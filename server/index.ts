import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startOptimizerServer } from './app.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isBuiltRuntime = basename(dirname(__dirname)) === 'build'
const rootDir = isBuiltRuntime ? join(__dirname, '..', '..') : join(__dirname, '..')
const distDir = join(rootDir, 'dist')
const storageDir = join(rootDir, 'storage')
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 4307)

const server = await startOptimizerServer({
  distDir,
  host,
  port,
  storageDir,
})

console.log(`GLB lossless optimizer server listening on ${server.origin}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.stop().finally(() => {
      process.exit(0)
    })
  })
}
