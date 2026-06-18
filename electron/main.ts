import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell } from 'electron'
import type {
  DesktopDirectoryPickResult,
  DesktopInputDirectoryEntry,
  DesktopInputDirectoryPickResult,
  DesktopPathRevealResult,
} from '../shared/contracts.js'
import type { RunningOptimizerServer } from '../server/app.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const APP_ID = 'com.chaolen.glb-lossless-optimizer'
const APP_NAME = 'GLB Compression Optimizer'
const APP_DISPLAY_NAME = 'GLB 压缩优化器'
const STARTUP_LOG_PATH = join(process.env.TEMP ?? process.cwd(), 'glb-lossless-optimizer.log')
const STARTUP_TIMEOUT_MS = 20_000
const DESKTOP_LAYOUT_MIN_WIDTH = 1200
const DESKTOP_LAYOUT_MIN_HEIGHT = 640

let mainWindow: BrowserWindow | null = null
let optimizerServer: RunningOptimizerServer | null = null
let optimizerServerPromise: Promise<RunningOptimizerServer> | null = null
let isStopping = false

void appendStartupLog('Main process module loaded.')

process.on('uncaughtException', (error) => {
  void reportFatalError('Uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  void reportFatalError('Unhandled rejection', reason)
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })

  void bootstrap()
}

ipcMain.handle('output:pick-directory', async (): Promise<DesktopDirectoryPickResult> => {
  if (!mainWindow) {
    return {
      canceled: false,
      error: '桌面窗口尚未准备就绪。',
    }
  }

  const selection = await dialog.showOpenDialog(mainWindow, {
    defaultPath: app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory'],
    title: '选择输出目录',
  })

  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true }
  }

  return {
    canceled: false,
    directoryPath: selection.filePaths[0],
  }
})

ipcMain.handle('input:pick-directory', async (): Promise<DesktopInputDirectoryPickResult> => {
  if (!mainWindow) {
    return {
      canceled: false,
      error: '桌面窗口尚未准备就绪。',
    }
  }

  const selection = await dialog.showOpenDialog(mainWindow, {
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory'],
    title: '选择包含 GLB 的文件夹',
  })

  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true }
  }

  const directoryPath = selection.filePaths[0]

  try {
    const entries = await collectGlbEntries(directoryPath)
    return {
      canceled: false,
      directoryPath,
      entries,
    }
  } catch (error) {
    return {
      canceled: false,
      error: toErrorMessage(error),
    }
  }
})

ipcMain.handle('path:reveal', async (_event, targetPath: string): Promise<DesktopPathRevealResult> => {
  if (!targetPath) {
    return {
      error: '未提供可打开的路径。',
    }
  }

  try {
    const stats = await fs.stat(targetPath)

    if (stats.isDirectory()) {
      const error = await shell.openPath(targetPath)
      return error ? { error } : {}
    }

    shell.showItemInFolder(targetPath)
    return {}
  } catch (error) {
    return {
      error: toErrorMessage(error),
    }
  }
})

async function bootstrap() {
  try {
    app.setName(APP_NAME)

    if (process.platform === 'win32') {
      app.setAppUserModelId(APP_ID)
    }

    await appendStartupLog('等待 Electron 应用就绪。')
    await app.whenReady()
    await appendStartupLog('Electron 应用已就绪。')

    Menu.setApplicationMenu(null)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow()
        return
      }

      focusMainWindow()
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        void stopAndQuit()
      }
    })

    app.on('before-quit', () => {
      if (!isStopping) {
        void stopServer()
      }
    })

    await createMainWindow()
  } catch (error) {
    await showStartupFailure(error)
  }
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow()
    return
  }

  await appendStartupLog('正在创建主窗口。')

  const metrics = getAdaptiveWindowMetrics()

  const window = new BrowserWindow({
    width: metrics.width,
    height: metrics.height,
    minWidth: metrics.minWidth,
    minHeight: metrics.minHeight,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: '#f7f3ea',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.js'),
      sandbox: false,
    },
  })

  mainWindow = window
  window.webContents.setZoomFactor(metrics.zoomFactor)

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    void appendStartupLog(
      `渲染进程加载失败，${errorCode}：${errorDescription}。目标：${validatedURL || '未知地址'}。`,
    )
  })

  await window.loadURL(makeStatusPage('正在启动本地压缩服务...', `日志文件：${STARTUP_LOG_PATH}`))
  window.show()
  focusMainWindow()

  try {
    const server = await ensureOptimizerServer()
    await appendStartupLog(`压缩服务已就绪：${server.origin}。`)
    await window.loadURL(server.origin)
    focusMainWindow()
  } catch (error) {
    const message = toErrorMessage(error)
    await appendStartupLog(`界面加载前启动失败：${message}`)

    if (!window.isDestroyed()) {
      await window.loadURL(makeStatusPage('启动失败。', `${message}\n\n请查看日志文件：\n${STARTUP_LOG_PATH}`))
      window.show()
      focusMainWindow()
    }

    dialog.showErrorBox(APP_DISPLAY_NAME, `启动失败。\n\n${message}\n\n日志：${STARTUP_LOG_PATH}`)
  }
}

