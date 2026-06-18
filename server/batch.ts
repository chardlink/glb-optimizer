import { promises as fs } from 'node:fs'
import { dirname, extname, join, posix } from 'node:path'
import type {
  BatchOptimizationProgress,
  BatchOptimizationSuccess,
  CompressionMode,
  OptimizationSuccess,
  OutputNamingRule,
} from '../shared/contracts.js'
import { JOB_FILES, getOptimizedPath } from './job-records.js'
import { buildOutputFileName, makeBaseName, optimizeModel, sanitizeOutputStem } from './optimizer.js'

interface BatchSourceInput {
  fileSize: number
  managedTemp?: boolean
  relativePath?: string
  sourceName: string
  tempPath: string
}

export interface OptimizeBatchOptions {
  batchDir: string
  batchId: string
  mode: CompressionMode
  namingRule?: OutputNamingRule
  onProgress?: (progress: BatchOptimizationProgress) => Promise<void> | void
  outputDir?: string
  sources: BatchSourceInput[]
  targetSavingsPercent?: number
}

interface BatchEntry {
  itemDir: string
  outputRelativePath: string
  result: OptimizationSuccess
}

export async function optimizeBatch({
  batchDir,
  batchId,
  mode,
  namingRule,
  onProgress,
  outputDir,
  sources,
  targetSavingsPercent,
}: OptimizeBatchOptions): Promise<BatchOptimizationSuccess> {
  const createdAt = new Date().toISOString()
  const itemsDir = join(batchDir, 'items')
  const entries: BatchEntry[] = []
  const usedOutputPaths = new Set<string>()

  await fs.mkdir(itemsDir, { recursive: true })

  for (const [index, source] of sources.entries()) {
    const itemLabel = `${String(index + 1).padStart(2, '0')}-${sanitizeOutputStem(makeBaseName(source.sourceName))}`
    const itemDir = join(itemsDir, itemLabel)
    const itemSourcePath = join(itemDir, JOB_FILES.input)
    const outputRelativePath = createOutputRelativePath({
      relativePath: source.relativePath ?? source.sourceName,
      index,
      namingRule,
      usedOutputPaths,
    })

    await fs.mkdir(itemDir, { recursive: true })
    if (source.managedTemp === false) {
      await fs.copyFile(source.tempPath, itemSourcePath)
    } else {
      await fs.rename(source.tempPath, itemSourcePath)
    }

    const result = await optimizeModel({
      jobDir: itemDir,
      jobId: `${batchId}-${String(index + 1).padStart(2, '0')}`,
      mode,
      namingRule,
      sourceName: source.sourceName,
      sourcePath: itemSourcePath,
      targetSavingsPercent,
    })

    const savedOutputFile = await saveBatchOutputFile({
      itemDir,
      outputDir,
      outputRelativePath,
      result,
    })

    entries.push({
      itemDir,
      outputRelativePath,
      result: {
        ...result,
        outputFile: savedOutputFile,
      },
    })

    await onProgress?.({
      completedCount: entries.length,
      outputBytes: savedOutputFile.byteLength,
      outputFileName: savedOutputFile.fileName,
      savingsPercent: result.savingsPercent,
      sourceCount: sources.length,
      sourceName: result.sourceName,
    })
  }

  const results = entries.map((entry) => entry.result)
  const totalInputBytes = results.reduce((sum, item) => sum + item.input.totalBytes, 0)
  const totalOutputBytes = results.reduce((sum, item) => sum + item.outputFile.byteLength, 0)
  const totalSavingsBytes = Math.max(0, totalInputBytes - totalOutputBytes)
  const totalSavingsPercent = totalInputBytes > 0 ? (totalSavingsBytes / totalInputBytes) * 100 : 0

  return {
    batchId,
    createdAt,
    mode: 'visual-lossy-batch',
    notes: createBatchNotes({
      outputDir,
      sourceCount: results.length,
      targetSavingsPercent,
      totalSavingsPercent,
    }),
    sourceCount: results.length,
    sourceNames: results.map((item) => item.sourceName),
    totalInputBytes,
    totalOutputBytes,
    totalSavingsBytes,
    totalSavingsPercent,
    ...(typeof targetSavingsPercent === 'number' ? { targetSavingsPercent } : {}),
    ...(outputDir ? { outputDirectory: outputDir } : {}),
    items: results.map((item) => ({
      blockedExtensions: item.blockedExtensions,
      notes: item.notes,
      outputBytes: item.outputFile.byteLength,
      outputFile: item.outputFile,
      savingsBytes: item.savingsBytes,
      savingsPercent: item.savingsPercent,
      sourceName: item.sourceName,
      ...(item.selectedProfile ? { selectedProfile: item.selectedProfile } : {}),
    })),
  }
}

