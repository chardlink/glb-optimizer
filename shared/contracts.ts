export type CompressionMode = 'visual-lossy'

export type BatchCompressionMode = 'visual-lossy-batch'

export type LossyProfileKey = 'gentle' | 'balanced' | 'aggressive' | 'extreme'

export type PipelineStepStatus = 'done' | 'skipped' | 'not-requested'

export type OutputNamingMode = 'original' | 'suffix' | 'custom'

export interface OutputNamingRule {
  mode: OutputNamingMode
  value?: string
}

export interface DesktopDirectoryPickResult {
  canceled: boolean
  directoryPath?: string
  error?: string
}

export interface DesktopInputDirectoryEntry {
  relativePath: string
  size: number
}

export interface DesktopInputDirectoryPickResult {
  canceled: boolean
  directoryPath?: string
  entries?: DesktopInputDirectoryEntry[]
  error?: string
}

export interface DesktopPathRevealResult {
  error?: string
}

export interface OutputFile {
  fileName: string
  byteLength: number
  downloadPath?: string
  filePath?: string
}

export interface InspectionSummary {
  totalBytes: number
  sceneCount: number
  meshCount: number
  materialCount: number
  textureCount: number
  animationCount: number
  renderVertexCount: number
  uploadVertexCount: number
  estimatedDrawCalls: number
  meshBytes: number
  textureBytes: number
  animationBytes: number
  warnings: string[]
  extensionsUsed: string[]
}

export interface PipelineStep {
  key: 'inspect' | 'dedup' | 'prune' | 'resample' | 'simplify' | 'texture' | 'geometry'
  label: string
  status: PipelineStepStatus
  detail: string
}

export interface OptimizationSuccess {
  jobId: string
  sourceName: string
  createdAt: string
  mode: CompressionMode
  blockedExtensions: string[]
  input: InspectionSummary
  output: InspectionSummary
  savingsBytes: number
  savingsPercent: number
  targetSavingsPercent?: number
  selectedProfile?: LossyProfileKey
  attemptedProfiles?: LossyProfileKey[]
  notes: string[]
  steps: PipelineStep[]
  outputFile: OutputFile
}

export interface BatchOptimizationItem {
  blockedExtensions: string[]
  notes: string[]
  outputBytes: number
  outputFile: OutputFile
  savingsBytes: number
  savingsPercent: number
  sourceName: string
  selectedProfile?: LossyProfileKey
}

export interface BatchOptimizationProgress {
  completedCount: number
  outputBytes: number
  outputFileName: string
  savingsPercent: number
  sourceCount: number
  sourceName: string
}

export interface BatchOptimizationSuccess {
  archiveFile?: OutputFile
  batchId: string
  createdAt: string
  mode: BatchCompressionMode
  notes: string[]
  sourceCount: number
  sourceNames: string[]
  totalInputBytes: number
  totalOutputBytes: number
  totalSavingsBytes: number
  totalSavingsPercent: number
  targetSavingsPercent?: number
  outputDirectory?: string
  items: BatchOptimizationItem[]
}

export type BatchOptimizationStreamEvent =
  | { type: 'progress'; progress: BatchOptimizationProgress }
  | { type: 'result'; result: BatchOptimizationSuccess }
  | { type: 'error'; error: string; notes?: string[] }
