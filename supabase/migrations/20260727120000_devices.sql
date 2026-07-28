-- Ancre d'essai : mémorise la première fois que le serveur voit un appareil.
-- Sans elle, désinstaller/réinstaller l'application remet l'essai de 3 jours à zéro,
-- indéfiniment. L'ANDROID_ID survivant à la désinstallation, le serveur peut
-- reconnaître l'appareil et refuser de redémarrer le décompte.
create table if not exists public.devices (
  hwid       text primary key,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

-- RLS activé SANS aucune policy : la clé publique `anon` ne peut ni lire ni écrire.
-- Seule la fonction Edge, qui utilise la clé `service_role`, accède à cette table.
alter table public.devices enable row level security;
