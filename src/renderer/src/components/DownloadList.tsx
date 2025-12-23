import { Play, Pause, X, File, FolderOpen, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { useState, useEffect, useCallback } from 'react';
import { AddDownloadModal } from './AddDownloadModal';
import { LogModal } from './LogModal';
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from '../utils/i18n';

export interface DownloadItem {
    id: string;
    name: string;
    size: string;
    progress: number;
    speed: string;
    status: 'downloading' | 'paused' | 'finished' | 'error' | 'queued' | 'cancelled' | 'interrupted';
    timeLeft?: string;
    url?: string;
    savePath?: string;
    canResume?: boolean;
    createdAt: number;
    strategy?: 'yt-dlp' | 'direct' | 'electron';
}

type DownloadListProps = {
    filter: string;
};

const STORAGE_KEY = 'download-manager-downloads';

function formatBytes(bytes: number, decimals = 2): string {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSecond: number): string {
    if (!bytesPerSecond || bytesPerSecond === 0) return '-';
    return `${formatBytes(bytesPerSecond)}/s`;
}

function loadDownloadsFromStorage(): DownloadItem[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Filter out cancelled downloads and keep only recent ones (last 30 days)
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            return parsed.filter((item: DownloadItem) =>
                item.status !== 'cancelled' && item.createdAt > thirtyDaysAgo
            );
        }
    } catch (error) {
        console.error('Error loading downloads from storage:', error);
    }
    return [];
}

