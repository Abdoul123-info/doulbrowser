import { ElectronAPI } from '@electron-toolkit/preload'

export interface DownloadAPI {
  startDownload: (url: string, savePath?: string) => void
  pauseDownload: (url: string) => void
  resumeDownload: (url: string, savePath?: string, filename?: string) => void
  cancelDownload: (url: string) => void
  openDownloadFolder: (url: string) => void
  selectDownloadPath: () => Promise<string | null>
  onDownloadProgress: (callback: (event: any, data: any) => void) => void
  onDownloadStarted: (callback: (event: any, data: any) => void) => void
  onDownloadComplete: (callback: (event: any, data: any) => void) => void
  onDownloadPaused: (callback: (event: any, data: any) => void) => void
  onDownloadResumed: (callback: (event: any, data: any) => void) => void
  onDownloadCancelled: (callback: (event: any, data: any) => void) => void
  onDownloadError: (callback: (event: any, data: any) => void) => void
  onDownloadDetected: (callback: (event: any, data: any) => void) => void
  acceptDetectedDownload: (url: string) => void
  dismissDetectedDownload: (url: string) => void
  getSettings: () => Promise<{
    downloadPath: string
    maxConcurrentDownloads: number
    maxRetries: number
    autoStart: boolean
    notifications: boolean
    soundNotifications: boolean
    language: string
  }>
  saveSettings: (settings: Partial<{
    downloadPath: string
    maxConcurrentDownloads: number
    maxRetries: number
    autoStart: boolean
    notifications: boolean
    soundNotifications: boolean
    language: string
  }>) => Promise<any>
  removeDownloadListeners: () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DownloadAPI
  }
}
