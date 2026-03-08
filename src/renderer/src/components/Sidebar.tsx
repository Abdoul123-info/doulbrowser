import { Download, CheckCircle, Clock, Trash2, LayoutGrid, Settings, Info, Sparkles, Music, Minimize2, ListTodo, Star } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../utils/i18n';

type SidebarProps = {
    activeFilter: string;
    onFilterChange: (filter: string) => void;
    onSettingsClick: () => void;
    onAboutClick: () => void;
    onAdminClick: () => void;
    onConverterClick: () => void;
    onCompressorClick: () => void;
    onBatchClick: () => void;
    onFeedbackClick: () => void; // [v1.6.1]
};

export function Sidebar({ activeFilter, onFilterChange, onSettingsClick, onAboutClick, onAdminClick, onConverterClick, onCompressorClick, onBatchClick, onFeedbackClick }: SidebarProps) {
    const { t } = useTranslation();
    const [logoClicks, setLogoClicks] = useState(0);
    const [version, setVersion] = useState('...');
    const [updateInfo, setUpdateInfo] = useState<{ available: boolean, url?: string, dismissed?: boolean } | null>(null);
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
    const [updateProgress, setUpdateProgress] = useState(0);

    useEffect(() => {
        // Get actual version
        window.api.getAppVersion().then(v => setVersion(v));

        // Initial update check
        checkUpdates();

        // Check for updates every 4 hours
        const interval = setInterval(checkUpdates, 4 * 60 * 60 * 1000);

        // [v1.6.0] Auto-update listeners
        window.api.onUpdateProgress((_e, progress) => {
            setUpdateProgress(progress);
            setUpdateStatus('downloading');
        });
        window.api.onUpdateReady(() => {
            setUpdateProgress(100);
            setUpdateStatus('ready');
        });
        window.api.onUpdateError((_e, err) => {
            console.error('[Update] Error:', err);
            setUpdateStatus('error');
        });

        return () => clearInterval(interval);
    }, []);

    const checkUpdates = async () => {
        try {
            const res = await window.api.checkAppUpdate();
            if (res.updateAvailable) {
                setUpdateInfo({ available: true, url: res.downloadUrl });
            }
        } catch (e) {
            console.warn('[Update] Check failed:', e);
        }
    };

    const handleStartUpdate = async () => {
        if (!updateInfo?.url) return;
        setUpdateStatus('downloading');
        setUpdateProgress(0);
        await window.api.startAppUpdate(updateInfo.url);
    };

    const handleInstallUpdate = async () => {
        await window.api.installAppUpdate();
    };

    const handleLogoClick = () => {
        const newCount = logoClicks + 1;
        setLogoClicks(newCount);

        if (newCount >= 5) {
            onAdminClick();
            setLogoClicks(0);
        }

        // Reset clicks after 2 seconds of inactivity
        setTimeout(() => setLogoClicks(0), 2000);
    };

    const menuItems = [
        { id: 'all', label: t.sidebar.allDownloads, icon: LayoutGrid },
        { id: 'downloading', label: t.sidebar.downloading, icon: Download },
        { id: 'finished', label: t.sidebar.finished, icon: CheckCircle },
        { id: 'queued', label: t.sidebar.queued, icon: Clock },
        { id: 'trash', label: t.sidebar.trash, icon: Trash2 },
    ];

    return (
        <div className="w-64 bg-secondary/30 h-screen flex flex-col border-r border-border backdrop-blur-md">
            {/* Header / Logo */}
            <div className="p-6 pb-2">
                <h1
                    onClick={handleLogoClick}
                    className="text-2xl font-black bg-gradient-to-br from-blue-400 via-indigo-400 to-purple-500 bg-clip-text text-transparent cursor-default select-none active:scale-95 transition-all tracking-tight"
                >
                    DoulGet
                </h1>
                <p className="text-[10px] text-muted-foreground font-mono opacity-40 mt-1 uppercase tracking-widest px-0.5">Professional Edition</p>
            </div>

            {/* Scrollable Navigation */}
            <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-8 custom-scrollbar">

                {/* Primary Navigation Group */}
                <div className="space-y-1">
                    <p className="px-4 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-2">{t.sidebarExtra.navGroup}</p>
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onFilterChange(item.id)}
                            className={clsx(
                                "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm font-medium",
                                activeFilter === item.id
                                    ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
                                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                            )}
                        >
                            <item.icon className={clsx("w-4 h-4", activeFilter === item.id ? "text-white" : "text-blue-400/70")} />
                            {item.label}
                        </button>
                    ))}
                </div>

                {/* Tools Group */}
                <div className="space-y-1">
                    <p className="px-4 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-2">{t.sidebarExtra.toolsGroup}</p>

                    {/* Batch Downloader */}
                    <button
                        onClick={onBatchClick}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground group"
                    >
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                            <ListTodo className="w-4 h-4 text-blue-400" />
                        </div>
                        {t.sidebarExtra.batch}
                    </button>

                    {/* Convertisseur MP3 */}
                    <button
                        onClick={onConverterClick}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground group"
                    >
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
                            <Music className="w-4 h-4 text-indigo-400" />
                        </div>
                        {t.sidebarExtra.converter}
                    </button>

                    {/* Compresseur Vidéo */}
                    <button
                        onClick={onCompressorClick}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground group"
                    >
                        <div className="w-8 h-8 rounded-lg bg-pink-500/10 flex items-center justify-center group-hover:bg-pink-500/20 transition-colors">
                            <Minimize2 className="w-4 h-4 text-pink-400" />
                        </div>
                        {t.sidebarExtra.compressor}
                    </button>
                </div>
            </nav>

            {/* Bottom Footer Section */}
            <div className="p-3 border-t border-white/5 bg-black/10 backdrop-blur-xl">

                {/* Update Available Banner (Floating above footer if needed) */}
                {updateInfo?.available && !updateInfo?.dismissed && (
                    <div className="mb-3 px-1">
                        {updateStatus === 'idle' && (
                            <div className="relative group/update">
                                <button
                                    onClick={handleStartUpdate}
                                    className="w-full bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold py-2 rounded-lg shadow-lg flex items-center justify-center gap-1.5 transition-all"
                                >
                                    <Sparkles className="w-3 h-3 animate-pulse" />
                                    {t.sidebarExtra.updateAvailable}
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setUpdateInfo(prev => prev ? { ...prev, dismissed: true } : null);
                                    }}
                                    className="absolute -top-1 -right-1 w-4 h-4 bg-muted rounded-full flex items-center justify-center text-[8px] hover:bg-destructive hover:text-white transition-colors border border-border cursor-pointer shadow-sm"
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                        {updateStatus === 'downloading' && (
                            <div className="rounded-lg bg-blue-900/30 border border-blue-500/30 p-2">
                                <div className="text-[9px] text-blue-300 font-bold mb-1.5 flex justify-between uppercase">
                                    <span>{t.sidebarExtra.updateDownloading}</span>
                                    <span>{updateProgress}%</span>
                                </div>
                                <div className="w-full h-1 bg-blue-900/50 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-400 rounded-full transition-all duration-300"
                                        style={{ width: `${updateProgress}%` }}
                                    />
                                </div>
                            </div>
                        )}
                        {updateStatus === 'ready' && (
                            <button
                                onClick={handleInstallUpdate}
                                className="w-full bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold py-2.5 rounded-lg shadow-lg flex items-center justify-center gap-1.5 animate-bounce shadow-green-900/20"
                            >
                                <Sparkles className="w-3.5 h-3.5" />
                                {t.sidebarExtra.updateReady}
                            </button>
                        )}
                    </div>
                )}

                {/* Secondary Actions Group */}
                <div className="flex flex-col gap-0.5">
                    {/* Settings */}
                    <button
                        onClick={onSettingsClick}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    >
                        <Settings className="w-4 h-4 text-muted-foreground/60" />
                        {t.sidebar.settings}
                    </button>

                    {/* About */}
                    <button
                        onClick={onAboutClick}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    >
                        <Info className="w-4 h-4 text-muted-foreground/60" />
                        {t.sidebar.about || 'À propos'}
                    </button>

                    {/* Feedback */}
                    <button
                        onClick={onFeedbackClick}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-xs font-medium text-yellow-500/60 hover:text-yellow-400 hover:bg-yellow-500/5"
                    >
                        <Star className="w-4 h-4" />
                        {t.sidebarExtra.feedback}
                    </button>
                </div>

                {/* Version Info */}
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between px-3">
                    <span className="text-[10px] text-muted-foreground/30 font-mono tracking-widest">BUILD 2026</span>
                    <span className="text-[10px] text-muted-foreground/50 font-mono font-bold">v{version}</span>
                </div>
            </div>
        </div>
    );
}
