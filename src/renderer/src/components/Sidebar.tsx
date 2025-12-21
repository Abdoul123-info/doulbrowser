import { Download, CheckCircle, Clock, Trash2, LayoutGrid, Settings, Info } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from '../utils/i18n';

type SidebarProps = {
    activeFilter: string;
    onFilterChange: (filter: string) => void;
    onSettingsClick: () => void;
    onAboutClick: () => void;
};

export function Sidebar({ activeFilter, onFilterChange, onSettingsClick, onAboutClick }: SidebarProps) {
    const { t } = useTranslation();

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
                <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
                    <Download className="w-8 h-8 text-blue-500" />
                    DoulBrowser
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

            <div className="p-4 border-t border-border">
                <div className="text-xs text-muted-foreground text-center">
                    v1.0.0
                </div>
            </div>
        </div>
    );
}
