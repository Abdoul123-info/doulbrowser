import { X, Settings, HelpCircle, Globe, FolderOpen, Download, Bell, Power, RotateCcw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation, Language } from '../utils/i18n';

type SettingsModalProps = {
    isOpen: boolean;
    onClose: () => void;
};

interface AppSettings {
    downloadPath: string;
    maxConcurrentDownloads: number;
    maxRetries: number;
    autoStart: boolean;
    notifications: boolean;
    soundNotifications: boolean;
    language: string;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { t, lang, setLanguage } = useTranslation();
    const [selectedLang, setSelectedLang] = useState<Language>(lang);
    const [showHelp, setShowHelp] = useState(false);
    const [settings, setSettings] = useState<AppSettings>({
        downloadPath: '',
        maxConcurrentDownloads: 3,
        maxRetries: 3,
        autoStart: false,
        notifications: true,
        soundNotifications: false,
        language: 'fr'
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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
