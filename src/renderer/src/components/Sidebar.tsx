import { Download, CheckCircle, Clock, Trash2, LayoutGrid, Settings, Info, Sparkles } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../utils/i18n';

type SidebarProps = {
    activeFilter: string;
    onFilterChange: (filter: string) => void;
    onSettingsClick: () => void;
    onAboutClick: () => void;
    onAdminClick: () => void;
};

export function Sidebar({ activeFilter, onFilterChange, onSettingsClick, onAboutClick, onAdminClick }: SidebarProps) {
    const { t } = useTranslation();
    const [logoClicks, setLogoClicks] = useState(0);
    const [version, setVersion] = useState('...');
    const [updateInfo, setUpdateInfo] = useState<{ available: boolean, url?: string } | null>(null);

    useEffect(() => {
        // Get actual version
        window.api.getAppVersion().then(v => setVersion(v));

        // Initial update check
        checkUpdates();

        // Check for updates every 4 hours
        const interval = setInterval(checkUpdates, 4 * 60 * 60 * 1000);
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
        <div className="w-64 bg-secondary/30 h-screen flex flex-col border-r border-border">
            <div className="p-6">
                <h1
                    onClick={handleLogoClick}
                    className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent cursor-default select-none active:scale-95 transition-transform"
                >
                    DoulGet
                </h1>
            </div>

            <nav className="flex-1 px-4 space-y-2">
                {menuItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onFilterChange(item.id)}
                        className={clsx(
                            "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium",
                            activeFilter === item.id
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        )}
                    >
                        <item.icon className="w-5 h-5" />
                        {item.label}
                    </button>
                ))}

                {/* Bouton Settings */}
                <button
                    onClick={onSettingsClick}
                    className={clsx(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium mt-4",
                        "text-muted-foreground hover:bg-secondary/50 hover:text-foreground border-t border-border pt-4"
                    )}
                >
                    <Settings className="w-5 h-5" />
                    {t.sidebar.settings}
                </button>

                {/* Bouton À propos */}
                <button
                    onClick={onAboutClick}
                    className={clsx(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium",
                        "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                >
                    <Info className="w-5 h-5" />
                    À propos
                </button>
            </nav>

            <div className="p-4 border-t border-border group relative">
                {updateInfo?.available && (
                    <button
                        onClick={() => window.open(updateInfo.url, '_blank')}
                        className="absolute -top-10 left-4 right-4 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold py-1.5 px-3 rounded-full shadow-lg animate-bounce flex items-center justify-center gap-1.5"
                    >
                        <Sparkles className="w-3 h-3" />
                        MAJ DISPONIBLE
                    </button>
                )}
                <div className="text-xs text-muted-foreground text-center font-mono opacity-50 group-hover:opacity-100 transition-opacity">
                    v{version}
                </div>
            </div>
        </div>
    );
}
