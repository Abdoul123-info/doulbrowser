-- ============================================================
-- Table des commandes de licences (vente automatique MoneyFusion)
-- A coller dans: Dashboard Supabase > SQL Editor > Run
-- ============================================================

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  plan text not null,                      -- 'm1' | 'm3' | 'm12'
  amount integer not null,                 -- prix attendu en FCFA
  machine_id text,                         -- ID machine si achat depuis l'app (activation auto)
  customer_name text,
  customer_phone text,
  payment_token text unique,               -- token de paiement MoneyFusion
  status text not null default 'pending',  -- pending | paid | failed
  license_key text,                        -- cle generee apres paiement verifie
  paid_at timestamptz
);

-- Index pour les recherches du webhook et du polling
create index if not exists orders_payment_token_idx on public.orders (payment_token);
create index if not exists orders_status_idx on public.orders (status);

-- Securite: RLS active et AUCUNE policy publique.
-- Seules les fonctions Edge (service_role) peuvent lire/ecrire.
alter table public.orders enable row level security;
