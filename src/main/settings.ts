import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from './types'
import { state } from './globals'

export const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')

// Dossier de base selon le type de fichier : les audios peuvent avoir leur propre
// dossier (audioPath) ; sinon ils retombent sur downloadPath, comme les vidéos.
export function getBaseDownloadDir(audioOnly: boolean): string {
  const s = state.appSettings
  return audioOnly && s.audioPath ? s.audioPath : s.downloadPath
}

export const settingsListeners: Array<(settings: AppSettings) => void> = []

export const addSettingsListener = (listener: (settings: AppSettings) => void) => {
  settingsListeners.push(listener)
}

// Charger les paramètres
export function loadSettings(): AppSettings {
  const defaultSettings: AppSettings = {
    downloadPath: app ? app.getPath('downloads') : '',
    audioPath: '',
    maxConcurrentDownloads: 3,
    maxRetries: 3,
    autoStart: false,
    notifications: true,
    soundNotifications: false,
    language: 'fr',
    licenseKey: '',
    isActivated: false,
    machineId: '',
    expiryDate: null,
    lastOpenedDate: null
  }

  try {
    const settingsPath = getSettingsPath()
    if (existsSync(settingsPath)) {
      const data = readFileSync(settingsPath, 'utf-8')
      const loaded = JSON.parse(data)
      // Merger avec les paramètres par défaut pour les nouvelles propriétés
      const merged = { ...defaultSettings, ...loaded }
      state.appSettings = merged
      return merged
    }
  } catch (error) {
    console.error('Error loading settings:', error)
  }

  state.appSettings = defaultSettings
  return defaultSettings
}

// Sauvegarder les paramètres
export function saveSettings(settings: Partial<AppSettings>) {
  try {
    const currentSettings = loadSettings()
    const newSettings = { ...currentSettings, ...settings }
    const settingsPath = getSettingsPath()
    writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf-8')

    // Mettre à jour l'état global
    state.appSettings = newSettings

    // Déclencher les écouteurs de changements
    settingsListeners.forEach(listener => {
      try {
        listener(newSettings)
      } catch (e) {
        console.error('Error in settings listener:', e)
      }
    })

    return newSettings
  } catch (error) {
    console.error('Error saving settings:', error)
    return null
  }
}
