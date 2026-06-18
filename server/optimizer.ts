import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  dedup,
  draco,
  inspect,
  meshopt,
  prune,
  resample,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import type {
  CompressionMode,
  InspectionSummary,
  LossyProfileKey,
  OptimizationSuccess,
  OutputNamingRule,
  PipelineStep,
} from '../shared/contracts.js'
import { getOptimizedPath } from './job-records.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const runtimeRequire = createRequire(import.meta.url)

const PIPELINE_LABELS = {
  inspect: '检查',
  dedup: '去重',
  prune: '清理',
  resample: '重采样',
  simplify: '网格简化',
  texture: '贴图压缩',
  geometry: '几何压缩',
}

const LOSSY_PROFILES: LossyProfile[] = [
  {
    key: 'gentle',
    label: '保真优先',
    simplifyRatio: 0.92,
    simplifyError: 0.0008,
    textureQuality: 88,
    textureResize: [2048, 2048],
    geometry: {
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeColor: 8,
      quantizeGeneric: 12,
    },
  },
  {
    key: 'balanced',
    label: '平衡',
    simplifyRatio: 0.8,
    simplifyError: 0.0015,
    textureQuality: 80,
    textureResize: [2048, 2048],
    geometry: {
      quantizePosition: 13,
      quantizeNormal: 9,
      quantizeTexcoord: 11,
      quantizeColor: 8,
      quantizeGeneric: 10,
    },
  },
  {
    key: 'aggressive',
    label: '高压缩',
    simplifyRatio: 0.65,
    simplifyError: 0.003,
    textureQuality: 72,
    textureResize: [1024, 1024],
    geometry: {
      quantizePosition: 12,
      quantizeNormal: 8,
      quantizeTexcoord: 10,
      quantizeColor: 7,
      quantizeGeneric: 9,
    },
  },
  {
    key: 'extreme',
    label: '极限',
    simplifyRatio: 0.5,
    simplifyError: 0.006,
    textureQuality: 62,
    textureResize: [768, 768],
    geometry: {
      quantizePosition: 11,
      quantizeNormal: 8,
      quantizeTexcoord: 10,
      quantizeColor: 7,
      quantizeGeneric: 8,
    },
  },
]

let ioPromise: Promise<NodeIO> | undefined
let sharpEncoderPromise: Promise<unknown | undefined> | undefined

export interface OptimizeOptions {
  jobDir: string
  jobId: string
  namingRule?: OutputNamingRule
  sourceName: string
  sourcePath: string
  mode?: CompressionMode
  outputDir?: string
  targetSavingsPercent?: number
}

interface LossyProfile {
  key: LossyProfileKey
  label: string
  simplifyRatio: number
  simplifyError: number
  textureQuality: number
  textureResize: [number, number]
  geometry: {
    quantizePosition: number
    quantizeNormal: number
    quantizeTexcoord: number
    quantizeColor: number
    quantizeGeneric: number
  }
}

interface LossyCandidate {
  outputPath: string
  profile: LossyProfile
  output: InspectionSummary
  outputBytes: number
  savingsBytes: number
  savingsPercent: number
  notes: string[]
  steps: PipelineStep[]
  geometryCodec: 'draco' | 'meshopt' | 'none'
}

async function loadSharpEncoder(): Promise<unknown | undefined> {
  if (!sharpEncoderPromise) {
    sharpEncoderPromise = tryLoadSharpEncoder()
  }

  return sharpEncoderPromise
}

async function tryLoadSharpEncoder(): Promise<unknown | undefined> {
  const candidates = new Set<string>()
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath

  if (resourcesPath) {
    candidates.add(join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp'))
    candidates.add(join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'ndarray-pixels', 'node_modules', 'sharp'))
  }

  candidates.add(join(__dirname, '..', '..', 'node_modules', 'sharp'))
  candidates.add(join(process.cwd(), 'node_modules', 'sharp'))

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) {
        continue
      }

      const required = runtimeRequire(candidate)
      const encoder = required?.default ?? required
      if (await canUseSharpEncoder(encoder)) {
        return encoder
      }
    } catch {
      // Try the next candidate path.
    }
  }

  try {
    const encoder = (await import('sharp')).default
    if (await canUseSharpEncoder(encoder)) {
      return encoder
    }
  } catch {
    // Fall through to undefined so the caller can skip texture re-encoding.
  }

  return undefined
}

