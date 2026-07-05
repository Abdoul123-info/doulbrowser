import { useState, useEffect } from 'react';
import { Key, ShieldAlert, Cpu, CheckCircle2, AlertCircle, ExternalLink, Lock } from 'lucide-react';

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
        <div className="fixed inset-0 bg-[#020617] text-slate-100 flex items-center justify-center p-4 z-[9999]">
            {/* Background decorative elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[25%] -left-[25%] w-[70%] h-[70%] bg-blue-600/10 rounded-full blur-[120px]" />
                <div className="absolute -bottom-[25%] -right-[25%] w-[70%] h-[70%] bg-indigo-600/10 rounded-full blur-[120px]" />
            </div>

            <div className="w-full max-w-md relative animate-in fade-in zoom-in-95 duration-500">
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

                <div className="mt-8 text-center space-y-4">
                    <p className="text-xs text-slate-500">
                        Vous n'avez pas de clé ? Achetez-la en 2 minutes par mobile money.
                    </p>
                    <div className="flex justify-center gap-6">
                        <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); handleBuy(); }}
                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                        >
                            Acheter une clé <ExternalLink className="w-3 h-3" />
                        </a>
                        <a href="#" className="text-xs text-slate-500 hover:text-white transition-colors">
                            Support technique
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
