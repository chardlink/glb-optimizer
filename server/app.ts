import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, relative } from 'node:path'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { Request, Response } from 'express'
import multer from 'multer'
import type {
  BatchOptimizationStreamEvent,
  BatchOptimizationSuccess,
  CompressionMode,
  OptimizationSuccess,
  OutputNamingRule,
} from '../shared/contracts.js'
import { JOB_FILES, getOptimizedPath } from './job-records.js'
import {
  cleanupExpiredDownloads,
  createBatchArchiveArtifact,
  createSingleDownloadArtifact,
  resolveDownloadArtifact,
} from './web-downloads.js'

export interface OptimizerServerOptions {
  distDir?: string
  host?: string
  port?: number
  storageDir: string
}

export interface RunningOptimizerServer {
  host: string
  origin: string
  port: number
  stop(): Promise<void>
}

let optimizeModelPromise: Promise<typeof import('./optimizer.js')> | null = null
let optimizeBatchPromise: Promise<typeof import('./batch.js')> | null = null
const DOWNLOAD_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

export async function startOptimizerServer({
  distDir,
  host = '127.0.0.1',
  port = 4307,
  storageDir,
}: OptimizerServerOptions): Promise<RunningOptimizerServer> {
  const incomingDir = join(storageDir, 'incoming')
  const jobsDir = join(storageDir, 'jobs')
  const downloadsDir = join(storageDir, 'downloads')

  await Promise.all([
    fs.mkdir(incomingDir, { recursive: true }),
    fs.mkdir(jobsDir, { recursive: true }),
    fs.mkdir(downloadsDir, { recursive: true }),
  ])
  await cleanupExpiredDownloads(downloadsDir)
  const downloadCleanupTimer = setInterval(() => {
    void cleanupExpiredDownloads(downloadsDir).catch((error) => {
      console.error('Failed to cleanup expired web downloads:', error)
    })
  }, DOWNLOAD_CLEANUP_INTERVAL_MS)
  downloadCleanupTimer.unref?.()

  const upload = multer({
    storage: multer.diskStorage({
      destination: incomingDir,
      filename: (_request, file, callback) => {
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        callback(null, `${stamp}${extname(file.originalname) || '.glb'}`)
      },
    }),
    limits: {
      fileSize: 1024 * 1024 * 1024,
    },
  })

  const app = express()
  app.use(express.json())

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true })
  })

  app.get('/api/downloads/:token', async (request, response, next) => {
    try {
      const artifact = await resolveDownloadArtifact(downloadsDir, request.params.token)
      response.download(artifact.filePath, artifact.fileName)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/optimize', upload.single('file'), async (request, response, next) => {
    const uploadedFile = request.file

    if (!uploadedFile) {
      response.status(400).json({ error: '未接收到 GLB 文件。' })
      return
    }

    if (extname(uploadedFile.originalname).toLowerCase() !== '.glb') {
      await safeRemove(uploadedFile.path)
      response.status(400).json({ error: '当前仅支持 .glb 文件。' })
      return
    }

    const outputDir = parseOutputDirectory(request.body.outputDir)
    if (!outputDir) {
      await safeRemove(uploadedFile.path)
      response.status(400).json({ error: '请先选择输出目录。' })
      return
    }

    const namingRule = parseOutputNamingRule(request.body.outputNamingMode, request.body.outputNamingValue)
    if (!namingRule) {
      await safeRemove(uploadedFile.path)
      response.status(400).json({ error: '请设置有效的输出命名规则。' })
      return
    }

    const jobId = createJobId()
    const jobDir = join(jobsDir, jobId)
    const sourcePath = join(jobDir, JOB_FILES.input)
    const mode = parseCompressionMode()
    const targetSavingsPercent = parseTargetSavings(request.body.targetSavingsPercent)

    await fs.mkdir(jobDir, { recursive: true })
    await fs.rename(uploadedFile.path, sourcePath)

    try {
      const { optimizeModel } = await loadOptimizerModule()
      const result = await optimizeModel({
        jobDir,
        jobId,
        mode,
        namingRule,
        outputDir,
        sourceName: uploadedFile.originalname,
        sourcePath,
        targetSavingsPercent,
      })

      response.json(result)
    } catch (error) {
      next(error)
    } finally {
      await safeRemove(jobDir)
    }
  })

  app.post('/api/web/optimize', upload.single('file'), async (request, response, next) => {
    const uploadedFile = request.file

    if (!uploadedFile) {
      response.status(400).json({ error: '未接收到 GLB 文件。' })
      return
    }

    if (extname(uploadedFile.originalname).toLowerCase() !== '.glb') {
      await safeRemove(uploadedFile.path)
      response.status(400).json({ error: '当前仅支持 .glb 文件。' })
      return
    }

    const namingRule = parseOutputNamingRule(request.body.outputNamingMode, request.body.outputNamingValue)
    if (!namingRule) {
      await safeRemove(uploadedFile.path)
      response.status(400).json({ error: '请设置有效的输出命名规则。' })
      return
    }

    const jobId = createJobId()
    const jobDir = join(jobsDir, jobId)
    const sourcePath = join(jobDir, JOB_FILES.input)
    const mode = parseCompressionMode()
    const targetSavingsPercent = parseTargetSavings(request.body.targetSavingsPercent)

    await fs.mkdir(jobDir, { recursive: true })
    await fs.rename(uploadedFile.path, sourcePath)

    try {
      const { optimizeModel } = await loadOptimizerModule()
      const result = await optimizeModel({
        jobDir,
        jobId,
        mode,
        namingRule,
        sourceName: uploadedFile.originalname,
        sourcePath,
        targetSavingsPercent,
      })

      const downloadArtifact = await createSingleDownloadArtifact({
        byteLength: result.outputFile.byteLength,
        downloadsDir,
        fileName: result.outputFile.fileName,
        sourcePath: getOptimizedPath(jobDir),
        token: jobId,
      })

      response.json({
        ...result,
        outputFile: downloadArtifact,
      } satisfies OptimizationSuccess)
    } catch (error) {
      next(error)
    } finally {
      await safeRemove(jobDir)
    }
  })

  app.post('/api/optimize/batch', upload.array('files'), async (request, response, next) => {
    const uploadedFiles = (request.files as Express.Multer.File[] | undefined) ?? []
    const directoryPath = parseInputDirectory(request.body.directoryPath)

    if (uploadedFiles.length === 0 && !directoryPath) {
      response.status(400).json({ error: '未接收到 GLB 文件。' })
      return
    }

    const invalidFile = uploadedFiles.find((file) => extname(file.originalname).toLowerCase() !== '.glb')
    if (invalidFile) {
      await Promise.all(uploadedFiles.map((file) => safeRemove(file.path)))
      response.status(400).json({ error: '批量模式仅支持 .glb 文件。' })
      return
    }

    const outputDir = parseOutputDirectory(request.body.outputDir)
    if (!outputDir) {
      await Promise.all(uploadedFiles.map((file) => safeRemove(file.path)))
      response.status(400).json({ error: '请先选择输出目录。' })
      return
    }

    const namingRule = parseOutputNamingRule(request.body.outputNamingMode, request.body.outputNamingValue)
    if (!namingRule) {
      await Promise.all(uploadedFiles.map((file) => safeRemove(file.path)))
      response.status(400).json({ error: '请设置有效的输出命名规则。' })
      return
    }

    const batchId = createJobId()
    const batchDir = join(jobsDir, batchId)
    const mode = parseCompressionMode()
    const targetSavingsPercent = parseTargetSavings(request.body.targetSavingsPercent)
    const sourcePaths = parseBatchPaths(request.body.paths, uploadedFiles.length)

    await fs.mkdir(batchDir, { recursive: true })

    try {
      const directorySources = directoryPath ? await collectBatchDirectorySources(directoryPath) : []
      const uploadedSources = uploadedFiles.map((file, index) => ({
        fileSize: file.size,
        managedTemp: true as const,
        relativePath: sourcePaths[index],
        sourceName: sourcePaths[index] ?? file.originalname,
        tempPath: file.path,
      }))
      const sources = [...uploadedSources, ...directorySources]

      if (sources.length === 0) {
        response.status(400).json({ error: '选中的文件夹中没有可处理的 .glb 文件。' })
        return
      }

      const { optimizeBatch } = await loadBatchModule()
      response.status(200)
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      response.setHeader('Cache-Control', 'no-cache, no-transform')
      response.setHeader('X-Accel-Buffering', 'no')
      response.flushHeaders?.()

      const writeEvent = (event: BatchOptimizationStreamEvent) => {
        response.write(`${JSON.stringify(event)}\n`)
      }

      const result = await optimizeBatch({
        batchDir,
        batchId,
        mode,
        namingRule,
        onProgress(progress) {
          writeEvent({ type: 'progress', progress })
        },
        outputDir,
        sources,
        targetSavingsPercent,
      })

      writeEvent({ type: 'result', result })
      response.end()
    } catch (error) {
      if (response.headersSent) {
        const message = error instanceof Error ? error.message : '未知错误'
        response.write(
          `${JSON.stringify({ type: 'error', error: '批量处理失败。', notes: [message] } satisfies BatchOptimizationStreamEvent)}\n`,
        )
        response.end()
        return
      }

      next(error)
    } finally {
      await safeRemove(batchDir)
      await Promise.all(uploadedFiles.map((file) => safeRemove(file.path)))
    }
  })

  app.post('/api/web/optimize/batch', upload.array('files'), async (request, response, next) => {
    const uploadedFiles = (request.files as Express.Multer.File[] | undefined) ?? []

    if (uploadedFiles.length === 0) {
      response.status(400).json({ error: '未接收到 GLB 文件。' })
      return
    }

    const invalidFile = uploadedFiles.find((file) => extname(file.originalname).toLowerCase() !== '.glb')
    if (invalidFile) {
      await Promise.all(uploadedFiles.map((file) => safeRemove(file.path)))
      response.status(400).json({ error: '批量模式仅支持 .glb 文件。' })
      return
    }

    const namingRule = parseOutputNamingRule(request.body.outputNamingMode, request.body.outputNamingValue)
    if (!namingRule) {
      await Promise.all(uploadedFiles.map((file) => safeRemove(file.path)))
      response.status(400).json({ error: '请设置有效的输出命名规则。' })
      return
    }

    const batchId = createJobId()
    const batchDir = join(jobsDir, batchId)
    const webOutputDir = join(batchDir, 'web-output')
    const mode = parseCompressionMode()
    const targetSavingsPercent = parseTargetSavings(request.body.targetSavingsPercent)
    const sourcePaths = parseBatchPaths(request.body.paths, uploadedFiles.length)

    await fs.mkdir(batchDir, { recursive: true })

    try {
      const { optimizeBatch } = await loadBatchModule()
      response.status(200)
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      response.setHeader('Cache-Control', 'no-cache, no-transform')
      response.setHeader('X-Accel-Buffering', 'no')
      response.flushHeaders?.()

      const writeEvent = (event: BatchOptimizationStreamEvent) => {
        response.write(`${JSON.stringify(event)}\n`)
      }

      const desktopLikeResult = await optimizeBatch({
        batchDir,
        batchId,
        mode,
        namingRule,
        onProgress(progress) {
          writeEvent({ type: 'progress', progress })
        },
        outputDir: webOutputDir,
        sources: uploadedFiles.map((file, index) => ({
          fileSize: file.size,
          managedTemp: true as const,
          relativePath: sourcePaths[index],
          sourceName: sourcePaths[index] ?? file.originalname,
          tempPath: file.path,
        })),
        targetSavingsPercent,
      })

      const archiveFile = await createBatchArchiveArtifact({
        downloadsDir,
        fileName: `glb-batch-${batchId}.zip`,
        sourceDirectory: webOutputDir,
        token: batchId,
      })

      const result: BatchOptimizationSuccess = {
        ...desktopLikeResult,
        archiveFile,
        notes: desktopLikeResult.notes.filter((note) => !note.includes('保存到') && !note.includes('输出结果已直接保存到')),
        items: desktopLikeResult.items.map((item) => ({
          ...item,
          outputFile: {
            byteLength: item.outputFile.byteLength,
            fileName: item.outputFile.fileName,
          },
        })),
      }

      delete result.outputDirectory

      writeEvent({ type: 'result', result })
      response.end()
    } catch (error) {
      if (response.headersSent) {
        const message = error instanceof Error ? error.message : '未知错误'
        response.write(
          `${JSON.stringify({ type: 'error', error: '批量处理失败。', notes: [message] } satisfies BatchOptimizationStreamEvent)}\n`,
        )
        response.end()
        return
      }

      next(error)
    } finally {
      await safeRemove(batchDir)
      await Promise.all(uploadedFiles.map((file) => safeRemove(file.path)))
    }
  })

  if (distDir && existsSync(distDir)) {
    app.use(express.static(distDir))

    app.get(/^(?!\/api\/).*/, (_request, response) => {
      response.sendFile(join(distDir, 'index.html'))
    })
  }

  app.use((error: unknown, _request: Request, response: Response, next: unknown) => {
    void next
    console.error(error)
    response.status(500).json({
      error: '处理失败，请查看本地服务日志了解详情。',
      notes: [error instanceof Error ? error.message : '未知错误'],
    })
  })

  const server = createServer(app)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo | null
  if (!address) {
    throw new Error('压缩服务未能暴露有效的监听地址。')
  }

  const resolvedHost = host === '0.0.0.0' ? '127.0.0.1' : host
  const origin = `http://${resolvedHost}:${address.port}`

  return {
    host: resolvedHost,
    origin,
    port: address.port,
    stop() {
      clearInterval(downloadCleanupTimer)
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

function createJobId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseCompressionMode(): CompressionMode {
  return 'visual-lossy'
}

function parseOutputDirectory(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const outputDir = value.trim()
  return outputDir || undefined
}

function parseInputDirectory(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const directoryPath = value.trim()
  return directoryPath || undefined
}

function parseOutputNamingRule(modeValue: unknown, namingValue: unknown): OutputNamingRule | undefined {
  if (modeValue !== 'original' && modeValue !== 'suffix' && modeValue !== 'custom') {
    return undefined
  }

  if (modeValue === 'original') {
    return { mode: modeValue }
  }

  if (typeof namingValue !== 'string') {
    return undefined
  }

  const value = namingValue.trim()
  if (!value) {
    return undefined
  }

  return {
    mode: modeValue,
    value,
  }
}

function parseTargetSavings(value: unknown) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return Math.max(35, Math.min(90, parsed))
}

function loadOptimizerModule() {
  if (!optimizeModelPromise) {
    optimizeModelPromise = import('./optimizer.js')
  }

  return optimizeModelPromise
}

function loadBatchModule() {
  if (!optimizeBatchPromise) {
    optimizeBatchPromise = import('./batch.js')
  }

  return optimizeBatchPromise
}

function parseBatchPaths(value: unknown, expectedLength: number) {
  const values = Array.isArray(value) ? value : value ? [value] : []

  return values
    .map((item) => (typeof item === 'string' ? item.trim().replace(/\\/g, '/') : ''))
    .filter(Boolean)
    .slice(0, expectedLength)
}

async function collectBatchDirectorySources(directoryPath: string) {
  const entries: Array<{
    fileSize: number
    managedTemp: false
    relativePath: string
    sourceName: string
    tempPath: string
  }> = []

  async function walk(currentDirectory: string) {
    const children = await fs.readdir(currentDirectory, { withFileTypes: true })

    for (const child of children) {
      const absolutePath = join(currentDirectory, child.name)
      if (child.isDirectory()) {
        await walk(absolutePath)
        continue
      }

      if (!child.isFile() || extname(child.name).toLowerCase() !== '.glb') {
        continue
      }

      const stats = await fs.stat(absolutePath)
      const relativePath = relative(directoryPath, absolutePath).replaceAll('\\', '/')

      entries.push({
        fileSize: stats.size,
        managedTemp: false,
        relativePath,
        sourceName: relativePath,
        tempPath: absolutePath,
      })
    }
  }

  await walk(directoryPath)
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
  return entries
}

async function safeRemove(targetPath: string) {
  await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
}