async function canUseSharpEncoder(encoder: unknown): Promise<boolean> {
  if (typeof encoder !== 'function') {
    return false
  }

  try {
    const probe = encoder({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })

    if (!probe || typeof probe.png !== 'function' || typeof probe.toBuffer !== 'function') {
      return false
    }

    await probe.png().toBuffer()
    return true
  } catch {
    return false
  }
}

export async function optimizeModel(options: OptimizeOptions): Promise<OptimizationSuccess> {
  return optimizeVisualLossy({
    ...options,
    mode: 'visual-lossy',
  })
}

export async function optimizeVisualLossy({
  jobDir,
  jobId,
  namingRule,
  outputDir,
  sourceName,
  sourcePath,
  targetSavingsPercent,
}: OptimizeOptions): Promise<OptimizationSuccess> {
  const io = await getIO()
  const createdAt = new Date().toISOString()
  const optimizedPath = getOptimizedPath(jobDir)
  const target = clampTargetSavings(targetSavingsPercent)

  const originalBytes = await fs.readFile(sourcePath)
  const inputDocument = await io.read(sourcePath)
  const input = summarizeInspection(inputDocument, originalBytes.byteLength)

  const selection = await selectLossyCandidate({
    input,
    io,
    jobDir,
    sourcePath,
    targetSavingsPercent: target,
  })

  const chosen = selection.selected
  const blockedExtensions: string[] = []
  let finalOutput = chosen.output
  let finalBuffer = await fs.readFile(chosen.outputPath)
  let fellBackToSource = false

  if (finalBuffer.byteLength >= originalBytes.byteLength) {
    await fs.copyFile(sourcePath, optimizedPath)
    finalBuffer = await fs.readFile(optimizedPath)
    finalOutput = input
    fellBackToSource = true
  } else {
    await fs.copyFile(chosen.outputPath, optimizedPath)
  }

  await cleanupCandidateFiles(selection.candidates.map((candidate) => candidate.outputPath))

  const steps = [...chosen.steps]

  const actualSavingsPercent =
    input.totalBytes > 0 ? Math.max(0, ((input.totalBytes - finalBuffer.byteLength) / input.totalBytes) * 100) : 0

  const outputFile = await saveOutputFile({
    byteLength: finalBuffer.byteLength,
    fileName: buildOutputFileName(sourceName, namingRule),
    optimizedPath,
    outputDir,
  })

  const result: OptimizationSuccess = {
    jobId,
    sourceName,
    createdAt,
    mode: 'visual-lossy',
    blockedExtensions,
    input,
    output: finalOutput,
    savingsBytes: Math.max(0, input.totalBytes - finalBuffer.byteLength),
    savingsPercent: actualSavingsPercent,
    targetSavingsPercent: target,
    selectedProfile: chosen.profile.key,
    attemptedProfiles: selection.candidates.map((candidate) => candidate.profile.key),
    notes: createLossyNotes({
      attemptedProfiles: selection.candidates.map((candidate) => candidate.profile),
      actualSavingsPercent,
      candidateNotes: chosen.notes,
      fellBackToSource,
      geometryCodec: chosen.geometryCodec,
      input,
      selectedProfile: chosen.profile,
      targetMet: !fellBackToSource && chosen.savingsPercent >= target,
      targetSavingsPercent: target,
    }),
    steps,
    outputFile,
  }

  return result
}

async function selectLossyCandidate({
  input,
  io,
  jobDir,
  sourcePath,
  targetSavingsPercent,
}: {
  input: InspectionSummary
  io: NodeIO
  jobDir: string
  sourcePath: string
  targetSavingsPercent: number
}) {
  const startIndex = getStartProfileIndex(targetSavingsPercent)
  const cache = new Map<number, LossyCandidate>()

  const runProfile = async (index: number) => {
    const cached = cache.get(index)
    if (cached) {
      return cached
    }

    const profile = LOSSY_PROFILES[index]
    const candidate = await runLossyCandidate({
      input,
      io,
      outputPath: join(jobDir, `candidate-${profile.key}.glb`),
      profile,
      sourcePath,
    })

    cache.set(index, candidate)
    return candidate
  }

  let selected = await runProfile(startIndex)
  let smallest = selected

  if (selected.savingsPercent >= targetSavingsPercent) {
    for (let index = startIndex - 1; index >= 0; index -= 1) {
      const softer = await runProfile(index)
      if (softer.outputBytes < smallest.outputBytes) {
        smallest = softer
      }
      if (softer.savingsPercent >= targetSavingsPercent) {
        selected = softer
        continue
      }
      break
    }
  } else {
    for (let index = startIndex + 1; index < LOSSY_PROFILES.length; index += 1) {
      const stronger = await runProfile(index)
      if (stronger.outputBytes < smallest.outputBytes) {
        smallest = stronger
      }
      if (stronger.savingsPercent >= targetSavingsPercent) {
        selected = stronger
        return {
          candidates: [...cache.values()].sort((left, right) => profileOrder(left.profile.key) - profileOrder(right.profile.key)),
          selected,
        }
      }
    }
    selected = smallest
  }

  return {
    candidates: [...cache.values()].sort((left, right) => profileOrder(left.profile.key) - profileOrder(right.profile.key)),
    selected,
  }
}

