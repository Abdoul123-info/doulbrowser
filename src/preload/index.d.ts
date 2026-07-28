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
    audioPath: string
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
    audioPath: string
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
  getAppLogPath: () => Promise<string>
  readAppLog: (maxLines?: number) => Promise<string[]>
  openAppLogFolder: () => Promise<boolean>
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
  adminUploadUpdateFile: (password: string, localPath: string, type: 'setup' | 'extension') => Promise<{ success: boolean, url?: string, hash?: string, error?: string }>
  onAdminUploadProgress: (callback: (event: any, data: { type: 'setup' | 'extension', uploaded: number, total: number, percent: number, speed?: number, etaSeconds?: number }) => void) => void
  removeAdminUploadProgress: () => void
  adminSelectUpdateFile: (type: 'setup' | 'extension') => Promise<string | null>
  adminHashLocalFile: (type: 'setup' | 'extension') => Promise<{ hash?: string, fileName?: string, error?: string } | null>
  getAppVersion: () => Promise<string>
  checkAppUpdate: () => Promise<{ updateAvailable: boolean, latestVersion?: string, currentVersion?: string, downloadUrl?: string, updateHash?: string }>
  adminSetLatestVersion: (password: string, newVersion: string, downloadUrl?: string, extensionVersion?: string, extensionUrl?: string, updateHash?: string, extensionHash?: string) => Promise<{ success: boolean, error?: string }>
  verifyAdminPassword: (password: string) => Promise<boolean>
  pingLicense: () => Promise<{ success: boolean, restored?: boolean }>
  adminDeleteLicenseCloud: (password: string, targetMid: string) => Promise<{ success: boolean, error?: string }>
  onLicenseDeactivated: (callback: (event: any, reason: string) => void) => void
  onLicenseRestored: (callback: (event: any, expiry: string | null) => void) => void
  selectLocalVideo: () => Promise<string | null>
  localConvertVideoToMp3: (path: string) => Promise<{ success: boolean, path: string }>
  onConversionProgress: (callback: (event: any, data: any) => void) => () => void
  // [v1.3.0] Video Compressor APIs 🎥
  localCompressVideo: (path: string, quality: 'low' | 'medium' | 'whatsapp') => Promise<{ success: boolean, path: string, filename: string }>
  onCompressionProgress: (callback: (event: any, data: any) => void) => () => void
  // [v1.4.0] Batch Downloader APIs 📋
  getPlaylistInfo: (url: string) => Promise<{ title: string, entries: any[] }>
  batchAddToQueue: (data: { items: any[], playlistTitle?: string, audioOnly: boolean, headers?: Record<string, string> }) => void
  // [v1.6.1] Feedback APIs ★
  submitFeedback: (rating: number, comment: string) => Promise<{ success: boolean, error?: string, already?: boolean }>
  adminGetFeedback: (password: string) => Promise<{ success: boolean, feedback?: any[], error?: string }>
  getFeedbackStatus: () => Promise<{ submitted: boolean }>
  // [v2.4.5] Annonces mobiles 📣
  adminSetAnnounce: (password: string, title: string, message: string, url: string, target?: string) => Promise<{ success: boolean, cleared?: boolean, announce?: any, target?: string, error?: string }>
  getAnnounce: (platform?: string) => Promise<{ announce: { id: string, title: string, body: string, url?: string } | null }>
  // [v1.6.0] Auto-Update APIs 🚀
  startAppUpdate: (downloadUrl: string, expectedHash: string) => Promise<{ success: boolean, error?: string }>
  installAppUpdate: () => Promise<{ success: boolean, error?: string }>
  onUpdateProgress: (callback: (event: any, progress: number) => void) => void
  onUpdateReady: (callback: (event: any) => void) => void
  onUpdateError: (callback: (event: any, error: string) => void) => void
  onExternalBatch: (callback: (event: any, data: any) => void) => void
  installExtensionUpdate: (url: string, expectedHash: string) => Promise<{ success: boolean, error?: string }>
  getExtensionVersion: () => Promise<string>
  registerExtensionInBrowsers: () => Promise<{ success: boolean, extensionPath?: string, infoFile?: string, browserOpened?: boolean, error?: string }>
  removeDownloadListeners: () => void
}


declare global {
  interface Window {
    electron: ElectronAPI
    api: DownloadAPI
  }
}