async function ensureOptimizerServer() {
  if (optimizerServer) {
    return optimizerServer
  }

  if (!optimizerServerPromise) {
    optimizerServerPromise = withTimeout(
      loadOptimizerServer({
        distDir: join(app.getAppPath(), 'dist'),
        port: 0,
        storageDir: join(app.getPath('userData'), 'storage'),
      }),
      STARTUP_TIMEOUT_MS,
      '启动本地压缩服务超时。',
    )
      .then((server) => {
        optimizerServer = server
        return server
      })
      .catch((error) => {
        optimizerServerPromise = null
        throw error
      })
  }

  return optimizerServerPromise
}

async function loadOptimizerServer(options: {
  distDir: string
  port: number
  storageDir: string
}) {
  const { startOptimizerServer } = await import('../server/app.js')
  return startOptimizerServer(options)
}

function getAdaptiveWindowMetrics() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width: workWidth, height: workHeight } = display.workAreaSize
  const minWidth = Math.min(DESKTOP_LAYOUT_MIN_WIDTH, workWidth)
  const width = clampDimension(Math.round(workWidth * 0.9), minWidth, 1680)
  const height = clampDimension(Math.round(workHeight * 0.9), 680, 1180)

  let zoomFactor = 1
  if (workHeight <= 770) {
    zoomFactor = 0.88
  } else if (workHeight <= 900) {
    zoomFactor = 0.94
  } else if (workHeight >= 1400) {
    zoomFactor = 1.08
  } else if (workHeight >= 1150) {
    zoomFactor = 1.03
  }

  return {
    width,
    height,
    minWidth,
    minHeight: Math.min(height, DESKTOP_LAYOUT_MIN_HEIGHT),
    zoomFactor,
  }
}

function clampDimension(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
}

async function stopAndQuit() {
  if (isStopping) {
    return
  }

  isStopping = true
  await stopServer()
  app.quit()
}

async function stopServer() {
  const server = optimizerServer
  optimizerServer = null
  optimizerServerPromise = null

  if (!server) {
    return
  }

  try {
    await server.stop()
  } catch (error) {
    await appendStartupLog(`压缩服务未能正常停止：${toErrorMessage(error)}`)
  }
}

async function showStartupFailure(error: unknown) {
  const message = toErrorMessage(error)
  await appendStartupLog(`致命启动失败：${message}`)

  try {
    dialog.showErrorBox(APP_DISPLAY_NAME, `启动失败。\n\n${message}\n\n日志：${STARTUP_LOG_PATH}`)
  } finally {
    app.quit()
  }
}

async function reportFatalError(label: string, error: unknown) {
  await appendStartupLog(`${label}: ${toErrorMessage(error)}`)
}

async function appendStartupLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  await fs.appendFile(STARTUP_LOG_PATH, line).catch(() => undefined)
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message
  }

  return typeof error === 'string' ? error : JSON.stringify(error)
}

function makeStatusPage(title: string, detail: string) {
  const markup = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(APP_DISPLAY_NAME)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(160deg, #f7f3ea 0%, #efe1cf 100%);
        color: #2d2012;
      }
      main {
        width: min(560px, calc(100vw - 48px));
        padding: 28px 30px;
        border-radius: 24px;
        background: rgba(255, 252, 247, 0.92);
        box-shadow: 0 18px 60px rgba(70, 42, 14, 0.12);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
      }
      p {
        margin: 0;
        white-space: pre-wrap;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
    </main>
  </body>
</html>`

  return `data:text/html;charset=utf-8,${encodeURIComponent(markup)}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function collectGlbEntries(rootDirectory: string): Promise<DesktopInputDirectoryEntry[]> {
  const entries: DesktopInputDirectoryEntry[] = []

  async function walk(currentDirectory: string) {
    const children = await fs.readdir(currentDirectory, { withFileTypes: true })

    for (const child of children) {
      const absolutePath = join(currentDirectory, child.name)
      if (child.isDirectory()) {
        await walk(absolutePath)
        continue
      }

      if (!child.isFile() || !child.name.toLowerCase().endsWith('.glb')) {
        continue
      }

      const stats = await fs.stat(absolutePath)
      entries.push({
        relativePath: relative(rootDirectory, absolutePath).replaceAll('\\', '/'),
        size: stats.size,
      })
    }
  }

  await walk(rootDirectory)
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
  return entries
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timeoutHandle: NodeJS.Timeout | undefined

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }) as Promise<T>
}
