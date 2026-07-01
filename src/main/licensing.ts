import { BrowserWindow } from 'electron'
import * as https from 'https'
import * as fs from 'fs'
import { URL } from 'url'
import { state } from './globals'
import { saveSettings } from './settings'
import { safeSend } from './utils'

// Public project configuration. Secrets now live in Supabase Edge Function env vars.
export const SUPABASE_URL = 'https://gqrwykhhqjimsgiqkgut.supabase.co'
export const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxcnd5a2hocWppbXNnaXFrZ3V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTIyNzAsImV4cCI6MjA4NzI4ODI3MH0.OVLEQdhYN6VHi5OQC_51EnDPoPPbnV0HuNHtchPy244'

type LicenseBackendResponse = {
  success?: boolean
  error?: string
  status?: 'FOUND' | 'NOT_FOUND' | 'BLOCKED' | 'EXPIRED'
  valid?: boolean
  key?: string
  expiry?: string | null
  licenses?: any[]
  feedback?: any[]
  url?: string
  signedUrl?: string
  publicUrl?: string
  path?: string
  token?: string
}

/**
 * Calls the Supabase Edge Function that owns licence/admin secrets.
 */
export async function licenseBackendRequest(
  action: string,
  body: Record<string, unknown> = {}
): Promise<LicenseBackendResponse> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { success: false, error: 'Configuration Supabase manquante.' }
  }

  return new Promise((resolve) => {
    const url = new URL(`${SUPABASE_URL}/functions/v1/license-admin`)
    const payload = JSON.stringify({ action, ...body })
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 15000
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {}
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return resolve({
              success: false,
              error: parsed.error || `Erreur backend licence (${res.statusCode})`
            })
          }
          resolve(parsed)
        } catch {
          resolve({ success: false, error: 'Réponse backend licence invalide.' })
        }
      })
    })

    req.on('error', (err) => resolve({ success: false, error: `Erreur réseau: ${err.message}` }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, error: 'Timeout backend licence.' })
    })
    req.write(payload)
    req.end()
  })
}

/**
 * Minimal REST client kept for public/non-sensitive reads such as update checks.
 */
export async function supabaseRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: any
): Promise<any> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null

  return new Promise((resolve) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`)
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(method !== 'GET' ? { Prefer: 'return=minimal' } : {})
      },
      timeout: 10000
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`[Supabase Error] ${method} ${path} -> Status ${res.statusCode}`)
          return resolve(null)
        }

        try {
          resolve(data ? JSON.parse(data) : {})
        } catch {
          resolve(null)
        }
      })
    })

    req.on('error', () => resolve(null))
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

export async function uploadFileToSignedUrl(
  localPath: string,
  signedUrl: string,
  publicUrl: string
): Promise<{ success: boolean; url?: string; error?: string; code?: number }> {
  if (!signedUrl) return { success: false, error: 'URL upload signée manquante.' }

  try {
    const fileContent = fs.readFileSync(localPath)
    const targetUrl = signedUrl.startsWith('http')
      ? signedUrl
      : `${SUPABASE_URL}${signedUrl.startsWith('/') ? '' : '/'}${signedUrl}`
    const url = new URL(targetUrl)

    const attemptUpload = (
      method: 'PUT' | 'POST'
    ): Promise<{ success: boolean; url?: string; error?: string; code?: number }> =>
      new Promise((resolve) => {
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileContent.length
        }
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve({ success: true, url: publicUrl })
          } else {
            resolve({
              success: false,
              error: `Erreur upload signé ${res.statusCode}: ${data.substring(0, 100)}`,
              code: res.statusCode
            })
          }
        })
      })

      req.on('error', (e) => resolve({ success: false, error: `Erreur réseau: ${e.message}` }))
      req.write(fileContent)
      req.end()
    })

    const putResult = await attemptUpload('PUT')
    if (putResult.success || (putResult.code !== 400 && putResult.code !== 405)) {
      return putResult
    }

    return await attemptUpload('POST')
  } catch (e: any) {
    return { success: false, error: `Erreur fichier local: ${e.message}` }
  }
}

export async function updateLicenseOnline(
  machineId: string,
  data: { last_seen?: string },
  _allowInsert = false
): Promise<boolean> {
  const result = await licenseBackendRequest('ping-license', {
    machineId,
    lastSeen: data.last_seen || new Date().toISOString()
  })
  return !!result.success
}

export function startLicenseHeartbeat(machineId: string) {
  setInterval(async () => {
    if (!state.appSettings.isActivated) return

    const cloud = await licenseBackendRequest('ping-license', { machineId })

    if (cloud.status === 'NOT_FOUND' || cloud.status === 'BLOCKED' || cloud.status === 'EXPIRED') {
      state.appSettings.isActivated = false
      state.appSettings.licenseKey = ''
      state.appSettings.expiryDate = null
      saveSettings({ isActivated: false, licenseKey: '', expiryDate: null })

      const reason =
        cloud.status === 'NOT_FOUND'
          ? "Votre licence a été supprimée par l'administrateur."
          : cloud.status === 'EXPIRED'
            ? 'Votre licence a expiré.'
            : 'Votre machine a été bloquée à distance.'

      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) safeSend(win, 'license-deactivated', reason)
      })
    }
  }, 3600000)
}
