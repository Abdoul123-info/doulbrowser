import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import CryptoJS from "https://esm.sh/crypto-js@4.1.1"

// --- CONFIGURATION ---
const LICENSE_SALT = 'DadiLicenceSecret2026'
const SUPABASE_URL = Deno.env.get('APP_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('APP_SERVICE_KEY') || ''

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    console.log('[Webhook] Request received')
    const url = new URL(req.url)
    
    // Robust body parsing
    let body = {}
    try {
      body = await req.json()
    } catch (e) {
      console.log('[Webhook] Empty or invalid JSON body')
    }
    
    // Determine duration
    // [v1.2.4] Unique plan: 1 Month only
    const duration = 'month'
    const email = (body as any).customer_email || (body as any).email || 'client@doulget.com'
    
    console.log(`[Webhook] Force Duration: ${duration}, Email: ${email}`)

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
       throw new Error('Server configuration error (Keys missing in Supabase Settings)')
    }

    const randomId = 'B-' + Math.random().toString(36).substring(2, 10).toUpperCase()
    const expiryDate = new Date()
    
    // Always 1 month
    expiryDate.setMonth(expiryDate.getMonth() + 1)

    const isoExpiry = expiryDate.toISOString()
    const payload = `${randomId}:${isoExpiry}:${LICENSE_SALT}`
    
    // Hash using CryptoJS (MD5) - Reliable in Deno
    const licenseHash = CryptoJS.MD5(payload).toString().toUpperCase()
    const shortHash = licenseHash.substring(0, 16)
    const licenseKey = `${randomId}#${isoExpiry}#${shortHash}`

    console.log(`[Webhook] Generated License Key: ${licenseKey}`)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { error: dbError } = await supabase.from('licences').insert([{ 
      hwid: randomId, 
      license_key: licenseKey, 
      expiry_date: isoExpiry,
      email: email,
      status: 'active'
    }])

    if (dbError) {
      console.error('[Database Error]', dbError)
      throw new Error(`Database insertion failed: ${dbError.message}`)
    }

    return new Response(JSON.stringify({ 
      success: true, 
      license_key: licenseKey,
      plan: duration,
      expiry: isoExpiry 
    }), { 
      headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' } 
    })
  } catch (err: any) {
    console.error('[Global Error]', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), { 
      status: 400,
      headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' }
    })
  }
})
