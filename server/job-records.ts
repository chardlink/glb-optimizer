import { join } from 'node:path'

export const JOB_FILES = {
  input: 'input.glb',
  optimized: 'optimized.glb',
} as const

export function getOptimizedPath(jobDir: string) {
  return join(jobDir, JOB_FILES.optimized)
}
