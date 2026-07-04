import { X, Settings, HelpCircle, Globe, FolderOpen, Download, Bell, Power, RotateCcw, Key, ShieldCheck, Info, Music } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation, Language } from '../utils/i18n';

type SettingsModalProps = {
    isOpen: boolean;
    onClose: () => void;
};

interface AppSettings {
    downloadPath: string;
    audioPath: string;
    maxConcurrentDownloads: number;
    maxRetries: number;
    autoStart: boolean;
    notifications: boolean;
    soundNotifications: boolean;
    language: string;
    isActivated: boolean;
    expiryDate: string | null;
    machineId: string;
    licenseKey: string;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { t, lang, setLanguage } = useTranslation();
    const [selectedLang, setSelectedLang] = useState<Language>(lang);
    const [showHelp, setShowHelp] = useState(false);
    const [settings, setSettings] = useState<AppSettings>({
        downloadPath: '',
        audioPath: '',
        maxConcurrentDownloads: 3,
        maxRetries: 3,
        autoStart: false,
        notifications: true,
        soundNotifications: false,
        language: 'fr',
        isActivated: false,
        expiryDate: null,
        machineId: '',
        licenseKey: ''
    });
    const [licenseInput, setLicenseInput] = useState('');
    const [activationMessage, setActivationMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // [v1.9.21] Secret admin reset
    const [secretClicks, setSecretClicks] = useState(0);
    const [showResetPrompt, setShowResetPrompt] = useState(false);
    const [resetPassword, setResetPassword] = useState('');
    const [resetMessage, setResetMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const handleSecretClick = () => {
        const newCount = secretClicks + 1;
        setSecretClicks(newCount);
        if (newCount >= 5) {
            setShowResetPrompt(true);
            setSecretClicks(0);
            setResetPassword('');
            setResetMessage(null);
        }
        // Auto-reset counter after 2 seconds of inactivity
        setTimeout(() => setSecretClicks(0), 2000);
    };

    const handleResetLicense = async () => {
        if (!resetPassword.trim()) return;
        try {
            const result = await window.api.adminResetLicense(resetPassword.trim());
            if (result.success) {
                setResetMessage({ type: 'success', text: 'Licence réinitialisée avec succès.' });
                await loadSettings();
                setTimeout(() => {
                    setShowResetPrompt(false);
                    setResetMessage(null);
                }, 1500);
            } else {
                setResetMessage({ type: 'error', text: result.error || 'Échec.' });
            }
        } catch (_e) {
            setResetMessage({ type: 'error', text: 'Erreur interne.' });
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadSettings();
        }
    }, [isOpen]);

    useEffect(() => {
        setSelectedLang(lang);
    }, [lang]);

    const loadSettings = async () => {
        try {
            setLoading(true);
            const loadedSettings = await window.api.getSettings();
            setSettings(loadedSettings);
            setSelectedLang(loadedSettings.language as Language);
        } catch (error) {
            console.error('Error loading settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const saveSettings = async () => {
        try {
            setSaving(true);
            const updatedSettings = {
                ...settings,
                language: selectedLang
            };
            await window.api.saveSettings(updatedSettings);
            setLanguage(selectedLang);
            // Recharger les paramètres pour confirmer
            await loadSettings();
        } catch (error) {
            console.error('Error saving settings:', error);
            alert('Erreur lors de la sauvegarde des paramètres');
        } finally {
            setSaving(false);
        }
    };

    const handleActivate = async () => {
        if (!licenseInput.trim()) return;

        try {
            const result = await window.api.activateLicense(licenseInput.trim());
            if (result.success) {
                setActivationMessage({ type: 'success', text: `Activé avec succès ! Expire le : ${result.expiry}` });
                await loadSettings();
            } else {
                setActivationMessage({ type: 'error', text: result.error || 'Clé invalide.' });
            }
        } catch (error) {
            setActivationMessage({ type: 'error', text: 'Erreur lors de l\'activation.' });
        }
    };

    const selectDownloadPath = async () => {
        try {
            const path = await window.api.selectDownloadPath();
            if (path) {
                setSettings({ ...settings, downloadPath: path });
            }
        } catch (error) {
            console.error('Error selecting download path:', error);
        }
    };

    const selectAudioPath = async () => {
        try {
            // Réutilise le même sélecteur de dossier générique que pour les vidéos.
            const path = await window.api.selectDownloadPath();
            if (path) {
                setSettings({ ...settings, audioPath: path });
            }
        } catch (error) {
            console.error('Error selecting audio path:', error);
        }
    };

    const resetAudioPath = () => {
        setSettings({ ...settings, audioPath: '' });
    };

    const handleLanguageChange = (newLang: Language) => {
        setSelectedLang(newLang);
    };

    if (!isOpen) return null;

    if (loading) {
        return (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                <div className="bg-card border border-border rounded-lg shadow-lg p-6">
                    <p className="text-foreground">{t.settings.loadingSettings}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Settings className="w-5 h-5 text-blue-500" />
                        {t.settings.title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {!showHelp ? (
                    <div className="space-y-6">
                        {/* Section Dossier de téléchargement */}
                        <div className="border border-border rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-4">
                                <FolderOpen className="w-5 h-5 text-blue-500" />
                                <h4 className="font-semibold text-foreground">{t.settings.downloadFolder}</h4>
                            </div>
                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={settings.downloadPath}
                                        readOnly
                                        className="flex-1 px-3 py-2 bg-secondary/80 text-foreground border border-border rounded-md focus:outline-none"
                                        style={{ color: 'hsl(var(--foreground))' }}
                                    />
                                    <button
                                        onClick={selectDownloadPath}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                                    >
                                        {t.settings.browse}
                                    </button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {t.settings.downloadFolderDescription}
                                </p>
                            </div>
                        </div>

                        {/* Section Dossier audio */}
                        <div className="border border-border rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-4">
                                <Music className="w-5 h-5 text-indigo-500" />
                                <h4 className="font-semibold text-foreground">{t.settings.audioFolder}</h4>
                            </div>
                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={settings.audioPath}
                                        readOnly
                                        placeholder={t.settings.audioFolderDefault}
                                        className="flex-1 px-3 py-2 bg-secondary/80 text-foreground border border-border rounded-md focus:outline-none"
                                        style={{ color: 'hsl(var(--foreground))' }}
                                    />
                                    <button
                                        onClick={selectAudioPath}
                                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors"
                                    >
                                        {t.settings.browse}
                                    </button>
                                    {settings.audioPath && (
                                        <button
                                            onClick={resetAudioPath}
                                            title={t.settings.audioFolderReset}
                                            className="px-3 py-2 bg-secondary hover:bg-secondary/70 text-foreground border border-border rounded-md transition-colors"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {t.settings.audioFolderDescription}
                                </p>
                            </div>
                        </div>

                        {/* Section Téléchargements simultanés */}
                        <div className="border border-border rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-4">
                                <Download className="w-5 h-5 text-blue-500" />
                                <h4 className="font-semibold text-foreground">{t.settings.maxConcurrentDownloads}</h4>
                            </div>
                            <div className="space-y-3">
                                <label htmlFor="maxConcurrent" className="block text-sm font-medium text-foreground">
                                    {t.settings.maxConcurrentDownloadsLabel}
                                </label>
                                <input
                                    id="maxConcurrent"
                                    type="number"
                                    min="1"
                                    max="10"
                                    value={settings.maxConcurrentDownloads}
                                    onChange={(e) => setSettings({ ...settings, maxConcurrentDownloads: parseInt(e.target.value) || 1 })}
                                    className="w-full px-3 py-2 bg-secondary/80 text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    style={{ color: 'hsl(var(--foreground))' }}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t.settings.maxConcurrentDownloadsDescription}
                                </p>
                            </div>
                        </div>

                        {/* Section Tentatives de retry */}
                        <div className="border border-border rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-4">
                                <RotateCcw className="w-5 h-5 text-blue-500" />
                                <h4 className="font-semibold text-foreground">{t.settings.maxRetries}</h4>
                            </div>
                            <div className="space-y-3">
                                <label htmlFor="maxRetries" className="block text-sm font-medium text-foreground">
                                    {t.settings.maxRetriesLabel}
                                </label>
                                <input
                                    id="maxRetries"
                                    type="number"
                                    min="0"
                                    max="10"
                                    value={settings.maxRetries}
                                    onChange={(e) => setSettings({ ...settings, maxRetries: parseInt(e.target.value) || 0 })}
                                    className="w-full px-3 py-2 bg-secondary/80 text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    style={{ color: 'hsl(var(--foreground))' }}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t.settings.maxRetriesDescription}
                                </p>
                            </div>
                        </div>

                        {/* Section Notifications */}
                        <div className="border border-border rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-4">
                                <Bell className="w-5 h-5 text-blue-500" />
                                <h4 className="font-semibold text-foreground">{t.settings.notifications}</h4>
                            </div>
                            <div className="space-y-3">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={settings.notifications}
                                        onChange={(e) => setSettings({ ...settings, notifications: e.target.checked })}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500/50"
                                    />
                                    <span className="text-sm text-foreground">{t.settings.enableNotifications}</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={settings.soundNotifications}
                                        onChange={(e) => setSettings({ ...settings, soundNotifications: e.target.checked })}
                                        disabled={!settings.notifications}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
                                    />
                                    <span className="text-sm text-foreground">{t.settings.enableSoundNotifications}</span>
                                </label>
                                <p className="text-xs text-muted-foreground">
                                    {t.settings.notificationsDescription}
                                </p>
                            </div>
                        </div>

                        {/* Section Auto-démarrage */}
                        <div className="border border-border rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-4">
                                <Power className="w-5 h-5 text-blue-500" />
                                <h4 className="font-semibold text-foreground">{t.settings.autoStart}</h4>
                            </div>
                            <div className="space-y-3">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={settings.autoStart}
                                        onChange={(e) => setSettings({ ...settings, autoStart: e.target.checked })}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500/50"
                                    />
                                    <span className="text-sm text-foreground">{t.settings.enableAutoStart}</span>
                                </label>
                                <p className="text-xs text-muted-foreground">
                                    {t.settings.autoStartDescription}
                                </p>
                            </div>
                        </div>

                        {/* Section Langue */}
                        <div className="border border-border rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-4">
                                <Globe className="w-5 h-5 text-blue-500" />
                                <h4 className="font-semibold text-foreground">{t.settings.language}</h4>
                            </div>
                            <div className="space-y-3">
                                <label htmlFor="language" className="block text-sm font-medium text-foreground">
                                    {t.settings.languageLabel}
                                </label>
                                <select
                                    id="language"
                                    value={selectedLang}
                                    onChange={(e) => handleLanguageChange(e.target.value as Language)}
                                    className="w-full px-3 py-2 bg-secondary/80 text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                    style={{ color: 'hsl(var(--foreground))' }}
                                >
                                    <option value="fr">Français</option>
                                    <option value="en">English</option>
                                </select>
                                <p className="text-xs text-muted-foreground">
                                    {t.settings.languageNote}
                                </p>
                            </div>
                        </div>

                        {/* Section Activation & Licence [v1.6.9] */}
                        <div className="border border-border rounded-lg p-4 bg-blue-500/5">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <ShieldCheck className={`w-5 h-5 ${settings.isActivated ? 'text-green-500' : 'text-blue-500'}`} />
                                    <h4 className="font-semibold text-foreground">Activation & Licence</h4>
                                </div>
                                {settings.isActivated && (
                                    <span className="px-2 py-1 bg-green-500/20 text-green-500 text-xs font-bold rounded uppercase tracking-wider">
                                        Activé
                                    </span>
                                )}
                            </div>

                            <div className="space-y-4">
                                {/* Machine ID Display */}
                                <div className="bg-secondary/50 rounded-md p-3 border border-border/50">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Info className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span
                                            className="text-xs font-medium text-muted-foreground uppercase tracking-tight cursor-default select-none"
                                            onClick={handleSecretClick}
                                        >Identifiant Machine (HWID)</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <code className="text-sm font-mono text-blue-400 select-all">{settings.machineId || 'Récupération...'}</code>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => {
                                                    const info = `Support DoulGet\n---\nHWID: ${settings.machineId}\nVersion: 1.9.29\nStatus: ${settings.isActivated ? 'Activé' : 'Non activé'}`;
                                                    navigator.clipboard.writeText(info);
                                                    setActivationMessage({ text: 'Infos techniques copiées !', type: 'success' });
                                                    setTimeout(() => setActivationMessage(null), 3000);
                                                }}
                                                className="text-[10px] text-muted-foreground hover:text-blue-500 font-medium transition-colors uppercase"
                                                title="Copier les informations pour le support technique"
                                            >
                                                Infos Support
                                            </button>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(settings.machineId);
                                                    setActivationMessage({ text: 'HWID copié !', type: 'success' });
                                                    setTimeout(() => setActivationMessage(null), 3000);
                                                }}
                                                className="text-[10px] text-muted-foreground hover:text-blue-500 font-medium transition-colors uppercase"
                                            >
                                                Copier HWID
                                            </button>
                                        </div>
                                    </div>

                                </div>

                                {!settings.isActivated ? (
                                    <div className="space-y-3">
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                                <input
                                                    type="text"
                                                    placeholder="xxxx-xxxx-xxxx-xxxx"
                                                    value={licenseInput}
                                                    onChange={(e) => setLicenseInput(e.target.value)}
                                                    className="w-full pl-9 pr-3 py-2 bg-secondary/80 text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                                />
                                            </div>
                                            <button
                                                onClick={handleActivate}
                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-all active:scale-95 whitespace-nowrap"
                                            >
                                                Activer
                                            </button>
                                        </div>
                                        {activationMessage && (
                                            <p className={`text-xs ${activationMessage.type === 'success' ? 'text-green-500' : 'text-red-500'} animate-in fade-in slide-in-from-top-1`}>
                                                {activationMessage.text}
                                            </p>
                                        )}
                                        <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                                            Veuillez entrer votre clé de licence reçue lors de votre test ou achat.
                                            L'identifiant machine ci-dessus est requis pour générer une clé valide.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground font-medium">Statut :</span>
                                            <span className="text-green-500 font-bold">Produit Activé</span>
                                        </div>

                                        {/* [v1.9.20] Expiration avec date + heure + countdown */}
                                        <div className="bg-secondary/50 rounded-md p-3 border border-border/50">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Key className="w-3.5 h-3.5 text-muted-foreground" />
                                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-tight">Date d'expiration</span>
                                            </div>
                                            {(() => {
                                                const raw = settings.expiryDate;
                                                if (!raw) return <span className="text-foreground text-sm">N/A</span>;
                                                const expiryMs = new Date(raw).getTime();
                                                const nowMs = Date.now();
                                                const diffMs = expiryMs - nowMs;
                                                const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                                                const totalHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                                                const isExpired = diffMs <= 0;
                                                const urgencyColor = isExpired ? 'text-red-500' : totalDays < 7 ? 'text-orange-500' : totalDays < 30 ? 'text-yellow-500' : 'text-green-500';
                                                const urgencyBg = isExpired ? 'bg-red-500/10 border-red-500/30' : totalDays < 7 ? 'bg-orange-500/10 border-orange-500/30' : totalDays < 30 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-green-500/10 border-green-500/30';

                                                // Format: "25 février 2026 à 14:30"
                                                const formatted = new Date(raw).toLocaleDateString('fr-FR', {
                                                    day: 'numeric',
                                                    month: 'long',
                                                    year: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                });

                                                return (
                                                    <div className="space-y-2">
                                                        <div className="text-foreground text-sm font-semibold">{formatted}</div>
                                                        <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs font-bold ${urgencyBg} ${urgencyColor}`}>
                                                            {isExpired
                                                                ? '⚠️ Licence expirée'
                                                                : `⏳ ${totalDays}j ${totalHours}h restant${totalDays > 1 ? 's' : ''}`
                                                            }
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>

                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground font-medium">Clé utilisée :</span>
                                            <span className="text-muted-foreground font-mono">
                                                {(settings.licenseKey || '').substring(0, 10)}****************
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* [v1.9.21] Secret Admin Reset Modal */}
                                {showResetPrompt && (
                                    <div className="mt-4 bg-red-500/5 border border-red-500/20 rounded-lg p-4 animate-in fade-in duration-200">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Key className="w-4 h-4 text-red-400" />
                                            <span className="text-sm font-semibold text-red-400">Admin Reset</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                placeholder="Mot de passe admin"
                                                value={resetPassword}
                                                onChange={(e) => setResetPassword(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleResetLicense()}
                                                className="flex-1 px-3 py-2 bg-secondary/80 text-foreground border border-red-500/30 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm"
                                            />
                                            <button
                                                onClick={handleResetLicense}
                                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-all active:scale-95 text-sm whitespace-nowrap"
                                            >
                                                Réinitialiser
                                            </button>
                                            <button
                                                onClick={() => setShowResetPrompt(false)}
                                                className="px-3 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        {resetMessage && (
                                            <p className={`text-xs mt-2 ${resetMessage.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                                                {resetMessage.text}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Section Aide */}
                        <div className="border border-border rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-3">
                                <HelpCircle className="w-5 h-5 text-blue-500" />
                                <h4 className="font-semibold text-foreground">{t.settings.help}</h4>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">
                                {t.help.description}
                            </p>
                            <button
                                onClick={() => setShowHelp(true)}
                                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm transition-colors flex items-center gap-2"
                            >
                                <HelpCircle className="w-4 h-4" />
                                {t.settings.help}
                            </button>
                        </div>

                        {/* Boutons */}
                        <div className="flex justify-end gap-3 pt-4 border-t border-border">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium bg-secondary hover:bg-secondary/80 text-foreground rounded-md transition-colors"
                            >
                                {t.settings.cancel}
                            </button>
                            <button
                                onClick={saveSettings}
                                disabled={saving}
                                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50"
                            >
                                {saving ? t.settings.saving : t.settings.save}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold text-foreground flex items-center gap-2">
                                <HelpCircle className="w-5 h-5 text-blue-500" />
                                {t.help.title}
                            </h4>
                            <button
                                onClick={() => setShowHelp(false)}
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                ← {t.settings.title}
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <h5 className="font-medium text-foreground mb-2">{t.help.howToUse}</h5>
                                <ul className="space-y-2 text-sm text-muted-foreground">
                                    <li>{t.help.step1}</li>
                                    <li>{t.help.step2}</li>
                                    <li>{t.help.step3}</li>
                                </ul>
                            </div>

                            <div className="border-t border-border pt-4">
                                <h5 className="font-medium text-foreground mb-2">{t.help.supportedPlatforms}</h5>
                                <p className="text-sm text-muted-foreground">{t.help.platforms}</p>
                            </div>
                        </div>

                        <div className="flex justify-end pt-4 border-t border-border">
                            <button
                                onClick={() => setShowHelp(false)}
                                className="px-4 py-2 text-sm font-medium bg-secondary hover:bg-secondary/80 text-foreground rounded-md transition-colors"
                            >
                                ← {t.settings.title}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