async function runLossyCandidate({
  input,
  io,
  outputPath,
  profile,
  sourcePath,
}: {
  input: InspectionSummary
  io: NodeIO
  outputPath: string
  profile: LossyProfile
  sourcePath: string
}): Promise<LossyCandidate> {
  const workingDocument = await io.read(sourcePath)
  const root = workingDocument.getRoot()
  const hasAnimations = root.listAnimations().length > 0
  const hasSkins = root.listSkins().length > 0
  const hasMeshes = root.listMeshes().length > 0
  const hasTextures = root.listTextures().length > 0

  const steps: PipelineStep[] = [createStep('inspect', 'done', `进入“${profile.label}”方案评估。`)]
  const notes: string[] = []

  await workingDocument.transform(dedup())
  steps.push(createStep('dedup', 'done', '已合并重复的 accessor、贴图引用和属性数据。'))

  await workingDocument.transform(prune())
  steps.push(createStep('prune', 'done', '已移除未使用的节点、材质、贴图和几何资源。'))

  if (hasAnimations) {
    await workingDocument.transform(resample())
    steps.push(createStep('resample', 'done', '已无损去除重复的动画关键帧。'))
  } else {
    steps.push(createStep('resample', 'skipped', '输入文件不包含动画片段。'))
  }

  if (!hasMeshes) {
    steps.push(
      createStep('simplify', 'skipped', '模型不包含网格，已跳过网格简化。'),
      createStep('geometry', 'skipped', '模型不包含网格，已跳过几何压缩。'),
    )
  } else if (hasAnimations || hasSkins) {
    steps.push(createStep('simplify', 'skipped', '检测到动画或骨骼，为降低风险已跳过网格简化。'))
    notes.push('模型包含动画或骨骼，本次仅执行贴图压缩和几何编码，不减少网格面数。')
  } else {
    try {
      await workingDocument.transform(
        weld(),
        simplify({
          simplifier: MeshoptSimplifier,
          ratio: profile.simplifyRatio,
          error: profile.simplifyError,
        }),
      )
      steps.push(
        createStep(
          'simplify',
          'done',
          `已执行可控网格简化，目标保留 ${(profile.simplifyRatio * 100).toFixed(0)}% 几何，误差阈值 ${profile.simplifyError}。`,
        ),
      )
    } catch (error) {
      steps.push(createStep('simplify', 'skipped', '网格简化失败，已回退为不简化网格。'))
      notes.push(`网格简化未成功，已自动跳过：${toErrorMessage(error)}`)
    }
  }

  if (!hasTextures) {
    steps.push(createStep('texture', 'skipped', '模型不包含贴图，已跳过贴图压缩。'))
  } else {
    try {
      const sharpEncoder = await loadSharpEncoder()
      if (!sharpEncoder) {
        throw new Error('Sharp encoder unavailable in desktop runtime.')
      }
      await workingDocument.transform(
        textureCompress({
          targetFormat: 'webp',
          resize: profile.textureResize,
          quality: profile.textureQuality,
          encoder: sharpEncoder,
        }),
      )
      steps.push(
        createStep(
          'texture',
          'done',
          sharpEncoder
            ? `已将贴图转换为 WebP，并限制到 ${profile.textureResize[0]}px 以内，质量 ${profile.textureQuality}。`
            : `已将贴图转换为 WebP，并限制到 ${profile.textureResize[0]}px 以内。当前环境未加载 sharp，已自动切换为兼容压缩器。`,
        ),
      )
      if (!sharpEncoder) {
        notes.push('当前运行环境无法加载 sharp，贴图压缩已自动切换为兼容实现，稳定性更高，但质量控制会稍弱。')
      }
    } catch (error) {
      steps.push(createStep('texture', 'skipped', '贴图压缩失败，已保留原始贴图编码。'))
      notes.push(`贴图压缩未成功，已自动保留原始贴图：${toErrorMessage(error)}`)
    }
  }

  let geometryCodec: LossyCandidate['geometryCodec'] = 'none'
  if (hasMeshes) {
    try {
      await workingDocument.transform(
        draco({
          method: 'edgebreaker',
          quantizePosition: profile.geometry.quantizePosition,
          quantizeNormal: profile.geometry.quantizeNormal,
          quantizeTexcoord: profile.geometry.quantizeTexcoord,
          quantizeColor: profile.geometry.quantizeColor,
          quantizeGeneric: profile.geometry.quantizeGeneric,
        }),
      )
      geometryCodec = 'draco'
      steps.push(
        createStep(
          'geometry',
          'done',
          `已使用 Draco 压缩几何数据，位置 ${profile.geometry.quantizePosition} bit，法线 ${profile.geometry.quantizeNormal} bit。`,
        ),
      )
    } catch (dracoError) {
      try {
        await workingDocument.transform(
          meshopt({
            encoder: MeshoptEncoder,
            level: 'high',
            quantizePosition: profile.geometry.quantizePosition,
            quantizeNormal: profile.geometry.quantizeNormal,
            quantizeTexcoord: profile.geometry.quantizeTexcoord,
            quantizeColor: profile.geometry.quantizeColor,
            quantizeGeneric: profile.geometry.quantizeGeneric,
          }),
        )
        geometryCodec = 'meshopt'
        steps.push(createStep('geometry', 'done', 'Draco 压缩失败，已自动回退为 Meshopt 几何压缩。'))
        notes.push(`Draco 压缩失败，已回退为 Meshopt：${toErrorMessage(dracoError)}`)
      } catch (meshoptError) {
        steps.push(createStep('geometry', 'skipped', '几何压缩失败，已保留原始几何编码。'))
        notes.push(`几何压缩未成功，已自动保留原始几何：${toErrorMessage(meshoptError)}`)
      }
    }
  }

  await io.write(outputPath, workingDocument)

  const optimizedBuffer = await fs.readFile(outputPath)
  const output = summarizeInspection(workingDocument, optimizedBuffer.byteLength)

  return {
    outputPath,
    profile,
    output,
    outputBytes: optimizedBuffer.byteLength,
    savingsBytes: Math.max(0, input.totalBytes - optimizedBuffer.byteLength),
    savingsPercent:
      input.totalBytes > 0 ? Math.max(0, ((input.totalBytes - optimizedBuffer.byteLength) / input.totalBytes) * 100) : 0,
    notes,
    steps,
    geometryCodec,
  }
}

