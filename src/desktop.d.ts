import type {
  DesktopDirectoryPickResult,
  DesktopInputDirectoryPickResult,
  DesktopPathRevealResult,
} from '../shared/contracts.js'

declare global {
  interface Window {
    desktopBridge?: {
      isDesktop: true
      pickInputDirectory(): Promise<DesktopInputDirectoryPickResult>
      pickOutputDirectory(): Promise<DesktopDirectoryPickResult>
      revealPath(targetPath: string): Promise<DesktopPathRevealResult>
    }
  }
}

export {}
