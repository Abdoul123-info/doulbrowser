// ============================================================
// Fonction Edge "buy-license" — vente automatique de licences
// via MoneyFusion (mobile money: Orange, MTN, Moov, Wave...)
//
// Actions (POST JSON):
//  - create-order  {action, plan, machineId?, name?, phone?}
//       -> cree la commande + le paiement MoneyFusion, renvoie l'URL de paiement
//  - webhook       (POST de MoneyFusion, sans champ "action")
//       -> re-verifie le paiement cote serveur puis genere la cle
//  - check-order   {action, orderId}
//       -> statut + cle si payee. Si la commande est encore "pending",
//          re-verifie aupres de MoneyFusion (robuste meme sans webhook)
//
// Deploiement: npx supabase functions deploy buy-license --no-verify-jwt
// (public: la page de vente et MoneyFusion appellent sans jeton)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import CryptoJS from "https://esm.sh/crypto-js@4.1.1"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const LICENSE_SALT = Deno.env.get("LICENSE_SALT") || ""
const MONEYFUSION_API_URL = Deno.env.get("MONEYFUSION_API_URL") || ""

// Adresse publique de la boutique (page de vente GitHub Pages)
const STORE_URL = "https://abdoul123-info.github.io/doulget-store"

// ------------------------------------------------------------
// TARIFS — modifier ICI uniquement (prix en FCFA, duree en jours)
// ------------------------------------------------------------
const PLANS: Record<string, { price: number; days: number; label: string }> = {
  m1: { price: 1500, days: 30, label: "1 mois" },
  m3: { price: 3000, days: 90, label: "3 mois" },
  m12: { price: 7500, days: 365, label: "12 mois" }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}

function md5(value: string): string {
  return CryptoJS.MD5(value).toString().toUpperCase()
}

// Meme signature que license-admin: cle compatible avec l'activation existante
function signLicense(machineId: string, expiryDate: string): string {
  const cleanMid = machineId.trim().toUpperCase()
  const payload = `${cleanMid}:${expiryDate}:${LICENSE_SALT}`
  const hash = md5(payload).substring(0, 16)
  return `${cleanMid}#${expiryDate}#${hash}`
}

// machineId fourni (achat depuis l'app) -> cle liee a la machine (activation auto)
// sinon -> cle universelle B-XXXXXXXX verrouillee au premier usage
function makeKey(machineId: string | null, days: number): string {
  const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  if (machineId && machineId.trim()) return signLicense(machineId, expiry)
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  const id = "B-" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()
  return signLicense(id, expiry)
}

// Verification du paiement AUPRES de MoneyFusion (jamais confiance au webhook seul)
async function verifyPayment(token: string): Promise<{ paid: boolean; failed: boolean; amount: number }> {
  const res = await fetch(`https://www.pay.moneyfusion.net/paiementNotif/${encodeURIComponent(token)}`)
  const j = await res.json().catch(() => null)
  const d = (j && (j.data || j)) || {}
  const st = String(d.statut ?? d.status ?? "").toLowerCase()
  const amount = Number(d.Montant ?? d.montant ?? d.amount ?? 0)
  return {
    paid: st === "paid",
    failed: st === "failure" || st === "no paid" || st === "cancelled" || st === "echec",
    amount
  }
}