async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])

  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    })
}

function getIO() {
  if (!ioPromise) {
    ioPromise = createIO()
  }

  return ioPromise
}

async function saveOutputFile({
  byteLength,
  fileName,
  optimizedPath,
  outputDir,
}: {
  byteLength: number
  fileName: string
  optimizedPath: string
  outputDir?: string
}) {
  if (!outputDir) {
    return {
      byteLength,
      fileName,
    }
  }

  await fs.mkdir(outputDir, { recursive: true })
  const filePath = join(outputDir, fileName)
  await fs.copyFile(optimizedPath, filePath)

  return {
    byteLength,
    fileName,
    filePath,
  }
}

function createLossyNotes({
  attemptedProfiles,
  actualSavingsPercent,
  candidateNotes,
  fellBackToSource,
  geometryCodec,
  input,
  selectedProfile,
  targetMet,
  targetSavingsPercent,
}: {
  attemptedProfiles: LossyProfile[]
  actualSavingsPercent: number
  candidateNotes: string[]
  fellBackToSource: boolean
  geometryCodec: LossyCandidate['geometryCodec']
  input: InspectionSummary
  selectedProfile: LossyProfile
  targetMet: boolean
  targetSavingsPercent: number
}) {
  const sizes = [
    { label: '贴图', size: input.textureBytes },
    { label: '网格', size: input.meshBytes },
    { label: '动画', size: input.animationBytes },
  ].sort((left, right) => right.size - left.size)

  const notes = [
    `当前模型主要体积来自${sizes[0]?.label ?? '结构数据'}。视觉优先模式会执行有损压缩，以尽量逼近 ${formatPercentText(targetSavingsPercent)}% 目标。`,
    `已尝试方案：${attemptedProfiles.map((profile) => profile.label).join(' -> ')}。最终采用“${selectedProfile.label}”。`,
  ]

  if (fellBackToSource) {
    notes.push('即使经过有损压缩，本次结果仍未比原文件更小，输出已安全回退为原始 GLB。')
  } else if (targetMet) {
    notes.push(`最终压缩比例为 ${formatPercentText(actualSavingsPercent)}%，已达到目标。`)
  } else {
    notes.push(`最终压缩比例为 ${formatPercentText(actualSavingsPercent)}%，未达到目标，已输出本轮尝试中体积最小的版本。`)
  }

  if (geometryCodec === 'draco') {
    notes.push('当前输出启用了 Draco 几何压缩，并使用 WebP 贴图扩展。使用前请确认目标引擎或查看器支持这些扩展。')
  } else if (geometryCodec === 'meshopt') {
    notes.push('当前输出启用了 Meshopt 几何压缩，并使用 WebP 贴图扩展。使用前请确认目标引擎或查看器支持这些扩展。')
  } else {
    notes.push('当前输出没有成功启用额外几何编码，但仍可能包含有损网格简化和 WebP 贴图。')
  }

  return [...notes, ...candidateNotes]
}

