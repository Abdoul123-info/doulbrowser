import { X, ShieldAlert, ShieldCheck, Key, FileText, Clipboard, CheckCircle2, AlertCircle, Cloud, RefreshCw, UploadCloud, Package, Search, Star, MessageSquare, AlertTriangle, Monitor, Smartphone, Megaphone } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../utils/i18n';

type AdminModalProps = {
    isOpen: boolean;
    onClose: () => void;
};

export function AdminModal({ isOpen, onClose }: AdminModalProps) {
    const [password, setPassword] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [authError, setAuthError] = useState('');
    const { t } = useTranslation();

    const [targetMid, setTargetMid] = useState('');
    const [duration, setDuration] = useState('30');
    const [customDate, setCustomDate] = useState('');
    const [count, setCount] = useState(1);

    const [result, setResult] = useState<{ type: 'single' | 'bulk', data: string | string[] } | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [activeTab, setActiveTab] = useState<'generation' | 'cloud' | 'updates' | 'feedback'>('generation');
    const [newVersion, setNewVersion] = useState('');
    const [newUpdateUrl, setNewUpdateUrl] = useState('');
    const [newExtensionVersion, setNewExtensionVersion] = useState('');
    const [newExtensionUrl, setNewExtensionUrl] = useState('');
    // [v2.4.2] Hashes SHA-256 publiés avec la version (auto après upload, ou via fichier local)
    const [newUpdateHash, setNewUpdateHash] = useState('');
    const [newExtensionHash, setNewExtensionHash] = useState('');
    const [cloudLicenses, setCloudLicenses] = useState<any[]>([]);
    const [isLoadingCloud, setIsLoadingCloud] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    // [v2.4.2] Progression de l'upload en cours (setup ou extension)
    const [uploadProgress, setUploadProgress] = useState<{ type: 'setup' | 'extension', percent: number, uploaded: number, total: number, speed?: number, etaSeconds?: number } | null>(null);
    // [v2.4.2] Ref miroir d'isUploading: ignore les events IPC retardataires après la fin
    const isUploadingRef = useRef(false);
    const [searchCloud, setSearchCloud] = useState('');
    const [feedbackList, setFeedbackList] = useState<any[]>([]);
    const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);

    // [v2.4.5] Annonce aux utilisateurs mobiles (notification sur leurs téléphones)
    const [announceTitle, setAnnounceTitle] = useState('');
    const [announceMessage, setAnnounceMessage] = useState('');
    const [announceUrl, setAnnounceUrl] = useState('');
    // [v2.4.8] Cible de l'annonce : 'all' (les deux), 'pc' ou 'android'.
    const [announceTarget, setAnnounceTarget] = useState<'all' | 'pc' | 'android'>('all');
    const [currentAnnounce, setCurrentAnnounce] = useState<{ id: string, title: string, body: string, url?: string } | null>(null);
    const [currentAnnounceAndroid, setCurrentAnnounceAndroid] = useState<{ id: string, title: string, body: string, url?: string } | null>(null);
    const [isSendingAnnounce, setIsSendingAnnounce] = useState(false);

    const refreshAnnounce = async () => {
        try {
            const [pc, android] = await Promise.all([
                window.api.getAnnounce('pc'),
                window.api.getAnnounce('android')
            ]);
            setCurrentAnnounce(pc?.announce || null);
            setCurrentAnnounceAndroid(android?.announce || null);
        } catch { setCurrentAnnounce(null); setCurrentAnnounceAndroid(null); }
    };

    const handleSendAnnounce = async () => {
        if (!announceTitle.trim() || !announceMessage.trim()) {
            setMessage({ type: 'error', text: 'Titre et message requis.' });
            return;
        }
        setIsSendingAnnounce(true);
        try {
            const res = await window.api.adminSetAnnounce(password, announceTitle.trim(), announceMessage.trim(), announceUrl.trim(), announceTarget);
            if (res?.success) {
                const cible = announceTarget === 'pc' ? 'aux utilisateurs PC'
                    : announceTarget === 'android' ? 'aux téléphones (reçue sous ~3 h)'
                    : 'à tous (PC + téléphones sous ~3 h)';
                setMessage({ type: 'success', text: `Annonce publiée ${cible}.` });
                setAnnounceTitle(''); setAnnounceMessage(''); setAnnounceUrl('');
                await refreshAnnounce();
            } else {
                setMessage({ type: 'error', text: res?.error || 'Échec de la publication.' });
            }
        } catch (e: any) {
            setMessage({ type: 'error', text: e?.message || 'Échec de la publication.' });
        }
        setIsSendingAnnounce(false);
    };

    const handleClearAnnounce = (target: 'pc' | 'android') => {
        const nom = target === 'pc' ? 'PC' : 'Android';
        showConfirm(`Supprimer l'annonce ${nom} en cours ?`, async () => {
            setIsSendingAnnounce(true);
            try {
                const res = await window.api.adminSetAnnounce(password, '', '', '', target);
                if (res?.success) {
                    setMessage({ type: 'success', text: `Annonce ${nom} supprimée.` });
                    await refreshAnnounce();
                } else {
                    setMessage({ type: 'error', text: res?.error || 'Échec de la suppression.' });
                }
            } catch (e: any) {
                setMessage({ type: 'error', text: e?.message || 'Échec de la suppression.' });
            }
            setIsSendingAnnounce(false);
        });
    };

    // Séparation PC / Mobile : Android envoie son ANDROID_ID (16 caractères hexadécimaux),
    // le PC un UUID matériel long — le format du hwid suffit à distinguer les plateformes.
    const isMobileHwid = (hwid?: string): boolean => !!hwid && /^[0-9a-f]{16}$/i.test(hwid.trim());
    const [cloudFilter, setCloudFilter] = useState<'all' | 'pc' | 'mobile'>('all');
    const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'pc' | 'mobile'>('all');
    const visibleFeedback = feedbackList.filter(f => feedbackFilter === 'all' || (feedbackFilter === 'mobile') === isMobileHwid(f.hwid));

    const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; onConfirm: () => void }>({
        open: false,
        message: '',
        onConfirm: () => {}
    });

    const showConfirm = (message: string, onConfirm: () => void) => {
        setConfirmDialog({ open: true, message, onConfirm });
    };

    const closeConfirm = () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
    };


    const handleAuth = async () => {
        const isValid = await window.api.verifyAdminPassword(password);
        if (isValid) {
            setIsAuthenticated(true);
            setAuthError('');
        } else {
            setAuthError(t.admin.wrongPassword);
        }
    };

    // [v1.9.34] Auto-refresh cloud data when on the tab
    useEffect(() => {
        let interval: any;
        if (activeTab === 'cloud' && isAuthenticated) {
            interval = setInterval(fetchCloudLicenses, 30000);
        }
        return () => clearInterval(interval);
    }, [activeTab, isAuthenticated]);

    // [v2.4.2] Abonnement à la progression de l'upload admin
    useEffect(() => {
        window.api.onAdminUploadProgress((_e, data) => {
            if (!isUploadingRef.current) return; // event fantôme après fin/erreur
            setUploadProgress({ type: data.type, percent: data.percent, uploaded: data.uploaded, total: data.total, speed: data.speed, etaSeconds: data.etaSeconds });
        });
        return () => window.api.removeAdminUploadProgress();
    }, []);

    // [v2.4.2] Formatage octets -> Mo/Ko lisible
    const formatBytes = (bytes: number): string => {
        if (!bytes || bytes < 1024) return `${bytes || 0} o`;
        const mb = bytes / (1024 * 1024);
        if (mb >= 1) return `${mb.toFixed(1)} Mo`;
        return `${(bytes / 1024).toFixed(0)} Ko`;
    };

    // [v2.4.2] Formatage durée restante -> "2 min 30 s"
    const formatEta = (s: number): string => {
        if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
        if (s >= 60) return `${Math.floor(s / 60)} min ${s % 60} s`;
        return `${s} s`;
    };

    const fetchFeedback = async () => {
        setIsLoadingFeedback(true);
        try {
            const res = await window.api.adminGetFeedback(password || '');
            if (res.success && res.feedback) {
                setFeedbackList(res.feedback);
            } else if (!res.success) {
                setMessage({ type: 'error', text: res.error || 'Erreur lors de la récupération des avis.' });
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Erreur technique lors de la récupération.' });
        } finally {
            setIsLoadingFeedback(false);
        }
    };


    const handleGenerateSingle = async () => {
        // HWID optionnel : s'il est vide, le backend génère une clé universelle "B-XXXX"
        // utilisable sur n'importe quelle machine (verrouillée au premier usage).
        try {
            const finalDuration = duration === 'custom' ? `date:${customDate}` : duration;
            if (duration === 'custom' && !customDate) {
                setMessage({ type: 'error', text: 'Veuillez choisir une date.' });
                return;
            }

            const res = await window.api.adminGenerateKey(password, targetMid.trim(), finalDuration);
            if (res.success && res.key) {
                setResult({ type: 'single', data: res.key });
                setMessage({ type: 'success', text: 'Clé générée avec succès !' });
            } else {
                setMessage({ type: 'error', text: res.error || 'Erreur lors de la génération.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Erreur technique.' });
        }
    };

    const handleGenerateBulk = async () => {
        try {
            const finalDuration = duration === 'custom' ? `date:${customDate}` : duration;
            if (duration === 'custom' && !customDate) {
                setMessage({ type: 'error', text: 'Veuillez choisir une date.' });
                return;
            }

            const res = await window.api.adminBulkGenerate(password, count, finalDuration);
            if (res.success && res.keys) {
                setResult({ type: 'bulk', data: res.keys });
                setMessage({ type: 'success', text: `${count} clés générées avec succès !` });
            } else {
                setMessage({ type: 'error', text: res.error || 'Erreur lors de la génération.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Erreur technique.' });
        }
    };

    const copyToClipboard = () => {
        if (!result) return;
        const text = Array.isArray(result.data) ? result.data.join('\n') : result.data;
        navigator.clipboard.writeText(text);
        setMessage({ type: 'success', text: 'Copié dans le presse-papiers !' });
    };

    const fetchCloudLicenses = async () => {
        setIsLoadingCloud(true);
        try {
            const res = await window.api.adminGetAllLicenses(password || '');
            if (res.success) {
                setCloudLicenses(res.licenses);
            } else {
                setMessage({ type: 'error', text: res.error || '' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Erreur lors de la récupération cloud.' });
        } finally {
            setIsLoadingCloud(false);
        }
    };

    const handleResetLicense = async () => {
        showConfirm(
            t.admin.confirmReset || 'Voulez-vous réinitialiser la licence de ce PC ?',
            async () => {
                try {
                    const res = await window.api.adminResetLicense(password);
                    if (res.success) {
                        setMessage({ type: 'success', text: 'Licence réinitialisée ! Redémarrez DoulGet pour activer une nouvelle clé.' });
                    } else {
                        setMessage({ type: 'error', text: res.error || 'Erreur lors de la réinitialisation.' });
                    }
                } catch (error) {
                    setMessage({ type: 'error', text: 'Erreur technique.' });
                }
            }
        );
    };

    const handlePushUpdate = async () => {
        if (!newVersion && !newExtensionVersion) {
            setMessage({ type: 'error', text: 'Veuillez au moins remplir une version (Setup ou Extension).' });
            return;
        }

        try {
            const res = await window.api.adminSetLatestVersion(
                password,
                newVersion,
                newUpdateUrl,
                newExtensionVersion,
                newExtensionUrl,
                // [v2.4.2] Sans hash publié, les clients refusent la mise à jour (anti-tampering)
                newUpdateHash.trim() || undefined,
                newExtensionHash.trim() || undefined
            );
            
            if (res.success) {
                setMessage({ type: 'success', text: 'Mise à jour publiée avec succès !' });
            } else {
                setMessage({ type: 'error', text: res.error || 'Erreur lors de la publication.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Erreur technique.' });
        }
    };

    const performUpload = async (localPath: string, type: 'setup' | 'extension', fileName: string) => {
        setIsUploading(true);
        isUploadingRef.current = true;
        setUploadProgress({ type, percent: 0, uploaded: 0, total: 0 });
        setMessage({ type: 'success', text: `Upload de ${fileName} en cours...` });

        try {
            const res = await window.api.adminUploadUpdateFile(password, localPath, type);
            if (res.success && res.url) {
                if (type === 'setup') {
                    setNewUpdateUrl(res.url);
                    if (res.hash) setNewUpdateHash(res.hash);
                } else {
                    setNewExtensionUrl(res.url);
                    if (res.hash) setNewExtensionHash(res.hash);
                }
                setMessage({ type: 'success', text: `${fileName} téléversé, hash SHA-256 publié et configuré !` });
            } else {
                setMessage({ type: 'error', text: res.error || 'Erreur lors de l\'upload.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Erreur technique lors de l\'upload.' });
        } finally {
            isUploadingRef.current = false;
            setIsUploading(false);
            setUploadProgress(null);
        }
    };

    // [v2.4.2] SHA-256 d'un fichier local sans upload — pour un setup hébergé
    // ailleurs (ex. GitHub Releases) publié via le champ « Lien Direct »
    const handleHashLocalFile = async (type: 'setup' | 'extension') => {
        const res = await window.api.adminHashLocalFile(type);
        if (!res) return; // dialogue annulé
        if (res.hash) {
            if (type === 'setup') setNewUpdateHash(res.hash);
            else setNewExtensionHash(res.hash);
            setMessage({ type: 'success', text: `SHA-256 de ${res.fileName} calculé. Publiez pour le diffuser.` });
        } else {
            setMessage({ type: 'error', text: res.error || 'Erreur de calcul du hash.' });
        }
    };

    const handleFileUpload = async (e: React.DragEvent, type: 'setup' | 'extension') => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!file) return;

        // @ts-ignore
        const localPath = file.path;
        if (!localPath) {
            setMessage({ type: 'error', text: 'Impossible d\'accéder au chemin du fichier.' });
            return;
        }

        await performUpload(localPath, type, file.name);
    };

    const handleDeleteLicenseCloud = async (mid: string) => {
        showConfirm(
            `${t.admin.confirmDelete || 'Voulez-vous supprimer cet élément ?'} (${mid})`,
            async () => {
                try {
                    const res = await window.api.adminDeleteLicenseCloud(password, mid);
                    if (res.success) {
                        setMessage({ type: 'success', text: 'Client supprimé totalement.' });
                        fetchCloudLicenses(); // Refresh
                    } else {
                        setMessage({ type: 'error', text: res.error || 'Erreur lors de la suppression.' });
                    }
                } catch (error) {
                    setMessage({ type: 'error', text: 'Erreur technique.' });
                }
            }
        );
    };

    const triggerFileSelect = async (type: 'setup' | 'extension') => {
        if (isUploading) return;

        try {
            const localPath = await window.api.adminSelectUpdateFile(type);
            if (localPath) {
                const fileName = localPath.split(/[\\/]/).pop() || (type === 'setup' ? 'Setup' : 'Extension');
                await performUpload(localPath, type, fileName);
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Erreur lors de la sélection du fichier.' });
        }
    };

    const handleToggleBlock = async (mid: string, currentStatus: boolean) => {
        try {
            const res = await window.api.adminUpdateLicenseStatus(password, mid, !currentStatus);
            if (res.success) {
                setMessage({ type: 'success', text: `Statut mis à jour pour ${mid}` });
                fetchCloudLicenses();
            } else {
                setMessage({ type: 'error', text: res.error || 'Erreur lors de la mise à jour.' });
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Erreur technique lors du blocage.' });
        }
    };


    const exportToText = () => {
        if (!result) return;
        const text = Array.isArray(result.data) ? result.data.join('\n') : result.data;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Cles_Licence_DoulGet_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] animate-in fade-in duration-300">
            {/* [v2.4.9] max-h-[90vh] + flex-col : la boîte ne dépasse plus l'écran ;
                l'en-tête reste fixe et le contenu défile (avant, sur les onglets longs
                comme « Mises à jour », les boutons Publier passaient sous le bord sans
                scroll possible → l'utilisateur devait baisser la résolution Windows). */}
            <div className="bg-[#0f172a] border border-blue-500/30 rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col p-8 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-6 border-b border-blue-500/20 pb-4 shrink-0">
                    <h3 className="text-xl font-bold flex items-center gap-3 text-blue-400">
                        <ShieldAlert className="w-6 h-6 text-red-500 animate-pulse" />
                        Administration Licence (SECRET)
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* [v2.4.9] Zone défilante : min-h-0 est indispensable pour qu'un enfant
                    flex puisse rétrécir et déclencher le overflow-y-auto. */}
                <div className="flex-1 overflow-y-auto min-h-0 -mr-4 pr-4 custom-scrollbar">
                {!isAuthenticated ? (
                    <div className="space-y-6">
                        <p className="text-sm text-blue-200/70 text-center italic">
                            {t.admin.accessRestricted}
                        </p>
                        <div className="relative">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500" />
                            <input
                                type="password"
                                placeholder={t.admin.password}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                                className="w-full pl-11 pr-4 py-3 bg-black/40 text-blue-100 border border-blue-500/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                autoFocus
                            />
                        </div>
                        {authError && (
                            <p className="text-xs text-red-400 flex items-center gap-2">
                                <AlertCircle className="w-3 h-3" /> {authError}
                            </p>
                        )}
                        <button
                            onClick={handleAuth}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all shadow-lg shadow-blue-900/20"
                        >
                            {t.admin.unlock}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Onglets */}
                        <div className="flex bg-black/40 p-1 rounded-lg border border-blue-500/20">
                            <button
                                onClick={() => setActiveTab('generation')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${activeTab === 'generation' ? 'bg-blue-600 text-white shadow-lg' : 'text-blue-300/50 hover:text-blue-300'}`}
                            >
                                <Key className="w-3.5 h-3.5 inline mr-2" />
                                {t.admin.tabGeneration}
                            </button>
                            <button
                                onClick={() => { setActiveTab('cloud'); fetchCloudLicenses(); }}
                                className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${activeTab === 'cloud' ? 'bg-blue-600 text-white shadow-lg' : 'text-blue-300/50 hover:text-blue-300'}`}
                            >
                                <Cloud className="w-3.5 h-3.5 inline mr-2" />
                                {t.admin.tabCloud}
                            </button>
                            <button
                                onClick={() => { setActiveTab('updates'); refreshAnnounce(); }}
                                className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${activeTab === 'updates' ? 'bg-blue-600 text-white shadow-lg' : 'text-blue-300/50 hover:text-blue-300'}`}
                            >
                                <RefreshCw className="w-3.5 h-3.5 inline mr-2" />
                                {t.admin.tabUpdates}
                            </button>
                            <button
                                onClick={() => { setActiveTab('feedback'); fetchFeedback(); }}
                                className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${activeTab === 'feedback' ? 'bg-yellow-600 text-white shadow-lg' : 'text-yellow-300/50 hover:text-yellow-300'}`}
                            >
                                <Star className="w-3.5 h-3.5 inline mr-2" />
                                {t.admin.tabFeedback}
                            </button>
                        </div>

                        {activeTab === 'generation' ? (
                            <div className="space-y-8 animate-in fade-in duration-300">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2 space-y-2">
                                        <label className="text-xs font-semibold text-blue-300 uppercase tracking-wider">{t.admin.duration}</label>
                                        <select
                                            value={duration}
                                            onChange={(e) => setDuration(e.target.value)}
                                            className="w-full px-3 py-2 bg-black/40 text-blue-100 border border-blue-500/20 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        >
                                            <option value="30">{t.admin.month1}</option>
                                            <option value="365">{t.admin.year1}</option>
                                            <option value="permanent">{t.admin.lifetime}</option>
                                            <option value="custom">{t.admin.customDate}</option>
                                        </select>
                                    </div>

                                    {duration === 'custom' && (
                                        <div className="col-span-2 space-y-2 animate-in slide-in-from-top-1 duration-200">
                                            <label className="text-xs font-semibold text-blue-300 uppercase tracking-wider">{t.admin.customDate}</label>
                                            <input
                                                type="datetime-local"
                                                value={customDate}
                                                onChange={(e) => setCustomDate(e.target.value)}
                                                className="w-full px-3 py-2 bg-black/40 text-blue-100 border border-blue-500/20 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            />
                                        </div>
                                    )}

                                    <div className="space-y-2 p-4 bg-white/5 rounded-lg border border-white/10">
                                        <h4 className="text-sm font-bold text-white mb-2">{t.admin.singleKey}</h4>
                                        <input
                                            type="text"
                                            placeholder={t.admin.hwidClient}
                                            value={targetMid}
                                            onChange={(e) => setTargetMid(e.target.value)}
                                            className="w-full px-2 py-1.5 text-xs bg-black/40 text-blue-100 border border-white/10 rounded mb-2"
                                        />
                                        <button
                                            onClick={handleGenerateSingle}
                                            className="w-full py-2 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-xs font-bold rounded transition-all border border-blue-600/30"
                                        >
                                            {t.admin.generate}
                                        </button>
                                    </div>

                                    <div className="space-y-2 p-4 bg-white/5 rounded-lg border border-white/10">
                                        <h4 className="text-sm font-bold text-white mb-2">{t.admin.bulkGeneration}</h4>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">{t.admin.count}</span>
                                            <input
                                                type="number"
                                                min="1"
                                                max="500"
                                                value={count}
                                                onChange={(e) => setCount(parseInt(e.target.value) || 1)}
                                                className="w-full px-2 py-1.5 text-xs bg-black/40 text-blue-100 border border-white/10 rounded"
                                            />
                                        </div>
                                        <button
                                            onClick={handleGenerateBulk}
                                            className="w-full py-2 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white text-xs font-bold rounded transition-all border border-indigo-600/30"
                                        >
                                            GÉNÉRER {count} CLÉS
                                        </button>
                                    </div>

                                    {/* Advanced Maintenance */}
                                    <div className="col-span-2 space-y-2 pt-4 border-t border-white/10">
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-red-400 uppercase tracking-wider">{t.admin.maintenance}</span>
                                                <span className="text-[10px] text-muted-foreground">{t.admin.maintenanceDesc}</span>
                                            </div>
                                            <button
                                                onClick={handleResetLicense}
                                                className="px-4 py-2 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white text-[10px] font-bold rounded transition-all border border-red-600/30"
                                            >
                                                {t.admin.resetPc}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {result && (
                                    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                                        <div className="flex justify-between items-center text-xs font-bold text-blue-300 uppercase">
                                            <span>Résultats : {Array.isArray(result.data) ? `${result.data.length} clés` : '1 clé'}</span>
                                            <div className="flex gap-2">
                                                <button onClick={copyToClipboard} className="flex items-center gap-1 hover:text-white transition-colors">
                                                    <Clipboard className="w-3 h-3" /> Copier
                                                </button>
                                                <button onClick={exportToText} className="flex items-center gap-1 hover:text-white transition-colors">
                                                    <FileText className="w-3 h-3" /> Exporter .txt
                                                </button>
                                            </div>
                                        </div>
                                        <div className="bg-black/60 border border-blue-500/20 rounded-md p-3 max-h-48 overflow-y-auto font-mono text-xs text-green-400">
                                            {Array.isArray(result.data) ? (
                                                result.data.map((k, i) => <div key={i} className="mb-1 py-1 border-b border-white/5 last:border-0">{k}</div>)
                                            ) : (
                                                <div className="text-sm text-center py-4">{result.data}</div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : activeTab === 'cloud' ? (
                            <div className="space-y-4 animate-in fade-in duration-300">
                                <div className="flex justify-between items-center bg-blue-500/5 border border-blue-500/10 p-3 rounded-lg">
                                    <div className="flex gap-6 items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-blue-300/50 uppercase font-bold tracking-widest">{t.admin.subscribers}</span>
                                            <span className="text-xl font-black text-white">{cloudLicenses.length}</span>
                                        </div>
                                        <div className="h-8 w-px bg-blue-500/10" />
                                        <div className="flex flex-col">
                                            <span className="flex items-center gap-1 text-[10px] text-blue-300/50 uppercase font-bold tracking-widest"><Monitor className="w-3 h-3" /> PC</span>
                                            <span className="text-xl font-black text-blue-300">{cloudLicenses.filter(l => !isMobileHwid(l.hwid)).length}</span>
                                        </div>
                                        <div className="h-8 w-px bg-blue-500/10" />
                                        <div className="flex flex-col">
                                            <span className="flex items-center gap-1 text-[10px] text-purple-300/50 uppercase font-bold tracking-widest"><Smartphone className="w-3 h-3" /> Mobile</span>
                                            <span className="text-xl font-black text-purple-400">{cloudLicenses.filter(l => isMobileHwid(l.hwid)).length}</span>
                                        </div>
                                        <div className="h-8 w-px bg-blue-500/10" />
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-green-400/50 uppercase font-bold tracking-widest">{t.admin.online}</span>
                                            <span className="text-xl font-black text-green-400">
                                                {cloudLicenses.filter(l => l.last_seen && (Date.now() - new Date(l.last_seen).getTime() < 15 * 60 * 1000)).length}
                                            </span>
                                        </div>
                                        <div className="h-8 w-px bg-blue-500/10" />
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-red-500/50 uppercase font-bold tracking-widest">{t.admin.banned}</span>
                                            <span className="text-xl font-black text-red-500">{cloudLicenses.filter(l => l.is_blocked).length}</span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={fetchCloudLicenses}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[10px] font-bold rounded transition-all border border-blue-500/20"
                                    >
                                        <RefreshCw className={`w-3 h-3 ${isLoadingCloud ? 'animate-spin' : ''}`} />
                                        RAFRAÎCHIR
                                    </button>
                                </div>

                                <div className="flex gap-2 items-center">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-400/50" />
                                        <input
                                            type="text"
                                            placeholder={t.admin.searchPlaceholder}
                                            value={searchCloud}
                                            onChange={(e) => setSearchCloud(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2 bg-black/40 text-[10px] text-blue-100 border border-blue-500/20 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                        />
                                    </div>
                                    <div className="flex bg-black/40 p-0.5 rounded-md border border-blue-500/20 shrink-0">
                                        <button
                                            onClick={() => setCloudFilter('all')}
                                            className={`px-2.5 py-1.5 text-[9px] font-bold rounded transition-all ${cloudFilter === 'all' ? 'bg-blue-600 text-white' : 'text-blue-300/50 hover:text-blue-300'}`}
                                        >TOUS</button>
                                        <button
                                            onClick={() => setCloudFilter('pc')}
                                            className={`flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-bold rounded transition-all ${cloudFilter === 'pc' ? 'bg-blue-600 text-white' : 'text-blue-300/50 hover:text-blue-300'}`}
                                        ><Monitor className="w-3 h-3" /> PC</button>
                                        <button
                                            onClick={() => setCloudFilter('mobile')}
                                            className={`flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-bold rounded transition-all ${cloudFilter === 'mobile' ? 'bg-purple-600 text-white' : 'text-purple-300/50 hover:text-purple-300'}`}
                                        ><Smartphone className="w-3 h-3" /> MOBILE</button>
                                    </div>
                                </div>

                                <div className="bg-black/60 border border-blue-500/20 rounded-md overflow-hidden flex flex-col h-96">
                                    <div className="grid grid-cols-5 gap-2 p-2 bg-blue-900/20 border-b border-blue-500/20 text-[10px] font-bold text-blue-300 uppercase">
                                        <span>{t.admin.hwid}</span>
                                        <span>{t.admin.originalKey}</span>
                                        <span>{t.admin.activation}</span>
                                        <span>{t.admin.statusLabel}</span>
                                        <span className="text-right">{t.admin.actionLabel}</span>
                                    </div>
                                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                                        {cloudLicenses.length === 0 ? (
                                            <div className="p-8 text-center text-xs text-muted-foreground italic">
                                                {t.admin.noUsers}
                                            </div>
                                        ) : (
                                            cloudLicenses
                                                .filter(lic => cloudFilter === 'all' || (cloudFilter === 'mobile') === isMobileHwid(lic.hwid))
                                                .filter(lic => {
                                                    const s = searchCloud.toLowerCase();
                                                    return lic.hwid?.toLowerCase().includes(s) ||
                                                        lic.original_key?.toLowerCase().includes(s);
                                                })
                                                .map((lic) => {
                                                    const activatedAt = lic.activated_at ? new Date(lic.activated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'N/A';
                                                    const isOnline = lic.last_seen && (Date.now() - new Date(lic.last_seen).getTime() < 15 * 60 * 1000);

                                                    return (
                                                        <div key={lic.hwid} className="grid grid-cols-5 gap-2 p-2 border-b border-white/5 items-center hover:bg-white/5 transition-colors">
                                                            <div
                                                                className="flex items-center gap-1.5 min-w-0"
                                                                title={`ID: ${lic.hwid}\nDernière activité: ${lic.last_seen ? new Date(lic.last_seen).toLocaleTimeString() : 'Jamais'}\nIl y a: ${lic.last_seen ? Math.round((Date.now() - new Date(lic.last_seen).getTime()) / 1000 / 60) : '?'} minutes`}
                                                            >
                                                                <div className={`shrink-0 w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]' : 'bg-gray-600'}`} />
                                                                {isMobileHwid(lic.hwid)
                                                                    ? <Smartphone className="shrink-0 w-3 h-3 text-purple-400" />
                                                                    : <Monitor className="shrink-0 w-3 h-3 text-blue-400/70" />}
                                                                <span className="text-[9px] font-mono text-blue-400 truncate">{lic.hwid}</span>
                                                                {isOnline && <span className="shrink-0 text-[7px] bg-green-500 text-white px-1 rounded-sm font-black animate-bounce shadow-lg shadow-green-500/20">LIVE</span>}
                                                            </div>
                                                            <span className="text-[9px] text-blue-200 truncate" title={lic.original_key || 'Direct'}>{lic.original_key || 'Direct'}</span>
                                                            <div className="flex flex-col">
                                                                <span className="text-[7px] text-blue-300/50 uppercase font-bold">{t.admin.activatedOn}</span>
                                                                <span className="text-[9px] text-blue-400 font-medium">{activatedAt}</span>
                                                            </div>
                                                            <span className="flex items-center gap-1">
                                                                {lic.is_blocked ? (
                                                                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-500 text-[8px] font-bold rounded">{t.admin.statusBan}</span>
                                                                ) : lic.license_key ? (
                                                                    <span className="px-1.5 py-0.5 bg-green-500/20 text-green-500 text-[8px] font-bold rounded">{t.admin.statusActive}</span>
                                                                ) : (
                                                                    <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-500 text-[8px] font-bold rounded">{t.admin.statusTrial}</span>
                                                                )}
                                                            </span>
                                                            <div className="flex justify-end gap-1">
                                                                <button
                                                                    onClick={() => handleToggleBlock(lic.hwid, !!lic.is_blocked)}
                                                                    className={`p-1 transition-colors ${lic.is_blocked ? 'text-green-500 hover:text-green-400' : 'text-red-500 hover:text-red-400'}`}
                                                                    title={lic.is_blocked ? "Débloquer" : "Bloquer (BAN)"}
                                                                >
                                                                    {lic.is_blocked ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                                                                </button>

                                                                <button
                                                                    onClick={() => handleDeleteLicenseCloud(lic.hwid)}
                                                                    className="p-1 text-red-700 hover:text-red-500 transition-colors"
                                                                    title="Supprimer définitivement du Cloud"
                                                                >
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>

                                                                <button
                                                                    onClick={() => { setTargetMid(lic.hwid); setActiveTab('generation'); }}
                                                                    className="p-1 hover:text-blue-400 text-muted-foreground transition-colors"
                                                                    title="Générer une clé pour ce PC"
                                                                >
                                                                    <Key className="w-3.5 h-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : activeTab === 'updates' ? (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                                    <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                        <RefreshCw className="w-4 h-4 text-blue-400 animate-spin-slow" />
                                        {t.admin.publishVersion}
                                    </h4>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleFileUpload(e, 'setup')}
                                            onClick={() => triggerFileSelect('setup')}
                                            className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${isUploading ? 'border-blue-500/50 bg-blue-500/5 opacity-50 cursor-wait' : 'border-blue-500/20 hover:border-blue-500/50 hover:bg-blue-500/5 active:scale-95'}`}
                                        >
                                            <UploadCloud className="w-8 h-8 text-blue-400" />
                                            <div className="text-center">
                                                <p className="text-[10px] font-bold text-white uppercase">{t.admin.setupExe}</p>
                                                <p className="text-[9px] text-blue-300/50">{t.admin.clickOrDrag}</p>
                                            </div>
                                        </div>

                                        <div
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleFileUpload(e, 'extension')}
                                            onClick={() => triggerFileSelect('extension')}
                                            className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${isUploading ? 'border-indigo-500/50 bg-indigo-500/5 opacity-50 cursor-wait' : 'border-indigo-500/20 hover:border-indigo-500/50 hover:bg-indigo-500/5 active:scale-95'}`}
                                        >
                                            <Package className="w-8 h-8 text-indigo-400" />
                                            <div className="text-center">
                                                <p className="text-[10px] font-bold text-white uppercase">{t.admin.extensionZip}</p>
                                                <p className="text-[9px] text-indigo-300/50">{t.admin.clickOrDrag}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* [v2.4.2] Barre de progression de l'upload */}
                                    {uploadProgress && (
                                        <div className={`mt-4 p-3 rounded-lg border ${uploadProgress.type === 'setup' ? 'bg-blue-500/5 border-blue-500/20' : 'bg-indigo-500/5 border-indigo-500/20'}`}>
                                            <div className="flex items-center justify-between mb-2">
                                                <span className={`text-[10px] font-bold uppercase flex items-center gap-1.5 ${uploadProgress.type === 'setup' ? 'text-blue-300' : 'text-indigo-300'}`}>
                                                    <UploadCloud className="w-3.5 h-3.5 animate-pulse" />
                                                    {uploadProgress.type === 'setup' ? 'Envoi du Setup (.exe)' : 'Envoi de l\'Extension (.zip)'}
                                                </span>
                                                <span className={`text-xs font-black ${uploadProgress.type === 'setup' ? 'text-blue-200' : 'text-indigo-200'}`}>
                                                    {uploadProgress.percent}%
                                                </span>
                                            </div>
                                            <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-200 ${uploadProgress.type === 'setup' ? 'bg-blue-500' : 'bg-indigo-500'}`}
                                                    style={{ width: `${uploadProgress.percent}%` }}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between mt-1.5">
                                                <span className="text-[9px] text-white/40">
                                                    {uploadProgress.total > 0
                                                        ? `${formatBytes(uploadProgress.uploaded)} / ${formatBytes(uploadProgress.total)}${uploadProgress.speed ? ` • ${formatBytes(uploadProgress.speed)}/s` : ''}`
                                                        : 'Préparation...'}
                                                </span>
                                                <span className="text-[9px] text-white/40">
                                                    {uploadProgress.percent >= 100
                                                        ? 'Finalisation (hash + config)...'
                                                        : uploadProgress.etaSeconds
                                                            ? `≈ ${formatEta(uploadProgress.etaSeconds)} restant`
                                                            : 'Ne fermez pas cette fenêtre'}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-4 pt-2">

                                        <div className="grid grid-cols-2 gap-4">
                                            {/* SETUP Mises à jour */}
                                            <div className="space-y-2 p-3 bg-black/20 rounded-lg border border-blue-500/10">
                                                <h5 className="text-[10px] font-bold text-blue-300 uppercase mb-2 border-b border-blue-500/20 pb-1">Logiciel PC (Setup)</h5>
                                                
                                                <label className="text-[9px] text-blue-300/70 uppercase">Version (ex: v2.0.0)</label>
                                                <input
                                                    type="text"
                                                    value={newVersion}
                                                    onChange={(e) => setNewVersion(e.target.value)}
                                                    placeholder="v2.0.0"
                                                    className="w-full px-3 py-2 bg-black/40 text-blue-100 border border-blue-500/20 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none mb-2"
                                                />

                                                <label className="text-[9px] text-blue-300/70 uppercase">Lien Direct (.exe)</label>
                                                <input
                                                    type="text"
                                                    value={newUpdateUrl}
                                                    onChange={(e) => setNewUpdateUrl(e.target.value)}
                                                    placeholder="Lien auto..."
                                                    className="w-full px-3 py-2 bg-black/40 text-blue-100 border border-blue-500/20 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none mb-2"
                                                />

                                                <div className="flex items-center justify-between">
                                                    <span className="text-[9px] text-blue-300/70 uppercase">SHA-256 (.exe)</span>
                                                    <button
                                                        onClick={() => handleHashLocalFile('setup')}
                                                        className="text-[9px] text-blue-400 hover:text-blue-300 underline"
                                                        title="Calcule le hash d'un .exe local sans l'uploader (lien manuel, ex. GitHub Releases)"
                                                    >
                                                        Hash fichier local
                                                    </button>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={newUpdateHash}
                                                    onChange={(e) => setNewUpdateHash(e.target.value)}
                                                    placeholder="Hash auto..."
                                                    className="w-full px-3 py-2 bg-black/40 text-blue-100 border border-blue-500/20 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                                                />
                                            </div>

                                            {/* EXTENSION Mises à jour */}
                                            <div className="space-y-2 p-3 bg-black/20 rounded-lg border border-indigo-500/10">
                                                <h5 className="text-[10px] font-bold text-indigo-300 uppercase mb-2 border-b border-indigo-500/20 pb-1">Extension Chrome (.zip)</h5>
                                                
                                                <label className="text-[9px] text-indigo-300/70 uppercase">Version (ex: v1.9.5)</label>
                                                <input
                                                    type="text"
                                                    value={newExtensionVersion}
                                                    onChange={(e) => setNewExtensionVersion(e.target.value)}
                                                    placeholder="v1.9.5"
                                                    className="w-full px-3 py-2 bg-black/40 text-indigo-100 border border-indigo-500/20 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none mb-2"
                                                />

                                                <label className="text-[9px] text-indigo-300/70 uppercase">Lien Direct (.zip)</label>
                                                <input
                                                    type="text"
                                                    value={newExtensionUrl}
                                                    onChange={(e) => setNewExtensionUrl(e.target.value)}
                                                    placeholder="Lien auto..."
                                                    className="w-full px-3 py-2 bg-black/40 text-indigo-100 border border-indigo-500/20 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none mb-2"
                                                />

                                                <div className="flex items-center justify-between">
                                                    <span className="text-[9px] text-indigo-300/70 uppercase">SHA-256 (.zip)</span>
                                                    <button
                                                        onClick={() => handleHashLocalFile('extension')}
                                                        className="text-[9px] text-indigo-400 hover:text-indigo-300 underline"
                                                        title="Calcule le hash d'un .zip local sans l'uploader"
                                                    >
                                                        Hash fichier local
                                                    </button>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={newExtensionHash}
                                                    onChange={(e) => setNewExtensionHash(e.target.value)}
                                                    placeholder="Hash auto..."
                                                    className="w-full px-3 py-2 bg-black/40 text-indigo-100 border border-indigo-500/20 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                                                />
                                            </div>
                                        </div>

                                        <button
                                            onClick={handlePushUpdate}
                                            disabled={isUploading}
                                            className={`w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all shadow-lg text-xs mt-2 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            {isUploading
                                                ? (uploadProgress ? `${t.admin.uploading} ${uploadProgress.percent}%` : t.admin.uploading)
                                                : t.admin.publishUpdate}
                                        </button>
                                    </div>

                                    <p className="mt-4 text-[10px] text-blue-300/50 italic text-center">
                                        Remplissez la version du Logiciel ou de l'Extension (ou les deux) puis cliquez sur Publier.
                                    </p>
                                </div>

                                {/* [v2.4.5] Annonce aux utilisateurs de DoulGet Mobile */}
                                <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                                    <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                                        <Megaphone className="w-4 h-4 text-purple-400" />
                                        Annonce à tous les utilisateurs
                                    </h4>
                                    <p className="text-[10px] text-purple-300/50 mb-4">
                                        Choisissez qui la reçoit. Sur téléphone : notification (sous ~3 h) et dialogue à l'ouverture. Sur PC : bandeau dans l'application. Chaque annonce n'est montrée qu'une seule fois par utilisateur.
                                    </p>

                                    {currentAnnounce && (
                                        <div className="mb-2 p-3 bg-black/30 border border-blue-500/20 rounded-lg">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[9px] text-blue-300/80 uppercase font-bold flex items-center gap-1"><Monitor className="w-3 h-3" /> Annonce PC en cours</span>
                                                <button
                                                    onClick={() => handleClearAnnounce('pc')}
                                                    disabled={isSendingAnnounce}
                                                    className="text-[9px] text-red-400 hover:text-red-300 underline"
                                                >
                                                    Supprimer
                                                </button>
                                            </div>
                                            <p className="text-xs font-bold text-purple-100">📣 {currentAnnounce.title}</p>
                                            <p className="text-[11px] text-purple-200/70 whitespace-pre-wrap">{currentAnnounce.body}</p>
                                            {currentAnnounce.url && (
                                                <p className="text-[10px] text-purple-300/50 truncate mt-1">🔗 {currentAnnounce.url}</p>
                                            )}
                                        </div>
                                    )}

                                    {currentAnnounceAndroid && (
                                        <div className="mb-4 p-3 bg-black/30 border border-green-500/20 rounded-lg">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[9px] text-green-300/80 uppercase font-bold flex items-center gap-1"><Smartphone className="w-3 h-3" /> Annonce Android en cours</span>
                                                <button
                                                    onClick={() => handleClearAnnounce('android')}
                                                    disabled={isSendingAnnounce}
                                                    className="text-[9px] text-red-400 hover:text-red-300 underline"
                                                >
                                                    Supprimer
                                                </button>
                                            </div>
                                            <p className="text-xs font-bold text-purple-100">📣 {currentAnnounceAndroid.title}</p>
                                            <p className="text-[11px] text-purple-200/70 whitespace-pre-wrap">{currentAnnounceAndroid.body}</p>
                                            {currentAnnounceAndroid.url && (
                                                <p className="text-[10px] text-purple-300/50 truncate mt-1">🔗 {currentAnnounceAndroid.url}</p>
                                            )}
                                        </div>
                                    )}

                                    <label className="text-[9px] text-purple-300/70 uppercase">Destinataires</label>
                                    <div className="grid grid-cols-3 gap-2 mb-3 mt-1">
                                        {([
                                            { key: 'all', label: 'Les deux', icon: <Megaphone className="w-3.5 h-3.5" /> },
                                            { key: 'pc', label: 'PC', icon: <Monitor className="w-3.5 h-3.5" /> },
                                            { key: 'android', label: 'Android', icon: <Smartphone className="w-3.5 h-3.5" /> }
                                        ] as const).map(opt => (
                                            <button
                                                key={opt.key}
                                                onClick={() => setAnnounceTarget(opt.key)}
                                                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold border transition-all ${announceTarget === opt.key
                                                    ? 'bg-purple-600 border-purple-400 text-white'
                                                    : 'bg-black/30 border-purple-500/20 text-purple-300/70 hover:border-purple-500/50'}`}
                                            >
                                                {opt.icon}{opt.label}
                                            </button>
                                        ))}
                                    </div>

                                    <label className="text-[9px] text-purple-300/70 uppercase">Titre</label>
                                    <input
                                        type="text"
                                        value={announceTitle}
                                        onChange={(e) => setAnnounceTitle(e.target.value)}
                                        placeholder="Ex : Nouvelle version, promo licence…"
                                        maxLength={60}
                                        className="w-full px-3 py-2 bg-black/40 text-purple-100 border border-purple-500/20 rounded text-xs focus:ring-1 focus:ring-purple-500 outline-none mb-2"
                                    />

                                    <label className="text-[9px] text-purple-300/70 uppercase">Message</label>
                                    <textarea
                                        value={announceMessage}
                                        onChange={(e) => setAnnounceMessage(e.target.value)}
                                        placeholder="Ex : Licence 1 an à 5000 F ce week-end seulement — écrivez-nous sur WhatsApp !"
                                        maxLength={300}
                                        rows={3}
                                        className="w-full px-3 py-2 bg-black/40 text-purple-100 border border-purple-500/20 rounded text-xs focus:ring-1 focus:ring-purple-500 outline-none mb-2 resize-none"
                                    />

                                    <label className="text-[9px] text-purple-300/70 uppercase">Lien (facultatif — ouvert quand l'utilisateur appuie sur la notification)</label>
                                    <input
                                        type="text"
                                        value={announceUrl}
                                        onChange={(e) => setAnnounceUrl(e.target.value)}
                                        placeholder="https://…"
                                        className="w-full px-3 py-2 bg-black/40 text-purple-100 border border-purple-500/20 rounded text-xs focus:ring-1 focus:ring-purple-500 outline-none mb-3"
                                    />

                                    <button
                                        onClick={handleSendAnnounce}
                                        disabled={isSendingAnnounce || !announceTitle.trim() || !announceMessage.trim()}
                                        className={`w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition-all shadow-lg text-xs ${isSendingAnnounce || !announceTitle.trim() || !announceMessage.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        {isSendingAnnounce ? 'Publication…' : '📣 Publier l\'annonce'}
                                    </button>
                                </div>
                            </div>
                        ) : activeTab === 'feedback' ? (
                            <div className="space-y-4 animate-in fade-in duration-300">
                                {/* Stats */}
                                <div className="flex justify-between items-center bg-yellow-500/5 border border-yellow-500/10 p-3 rounded-lg">
                                    <div className="flex gap-6 items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-yellow-300/50 uppercase font-bold tracking-widest">{t.admin.totalFeedback}</span>
                                            <span className="text-xl font-black text-white">{feedbackList.length}</span>
                                        </div>
                                        <div className="h-8 w-px bg-yellow-500/10" />
                                        <div className="flex flex-col">
                                            <span className="flex items-center gap-1 text-[10px] text-blue-300/50 uppercase font-bold tracking-widest"><Monitor className="w-3 h-3" /> PC</span>
                                            <span className="text-xl font-black text-blue-300">{feedbackList.filter(f => !isMobileHwid(f.hwid)).length}</span>
                                        </div>
                                        <div className="h-8 w-px bg-yellow-500/10" />
                                        <div className="flex flex-col">
                                            <span className="flex items-center gap-1 text-[10px] text-purple-300/50 uppercase font-bold tracking-widest"><Smartphone className="w-3 h-3" /> Mobile</span>
                                            <span className="text-xl font-black text-purple-400">{feedbackList.filter(f => isMobileHwid(f.hwid)).length}</span>
                                        </div>
                                        <div className="h-8 w-px bg-yellow-500/10" />
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-yellow-300/50 uppercase font-bold tracking-widest">{t.admin.avgRating}</span>
                                            <span className="text-xl font-black text-yellow-400">
                                                {visibleFeedback.length > 0 ? (visibleFeedback.reduce((acc, f) => acc + f.rating, 0) / visibleFeedback.length).toFixed(1) : '-'}
                                                <span className="text-sm"> / 5</span>
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        <div className="flex bg-black/40 p-0.5 rounded-md border border-yellow-500/20 shrink-0">
                                            <button
                                                onClick={() => setFeedbackFilter('all')}
                                                className={`px-2.5 py-1.5 text-[9px] font-bold rounded transition-all ${feedbackFilter === 'all' ? 'bg-yellow-600 text-white' : 'text-yellow-300/50 hover:text-yellow-300'}`}
                                            >TOUS</button>
                                            <button
                                                onClick={() => setFeedbackFilter('pc')}
                                                className={`flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-bold rounded transition-all ${feedbackFilter === 'pc' ? 'bg-blue-600 text-white' : 'text-blue-300/50 hover:text-blue-300'}`}
                                            ><Monitor className="w-3 h-3" /> PC</button>
                                            <button
                                                onClick={() => setFeedbackFilter('mobile')}
                                                className={`flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-bold rounded transition-all ${feedbackFilter === 'mobile' ? 'bg-purple-600 text-white' : 'text-purple-300/50 hover:text-purple-300'}`}
                                            ><Smartphone className="w-3 h-3" /> MOBILE</button>
                                        </div>
                                        <button
                                            onClick={fetchFeedback}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 text-[10px] font-bold rounded transition-all border border-yellow-500/20"
                                        >
                                            <RefreshCw className={`w-3 h-3 ${isLoadingFeedback ? 'animate-spin' : ''}`} />
                                            RAFRAÎCHIR
                                        </button>
                                    </div>
                                </div>

                                {/* List */}
                                <div className="bg-black/60 border border-yellow-500/20 rounded-md overflow-hidden flex flex-col h-72">
                                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                                        {visibleFeedback.length === 0 ? (
                                            <div className="p-8 text-center text-xs text-muted-foreground italic">
                                                {t.admin.noFeedback}
                                            </div>
                                        ) : (
                                            visibleFeedback.map((fb, i) => (
                                                <div key={i} className="p-3 border-b border-white/5 hover:bg-white/5 transition-colors">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <div className="flex items-center gap-1">
                                                            {[1, 2, 3, 4, 5].map(s => (
                                                                <Star
                                                                    key={s}
                                                                    className={`w-3.5 h-3.5 ${s <= fb.rating ? 'text-yellow-400 fill-yellow-400' : 'text-white/15'}`}
                                                                />
                                                            ))}
                                                        </div>
                                                        <span className="text-[9px] text-muted-foreground">
                                                            {fb.created_at ? new Date(fb.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}
                                                        </span>
                                                    </div>
                                                    {fb.comment && (
                                                        <p className="text-xs text-blue-100/80 mt-1 flex items-start gap-1.5">
                                                            <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-blue-400/50" />
                                                            {fb.comment}
                                                        </p>
                                                    )}
                                                    <div className="flex items-center justify-between mt-1.5">
                                                        <span className="flex items-center gap-1 text-[8px] font-mono text-blue-400/40" title={fb.hwid}>
                                                            {isMobileHwid(fb.hwid)
                                                                ? <Smartphone className="w-2.5 h-2.5 text-purple-400" />
                                                                : <Monitor className="w-2.5 h-2.5 text-blue-400/70" />}
                                                            {isMobileHwid(fb.hwid) ? 'MOBILE' : 'PC'} · {fb.hwid?.substring(0, 12)}...
                                                        </span>
                                                        <span className="text-[8px] text-blue-400/30">v{fb.app_version || '?'}</span>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {message && (
                            <p className={`text-xs text-center flex items-center justify-center gap-2 ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                {message.text}
                            </p>
                        )}

                        <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                            <p className="text-[10px] text-muted-foreground italic max-w-xs">
                                {t.admin.bulkNote}
                            </p>
                            <button
                                onClick={() => setIsAuthenticated(false)}
                                className="text-xs text-muted-foreground hover:text-white underline"
                            >
                                {t.admin.logout}
                            </button>
                        </div>
                    </div>
                )}
                </div>
                <ConfirmDialog state={confirmDialog} onClose={closeConfirm} />
            </div>
        </div>
    );
}

function ConfirmDialog({ state, onClose }: { state: { open: boolean; message: string; onConfirm: () => void }, onClose: () => void }) {
    if (!state.open) return null;
    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative bg-[#0f172a] border border-blue-500/30 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                    </div>
                    <p className="text-sm text-blue-100 leading-relaxed">{state.message}</p>
                </div>
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm bg-slate-800 hover:bg-slate-700 text-blue-200 transition-colors"
                    >
                        Annuler
                    </button>
                    <button
                        onClick={() => { state.onConfirm(); onClose(); }}
                        className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
                    >
                        Confirmer
                    </button>
                </div>
            </div>
        </div>
    );
}
