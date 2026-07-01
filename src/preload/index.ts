import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  startDownload: (url: string, savePath?: string, audioOnly: boolean = false) => ipcRenderer.send('download-start', url, savePath, audioOnly),
  pauseDownload: (url: string, audioOnly: boolean = false) => ipcRenderer.send('download-pause', url, audioOnly),
  resumeDownload: (url: string, savePath?: string, filename?: string, audioOnly: boolean = false) => ipcRenderer.send('download-resume', url, savePath, filename, audioOnly),
  cancelDownload: (url: string, audioOnly: boolean = false) => ipcRenderer.send('download-cancel', url, audioOnly),
  openDownloadFolder: (url: string, savePath?: string, filename?: string, audioOnly: boolean = false) => ipcRenderer.send('download-open-folder', url, savePath, filename, audioOnly),
  selectDownloadPath: () => ipcRenderer.invoke('download-select-path'),
  onDownloadProgress: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-progress', callback),
  onDownloadStarted: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-started', callback),
  onDownloadComplete: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-complete', callback),
  onDownloadPaused: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-paused', callback),
  onDownloadResumed: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-resumed', callback),
  onDownloadCancelled: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-cancelled', callback),
  onDownloadError: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-error', callback),
  onDownloadDetected: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-detected', callback),
  onNotification: (callback: (event: any, data: any) => void) => ipcRenderer.on('notification', callback),
  acceptDetectedDownload: (url: string, audioOnly: boolean = false) => ipcRenderer.send('accept-detected-download', url, audioOnly),
  dismissDetectedDownload: (url: string) => ipcRenderer.send('dismiss-detected-download', url),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  getDownloadLogs: (url: string) => ipcRenderer.invoke('get-download-logs', url),
  getAppLogPath: () => ipcRenderer.invoke('get-app-log-path'),
  readAppLog: (maxLines?: number) => ipcRenderer.invoke('read-app-log', maxLines),
  openAppLogFolder: () => ipcRenderer.invoke('open-app-log-folder'),
  deleteFile: (path: string, filename?: string) => ipcRenderer.invoke('delete-file', path, filename),
  // [v1.6.9] Licensing APIs
  getLicenseStatus: () => ipcRenderer.invoke('get-license-status'),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  activateLicense: (key: string) => ipcRenderer.invoke('activate-license', key),
  adminGenerateKey: (password, machineId, durationDays) => ipcRenderer.invoke('admin-generate-key', password, machineId, durationDays),
  adminBulkGenerate: (password, count, durationDays) => ipcRenderer.invoke('admin-bulk-generate', password, count, durationDays),
  adminResetLicense: (password: string) => ipcRenderer.invoke('admin-reset-license', password),
  adminGetAllLicenses: (password: string) => ipcRenderer.invoke('admin-get-all-licenses', password),
  adminUpdateLicenseStatus: (password: string, targetMid: string, isBlocked: boolean) => ipcRenderer.invoke('admin-update-license-status', password, targetMid, isBlocked),
  adminUploadUpdateFile: (password: string, localPath: string, type: 'setup' | 'extension') => ipcRenderer.invoke('admin-upload-update-file', password, localPath, type),
  adminSelectUpdateFile: (type: 'setup' | 'extension') => ipcRenderer.invoke('admin-select-update-file', type),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
  adminSetLatestVersion: (password, newVersion, downloadUrl, extensionVersion, extensionUrl, updateHash, extensionHash) => ipcRenderer.invoke('admin-set-latest-version', password, newVersion, downloadUrl, extensionVersion, extensionUrl, updateHash, extensionHash),
  verifyAdminPassword: (password: string) => ipcRenderer.invoke('verify-admin-password', password),
  pingLicense: () => ipcRenderer.invoke('ping-license'),
  adminDeleteLicenseCloud: (password: string, targetMid: string) => ipcRenderer.invoke('admin-delete-license-cloud', password, targetMid),
  onLicenseDeactivated: (callback: (event: any, reason: string) => void) => ipcRenderer.on('license-deactivated', callback),
  // [v1.2.9] MP3 Converter APIs 🎵
  selectLocalVideo: () => ipcRenderer.invoke('select-local-video'),
  localConvertVideoToMp3: (path: string) => ipcRenderer.invoke('local-convert-video-to-mp3', path),
  onConversionProgress: (callback: (event: any, data: any) => void) => ipcRenderer.on('conversion-progress', callback),
  // [v1.3.0] Video Compressor APIs 🎥
  localCompressVideo: (path: string, quality: string) => ipcRenderer.invoke('local-compress-video', path, quality),
  onCompressionProgress: (callback: (event: any, data: any) => void) => ipcRenderer.on('compression-progress', callback),
  // [v1.4.0] Batch Downloader APIs 📋
  getPlaylistInfo: (url: string) => ipcRenderer.invoke('get-playlist-info', url),
  batchAddToQueue: (data: { items: any[], playlistTitle?: string, audioOnly: boolean }) => ipcRenderer.send('batch-add-to-queue', data),
  // [v1.6.1] Feedback APIs ★
  submitFeedback: (rating: number, comment: string) => ipcRenderer.invoke('submit-feedback', rating, comment),
  adminGetFeedback: (password: string) => ipcRenderer.invoke('admin-get-feedback', password),
  getFeedbackStatus: () => ipcRenderer.invoke('get-feedback-status'),
  // [v1.6.0] Auto-Update APIs 🚀
  startAppUpdate: (downloadUrl: string, expectedHash: string) => ipcRenderer.invoke('start-app-update', downloadUrl, expectedHash),
  installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', callback),
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', callback),
  onUpdateError: (callback) => ipcRenderer.on('update-error', callback),
  onExternalBatch: (callback) => ipcRenderer.on('external-batch', callback),
  installExtensionUpdate: (url: string, expectedHash: string) => ipcRenderer.invoke('install-extension-update', url, expectedHash),
  getExtensionVersion: () => ipcRenderer.invoke('get-extension-version'),
  registerExtensionInBrowsers: () => ipcRenderer.invoke('register-extension-in-browsers'),
  removeDownloadListeners: () => {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.removeAllListeners('download-started');
    ipcRenderer.removeAllListeners('download-complete');
    ipcRenderer.removeAllListeners('download-paused');
    ipcRenderer.removeAllListeners('download-resumed');
    ipcRenderer.removeAllListeners('download-cancelled');
    ipcRenderer.removeAllListeners('download-error');
    ipcRenderer.removeAllListeners('download-detected');
    ipcRenderer.removeAllListeners('notification');
    ipcRenderer.removeAllListeners('conversion-progress');
    ipcRenderer.removeAllListeners('compression-progress');
    ipcRenderer.removeAllListeners('update-progress');
    ipcRenderer.removeAllListeners('update-ready');
    ipcRenderer.removeAllListeners('update-error');
    ipcRenderer.removeAllListeners('external-batch');
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
