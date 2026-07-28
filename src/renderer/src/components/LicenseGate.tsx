import { useState, useEffect } from 'react';
import { Key, ShieldAlert, Cpu, CheckCircle2, AlertCircle, ExternalLink, Lock, Smartphone } from 'lucide-react';
import airtelLogo from '../assets/pay/airtel.png';
import moovLogo from '../assets/pay/moov.png';
import zamaniLogo from '../assets/pay/zamani.png';
import amanaLogo from '../assets/pay/amana.png';
import nitaLogo from '../assets/pay/mynita.png';

// Operateurs REELLEMENT proposes au paiement : la page MoneyFusion est verrouillee
// sur le Niger (+227, aucun selecteur de pays). Annoncer Orange/MTN/Wave ferait
// esperer des moyens de paiement qui n'apparaissent jamais a l'ecran suivant.
const OPERATEURS = [
    { src: airtelLogo, nom: 'Airtel Money' },
    { src: moovLogo, nom: 'Moov Money' },
    { src: zamaniLogo, nom: 'Zamani Cash' },
    { src: amanaLogo, nom: 'Amana' },
    { src: nitaLogo, nom: 'MyNita' }
];

const WHATSAPP = '22785196143';

// Logo WhatsApp en SVG inline : lucide-react ne fournit plus de marques, et une
// icone de bulle generique ne se reconnait pas au premier coup d'oeil.
function LogoWhatsApp({ className = 'w-4 h-4' }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.885 3.4" />
        </svg>
    );
}

type LicenseGateProps = {
    onActivated: () => void;
    onAdminClick: () => void;
};

