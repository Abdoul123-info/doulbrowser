import { useState, useEffect } from 'react';
import { Megaphone, X, ExternalLink } from 'lucide-react';

/**
 * Affiche l'annonce publiée par l'administrateur (panneau Admin -> Mises à jour).
 *
 * L'annonce vit dans app_config sous la clé "announce" — la même que celle lue
 * par l'application mobile. Jusqu'ici seuls les téléphones l'affichaient : côté
 * PC, la clé n'était utilisée que pour l'ENVOYER, et les utilisateurs Windows
 * ne voyaient jamais rien.
 *
 * Chaque annonce n'est montrée qu'une fois : son identifiant est mémorisé
 * localement une fois la bannière fermée. Publier une nouvelle annonce (nouvel
 * identifiant) la fait réapparaître.
 */
const SEEN_KEY = 'doulget_seen_announce_id';

type Announce = { id: string; title: string; body: string; url?: string };

export function AnnounceBanner() {
  const [announce, setAnnounce] = useState<Announce | null>(null);

  useEffect(() => {
    let annule = false;

    const verifier = async () => {
      try {
        const res = await window.api.getAnnounce();
        const a = res?.announce;
        if (annule || !a || !a.id) return;
        // Ni titre ni message : l'administrateur a effacé l'annonce.
        if (!a.title?.trim() && !a.body?.trim()) return;
        if (localStorage.getItem(SEEN_KEY) === a.id) return;
        setAnnounce(a);
      } catch {
        /* hors ligne : on réessaiera au prochain passage */
      }
    };

    // Au lancement, puis périodiquement : l'application PC reste souvent
    // ouverte des heures, une annonce publiée entre-temps doit arriver.
    verifier();
    const timer = setInterval(verifier, 30 * 60 * 1000);
    return () => {
      annule = true;
      clearInterval(timer);
    };
  }, []);

  const fermer = () => {
    if (announce) localStorage.setItem(SEEN_KEY, announce.id);
    setAnnounce(null);
  };

  const ouvrirLien = () => {
    if (announce?.url) window.open(announce.url, '_blank');
    fermer();
  };

  if (!announce) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-right-4 duration-500">
      <div className="w-80 bg-slate-900/95 backdrop-blur-xl border border-violet-500/30 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-2xl bg-violet-500/10 text-violet-400 shrink-0">
              <Megaphone className="w-6 h-6" />
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-white mb-1 break-words">{announce.title}</h4>
              <p className="text-xs text-slate-400 leading-relaxed break-words whitespace-pre-line">
                {announce.body}
              </p>
            </div>

            <button
              onClick={fermer}
              className="text-slate-500 hover:text-white transition-colors shrink-0"
              title="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {announce.url ? (
            <div className="mt-4 flex gap-2">
              <button
                onClick={ouvrirLien}
                className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-violet-900/20 flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Ouvrir le lien
              </button>
              <button
                onClick={fermer}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-all"
              >
                Fermer
              </button>
            </div>
          ) : (
            <button
              onClick={fermer}
              className="mt-4 w-full py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-violet-900/20"
            >
              J'ai compris
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
