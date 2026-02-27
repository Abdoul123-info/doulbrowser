-- SCRIPT DE RÉPARATION SCHÉMA SUPABASE
-- À exécuter si vous avez l'erreur "Impossible de récupérer les données cloud"

-- 1. Ajouter les colonnes manquantes à la table licences
ALTER TABLE public.licences ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.licences ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.licences ADD COLUMN IF NOT EXISTS original_key TEXT;
ALTER TABLE public.licences ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());
ALTER TABLE public.licences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 2. S'assurer que la table app_config existe
CREATE TABLE IF NOT EXISTS public.app_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Politique de sécurité (RLS) - lecture publique si nécessaire
ALTER TABLE public.licences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lecture publique des licences" ON public.licences;
CREATE POLICY "Lecture publique des licences" ON public.licences FOR SELECT USING (true);