export function LicenseGate({ onActivated }: LicenseGateProps) {
    const [key, setKey] = useState('');
    const [machineId, setMachineId] = useState('Chargement...');
    const [logoClicks, setLogoClicks] = useState(0);
    const [showAdminBypass, setShowAdminBypass] = useState(false);
    const [adminPassword, setAdminPassword] = useState('');
    const [adminMessage, setAdminMessage] = useState<{ type: 'success' | 'error' | 'loading', text: string } | null>(null);
    const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error', message: string }>({
        type: 'idle',
        message: ''
    });
    // [v2.4.2] Achat en ligne (boutique MoneyFusion) + activation automatique
    const STORE_URL = 'https://abdoul123-info.github.io/doulget-store';
    const BUY_API = 'https://gqrwykhhqjimsgiqkgut.supabase.co/functions/v1/buy-license';
    const [waitingPayment, setWaitingPayment] = useState(false);

    const handleTitleClick = () => {
        const newCount = logoClicks + 1;
        setLogoClicks(newCount);
        if (newCount >= 5) {
            // [v1.9.22] Show inline admin bypass instead of trying to open unreachable admin panel
            setShowAdminBypass(true);
            setAdminPassword('');
            setAdminMessage(null);
            setLogoClicks(0);
        }
        setTimeout(() => setLogoClicks(0), 2000);
    };

    // [v2.4.2] Interroge la boutique: une clé payée existe-t-elle pour cette machine ?
    const checkMachineForKey = async (mid: string): Promise<string | null> => {
        if (!mid || mid === 'Chargement...' || mid.startsWith('Erreur')) return null;
        try {
            const r = await fetch(BUY_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'check-machine', machineId: mid })
            });
            const j = await r.json();
            return (j && j.success && j.found && j.licenseKey) ? j.licenseKey : null;
        } catch {
            return null;
        }
    };

    useEffect(() => {
        const fetchId = async () => {
            try {
                const mid = await window.api.getMachineId();
                setMachineId(mid);
                // [v2.4.2] Récupération auto: paiement déjà effectué (ex. app relancée
                // avant la confirmation) -> activation sans rien demander
                const paidKey = await checkMachineForKey(mid);
                if (paidKey) activateWithKey(paidKey);
            } catch (e) {
                setMachineId('Erreur de lecture HWID');
            }
        };
        fetchId();
    }, []);

    // [v2.4.2] Pendant l'achat: surveille le paiement puis active tout seul
    useEffect(() => {
        if (!waitingPayment) return;
        const interval = setInterval(async () => {
            const paidKey = await checkMachineForKey(machineId);
            if (paidKey) {
                clearInterval(interval);
                setWaitingPayment(false);
                activateWithKey(paidKey);
            }
        }, 8000);
        return () => clearInterval(interval);
    }, [waitingPayment, machineId]);

    const handleBuy = () => {
        if (!machineId || machineId === 'Chargement...' || machineId.startsWith('Erreur')) return;
        window.open(`${STORE_URL}/?mid=${encodeURIComponent(machineId)}`);
        setWaitingPayment(true);
    };

    // Le message porte l'identifiant machine : sans lui, il faut le redemander au
    // client avant de pouvoir generer sa cle.
    const handleWhatsApp = () => {
        const texte = `Bonjour, je veux acheter une licence DoulGet.\nMon identifiant machine : ${machineId}`;
        window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texte)}`);
    };

    const activateWithKey = async (licenseKey: string) => {
        setKey(licenseKey);
        setStatus({ type: 'loading', message: 'Vérification de la licence...' });
        try {
            const res = await window.api.activateLicense(licenseKey.trim());
            if (res.success) {
                setStatus({ type: 'success', message: 'Licence activée ! Redémarrage...' });
                setTimeout(() => {
                    onActivated();
                }, 1500);
            } else {
                setStatus({ type: 'error', message: res.error || 'Clé invalide.' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Erreur de connexion au serveur de licence.' });
        }
    };

    const handleActivate = async () => {
        if (!key.trim()) return;
        await activateWithKey(key.trim());
    };

    // [v1.9.22] Admin self-activation: generate a key and activate in one step
    const handleAdminBypass = async () => {
        if (!adminPassword.trim()) return;
        setAdminMessage({ type: 'loading', text: 'Génération de la clé...' });
        try {
            // Generate a 30-day key for this machine
            const res = await window.api.adminGenerateKey(adminPassword.trim(), machineId, '30');
            if (res.success && res.key) {
                setAdminMessage({ type: 'loading', text: 'Activation en cours...' });
                // Auto-activate with the generated key
                const activateRes = await window.api.activateLicense(res.key);
                if (activateRes.success) {
                    setAdminMessage({ type: 'success', text: `Licence activée (30 jours). Expire le: ${activateRes.expiry}` });
                    setTimeout(() => onActivated(), 1500);
                } else {
                    setAdminMessage({ type: 'error', text: activateRes.error || 'Erreur d\'activation.' });
                }
            } else {
                setAdminMessage({ type: 'error', text: res.error || 'Mot de passe admin incorrect.' });
            }
        } catch (_e) {
            setAdminMessage({ type: 'error', text: 'Erreur interne.' });
        }
    };

    return (
        // [v2.5.0] La carte etait centree sans defilement possible : avec la section
        // d'achat ajoutee, un portable 1366x768 — courant chez nos clients — masquait
        // les boutons hors de l'ecran, exactement ce qu'on cherchait a corriger.
        //
        // Structure en deux niveaux, et pas un simple `overflow-y-auto` sur le
        // conteneur flex : teste, un enfant centre par `my-auto` dans un conteneur
        // flex defilant voit son debordement ROGNE — le bouton WhatsApp restait
        // inatteignable meme en faisant defiler a fond. Le wrapper `min-h-full`
        // centre quand la place suffit et laisse defiler jusqu'en bas sinon.
        <div className="fixed inset-0 bg-[#020617] text-slate-100 z-[9999] overflow-y-auto">
            {/* Background decorative elements — en `fixed` pour ne pas suivre le
                defilement ni s'etirer sur toute la hauteur du contenu. */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[25%] -left-[25%] w-[70%] h-[70%] bg-blue-600/10 rounded-full blur-[120px]" />
                <div className="absolute -bottom-[25%] -right-[25%] w-[70%] h-[70%] bg-indigo-600/10 rounded-full blur-[120px]" />
            </div>

            <div className="min-h-full flex items-center justify-center p-4">
            <div className="w-full max-w-md relative py-6 animate-in fade-in zoom-in-95 duration-500">
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-blue-600/20 shadow-xl shadow-blue-900/20 border border-blue-500/30 mb-6">
                        <Key className="w-10 h-10 text-blue-400" />
                    </div>
                    <h1
                        onClick={handleTitleClick}
                        className="text-3xl font-black tracking-tight text-white mb-2 cursor-default select-none transition-transform active:scale-95"
                    >
                        Activation de DoulGet
                    </h1>
                    <p className="text-slate-400">Une licence valide est requise pour utiliser l'application.</p>
                </div>

                <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                    {/* Machine ID Section */}
                    <div className="mb-8 p-4 bg-slate-950/50 border border-slate-800 rounded-2xl relative group">
                        <div className="flex items-center gap-3 mb-2">
                            <Cpu className="w-4 h-4 text-blue-400" />
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Votre Identifiant Machine (HWID)</span>
                        </div>
                        <div className="font-mono text-sm text-blue-200 break-all select-all">
                            {machineId}
                        </div>
                    </div>

                    {/* [v1.9.22] Secret Admin Bypass Panel */}
                    {showAdminBypass ? (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="flex items-center gap-2 mb-2">
                                <Lock className="w-4 h-4 text-amber-400" />
                                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Accès Admin</span>
                            </div>
                            <div className="relative">
                                <input
                                    type="password"
                                    placeholder="Mot de passe admin"
                                    value={adminPassword}
                                    onChange={(e) => setAdminPassword(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAdminBypass()}
                                    className="w-full bg-slate-950 border border-amber-500/30 rounded-2xl px-6 py-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAdminBypass}
                                    disabled={!adminPassword.trim() || adminMessage?.type === 'loading'}
                                    className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white font-bold py-3 rounded-2xl transition-all"
                                >
                                    {adminMessage?.type === 'loading' ? 'Chargement...' : 'Activer (30 jours)'}
                                </button>
                                <button
                                    onClick={() => setShowAdminBypass(false)}
                                    className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-2xl transition-all"
                                >
                                    ✕
                                </button>
                            </div>
                            {adminMessage && (
                                <div className={`p-3 rounded-xl flex items-center gap-2 text-sm ${adminMessage.type === 'success' ? 'bg-green-500/10 text-green-400' :
                                    adminMessage.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                                    }`}>
                                    {adminMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> :
                                        adminMessage.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> :
                                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />}
                                    {adminMessage.text}
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Normal Input Section */}
                            <div className="space-y-4">
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Entrez votre clé de licence"
                                        value={key}
                                        onChange={(e) => setKey(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                                        disabled={status.type === 'loading' || status.type === 'success'}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all disabled:opacity-50"
                                    />
                                </div>

                                <button
                                    onClick={handleActivate}
                                    disabled={!key.trim() || status.type === 'loading' || status.type === 'success'}
                                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-3 group"
                                >
                                    {status.type === 'loading' ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            ACTIVER LA LICENCE
                                            <ShieldAlert className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* Status Message */}
                            {status.message && (
                                <div className={`mt-6 p-4 rounded-xl flex items-center gap-3 text-sm animate-in slide-in-from-top-2 duration-300 ${status.type === 'success' ? 'bg-green-500/10 text-green-400' :
                                    status.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                                    }`}>
                                    {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> :
                                        status.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0" /> :
                                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />}
                                    {status.message}
                                </div>
                            )}

                            {/* [v2.4.2] Attente du paiement boutique -> activation auto */}
                            {waitingPayment && status.type !== 'success' && status.type !== 'loading' && (
                                <div className="mt-6 p-4 rounded-xl bg-blue-500/10 text-blue-300 text-sm flex items-center gap-3 animate-in slide-in-from-top-2 duration-300">
                                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
                                    <span>En attente de votre paiement... L'application s'activera automatiquement dès confirmation.</span>
                                    <button
                                        onClick={() => setWaitingPayment(false)}
                                        className="ml-auto text-blue-400 hover:text-white transition-colors shrink-0"
                                        title="Annuler l'attente"
                                    >
                                        ✕
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* [v2.5.0] L'achat n'etait qu'un lien texte de 12 px perdu en bas de
                    page : les clients ne le voyaient pas et ecrivaient sur WhatsApp
                    pour demander comment payer. Il devient un vrai bouton, avec les
                    operateurs affiches et le recours WhatsApp a cote. */}
                {!showAdminBypass && (
                    <div className="mt-8">
                        <div className="text-center mb-4">
                            <p className="text-sm font-semibold text-slate-300">Pas encore de clé ?</p>
                            <p className="text-xs text-slate-500 mt-1">
                                1 mois — 1 500 F&nbsp;&nbsp;·&nbsp;&nbsp;3 mois — 3 000 F&nbsp;&nbsp;·&nbsp;&nbsp;12 mois — 7 500 F
                            </p>
                        </div>

                        <button
                            onClick={handleBuy}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-3"
                        >
                            <Smartphone className="w-5 h-5" />
                            PAYER PAR MOBILE MONEY
                        </button>

                        <div className="flex justify-center items-center gap-3 mt-4">
                            {OPERATEURS.map((op) => (
                                <img
                                    key={op.nom}
                                    src={op.src}
                                    alt={op.nom}
                                    title={op.nom}
                                    className="w-9 h-9 rounded-lg bg-white object-contain"
                                />
                            ))}
                        </div>

                        <p className="text-[11px] text-slate-500 text-center mt-3 leading-relaxed">
                            Votre licence s'active toute seule dès le paiement confirmé —
                            aucune clé à recopier.
                        </p>

                        <button
                            onClick={handleWhatsApp}
                            className="w-full mt-4 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-medium py-3 rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                        >
                            <LogoWhatsApp className="w-4 h-4 text-[#25D366]" />
                            Acheter par WhatsApp
                            <ExternalLink className="w-3 h-3 opacity-60" />
                        </button>
                        <p className="text-[11px] text-slate-600 text-center mt-2">
                            Hors du Niger, le paiement mobile money n'est pas disponible :
                            passez par WhatsApp.
                        </p>
                    </div>
                )}
            </div>
            </div>
        </div>
    );
}
