-- MISE À JOUR : SUIVI TEMPS RÉEL
-- Ajoute le support pour savoir qui est en ligne et permet la suppression totale

-- 1. Ajouter la colonne last_seen si elle n'existe pas
ALTER TABLE public.licences ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 2. Index pour optimiser les requêtes de statistiques
CREATE INDEX IF NOT EXISTS idx_licences_last_seen ON public.licences(last_seen);
