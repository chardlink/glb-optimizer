import { startTransition, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type SVGProps } from 'react'
import './App.css'
import './WebApp.css'
import type {
  BatchOptimizationProgress,
  BatchOptimizationSuccess,
  BatchOptimizationStreamEvent,
  OptimizationSuccess,
  OutputNamingMode,
  PipelineStep,
} from '../shared/contracts.js'

type ApiError = {
  error: string
  notes?: string[]
}

type UploadMode = 'single' | 'batch'

type DirectoryFile = File & {
  webkitRelativePath?: string
}

type SelectedItem = {
  displayName: string
  size: number
}

type ViewStepStatus = PipelineStep['status'] | 'pending' | 'active'

type ViewStep = {
  detail: string
  key: PipelineStep['key']
  label: string
  lastCompletedSourceName?: string
  progressPending?: boolean
  progressCurrent?: number
  progressTotal?: number
  status: ViewStepStatus
}

type MetricItem = {
  accent?: boolean
  label: string
  note?: string
  value: string
}

type BatchRow = {
  fileName: string
  outputSize: string
  savings: string
}

type PipelinePlayback = {
  activeIndex: number
  completedCount: number
  lastCompletedSourceName?: string
  sourceCount: number
}

type IconProps = SVGProps<SVGSVGElement>

const byteFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
})

const PIPELINE_TEMPLATE: Array<{ key: PipelineStep['key']; label: string; blurb: string }> = [
  { key: 'inspect', label: '检查', blurb: '解析 GLB 结构并识别资源占比。' },
  { key: 'dedup', label: '去重', blurb: '合并重复引用和重复资源。' },
  { key: 'prune', label: '清理', blurb: '移除未被使用的节点、材质和贴图。' },
  { key: 'resample', label: '重采样', blurb: '有动画时先整理关键帧。' },
  { key: 'simplify', label: '网格简化', blurb: '按误差阈值减少网格顶点和面数。' },
  { key: 'texture', label: '贴图压缩', blurb: '重编码贴图并缩小尺寸。' },
  { key: 'geometry', label: '几何压缩', blurb: '使用 Draco 或 Meshopt 压缩几何数据。' },
]

const VISIBLE_PIPELINE_TEMPLATE = PIPELINE_TEMPLATE.filter((step) => step.key !== 'resample')

function CubeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Z" />
      <path d="M12 12 4 7" />
      <path d="M12 12l8-5" />
      <path d="M12 12v9.5" />
    </svg>
  )
}

function ShieldIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3.5 18.5 6v5.2c0 4.1-2.4 7.8-6.5 9.3-4.1-1.5-6.5-5.2-6.5-9.3V6L12 3.5Z" />
      <path d="m9.2 11.8 1.9 1.9 3.7-4.1" />
    </svg>
  )
}

function BookIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h11v16H7A2.5 2.5 0 0 0 4.5 21V5.5Z" />
      <path d="M18 19a2.5 2.5 0 0 0-2.5-2.5H7" />
    </svg>
  )
}

function CloseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </svg>
  )
}

function UploadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7.5 18H7A4.5 4.5 0 1 1 8.2 9.16 5.5 5.5 0 0 1 18.94 11a3.75 3.75 0 0 1-.94 7H16.5" />
      <path d="m12 8.5 3.25 3.25" />
      <path d="M12 8.5 8.75 11.75" />
      <path d="M12 8.75V19" />
    </svg>
  )
}

function FileIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H8Z" />
      <path d="M14 3.5V8h4" />
    </svg>
  )
}

function FolderIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2 2h6A2.5 2.5 0 0 1 20.5 8.5v9A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-11Z" />
    </svg>
  )
}

function SearchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  )
}

function LayersIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 4 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </svg>
  )
}

function ScissorsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="m20 4-9.2 9.2" />
      <path d="m14.5 14.5 5.5 5.5" />
      <path d="m9 9 4.5 4.5" />
    </svg>
  )
}

function WaveIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 12h3l2-5 3 10 3-8 2 3h4" />
    </svg>
  )
}

function MeshIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m5 7 7-4 7 4v10l-7 4-7-4V7Z" />
      <path d="m5 7 7 4 7-4" />
      <path d="M12 11v10" />
    </svg>
  )
}

function ImageIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m20.5 16-4.5-4.5-5.5 5.5-2.5-2.5-4.5 4.5" />
    </svg>
  )
}

function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 6.5v11l9-5.5-9-5.5Z" />
    </svg>
  )
}

function getStepIcon(key: PipelineStep['key']) {
  switch (key) {
    case 'inspect':
      return SearchIcon
    case 'dedup':
      return LayersIcon
    case 'prune':
      return ScissorsIcon
    case 'resample':
      return WaveIcon
    case 'simplify':
      return MeshIcon
    case 'texture':
      return ImageIcon
    case 'geometry':
      return CubeIcon
  }
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** exponent
  return `${byteFormatter.format(scaled)} ${units[exponent]}`
}

function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`
}

async function readApiError(response: Response): Promise<ApiError> {
  try {
    return (await response.json()) as ApiError
  } catch {
    const fallback = (await response.text()).trim()

    return {
      error: fallback || `请求失败，状态码 ${response.status}。`,
    }
  }
}

async function readBatchStream(
  response: Response,
  onProgress: (progress: BatchOptimizationProgress) => void,
): Promise<BatchOptimizationSuccess> {
  if (!response.body) {
    return (await response.json()) as BatchOptimizationSuccess
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) {
        continue
      }

      const event = JSON.parse(line) as BatchOptimizationStreamEvent
      if (event.type === 'progress') {
        onProgress(event.progress)
        continue
      }

      if (event.type === 'result') {
        return event.result
      }

      throw {
        error: event.error,
        notes: event.notes,
      } satisfies ApiError
    }

    if (done) {
      break
    }
  }

  const tail = buffer.trim()
  if (tail) {
    const event = JSON.parse(tail) as BatchOptimizationStreamEvent
    if (event.type === 'result') {
      return event.result
    }
    if (event.type === 'progress') {
      onProgress(event.progress)
    } else {
      throw {
        error: event.error,
        notes: event.notes,
      } satisfies ApiError
    }
  }

  throw {
    error: '批量处理未返回最终结果。',
  } satisfies ApiError
}

function buildPlaceholderPipeline(sourceCount = 0): ViewStep[] {
  return VISIBLE_PIPELINE_TEMPLATE.map((step) => ({
    ...step,
    status: 'pending',
    detail: sourceCount > 0 ? `文件已准备好，等待执行该步骤。` : step.blurb,
  }))
}

function buildBatchCompletePipeline(sourceCount: number): ViewStep[] {
  return VISIBLE_PIPELINE_TEMPLATE.map((step) => ({
    ...step,
    status: 'done',
    detail: `已对 ${sourceCount} 个文件执行该步骤。`,
  }))
}

function buildAnimatedPipeline(
  activeIndex: number,
  sourceCount: number,
  completedCount: number,
  lastCompletedSourceName?: string,
): ViewStep[] {
  const lastVisibleIndex = VISIBLE_PIPELINE_TEMPLATE.length - 1
  const clampedCompletedCount = Math.max(0, Math.min(completedCount, sourceCount || 0))
  const currentFileIndex = sourceCount > 0 ? Math.min(clampedCompletedCount + 1, sourceCount) : 0

  return VISIBLE_PIPELINE_TEMPLATE.map((step, index) => ({
    ...step,
    status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
    detail:
      index < activeIndex
        ? `已完成，当前批次共 ${sourceCount} 个文件。`
        : index === activeIndex
          ? index === lastVisibleIndex && sourceCount > 1
            ? clampedCompletedCount >= sourceCount
              ? `已处理 ${sourceCount} / ${sourceCount} 个文件，正在汇总并保存结果。`
              : `已完成 ${clampedCompletedCount} / ${sourceCount} 个文件，正在处理第 ${currentFileIndex} 个文件。${lastCompletedSourceName ? ` 最近完成：${lastCompletedSourceName}` : ''}`
            : `正在处理，当前批次共 ${sourceCount} 个文件。`
          : `等待执行，当前批次共 ${sourceCount} 个文件。`,
    lastCompletedSourceName:
      index === activeIndex && index === lastVisibleIndex && sourceCount > 1 ? lastCompletedSourceName : undefined,
    progressCurrent: index === activeIndex && index === lastVisibleIndex && sourceCount > 1 ? clampedCompletedCount : undefined,
    progressPending: index === activeIndex && index === lastVisibleIndex && sourceCount > 1 && clampedCompletedCount < sourceCount,
    progressTotal: index === activeIndex && index === lastVisibleIndex && sourceCount > 1 ? sourceCount : undefined,
  }))
}

function mapResultPipeline(result: OptimizationSuccess): ViewStep[] {
  const allowedKeys = new Set(VISIBLE_PIPELINE_TEMPLATE.map((step) => step.key))

  return result.steps
    .filter((step) => allowedKeys.has(step.key))
    .map((step) => ({
      detail: step.detail,
      key: step.key,
      label: step.label,
      status: step.status,
    }))
}

function getPipelineStatusLabel(status: ViewStepStatus) {
  switch (status) {
    case 'done':
      return '已完成'
    case 'skipped':
      return '跳过'
    case 'not-requested':
      return '未请求'
    case 'pending':
      return '待处理'
    case 'active':
      return '处理中'
  }
}

function buildBatchTable(batchResult: BatchOptimizationSuccess): BatchRow[] {
  return batchResult.items.map((item) => ({
    fileName: item.sourceName,
    outputSize: formatBytes(item.outputBytes),
    savings: formatPercent(item.savingsPercent),
  }))
}

function isGlbFile(file: File) {
  return file.name.toLowerCase().endsWith('.glb')
}

function getFileDisplayName(file: File) {
  const directoryFile = file as DirectoryFile
  return directoryFile.webkitRelativePath?.trim() || file.name
}

function WebApp() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadMode, setUploadMode] = useState<UploadMode>('single')
  const [isDragging, setIsDragging] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [outputNamingMode, setOutputNamingMode] = useState<OutputNamingMode>('original')
  const [outputNamingValue, setOutputNamingValue] = useState('')
  const [result, setResult] = useState<OptimizationSuccess | null>(null)
  const [batchResult, setBatchResult] = useState<BatchOptimizationSuccess | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [pipelinePlayback, setPipelinePlayback] = useState<PipelinePlayback | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const pipelineScrollRef = useRef<HTMLDivElement | null>(null)
  const resultPanelBodyRef = useRef<HTMLDivElement | null>(null)
  const pipelineTimerRef = useRef<number | null>(null)

  const isBatchMode = uploadMode === 'batch'
  const namingValueTrimmed = outputNamingValue.trim()
  const selectedItems = useMemo<SelectedItem[]>(
    () =>
      selectedFiles.map((file) => ({
        displayName: getFileDisplayName(file),
        size: file.size,
      })),
    [selectedFiles],
  )
  const selectedFileCount = selectedItems.length
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.size, 0)
  const firstSelectedLabel = selectedItems[0]?.displayName ?? ''

  const currentPipeline = useMemo(() => {
    if (result) {
      return mapResultPipeline(result)
    }

    if (batchResult) {
      return buildBatchCompletePipeline(batchResult.sourceCount)
    }

    if (pipelinePlayback) {
      return buildAnimatedPipeline(
        pipelinePlayback.activeIndex,
        pipelinePlayback.sourceCount,
        pipelinePlayback.completedCount,
        pipelinePlayback.lastCompletedSourceName,
      )
    }

    return buildPlaceholderPipeline(selectedFileCount)
  }, [batchResult, pipelinePlayback, result, selectedFileCount])

  const metrics = useMemo<MetricItem[]>(() => {
    if (result) {
      return [
        { label: '原始大小', value: formatBytes(result.input.totalBytes) },
        { label: '优化后大小', value: formatBytes(result.outputFile.byteLength) },
        { label: '节省体积', value: formatBytes(result.savingsBytes) },
        { label: '节省比例', value: formatPercent(result.savingsPercent), note: '已完成', accent: true },
      ]
    }

    if (batchResult) {
      return [
        { label: '原始大小', value: formatBytes(batchResult.totalInputBytes), note: `${batchResult.sourceCount} 个文件` },
        { label: '优化后大小', value: formatBytes(batchResult.totalOutputBytes) },
        { label: '节省体积', value: formatBytes(batchResult.totalSavingsBytes) },
        { label: '节省比例', value: formatPercent(batchResult.totalSavingsPercent), note: '已完成', accent: true },
      ]
    }

    return [
      {
        label: '原始大小',
        value: selectedFileCount > 0 ? formatBytes(selectedBytes) : '--',
        note: selectedFileCount > 0 ? `${selectedFileCount} 个文件待处理` : '等待上传',
      },
      { label: '优化后大小', value: '--', note: '--' },
      { label: '节省体积', value: '--', note: '--' },
      { label: '节省比例', value: '--', note: isSubmitting ? '处理中' : selectedFileCount > 0 ? '等待处理' : '待处理', accent: true },
    ]
  }, [batchResult, isSubmitting, result, selectedBytes, selectedFileCount])

  const activePipelineStep = currentPipeline.find((step) => step.status === 'active') ?? null
  const activePipelineStepKey = activePipelineStep?.key ?? ''
  const activePipelineStepSignature = activePipelineStep
    ? [
        activePipelineStep.key,
        activePipelineStep.detail,
        activePipelineStep.progressCurrent ?? '',
        activePipelineStep.progressTotal ?? '',
        activePipelineStep.lastCompletedSourceName ?? '',
      ].join('|')
    : ''

  useEffect(() => {
    resultPanelBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [batchResult, result])

  useEffect(() => {
    if (!activePipelineStepKey) {
      return
    }

    const scrollHost = pipelineScrollRef.current
    if (!scrollHost) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const activeStep = scrollHost.querySelector<HTMLElement>(`[data-step-key="${activePipelineStepKey}"]`)
      if (!activeStep) {
        return
      }

      const hostRect = scrollHost.getBoundingClientRect()
      const stepRect = activeStep.getBoundingClientRect()
      const padding = 12

      if (stepRect.top < hostRect.top + padding) {
        scrollHost.scrollBy({
          top: stepRect.top - hostRect.top - padding,
          behavior: 'smooth',
        })
        return
      }

      if (stepRect.bottom > hostRect.bottom - padding) {
        scrollHost.scrollBy({
          top: stepRect.bottom - hostRect.bottom + padding,
          behavior: 'smooth',
        })
      }
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activePipelineStepKey, activePipelineStepSignature])

  useEffect(() => {
    if (!pipelinePlayback || !isSubmitting || result || batchResult || error) {
      return
    }

    const lastPipelineIndex = VISIBLE_PIPELINE_TEMPLATE.length - 1
    const delay =
      pipelinePlayback.activeIndex >= lastPipelineIndex
        ? pipelinePlayback.sourceCount > 10
          ? 360
          : pipelinePlayback.sourceCount > 6
            ? 440
            : 560
        : 520

    pipelineTimerRef.current = window.setTimeout(() => {
      setPipelinePlayback((current) => {
        if (!current) {
          return current
        }

        if (current.activeIndex >= lastPipelineIndex) {
          return current
        }

        const nextIndex = Math.min(current.activeIndex + 1, lastPipelineIndex)

        return {
          ...current,
          activeIndex: nextIndex,
        }
      })
    }, delay)

    return () => {
      if (pipelineTimerRef.current !== null) {
        window.clearTimeout(pipelineTimerRef.current)
        pipelineTimerRef.current = null
      }
    }
  }, [batchResult, error, isSubmitting, pipelinePlayback, result])

  function resetProcessingState() {
    if (pipelineTimerRef.current !== null) {
      window.clearTimeout(pipelineTimerRef.current)
      pipelineTimerRef.current = null
    }
    setPipelinePlayback(null)
    setResult(null)
    setBatchResult(null)
    setError(null)
  }

  function applySelection(files: File[]) {
    const glbFiles = files.filter(isGlbFile)

    if (files.length > 0 && glbFiles.length === 0) {
      setSelectedFiles([])
      resetProcessingState()
      setError({ error: '当前仅支持 .glb 文件。' })
      return
    }

    const nextFiles = uploadMode === 'single' ? glbFiles.slice(0, 1) : glbFiles
    setSelectedFiles(nextFiles)
    resetProcessingState()
  }

  function changeUploadMode(nextMode: UploadMode) {
    setUploadMode(nextMode)
    setSelectedFiles((current) => (nextMode === 'single' ? current.slice(0, 1) : current))
    resetProcessingState()
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    applySelection(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  function handleFolderChange(event: ChangeEvent<HTMLInputElement>) {
    applySelection(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function openFolderPicker() {
    folderInputRef.current?.click()
  }

  async function handleSubmit() {
    if (selectedFileCount === 0 || isSubmitting) {
      return
    }

    if (outputNamingMode !== 'original' && !namingValueTrimmed) {
      setError({ error: outputNamingMode === 'suffix' ? '请填写输出文件后缀。' : '请填写输出文件名称。' })
      return
    }

    const formData = new FormData()
    const endpoint = isBatchMode ? '/api/web/optimize/batch' : '/api/web/optimize'

    formData.append('mode', 'visual-lossy')
    formData.append('outputNamingMode', outputNamingMode)
    if (outputNamingMode !== 'original') {
      formData.append('outputNamingValue', namingValueTrimmed)
    }

    if (isBatchMode) {
      for (const file of selectedFiles) {
        formData.append('files', file)
        formData.append('paths', getFileDisplayName(file))
      }
    } else {
      formData.append('file', selectedFiles[0])
    }

    setIsSubmitting(true)
    setError(null)
    setResult(null)
    setBatchResult(null)
    setPipelinePlayback({
      activeIndex: 0,
      completedCount: 0,
      sourceCount: selectedFileCount,
    })

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const payload = await readApiError(response)
        setPipelinePlayback(null)
        setError(payload)
        return
      }

      if (isBatchMode) {
        const payload = await readBatchStream(response, (progress) => {
          setPipelinePlayback((current) => {
            if (!current) {
              return current
            }

            return {
              ...current,
              activeIndex: VISIBLE_PIPELINE_TEMPLATE.length - 1,
              completedCount: progress.completedCount,
              lastCompletedSourceName: progress.sourceName,
            }
          })
        })
        setPipelinePlayback(null)
        startTransition(() => setBatchResult(payload))
      } else {
        const payload = (await response.json()) as OptimizationSuccess
        setPipelinePlayback(null)
        startTransition(() => setResult(payload))
      }
    } catch (caughtError) {
      setPipelinePlayback(null)
      if (caughtError && typeof caughtError === 'object' && 'error' in caughtError) {
        setError(caughtError as ApiError)
      } else {
      setError({
          error: '请求失败，请确认网页服务仍在运行。',
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    applySelection(Array.from(event.dataTransfer.files ?? []))
  }

  const batchRows = batchResult ? buildBatchTable(batchResult) : []
  const singleDownloadPath = result?.outputFile.downloadPath ?? ''
  const batchDownloadPath = batchResult?.archiveFile?.downloadPath ?? ''
  const resultSummary = result
    ? `最终压缩比例为 ${formatPercent(result.savingsPercent)}，结果已生成，可直接下载压缩后的 GLB。`
    : batchResult
      ? `整批最终压缩比例为 ${formatPercent(batchResult.totalSavingsPercent)}，结果已打包完成，可直接下载 ZIP。`
      : '网页版本不需要预先选择输出目录，处理完成后会直接提供下载。'
  const namingInputLabel = outputNamingMode === 'suffix' ? '后缀内容' : '自定义名称'
  const namingPlaceholder =
    outputNamingMode === 'suffix'
      ? '例如：compressed'
      : isBatchMode
        ? '例如：project-final'
        : '例如：my-model-final'
  useEffect(() => {
    if (!isGuideOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsGuideOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isGuideOpen])

  function renderOutputSettingsSection(downloadPath: string, downloadLabel: string) {
    return (
      <div className="result-note output-settings">
        <div className="result-note__head">
          <strong>输出设置</strong>
        </div>

        <div className="output-settings__body">
          <div className="output-settings__row">
            <div className="output-settings__label">输出命名</div>
            <div className="output-settings__control">
              <div className="mode-switch" role="tablist" aria-label="输出命名规则">
                <button
                  type="button"
                  className={`mode-switch__item ${outputNamingMode === 'original' ? 'mode-switch__item--active' : ''}`}
                  onClick={() => setOutputNamingMode('original')}
                >
                  原文件名
                </button>
                <button
                  type="button"
                  className={`mode-switch__item ${outputNamingMode === 'suffix' ? 'mode-switch__item--active' : ''}`}
                  onClick={() => setOutputNamingMode('suffix')}
                >
                  原名+后缀
                </button>
                <button
                  type="button"
                  className={`mode-switch__item ${outputNamingMode === 'custom' ? 'mode-switch__item--active' : ''}`}
                  onClick={() => setOutputNamingMode('custom')}
                >
                  自定义名称
                </button>
              </div>
            </div>
          </div>

          {outputNamingMode !== 'original' ? (
            <div className="output-settings__row">
              <div className="output-settings__label">{namingInputLabel}</div>
              <div className="output-settings__control">
                <input
                  type="text"
                  className="output-settings__input"
                  value={outputNamingValue}
                  onChange={(event) => setOutputNamingValue(event.target.value)}
                  placeholder={namingPlaceholder}
                />
              </div>
            </div>
          ) : null}

          <div className="web-output-note">
            <span>网页版本不需要预先选择输出目录，处理完成后会直接提供下载。</span>
          </div>

          {downloadPath ? (
            <a className="action-button action-button--block web-download-action" href={downloadPath} download>
              <FolderIcon className="action-icon" />
              <span>{downloadLabel}</span>
            </a>
          ) : (
            <div className="web-download-placeholder">
              <span>处理完成后，这里会显示下载按钮。</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <main className="app-shell web-app-shell">
      <section className="app-frame web-app-frame">
        <header className="app-header">
          <div className="brand-block">
            <div className="brand-mark">
              <CubeIcon />
            </div>
            <div className="brand-copy">
              <div className="brand-row">
                <h1>GLB 压缩优化器</h1>
                <span className="mode-tag">
                  <ShieldIcon className="mode-tag__icon" />
                  视觉优先极致压缩
                </span>
              </div>
              <p>网页部署版，适合服务器统一压缩与下载交付。</p>
            </div>
          </div>

          <div className="header-meta">
            <button
              type="button"
              className="header-link"
              onClick={() => setIsGuideOpen(true)}
            >
              <BookIcon />
              使用说明
            </button>
          </div>
        </header>

        <section className="options-bar">
          <div className="options-group">
            <div className="options-title">
              <span>处理方式</span>
            </div>

            <div className="mode-switch" role="tablist" aria-label="上传方式">
              <button
                type="button"
                className={`mode-switch__item ${uploadMode === 'single' ? 'mode-switch__item--active' : ''}`}
                onClick={() => changeUploadMode('single')}
              >
                单文件
              </button>
              <button
                type="button"
                className={`mode-switch__item ${uploadMode === 'batch' ? 'mode-switch__item--active' : ''}`}
                onClick={() => changeUploadMode('batch')}
              >
                批量压缩
              </button>
            </div>
          </div>
        </section>

        <section className="main-grid">
          <article className="panel-card upload-panel">
            <div className="panel-card__header">
              <div>
                <span className="panel-card__index">1.</span>
                <h2>上传 GLB</h2>
              </div>
            </div>

            <div className="panel-card__body upload-panel__body">
              <div
                className={`upload-dropzone ${isDragging ? 'upload-dropzone--active' : ''}`}
                onClick={openFilePicker}
                onDragEnter={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".glb,model/gltf-binary"
                  multiple={isBatchMode}
                  hidden
                  onChange={handleInputChange}
                />
                <input
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                  ref={folderInputRef}
                  type="file"
                  hidden
                  onChange={handleFolderChange}
                />

                <div className="upload-dropzone__icon">
                  <UploadIcon />
                </div>

                <strong>
                  {selectedFileCount === 0
                    ? isBatchMode
                      ? '拖拽一个文件夹或多个 GLB 文件到此处'
                      : '拖拽 GLB 文件到此处'
                    : selectedFileCount === 1
                      ? firstSelectedLabel
                      : `已选择 ${selectedFileCount} 个 GLB 文件`}
                </strong>

                <span>或</span>

                <div className="upload-picker-row">
                  <button
                    type="button"
                    className="picker-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      openFilePicker()
                    }}
                  >
                    {isBatchMode ? '选择多个文件' : '选择文件'}
                  </button>
                  {isBatchMode ? (
                    <button
                      type="button"
                      className="picker-button picker-button--ghost"
                      onClick={(event) => {
                        event.stopPropagation()
                        openFolderPicker()
                      }}
                    >
                      <FolderIcon />
                      选择文件夹
                    </button>
                  ) : null}
                </div>

                <p>
                  {isBatchMode
                    ? '批量模式支持多个 GLB 文件，也支持选择整个文件夹并递归处理其中全部 GLB。'
                    : '单文件模式一次只处理 1 个 GLB 文件。'}
                </p>
              </div>

              <div className="upload-meta">
                <div className="upload-meta__row">
                  <FileIcon />
                  <strong>{selectedFileCount === 0 ? '未选择文件' : isBatchMode ? '批量极致压缩' : '单文件极致压缩'}</strong>
                </div>
                <p>
                  {selectedFileCount > 0
                    ? `${selectedFileCount} 个文件，共 ${formatBytes(selectedBytes)}。`
                    : isBatchMode
                      ? '选择多个文件或整个文件夹后，程序会把其中所有 GLB 上传到服务端统一压缩，并在完成后提供 ZIP 下载。'
                      : '选择一个 GLB 文件后，程序会自动尝试多档压缩方案，并在完成后提供压缩结果下载。'}
                </p>
              </div>

              {selectedFileCount > 0 ? (
                <div className="selected-files">
                  {selectedItems.slice(0, 6).map((item) => (
                    <div key={`${item.displayName}-${item.size}`} className="selected-files__row">
                      <span>{item.displayName}</span>
                      <strong>{formatBytes(item.size)}</strong>
                    </div>
                  ))}
                  {selectedFileCount > 6 ? <p>另有 {selectedFileCount - 6} 个文件未展开显示。</p> : null}
                </div>
              ) : null}
            </div>
          </article>

          <article className="panel-card pipeline-panel">
            <div className="panel-card__header">
              <div>
                <span className="panel-card__index">2.</span>
                <h2>处理流水线（极致压缩）</h2>
              </div>
            </div>

            <div className="panel-card__body pipeline-panel__body">
              <div ref={pipelineScrollRef} className="pipeline-scroll">
                <ol className="pipeline-timeline">
                  {currentPipeline.map((step, index) => {
                    const StepIcon = getStepIcon(step.key)

                    return (
                      <li key={step.key} data-step-key={step.key} className={`timeline-step timeline-step--${step.status}`}>
                        <div className="timeline-step__rail">
                          <span className="timeline-step__number">{index + 1}</span>
                        </div>
                        <div className="timeline-step__card">
                          <div className="timeline-step__icon">
                            <StepIcon />
                          </div>
                          <div className="timeline-step__content">
                            <div className="timeline-step__top">
                              <strong>{step.label}</strong>
                              <span>
                                {step.progressTotal
                                  ? `${getPipelineStatusLabel(step.status)} · ${step.progressCurrent}/${step.progressTotal}`
                                  : getPipelineStatusLabel(step.status)}
                              </span>
                            </div>
                            <p>{step.detail}</p>
                            {step.progressTotal ? (
                              <div className="timeline-step__progress" aria-hidden="true">
                                <div
                                  className={`timeline-step__progress-track ${step.progressPending ? 'timeline-step__progress-track--pending' : ''}`}
                                >
                                  <div
                                    className="timeline-step__progress-fill"
                                    style={{
                                      width: `${Math.max(((step.progressCurrent ?? 0) / step.progressTotal) * 100, 0)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>

              <button
                type="button"
                className="process-button"
                disabled={selectedFileCount === 0 || isSubmitting}
                onClick={() => void handleSubmit()}
              >
                <PlayIcon />
                <span>{isSubmitting ? '处理中...' : isBatchMode ? '开始批量极致压缩' : '开始极致压缩'}</span>
              </button>

              <p className="panel-note">
                点击开始后，流程会按步骤推进；处理完成后会直接提供下载结果。
              </p>
            </div>
          </article>

          <article className="panel-card result-panel">
            <div className="panel-card__header">
              <div>
                <span className="panel-card__index">3.</span>
                <h2>结果与报告</h2>
              </div>
            </div>

            <div className="panel-card__body result-panel__body">
              {error ? (
                <div className="feedback feedback--error">
                  <strong>{error.error}</strong>
                  {error.notes?.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              ) : null}

              <div className="metric-strip">
                {metrics.map((item) => (
                  <div key={item.label} className={`metric-item ${item.accent ? 'metric-item--accent' : ''}`}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.note ?? '--'}</small>
                  </div>
                ))}
              </div>

              {result ? (
                <div ref={resultPanelBodyRef} className="result-panel__scroll">
                  <>
                    {renderOutputSettingsSection(singleDownloadPath, '下载 .glb')}

                    <div className="result-note">
                      <div className="result-note__head">
                        <strong>处理说明</strong>
                      </div>
                      <p>{resultSummary}</p>
                    </div>
                  </>
                </div>
              ) : batchResult ? (
                <div className="batch-results-layout">
                  <section className="batch-summary-section">
                    <div className="result-subhead">
                      <strong>批量结果摘要</strong>
                      <span>{batchResult.sourceCount} 个文件</span>
                    </div>

                    <div ref={resultPanelBodyRef} className="batch-summary-scroll">
                      <div className="data-table data-table--batch">
                        <div className="data-table__head">
                          <span>文件</span>
                          <span>输出</span>
                          <span>节省</span>
                        </div>
                        {batchRows.map((row) => (
                          <div key={row.fileName} className="data-table__row">
                            <span>{row.fileName}</span>
                            <span>{row.outputSize}</span>
                            <span>{row.savings}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="batch-settings-section">
                    {renderOutputSettingsSection(batchDownloadPath, '下载 ZIP')}
                  </section>
                </div>
              ) : (
                <div ref={resultPanelBodyRef} className="result-panel__scroll">
                  {renderOutputSettingsSection('', '')}
                </div>
              )}
            </div>
          </article>
        </section>

        <footer className="app-footer">
          <span>网页部署版</span>
          <span>版本 1.0.0</span>
          <span>部署提醒：处理发生在当前服务器，请勿上传不应离开本机或局域网的敏感文件。</span>
        </footer>

        {isGuideOpen ? (
          <div className="guide-overlay" role="presentation" onClick={() => setIsGuideOpen(false)}>
            <section
              className="guide-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="guide-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="guide-dialog__header">
                <div>
                  <span className="guide-dialog__eyebrow">使用说明</span>
                  <h2 id="guide-title">上传、命名和导出</h2>
                </div>

                <button type="button" className="guide-dialog__close" onClick={() => setIsGuideOpen(false)} aria-label="关闭使用说明">
                  <CloseIcon />
                </button>
              </div>

              <div className="guide-dialog__body">
                <section className="guide-section guide-section--compact">
                  <h3>上传方式</h3>
                  <ul>
                    <li>单文件：拖入 1 个 GLB，或点“选择文件”。</li>
                    <li>批量压缩：可选多个 GLB，也可直接选整个文件夹上传。</li>
                    <li>选择文件夹后，浏览器会把其中全部 .glb 一并上传并参与批量处理。</li>
                  </ul>
                </section>

                <section className="guide-section guide-section--compact">
                  <h3>命名规则</h3>
                  <ul>
                    <li>原文件名：保持原名输出，扩展名固定为 .glb。</li>
                    <li>原名+后缀：在原文件名后追加后缀，例如 `_mini`。</li>
                    <li>自定义名称：单文件直接用新名称，批量会自动追加序号防止重名。</li>
                  </ul>
                </section>

                <section className="guide-section guide-section--compact">
                  <h3>结果下载</h3>
                  <ul>
                    <li>单文件完成后可直接下载压缩后的 .glb。</li>
                    <li>批量完成后会生成一个 ZIP 下载包。</li>
                    <li>批量模式会按真实完成数量显示进度，不是假动画。</li>
                    <li>这是视觉压缩模式，目标是尽量小且尽量保真，不是严格无损。</li>
                  </ul>
                </section>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  )
}
export default WebApp

