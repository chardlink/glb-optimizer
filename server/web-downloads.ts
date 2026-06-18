import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { OutputFile } from '../shared/contracts.js'

const DOWNLOAD_RETENTION_MS = 24 * 60 * 60 * 1000
const runtimeRequire = createRequire(import.meta.url)
const { ZipArchive } = runtimeRequire('archiver') as {
  ZipArchive: new (options?: { zlib?: { level?: number } }) => {
    directory(source: string, dest: false | string): void
    finalize(): Promise<void>
    on(event: 'error', listener: (error: Error) => void): void
    pipe(destination: NodeJS.WritableStream): void
  }
}

export async function cleanupExpiredDownloads(downloadsDir: string) {
  await fs.mkdir(downloadsDir, { recursive: true })
  const entries = await fs.readdir(downloadsDir, { withFileTypes: true }).catch(() => [])
  const cutoff = Date.now() - DOWNLOAD_RETENTION_MS

  await Promise.all(
    entries.map(async (entry) => {
      const targetPath = join(downloadsDir, entry.name)
      const stats = await fs.stat(targetPath).catch(() => null)
      if (!stats || stats.mtimeMs >= cutoff) {
        return
      }

      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
    }),
  )
}

export async function createSingleDownloadArtifact({
  byteLength,
  downloadsDir,
  fileName,
  sourcePath,
  token,
}: {
  byteLength: number
  downloadsDir: string
  fileName: string
  sourcePath: string
  token: string
}): Promise<OutputFile> {
  const artifactDir = join(downloadsDir, token)
  const targetPath = join(artifactDir, fileName)

  await fs.rm(artifactDir, { recursive: true, force: true }).catch(() => undefined)
  await fs.mkdir(artifactDir, { recursive: true })
  await fs.copyFile(sourcePath, targetPath)

  return {
    byteLength,
    downloadPath: `/api/downloads/${token}`,
    fileName,
  }
}

export async function createBatchArchiveArtifact({
  downloadsDir,
  fileName,
  sourceDirectory,
  token,
}: {
  downloadsDir: string
  fileName: string
  sourceDirectory: string
  token: string
}): Promise<OutputFile> {
  const artifactDir = join(downloadsDir, token)
  const archivePath = join(artifactDir, fileName)

  await fs.rm(artifactDir, { recursive: true, force: true }).catch(() => undefined)
  await fs.mkdir(artifactDir, { recursive: true })
  await zipDirectoryContents(sourceDirectory, archivePath)

  const stats = await fs.stat(archivePath)
  return {
    byteLength: stats.size,
    downloadPath: `/api/downloads/${token}`,
    fileName,
  }
}

export async function resolveDownloadArtifact(downloadsDir: string, token: string) {
  const artifactDir = join(downloadsDir, token)
  const entries = await fs.readdir(artifactDir, { withFileTypes: true })
  const fileEntry = entries.find((entry) => entry.isFile())

  if (!fileEntry) {
    throw new Error('下载文件不存在。')
  }

  const filePath = join(artifactDir, fileEntry.name)
  return {
    fileName: fileEntry.name,
    filePath,
  }
}

async function zipDirectoryContents(sourceDirectory: string, archivePath: string) {
  await fs.mkdir(dirname(archivePath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(archivePath)
    const archive = new ZipArchive({ zlib: { level: 9 } })

    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory(sourceDirectory, false)
    void archive.finalize()
  })
}
