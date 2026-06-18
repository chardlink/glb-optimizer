import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, '..')
const npmCommand = 'npm'
const nodeCommand = process.execPath
const host = process.env.HOST || '0.0.0.0'
const port = process.env.PORT || '4307'

function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

function run(command, args, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`[deploy] ${label}`)
    const env = {
      ...process.env,
      HOST: host,
      PORT: port,
    }
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArg).join(' ')], {
            cwd: rootDir,
            env,
            stdio: 'inherit',
            shell: false,
          })
        : spawn(command, args, {
            cwd: rootDir,
            env,
            stdio: 'inherit',
            shell: false,
          })

    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(new Error(`${label} failed with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`))
    })
  })
}

function startServer() {
  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`[deploy] Starting web server on http://127.0.0.1:${port}`)
    console.log('[deploy] Press Ctrl+C to stop.')

    const child = spawn(nodeCommand, ['build/server/index.js'], {
      cwd: rootDir,
      env: {
        ...process.env,
        HOST: host,
        PORT: port,
      },
      stdio: 'inherit',
      shell: false,
    })

    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal)
      }
    }

    process.on('SIGINT', forwardSignal)
    process.on('SIGTERM', forwardSignal)

    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)

      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        resolvePromise()
        return
      }

      rejectPromise(new Error(`Web server exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`))
    })
  })
}

try {
  await run(npmCommand, ['install'], 'Install dependencies')
  await run(npmCommand, ['run', 'build'], 'Build project')
  await startServer()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[deploy] ${message}`)
  process.exit(1)
}