function saveDownloadsToStorage(downloads: DownloadItem[]): void {
    try {
        // Save finished, paused, error, and interrupted downloads (but not active ones)
        const toSave = downloads.filter(item =>
            ['finished', 'paused', 'error', 'interrupted', 'cancelled'].includes(item.status)
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (error) {
        console.error('Error saving downloads to storage:', error);
    }
}

export function DownloadList({ filter }: DownloadListProps) {
    const { t } = useTranslation();
    const [downloads, setDownloads] = useState<DownloadItem[]>(() => loadDownloadsFromStorage());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [logModalItem, setLogModalItem] = useState<{ url: string, name: string } | null>(null);

    // Save to localStorage whenever downloads change
    useEffect(() => {
        saveDownloadsToStorage(downloads);
    }, [downloads]);

    // Effect to clear selection when filter changes
    useEffect(() => {
        setSelectedIds(new Set());
    }, [filter]);

    useEffect(() => {
        const handleProgress = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                if (item.url === data.url) {
                    // Ne pas mettre à jour le pourcentage si le téléchargement est en pause
                    const newProgress = (item.status === 'paused') ? item.progress : Math.round(data.progress || 0);
                    return {
                        ...item,
                        progress: newProgress,
                        size: data.totalBytes ? formatBytes(data.totalBytes) : item.size,
                        status: data.state || item.status,
                        name: data.filename || item.name,
                        speed: data.speed !== undefined ? formatSpeed(data.speed) : item.speed,
                        timeLeft: data.timeLeft || item.timeLeft,
                        canResume: data.canResume !== undefined ? data.canResume : item.canResume
                    };
                }
                return item;
            }));
        };

        const handleComplete = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                if (item.url === data.url) {
                    const isSuccess = data.state === 'finished' || !data.state;
                    return {
                        ...item,
                        status: isSuccess ? 'finished' :
                            data.state === 'cancelled' ? 'cancelled' : 'error',
                        progress: isSuccess ? 100 : item.progress,
                        timeLeft: '',
                        speed: '-',
                        savePath: data.savePath || item.savePath
                    };
                }
                return item;
            }));
        };

        const handlePaused = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                if (item.url === data.url) {
                    return {
                        ...item,
                        status: 'paused' as const,
                        // Preserve the progress percentage when pausing
                        progress: data.progress !== undefined ? data.progress : item.progress
                    };
                }
                return item;
            }));
        };

        const handleResumed = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                if (item.url === data.url) {
                    // Conserver le pourcentage actuel lors de la reprise
                    return {
                        ...item,
                        status: 'downloading' as const,
                        // Ne pas réinitialiser le pourcentage, le garder tel quel
                        progress: item.progress
                    };
                }
                return item;
            }));
        };

        const handleCancelled = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                if (item.url === data.url) {
                    return { ...item, status: 'cancelled' as const };
                }
                return item;
            }));
        };

        const handleError = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                if (item.url === data.url || (data.originalUrl && item.url === data.originalUrl)) {
                    return {
                        ...item,
                        status: 'error' as const,
                        name: item.name + ' (Error: ' + (data.error || 'Unknown error') + ')'
                    };
                }
                return item;
            }));
        };

        const handleStarted = (_event: any, data: any) => {
            setDownloads(prev => {
                // Check if already exists in active state
                if (prev.find(item => item.url === data.url && ['queued', 'downloading', 'paused'].includes(item.status))) {
                    return prev;
                }

                const newItem: DownloadItem = {
                    id: uuidv4(),
                    name: data.name || 'unknown',
                    size: data.size || 'Waiting...',
                    progress: data.progress || 0,
                    speed: data.speed || '-',
                    status: (data.status as any) || 'queued',
                    timeLeft: data.timeLeft || '--',
                    url: data.url,
                    createdAt: data.createdAt || Date.now(),
                    savePath: data.savePath
                };
                return [newItem, ...prev];
            });
        };

        window.api.onDownloadProgress(handleProgress);
        window.api.onDownloadStarted(handleStarted);
        window.api.onDownloadComplete(handleComplete);
        window.api.onDownloadPaused(handlePaused);
        window.api.onDownloadResumed(handleResumed);
        window.api.onDownloadCancelled(handleCancelled);
        window.api.onDownloadError(handleError);

        return () => {
            window.api.removeDownloadListeners();
        };
    }, []);

    const filteredDownloads = downloads.filter(item => {
        if (filter === 'all') return item.status !== 'cancelled';
        if (filter === 'trash') return item.status === 'cancelled';
        return item.status === filter;
    });

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredDownloads.length && filteredDownloads.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredDownloads.map(d => d.id)));
        }
    };

    const handleAddDownload = useCallback(async (url: string) => {
        // Check if download already exists
        const exists = downloads.find(d => d.url === url &&
            ['downloading', 'queued', 'paused'].includes(d.status));

        if (exists) {
            alert(t.downloadList.alreadyInProgress);
            return;
        }

        // Ask for download path
        const savePath = await window.api.selectDownloadPath();

        const newDownload: DownloadItem = {
            id: uuidv4(),
            name: url.split('/').pop() || 'unknown-file',
            size: t.downloadList.waiting,
            progress: 0,
            speed: '-',
            status: 'queued',
            url,
            timeLeft: '--',
            createdAt: Date.now(),
            strategy: 'yt-dlp'
        };

        setDownloads(prev => [newDownload, ...prev]);
        window.api.startDownload(url, savePath || undefined);
    }, [downloads]);

    const handlePause = useCallback((url: string) => {
        window.api.pauseDownload(url);
    }, []);

    const handleResume = useCallback((url: string) => {
        const item = downloads.find(d => d.url === url);
        window.api.resumeDownload(url, item?.savePath, item?.name);
    }, [downloads]);

    const handleCancel = useCallback((url: string) => {
        if (confirm(t.downloadList.cancelConfirm)) {
            window.api.cancelDownload(url);
        }
    }, [t]);

    const handleOpenFolder = useCallback((url: string) => {
        window.api.openDownloadFolder(url);
    }, []);

    const handleDelete = useCallback((id: string) => {
        if (confirm(t.downloadList.deleteConfirm)) {
            setDownloads(prev => {
                const updated = prev.filter(item => item.id !== id);
                // Sauvegarder immédiatement pour éviter que l'élément revienne
                try {
                    const toSave = updated.filter(item =>
                        ['finished', 'paused', 'error', 'interrupted', 'cancelled'].includes(item.status)
                    );
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
                } catch (error) {
                    console.error('Error saving downloads to storage:', error);
                }
                return updated;
            });
        }
    }, [t]);

    const handleResumeAll = useCallback(() => {
        downloads.forEach(item => {
            if ((['paused', 'interrupted', 'error'].includes(item.status)) && item.canResume !== false && item.url) {
                window.api.resumeDownload(item.url, item.savePath, item.name);
            }
        });
    }, [downloads]);

    const handleStopAll = useCallback(() => {
        downloads.forEach(item => {
            if ((['downloading', 'queued'].includes(item.status)) && item.url) {
                window.api.pauseDownload(item.url);
            }
        });
    }, [downloads]);

    const handleResumeSelected = useCallback(() => {
        downloads.forEach(item => {
            if (selectedIds.has(item.id) && (['paused', 'interrupted', 'error'].includes(item.status)) && item.canResume !== false && item.url) {
                window.api.resumeDownload(item.url, item.savePath, item.name);
            }
        });
        setSelectedIds(new Set());
    }, [downloads, selectedIds]);

    const handleStopSelected = useCallback(() => {
        downloads.forEach(item => {
            if (selectedIds.has(item.id) && (['downloading', 'queued'].includes(item.status)) && item.url) {
                window.api.pauseDownload(item.url);
            }
        });
        setSelectedIds(new Set());
    }, [downloads, selectedIds]);

    const handleDeleteSelected = useCallback(() => {
        if (!confirm(t.downloadList.deleteConfirm)) return;

        const idsToDelete = new Set(selectedIds);

        // Cancel any active ones first
        downloads.forEach(item => {
            if (idsToDelete.has(item.id) && ['downloading', 'queued', 'paused'].includes(item.status) && item.url) {
                window.api.cancelDownload(item.url);
            }
        });

        setDownloads(prev => {
            const updated = prev.filter(item => !idsToDelete.has(item.id));
            try {
                const toSave = updated.filter(item =>
                    ['finished', 'paused', 'error', 'interrupted', 'cancelled'].includes(item.status)
                );
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
            } catch (error) {
                console.error('Error saving downloads to storage:', error);
            }
            return updated;
        });
        setSelectedIds(new Set());
    }, [downloads, selectedIds, t]);

    return (
        <div className="flex-1 bg-background flex flex-col h-screen overflow-hidden">
            <div className="p-6 border-b border-border flex flex-col gap-4">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold">
                        {filter === 'all' ? t.downloadList.allDownloads :
                            filter === 'trash' ? t.downloadList.trash :
                                t.sidebar[filter as keyof typeof t.sidebar] || filter}
                    </h2>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
                    >
                        <File className="w-4 h-4" />
                        {t.downloadList.addUrl}
                    </button>
                </div>

                {/* Bulk Actions Toolbar */}
                <div className="flex items-center gap-2 flex-wrap">
                    {selectedIds.size > 0 ? (
                        <>
                            <span className="text-sm text-muted-foreground mr-2">{selectedIds.size} {t.downloadList.selected}</span>
                            <button onClick={handleResumeSelected} className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded text-xs font-medium flex items-center gap-1">
                                <Play className="w-3 h-3" /> {t.downloadList.resumeSelected}
                            </button>
                            <button onClick={handleStopSelected} className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded text-xs font-medium flex items-center gap-1">
                                <Pause className="w-3 h-3" /> {t.downloadList.stopSelected}
                            </button>
                            <button onClick={handleDeleteSelected} className="px-3 py-1.5 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded text-xs font-medium flex items-center gap-1">
                                <X className="w-3 h-3" /> {t.downloadList.deleteSelected}
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={handleResumeAll} className="px-3 py-1.5 bg-green-500/10 text-green-600 hover:bg-green-500/20 rounded text-xs font-medium flex items-center gap-1">
                                <Play className="w-3 h-3" /> {t.downloadList.resumeAll}
                            </button>
                            <button onClick={handleStopAll} className="px-3 py-1.5 bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20 rounded text-xs font-medium flex items-center gap-1">
                                <Pause className="w-3 h-3" /> {t.downloadList.stopAll}
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-secondary/50 text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 w-[40px]">
                                    <input
                                        type="checkbox"
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        checked={filteredDownloads.length > 0 && selectedIds.size === filteredDownloads.length}
                                        onChange={toggleSelectAll}
                                    />
                                </th>
                                <th className="px-6 py-3 font-medium">{t.downloadList.fileName}</th>
                                <th className="px-6 py-3 font-medium">{t.downloadList.size}</th>
                                <th className="px-6 py-3 font-medium">{t.downloadList.progress}</th>
                                <th className="px-6 py-3 font-medium">{t.downloadList.speed}</th>
                                <th className="px-6 py-3 font-medium">{t.downloadList.status}</th>
                                <th className="px-6 py-3 font-medium text-right">{t.downloadList.actions}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredDownloads.map((item) => (
                                <tr key={item.id} className={clsx("hover:bg-secondary/20 transition-colors group", selectedIds.has(item.id) && "bg-secondary/10")}>
                                    <td className="px-4 py-4">
                                        <input
                                            type="checkbox"
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            checked={selectedIds.has(item.id)}
                                            onChange={() => toggleSelection(item.id)}
                                        />
                                    </td>
                                    <td className="px-6 py-4 font-medium flex items-center gap-3">
                                        <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center text-muted-foreground">
                                            <File className="w-4 h-4" />
                                        </div>
                                        <div className="truncate max-w-[400px]" title={item.name}>
                                            {item.name}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground">{item.size}</td>
                                    <td className="px-6 py-4 w-64">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex justify-between text-xs text-muted-foreground">
                                                <span>{item.progress}%</span>
                                                <span>{item.timeLeft || '--'}</span>
                                            </div>
                                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className={clsx("h-full rounded-full transition-all duration-500",
                                                        item.status === 'finished' ? "bg-green-500" :
                                                            item.status === 'paused' ? "bg-yellow-500" :
                                                                item.status === 'error' || item.status === 'cancelled' ? "bg-red-500" :
                                                                    item.status === 'interrupted' ? "bg-orange-500" :
                                                                        "bg-blue-500"
                                                    )}
                                                    style={{ width: `${item.progress}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground">{item.speed}</td>
                                    <td className="px-6 py-4">
                                        <span className={clsx("px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                                            item.status === 'finished' ? "bg-green-500/10 text-green-500" :
                                                item.status === 'downloading' ? "bg-blue-500/10 text-blue-500" :
                                                    item.status === 'paused' ? "bg-yellow-500/10 text-yellow-500" :
                                                        item.status === 'queued' ? "bg-secondary text-muted-foreground" :
                                                            item.status === 'interrupted' ? "bg-orange-500/10 text-orange-500" :
                                                                "bg-red-500/10 text-red-500"
                                        )}>
                                            {t.status[item.status as keyof typeof t.status] || item.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {(item.status === 'downloading' || item.status === 'queued') && item.canResume !== false && (
                                                <button
                                                    onClick={() => item.url && handlePause(item.url)}
                                                    className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Pause"
                                                >
                                                    <Pause className="w-4 h-4" />
                                                </button>
                                            )}
                                            {(item.status === 'paused' || item.status === 'interrupted') && item.canResume !== false && (
                                                <button
                                                    onClick={() => item.url && handleResume(item.url)}
                                                    className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Resume"
                                                    disabled={item.status === 'interrupted' && !item.canResume}
                                                >
                                                    <Play className="w-4 h-4" />
                                                </button>
                                            )}
                                            {(item.status === 'downloading' || item.status === 'queued' || item.status === 'paused' || item.status === 'interrupted') && (
                                                <button
                                                    onClick={() => item.url && handleCancel(item.url)}
                                                    className="p-1.5 hover:bg-red-500/10 rounded-md text-muted-foreground hover:text-red-500 transition-colors"
                                                    title="Cancel"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            )}
                                            {item.status === 'finished' && (
                                                <button
                                                    onClick={() => item.url && handleOpenFolder(item.url)}
                                                    className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Open folder"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            )}
                                            {(item.status === 'finished' || item.status === 'error' || item.status === 'cancelled' || item.status === 'interrupted') && (
                                                <button
                                                    onClick={() => handleDelete(item.id)}
                                                    className="p-1.5 hover:bg-red-500/10 rounded-md text-muted-foreground hover:text-red-500 transition-colors"
                                                    title="Delete"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            )}
                                            {item.strategy === 'yt-dlp' && item.url && (
                                                <button
                                                    onClick={() => item.url && setLogModalItem({ url: item.url, name: item.name })}
                                                    className="p-1.5 hover:bg-blue-500/10 rounded-md text-muted-foreground hover:text-blue-500 transition-colors"
                                                    title={t.downloadList.viewLogs}
                                                >
                                                    <Terminal className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredDownloads.length === 0 && (
                        <div className="p-12 text-center text-muted-foreground">
                            {t.downloadList.noDownloads}
                        </div>
                    )}
                </div>
            </div>

            <AddDownloadModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onAdd={handleAddDownload}
            />

            <LogModal
                isOpen={!!logModalItem}
                onClose={() => setLogModalItem(null)}
                url={logModalItem?.url || ''}
                filename={logModalItem?.name || ''}
            />
        </div>
    );
}
