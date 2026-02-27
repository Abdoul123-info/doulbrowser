import { ElectronAPI } from '@electron-toolkit/preload'

export interface DownloadAPI {
  startDownload: (url: string, savePath?: string, audioOnly?: boolean) => void
  pauseDownload: (url: string, audioOnly?: boolean) => void
  resumeDownload: (url: string, savePath?: string, filename?: string, audioOnly?: boolean) => void
  cancelDownload: (url: string, audioOnly?: boolean) => void
  openDownloadFolder: (url: string, savePath?: string, filename?: string, audioOnly?: boolean) => void
  selectDownloadPath: () => Promise<string | null>
  onDownloadProgress: (callback: (event: any, data: any) => void) => void
  onDownloadStarted: (callback: (event: any, data: any) => void) => void
  onDownloadComplete: (callback: (event: any, data: any) => void) => void
  onDownloadPaused: (callback: (event: any, data: any) => void) => void
  onDownloadResumed: (callback: (event: any, data: any) => void) => void
  onDownloadCancelled: (callback: (event: any, data: any) => void) => void
  onDownloadError: (callback: (event: any, data: any) => void) => void
  onDownloadDetected: (callback: (event: any, data: any) => void) => void
  onNotification: (callback: (event: any, data: any) => void) => void
  acceptDetectedDownload: (url: string, audioOnly?: boolean) => void
  dismissDetectedDownload: (url: string) => void
  getSettings: () => Promise<{
    downloadPath: string
    maxConcurrentDownloads: number
    maxRetries: number
    autoStart: boolean
    notifications: boolean
    soundNotifications: boolean
    language: string
    isActivated: boolean
    expiryDate: string | null
    machineId: string
    licenseKey: string
  }>
  saveSettings: (settings: Partial<{
    downloadPath: string
    maxConcurrentDownloads: number
    maxRetries: number
    autoStart: boolean
    notifications: boolean
    soundNotifications: boolean
    language: string
    isActivated: boolean
    expiryDate: string | null
    licenseKey: string
  }>) => Promise<any>
  getDownloadLogs: (url: string) => Promise<string[]>
  deleteFile: (path: string, filename?: string) => Promise<boolean>
  getLicenseStatus: () => Promise<{
    isActivated: boolean,
    expiryDate: string | null,
    machineId: string,
    licenseKey: string
  }>
  getMachineId: () => Promise<string>
  activateLicense: (key: string) => Promise<{ success: boolean, expiry?: string, error?: string }>
  adminGenerateKey: (password: string, machineId: string, durationDays: string) => Promise<{ success: boolean, key?: string, expiry?: string, error?: string }>
  adminBulkGenerate: (password: string, count: number, durationDays: string) => Promise<{ success: boolean, keys?: string[], error?: string }>
  adminResetLicense: (password: string) => Promise<{ success: boolean, error?: string }>
  adminGetAllLicenses: (password: string) => Promise<{ success: boolean, licenses: any[], error?: string }>
  adminUpdateLicenseStatus: (password: string, targetMid: string, isBlocked: boolean) => Promise<{ success: boolean, error?: string }>
  adminUploadUpdateFile: (password: string, localPath: string, type: 'setup' | 'extension') => Promise<{ success: boolean, url?: string, error?: string }>
  adminSelectUpdateFile: (type: 'setup' | 'extension') => Promise<string | null>
  getAppVersion: () => Promise<string>
  checkAppUpdate: () => Promise<{ updateAvailable: boolean, latestVersion?: string, currentVersion?: string, downloadUrl?: string }>
  adminSetLatestVersion: (password: string, newVersion: string, downloadUrl?: string) => Promise<{ success: boolean, error?: string }>
  verifyAdminPassword: (password: string) => Promise<boolean>
  pingLicense: () => Promise<{ success: boolean }>
  adminDeleteLicenseCloud: (password: string, targetMid: string) => Promise<{ success: boolean, error?: string }>
  onLicenseDeactivated: (callback: (event: any, reason: string) => void) => void
  removeDownloadListeners: () => void
}


declare global {
  interface Window {
    electron: ElectronAPI
    api: DownloadAPI
  }
}