async function saveBatchOutputFile({
  itemDir,
  outputDir,
  outputRelativePath,
  result,
}: {
  itemDir: string
  outputDir?: string
  outputRelativePath: string
  result: OptimizationSuccess
}) {
  if (!outputDir) {
    return {
      ...result.outputFile,
      fileName: outputRelativePath,
    }
  }

  const filePath = join(outputDir, ...outputRelativePath.split('/'))
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.copyFile(getOptimizedPath(itemDir), filePath)

  return {
    ...result.outputFile,
    fileName: outputRelativePath,
    filePath,
  }
}

function createBatchNotes({
  outputDir,
  sourceCount,
  targetSavingsPercent,
  totalSavingsPercent,
}: {
  outputDir?: string
  sourceCount: number
  targetSavingsPercent?: number
  totalSavingsPercent: number
}) {
  const notes = [
    `已按极致压缩模式处理 ${sourceCount} 个 GLB 文件。`,
    `目标压缩率为 ${formatPercent(targetSavingsPercent ?? 65)}，整批当前达到 ${formatPercent(totalSavingsPercent)}。`,
    '每个文件都会自动尝试多档压缩方案，并输出当前尽量小且尽量保真的结果。',
  ]

  if (outputDir) {
    notes.push(`输出结果已直接保存到：${outputDir}`)
  }

  return notes
}

function sanitizePathSegment(segment: string) {
  const cleaned = segment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'item'
}

export function createOutputRelativePath({
  relativePath,
  index,
  namingRule,
  usedOutputPaths,
}: {
  relativePath: string
  index: number
  namingRule?: OutputNamingRule
  usedOutputPaths: Set<string>
}) {
  const normalized = relativePath.replace(/\\/g, '/')
  const rawSegments = normalized.split('/').filter(Boolean).filter((segment) => segment !== '.' && segment !== '..')
  const segments = rawSegments.map(sanitizePathSegment)
  const fileName = segments.pop() ?? `model-${index + 1}.glb`
  const sourceName = extname(fileName).toLowerCase() === '.glb' ? fileName : `${fileName}.glb`

  let outputFileName = buildOutputFileName(sourceName, namingRule)
  if (namingRule?.mode === 'custom') {
    const customBaseName = sanitizeOutputStem(namingRule.value?.trim() ?? 'model')
    outputFileName = `${customBaseName}-${String(index + 1).padStart(3, '0')}.glb`
  }

  return ensureUniqueOutputRelativePath({
    directorySegments: segments,
    outputFileName,
    usedOutputPaths,
  })
}

function ensureUniqueOutputRelativePath({
  directorySegments,
  outputFileName,
  usedOutputPaths,
}: {
  directorySegments: string[]
  outputFileName: string
  usedOutputPaths: Set<string>
}) {
  const extension = extname(outputFileName) || '.glb'
  const baseName = extname(outputFileName) ? outputFileName.slice(0, -extension.length) : outputFileName

  let attempt = 0
  while (true) {
    const suffix = attempt === 0 ? '' : `-${String(attempt + 1).padStart(2, '0')}`
    const candidateName = `${baseName}${suffix}${extension}`
    const relativePath = posix.join(...directorySegments, candidateName)
    const lookupKey = relativePath.toLowerCase()

    if (!usedOutputPaths.has(lookupKey)) {
      usedOutputPaths.add(lookupKey)
      return relativePath
    }

    attempt += 1
  }
}

function formatPercent(value: number) {
  return `${value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`
}
