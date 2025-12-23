import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  startDownload: (url: string, savePath?: string) => ipcRenderer.send('download-start', url, savePath),
  pauseDownload: (url: string) => ipcRenderer.send('download-pause', url),
  resumeDownload: (url: string, savePath?: string, filename?: string) => ipcRenderer.send('download-resume', url, savePath, filename),
  cancelDownload: (url: string) => ipcRenderer.send('download-cancel', url),
  openDownloadFolder: (url: string) => ipcRenderer.send('download-open-folder', url),
  selectDownloadPath: () => ipcRenderer.invoke('download-select-path'),
  onDownloadProgress: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-progress', callback),
  onDownloadStarted: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-started', callback),
  onDownloadComplete: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-complete', callback),
  onDownloadPaused: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-paused', callback),
  onDownloadResumed: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-resumed', callback),
  onDownloadCancelled: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-cancelled', callback),
  onDownloadError: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-error', callback),
  onDownloadDetected: (callback: (event: any, data: any) => void) => ipcRenderer.on('download-detected', callback),
  acceptDetectedDownload: (url: string) => ipcRenderer.send('accept-detected-download', url),
  dismissDetectedDownload: (url: string) => ipcRenderer.send('dismiss-detected-download', url),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  getDownloadLogs: (url: string) => ipcRenderer.invoke('get-download-logs', url),
  removeDownloadListeners: () => {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.removeAllListeners('download-started');
    ipcRenderer.removeAllListeners('download-complete');
    ipcRenderer.removeAllListeners('download-paused');
    ipcRenderer.removeAllListeners('download-resumed');
    ipcRenderer.removeAllListeners('download-cancelled');
    ipcRenderer.removeAllListeners('download-error');
    ipcRenderer.removeAllListeners('download-detected');
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