// Regle une commande: verifie le paiement et genere la cle (idempotent)
// deno-lint-ignore no-explicit-any
async function settleOrder(supabase: any, order: any): Promise<any> {
  if (order.status === "paid" && order.license_key) return order
  if (!order.payment_token) return order

  const v = await verifyPayment(order.payment_token)

  if (v.failed) {
    await supabase.from("orders").update({ status: "failed" }).eq("id", order.id).eq("status", "pending")
    return { ...order, status: "failed" }
  }
  if (!v.paid) return order

  // Anti-fraude: le montant paye doit couvrir le prix du plan
  if (v.amount > 0 && v.amount + 1 < order.amount) {
    await supabase.from("orders").update({ status: "failed" }).eq("id", order.id).eq("status", "pending")
    return { ...order, status: "failed" }
  }

  const plan = PLANS[order.plan]
  if (!plan) return order
  const key = makeKey(order.machine_id, plan.days)

  // Idempotence: n'ecrit la cle que si aucune n'existe deja (webhook + polling simultanes)
  const { data: updated } = await supabase
    .from("orders")
    .update({ status: "paid", license_key: key, paid_at: new Date().toISOString() })
    .eq("id", order.id)
    .is("license_key", null)
    .select()
    .single()

  if (updated) return updated
  const { data: fresh } = await supabase.from("orders").select("*").eq("id", order.id).single()
  return fresh || order
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ success: false, error: "Méthode non autorisée." }, 405)

  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !LICENSE_SALT || !MONEYFUSION_API_URL) {
      throw new Error("Configuration boutique incomplète.")
    }
    const body = await req.json().catch(() => ({}))
    let action = String(body.action || "")
    // Le webhook MoneyFusion n'envoie pas de champ "action"
    if (!action && (body.tokenPay || body.token)) action = "webhook"

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    if (action === "create-order") {
      const plan = PLANS[String(body.plan || "")]
      if (!plan) return json({ success: false, error: "Plan invalide." }, 400)

      const machineId = String(body.machineId || "").trim().toUpperCase() || null
      const name = String(body.name || "").trim().substring(0, 80) || "Client DoulGet"
      const phone = String(body.phone || "").trim().substring(0, 20)

      const { data: order, error: insErr } = await supabase
        .from("orders")
        .insert({
          plan: String(body.plan),
          amount: plan.price,
          machine_id: machineId,
          customer_name: name,
          customer_phone: phone
        })
        .select()
        .single()
      if (insErr || !order) throw new Error(insErr?.message || "Création de commande impossible.")

      const payload = {
        totalPrice: plan.price,
        article: [{ [`Licence DoulGet ${plan.label}`]: plan.price }],
        personal_Info: [{ orderId: order.id }],
        numeroSend: phone,
        nomclient: name,
        return_url: `${STORE_URL}/merci.html?order=${order.id}`,
        webhook_url: `${SUPABASE_URL}/functions/v1/buy-license`
      }

      const res = await fetch(MONEYFUSION_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      const j = await res.json().catch(() => null)

      if (!j || j.statut !== true || !j.url) {
        await supabase.from("orders").update({ status: "failed" }).eq("id", order.id)
        return json({
          success: false,
          error: (j && (j.message || j["message-money"])) || "MoneyFusion a refusé la création du paiement."
        }, 502)
      }

      await supabase.from("orders").update({ payment_token: j.token || null }).eq("id", order.id)
      return json({ success: true, orderId: order.id, paymentUrl: j.url })
    }

    if (action === "webhook") {
      const token = String(body.tokenPay || body.token || "")
      if (!token) return json({ success: true })
      const { data: order } = await supabase.from("orders").select("*").eq("payment_token", token).single()
      // 200 meme si inconnue: on ne donne aucune info et MoneyFusion ne re-tente pas en boucle
      if (!order) return json({ success: true })
      await settleOrder(supabase, order)
      return json({ success: true })
    }

    // Interrogee par l'app DoulGet (LicenseGate) avec son propre machineId:
    // renvoie la cle des qu'un paiement lie a cette machine est confirme.
    // Sans risque: une cle liee a une machine est inutilisable ailleurs.
    if (action === "check-machine") {
      const machineId = String(body.machineId || "").trim().toUpperCase()
      if (!machineId) return json({ success: false, error: "machineId manquant." }, 400)

      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .eq("machine_id", machineId)
        .neq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(3)

      for (const o of orders || []) {
        const s = o.status === "pending" ? await settleOrder(supabase, o) : o
        if (s.status === "paid" && s.license_key) {
          return json({ success: true, found: true, licenseKey: s.license_key })
        }
      }
      return json({ success: true, found: false })
    }

    if (action === "check-order") {
      const orderId = String(body.orderId || "")
      if (!orderId) return json({ success: false, error: "orderId manquant." }, 400)
      const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single()
      if (!order) return json({ success: false, error: "Commande introuvable." }, 404)

      // Verification paresseuse: fonctionne meme si le webhook n'est jamais arrive
      const settled = order.status === "pending" ? await settleOrder(supabase, order) : order

      return json({
        success: true,
        status: settled.status,
        licenseKey: settled.license_key || null,
        plan: settled.plan,
        planLabel: PLANS[settled.plan]?.label || settled.plan,
        machineBound: !!settled.machine_id
      })
    }

    return json({ success: false, error: "Action inconnue." }, 400)
  } catch (e) {
    return json({ success: false, error: (e as Error).message || "Erreur serveur." }, 500)
  }
})
