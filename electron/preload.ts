import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopDirectoryPickResult,
  DesktopInputDirectoryPickResult,
  DesktopPathRevealResult,
} from '../shared/contracts.js'

contextBridge.exposeInMainWorld('desktopBridge', {
  isDesktop: true as const,
  pickInputDirectory() {
    return ipcRenderer.invoke('input:pick-directory') as Promise<DesktopInputDirectoryPickResult>
  },
  pickOutputDirectory() {
    return ipcRenderer.invoke('output:pick-directory') as Promise<DesktopDirectoryPickResult>
  },
  revealPath(targetPath: string) {
    return ipcRenderer.invoke('path:reveal', targetPath) as Promise<DesktopPathRevealResult>
  },
})