function summarizeInspection(document: Awaited<ReturnType<NodeIO['read']>>, totalBytes: number): InspectionSummary {
  const report = inspect(document)
  const warnings = [
    ...(report.scenes.warnings ?? []),
    ...(report.meshes.warnings ?? []),
    ...(report.materials.warnings ?? []),
    ...(report.textures.warnings ?? []),
    ...(report.animations.warnings ?? []),
  ]

  return {
    totalBytes,
    sceneCount: report.scenes.properties.length,
    meshCount: report.meshes.properties.length,
    materialCount: report.materials.properties.length,
    textureCount: report.textures.properties.length,
    animationCount: report.animations.properties.length,
    renderVertexCount: report.scenes.properties.reduce((sum, item) => sum + item.renderVertexCount, 0),
    uploadVertexCount: report.scenes.properties.reduce((sum, item) => sum + item.uploadVertexCount, 0),
    estimatedDrawCalls: report.meshes.properties.reduce((sum, item) => sum + item.glPrimitives * Math.max(item.instances, 1), 0),
    meshBytes: report.meshes.properties.reduce((sum, item) => sum + item.size, 0),
    textureBytes: report.textures.properties.reduce((sum, item) => sum + item.size, 0),
    animationBytes: report.animations.properties.reduce((sum, item) => sum + item.size, 0),
    warnings: [...new Set(warnings)],
    extensionsUsed: document.getRoot().listExtensionsUsed().map((extension) => extension.extensionName).sort(),
  }
}

function createStep(key: PipelineStep['key'], status: PipelineStep['status'], detail: string): PipelineStep {
  return {
    key,
    label: PIPELINE_LABELS[key],
    status,
    detail,
  }
}

export function makeBaseName(sourceName: string) {
  const extension = extname(sourceName)
  return extension ? basename(sourceName, extension) : sourceName
}

export function sanitizeOutputStem(value: string, fallback = 'model') {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned || fallback
}

export function buildOutputFileName(sourceName: string, namingRule?: OutputNamingRule) {
  const baseName = makeBaseName(sourceName)
  const normalizedBaseName = sanitizeOutputStem(baseName)

  if (!namingRule || namingRule.mode === 'original') {
    return `${normalizedBaseName}.glb`
  }

  const rawValue = namingRule.value?.trim() ?? ''
  const normalizedValue = sanitizeOutputStem(rawValue)

  if (namingRule.mode === 'custom') {
    return `${normalizedValue}.glb`
  }

  return `${normalizedBaseName}_${normalizedValue}.glb`
}

function clampTargetSavings(value?: number) {
  if (!Number.isFinite(value)) {
    return 65
  }

  return Math.max(35, Math.min(90, Number(value)))
}

function getStartProfileIndex(targetSavingsPercent: number) {
  if (targetSavingsPercent >= 80) {
    return 3
  }
  if (targetSavingsPercent >= 65) {
    return 2
  }
  if (targetSavingsPercent >= 50) {
    return 1
  }
  return 0
}

function profileOrder(key: LossyProfileKey) {
  return LOSSY_PROFILES.findIndex((profile) => profile.key === key)
}

function formatPercentText(value: number) {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

async function cleanupCandidateFiles(paths: string[]) {
  await Promise.all(paths.map((path: string) => fs.rm(path, { force: true }).catch(() => undefined)))
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === 'string' ? error : JSON.stringify(error)
}
