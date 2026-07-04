import { Play, Pause, X, File, FolderOpen, Terminal, ChevronDown, ChevronRight, RotateCcw, AlertTriangle, Trash2 } from 'lucide-react';
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
    statusMessage?: string;
    segments?: number[];
    isExpanded?: boolean;
    audioOnly?: boolean; // [v1.7.0] Track format for granular IPC calls
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
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

            // [FIX v2.3.7] MIGRATION: Exclure les 'finished' de l'ancien localStorage
            // Ils ne doivent plus être sauvegardés ni restaurés (voir saveDownloadsToStorage).
            // Ce filtre nettoie automatiquement l'historique existant dès le premier démarrage.
            const filtered = parsed.filter((item: DownloadItem) => {
                if (item.status === 'finished') return false; // ← MIGRATION: ignore les anciens 'finished'
                return item.createdAt > thirtyDaysAgo;
            });

            return filtered.map((item: DownloadItem) => {
                // Mark active downloads as interrupted/paused on startup until backend resumes them
                if (['downloading', 'queued'].includes(item.status)) {
                    return { ...item, status: 'paused', statusMessage: 'Waiting for resume...' };
                }
                return item;
            });
        }
    } catch (error) {
        console.error('Error loading downloads from storage:', error);
    }
    return [];
}

function saveDownloadsToStorage(downloads: DownloadItem[]): void {
    try {
        // [FIX v2.3.7] Ne PAS sauvegarder les 'finished' : ils reviendraient au démarrage
        // car le backend les restaure comme 'paused' et les relance automatiquement.
        // On garde uniquement paused, error, interrupted, queued et cancelled.
        const toSave = downloads.filter(item => item.status !== 'finished');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (error) {
        console.error('Error saving downloads to storage:', error);
    }
}

// ─── Confirm Dialog (remplace window.confirm() bloqué en Electron) ───
interface ConfirmDialogState {
    open: boolean;
    message: string;
    onConfirm: () => void;
}

function ConfirmDialog({ state, onClose }: { state: ConfirmDialogState, onClose: () => void }) {
    if (!state.open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-card border border-border rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{state.message}</p>
                </div>
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                    >
                        Annuler
                    </button>
                    <button
                        onClick={() => { state.onConfirm(); onClose(); }}
                        className="px-4 py-2 rounded-lg text-sm bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
                    >
                        Confirmer
                    </button>
                </div>
            </div>
        </div>
    );
}
// ─────────────────────────────────────────────────────────────────────

export function DownloadList({ filter }: DownloadListProps) {
    const { t } = useTranslation();
    const [downloads, setDownloads] = useState<DownloadItem[]>(() => loadDownloadsFromStorage());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [logModalItem, setLogModalItem] = useState<{ url: string, name: string } | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ open: false, message: '', onConfirm: () => {} });

    const showConfirm = useCallback((message: string, onConfirm: () => void) => {
        setConfirmDialog({ open: true, message, onConfirm });
    }, []);
    const closeConfirm = useCallback(() => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
    }, []);

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
                if (item.url === data.url && !!item.audioOnly === !!data.audioOnly) {
                    const newProgress = (item.status === 'paused') ? item.progress : Math.round(data.progress || 0);
                    // Handle pre-formatted size strings from backend (yt-dlp) or byte numbers
                    let displaySize = item.size;
                    if (data.totalBytes) {
                        displaySize = typeof data.totalBytes === 'number'
                            ? formatBytes(data.totalBytes)
                            : data.totalBytes;
                    }

                    return {
                        ...item,
                        progress: newProgress,
                        size: displaySize,
                        status: data.state || item.status,
                        name: data.filename || item.name,
                        // Fix speed display: accept string directly (from yt-dlp) or format number
                        speed: data.speed !== undefined
                            ? (typeof data.speed === 'string' ? data.speed : formatSpeed(data.speed))
                            : item.speed,
                        timeLeft: data.timeLeft || item.timeLeft,
                        canResume: data.canResume !== undefined ? data.canResume : item.canResume,
                        savePath: data.savePath || item.savePath, // [v1.4.6] Capture savePath during progress
                        segments: data.segmentProgress || item.segments,
                        statusMessage: data.statusMessage || (data.state === 'finished' ? '' : item.statusMessage)
                    };
                }
                return item;
            }));
        };

        const handleComplete = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                if (item.url === data.url && !!item.audioOnly === !!data.audioOnly) {
                    const isSuccess = data.state === 'finished' || !data.state;
                    return {
                        ...item,
                        status: isSuccess ? 'finished' :
                            data.state === 'cancelled' ? 'cancelled' : 'error',
                        progress: isSuccess ? 100 : item.progress,
                        size: data.totalBytes ? formatBytes(data.totalBytes) : item.size,
                        timeLeft: '',
                        speed: '-',
                        // [v2.4.1] Adopter le nom réel du fichier sur disque (utilisé par
                        // "Ouvrir" et "Supprimer" pour retrouver le fichier exact)
                        name: (isSuccess && data.filename) ? data.filename : item.name,
                        savePath: data.savePath || item.savePath,
                        statusMessage: '',
                        isExpanded: false
                    };
                }
                return item;
            }));
        };

        const handlePaused = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                if (item.url === data.url && !!item.audioOnly === !!data.audioOnly) {
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
                if (item.url === data.url && !!item.audioOnly === !!data.audioOnly) {
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
                if (item.url === data.url && !!item.audioOnly === !!data.audioOnly) {
                    return { ...item, status: 'cancelled' as const };
                }
                return item;
            }));
        };

        const handleError = (_event: any, data: any) => {
            setDownloads(prev => prev.map(item => {
                const urlMatch = item.url === data.url || (data.originalUrl && item.url === data.originalUrl);
                const formatMatch = !!item.audioOnly === !!data.audioOnly;
                if (urlMatch && formatMatch) {
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
                // [FIX v2.3.7] Vérifier aussi les 'finished' pour éviter doublons au redémarrage
                // Le backend restaure les downloads et envoie 'download-started' même pour des
                // URLs déjà finies côté frontend (localStorage ne les garde plus, mais en mémoire).
                if (prev.find(item => item.url === data.url && !!item.audioOnly === !!data.audioOnly && ['queued', 'downloading', 'paused', 'finished'].includes(item.status))) {
                    console.log('[DEBUG] Download already exists in UI (incl. finished):', data.url, 'AudioOnly:', data.audioOnly);
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
                    audioOnly: !!data.audioOnly, // [v1.7.0] Store format
                    createdAt: data.createdAt || Date.now(),
                    savePath: data.savePath,
                    canResume: data.canResume // [v2.4.0] Enable manual retry for restored/interrupted items
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

    const toggleExpand = (id: string) => {
        setDownloads(prev => prev.map(item =>
            item.id === id ? { ...item, isExpanded: !item.isExpanded } : item
        ));
    };

    const handleAddDownload = useCallback(async (url: string, audioOnly: boolean = false) => {
        // ... existence check omitted for brevity ...
        const exists = downloads.find(d => d.url === url &&
            !!d.audioOnly === audioOnly &&
            ['downloading', 'queued', 'paused'].includes(d.status));

        if (exists) {
            alert(t.downloadList.alreadyInProgress);
            return;
        }

        // Ask for download path
        const savePath = await window.api.selectDownloadPath();

        const newDownload: DownloadItem = {
            id: uuidv4(),
            name: (url.split('/').pop() || 'unknown-file') + (audioOnly ? '.mp3' : ''),
            size: t.downloadList.waiting,
            progress: 0,
            speed: '-',
            status: 'queued',
            url,
            timeLeft: '--',
            createdAt: Date.now(),
            strategy: 'yt-dlp',
            audioOnly, // [v1.7.0] Store format
            savePath: savePath || undefined // [v1.4.7] Store savePath immediately
        };

        setDownloads(prev => [newDownload, ...prev]);
        window.api.startDownload(url, savePath || undefined, audioOnly);
    }, [downloads]);

    const handlePause = useCallback((url: string, audioOnly: boolean = false) => {
        window.api.pauseDownload(url, audioOnly);
    }, []);

    const handleResume = useCallback(async (url: string, audioOnly: boolean = false) => {
        const item = downloads.find(d => d.url === url && !!d.audioOnly === !!audioOnly);
        let savePath = item?.savePath;

        // [v1.4.7] Fallback: If savePath is missing, ask the user to select the folder
        if (!savePath) {
            console.log('[Resume] SavePath missing in localStorage, asking user...');
            savePath = await window.api.selectDownloadPath() || undefined;

            if (savePath) {
                // Update local status so the path is saved for next time
                setDownloads(prev => prev.map(d =>
                    (d.url === url && !!d.audioOnly === !!audioOnly) ? { ...d, savePath } : d
                ));
            } else {
                return; // User cancelled folder selection
            }
        }

        window.api.resumeDownload(url, savePath, item?.name, audioOnly);
    }, [downloads]);

    const handleCancel = useCallback((url: string, audioOnly: boolean = false) => {
        showConfirm(
            t.downloadList.cancelConfirm || 'Voulez-vous annuler ce téléchargement ?',
            () => {
                window.api.cancelDownload(url, audioOnly);
                // Mise à jour immédiate de l'UI sans attendre l'event backend
                setDownloads(prev => prev.map(item =>
                    (item.url === url && !!item.audioOnly === !!audioOnly)
                        ? { ...item, status: 'cancelled' as const, speed: '-', timeLeft: '' }
                        : item
                ));
            }
        );
    }, [t, showConfirm]);

    const handleOpenFolder = useCallback((url: string, audioOnly: boolean = false) => {
        const item = downloads.find(d => d.url === url && !!d.audioOnly === !!audioOnly);
        window.api.openDownloadFolder(url, item?.savePath, item?.name, audioOnly);
    }, [downloads]);

    const handleDelete = useCallback((id: string) => {
        const itemToDelete = downloads.find(d => d.id === id);
        if (!itemToDelete) return;

        const doDelete = () => {
            // [FIX] Si le téléchargement est actif, l'arrêter côté backend AVANT de supprimer
            if (['downloading', 'queued', 'paused'].includes(itemToDelete.status) && itemToDelete.url) {
                window.api.cancelDownload(itemToDelete.url, !!itemToDelete.audioOnly);
            }

            // [FIX v2.3.7] Les items 'finished' sont supprimés DIRECTEMENT et DEFINITIVEMENT
            // (pas de passage par la corbeille → ils ne reviennent plus au redémarrage)
            if (itemToDelete.status === 'finished') {
                setDownloads(prev => {
                    const updated = prev.filter(item => item.id !== id);
                    try {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                    } catch (error) {
                        console.error('Error saving downloads to storage:', error);
                    }
                    return updated;
                });
                return;
            }

            // [v1.2.9] Soft Delete Flow: If not already cancelled, move to Trash
            if (itemToDelete.status !== 'cancelled') {
                setDownloads(prev => prev.map(item =>
                    item.id === id ? { ...item, status: 'cancelled' as const, speed: '-', timeLeft: '' } : item
                ));
                return;
            }

            // [v1.3.0] Permanent Delete Flow: If already in Trash, perform PHYSICAL DELETE and remove from state
            if (itemToDelete.savePath) {
                window.api.deleteFile(itemToDelete.savePath, itemToDelete.name);
            }

            setDownloads(prev => {
                const updated = prev.filter(item => item.id !== id);
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                } catch (error) {
                    console.error('Error saving downloads to storage:', error);
                }
                return updated;
            });
        };

        showConfirm(
            t.downloadList.deleteConfirm || 'Voulez-vous supprimer cet élément ?',
            doDelete
        );
    }, [t, downloads, showConfirm]);

    const handleRestore = useCallback((id: string) => {
        setDownloads(prev => prev.map(item => {
            if (item.id === id && item.status === 'cancelled') {
                // Determine restored status based on progress
                const restoredStatus = item.progress >= 100 ? 'finished' : 'paused';
                return { ...item, status: restoredStatus as any };
            }
            return item;
        }));
    }, []);

    const handleResumeAll = useCallback(() => {
        downloads.forEach(item => {
            if ((['paused', 'interrupted', 'error'].includes(item.status)) && item.canResume !== false && item.url) {
                window.api.resumeDownload(item.url, item.savePath, item.name, !!item.audioOnly);
            }
        });
    }, [downloads]);

    const handleStopAll = useCallback(() => {
        downloads.forEach(item => {
            if ((['downloading', 'queued'].includes(item.status)) && item.url) {
                window.api.pauseDownload(item.url, !!item.audioOnly);
            }
        });
    }, [downloads]);

    const handleResumeSelected = useCallback(() => {
        downloads.forEach(item => {
            if (selectedIds.has(item.id) && (['paused', 'interrupted', 'error'].includes(item.status)) && item.canResume !== false && item.url) {
                window.api.resumeDownload(item.url, item.savePath, item.name, !!item.audioOnly);
            }
        });
        setSelectedIds(new Set());
    }, [downloads, selectedIds]);

    const handleStopSelected = useCallback(() => {
        downloads.forEach(item => {
            if (selectedIds.has(item.id) && (['downloading', 'queued'].includes(item.status)) && item.url) {
                window.api.pauseDownload(item.url, !!item.audioOnly);
            }
        });
        setSelectedIds(new Set());
    }, [downloads, selectedIds]);

    const handleDeleteSelected = useCallback(() => {
        showConfirm(
            t.downloadList.deleteConfirm || 'Voulez-vous supprimer les éléments sélectionnés ?',
            () => {
                const idsToDelete = new Set(selectedIds);

                setDownloads(prev => {
                    const updated = prev.map(item => {
                        if (idsToDelete.has(item.id)) {
                            // [FIX] Cancel active downloads before deleting
                            if (item.status !== 'cancelled') {
                                if (['downloading', 'queued', 'paused'].includes(item.status) && item.url) {
                                    window.api.cancelDownload(item.url, !!item.audioOnly);
                                }
                                return { ...item, status: 'cancelled' as const, speed: '-', timeLeft: '' };
                            }
                            // Permanent removal: PERFORM PHYSICAL DELETE if in Trash
                            if (item.savePath) {
                                window.api.deleteFile(item.savePath, item.name);
                            }
                            return null;
                        }
                        return item;
                    }).filter((item): item is DownloadItem => item !== null);

                    try {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                    } catch (error) {
                        console.error('Error saving downloads to storage:', error);
                    }
                    return updated;
                });
                setSelectedIds(new Set());
            }
        );
    }, [downloads, selectedIds, t, showConfirm]);

    const handleRestoreSelected = useCallback(() => {
        setDownloads(prev => prev.map(item => {
            if (selectedIds.has(item.id) && item.status === 'cancelled') {
                const restoredStatus = item.progress >= 100 ? 'finished' : 'paused';
                return { ...item, status: restoredStatus as any };
            }
            return item;
        }));
        setSelectedIds(new Set());
    }, [selectedIds]);

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
                            {filter === 'trash' && (
                                <button onClick={handleRestoreSelected} className="px-3 py-1.5 bg-green-500/10 text-green-600 hover:bg-green-500/20 rounded text-xs font-medium flex items-center gap-1">
                                    <RotateCcw className="w-3 h-3" /> {t.downloadList.restoreSelected}
                                </button>
                            )}
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
                                <th className="px-6 py-3 font-medium min-w-[300px] w-auto">{t.downloadList.fileName}</th>
                                <th className="px-6 py-3 font-medium w-32">{t.downloadList.size}</th>
                                <th className="px-6 py-3 font-medium w-60">{t.downloadList.progress}</th>
                                <th className="px-6 py-3 font-medium w-32">{t.downloadList.speed}</th>
                                <th className="px-6 py-3 font-medium w-32">{t.downloadList.status}</th>
                                <th className="px-6 py-3 font-medium text-right w-32">{t.downloadList.actions}</th>
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
                                    <td className="px-6 py-4 font-medium flex items-center gap-3 min-w-[200px]">
                                        <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
                                            <File className="w-4 h-4" />
                                        </div>
                                        <div className="truncate max-w-[400px]" title={item.name}>
                                            {item.name}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground w-28 tabular-nums">{item.size}</td>
                                    <td className="px-6 py-4 w-48">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <span>{Math.round(item.progress)}%</span>
                                                    {item.segments && item.segments.length > 0 && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                                                            className="p-0.5 hover:bg-secondary rounded transition-colors"
                                                            title="Toggle details"
                                                        >
                                                            {item.isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                                        </button>
                                                    )}
                                                </div>
                                                <span>{item.timeLeft || '--'}</span>
                                            </div>
                                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden relative">
                                                <div
                                                    className={clsx("h-full rounded-full transition-all duration-500",
                                                        item.status === 'finished' ? "bg-green-500" :
                                                            item.status === 'paused' ? "bg-yellow-500" :
                                                                item.status === 'error' || item.status === 'cancelled' ? "bg-red-500" :
                                                                    item.status === 'interrupted' ? "bg-orange-500" :
                                                                        "bg-blue-500"
                                                    )}
                                                    style={{ width: `${Math.round(item.progress)}%` }}
                                                />
                                            </div>

                                            {/* Status Message (Post-processing feedback) */}
                                            {item.statusMessage && (
                                                <div className="text-[10px] text-blue-500 font-medium animate-pulse mt-0.5 truncate">
                                                    {item.statusMessage}
                                                </div>
                                            )}

                                            {/* Collapsible Segment Bars (Sub-progress) */}
                                            {item.isExpanded && item.segments && item.segments.length > 0 && (
                                                <div className="flex gap-1 mt-1.5 h-1.5 w-full">
                                                    {item.segments.map((segProgress, idx) => (
                                                        <div
                                                            key={idx}
                                                            className="flex-1 h-full bg-secondary/30 rounded-full overflow-hidden"
                                                            title={`Thread ${idx + 1}: ${segProgress}%`}
                                                        >
                                                            <div
                                                                className="h-full bg-blue-500/80 transition-all duration-300"
                                                                style={{ width: `${segProgress}%` }}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground w-28 tabular-nums">{item.speed}</td>
                                    <td className="px-6 py-4 w-28">
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
                                    <td className="px-6 py-4 text-right w-28">
                                        <div className="flex items-center justify-end gap-2 text-muted-foreground">
                                            {(item.status === 'downloading' || item.status === 'queued') && item.canResume !== false && (
                                                <button
                                                    onClick={() => item.url && handlePause(item.url, !!item.audioOnly)}
                                                    className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Pause"
                                                >
                                                    <Pause className="w-4 h-4" />
                                                </button>
                                            )}
                                            {(item.status === 'paused' || item.status === 'interrupted') && item.canResume !== false && (
                                                <button
                                                    onClick={() => item.url && handleResume(item.url, !!item.audioOnly)}
                                                    className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Resume"
                                                    disabled={item.status === 'interrupted' && !item.canResume}
                                                >
                                                    <Play className="w-4 h-4" />
                                                </button>
                                            )}
                                            {(item.status === 'downloading' || item.status === 'queued' || item.status === 'paused' || item.status === 'interrupted') && (
                                                <>
                                                    <button
                                                        onClick={() => item.url && handleCancel(item.url, !!item.audioOnly)}
                                                        className="p-1.5 hover:bg-red-500/10 rounded-md text-muted-foreground hover:text-red-500 transition-colors"
                                                        title="Annuler"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(item.id)}
                                                        className="p-1.5 hover:bg-red-500/20 rounded-md text-red-400 hover:text-red-500 transition-colors"
                                                        title="Annuler et supprimer"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                            {item.status === 'finished' && (
                                                <button
                                                    onClick={() => item.url && handleOpenFolder(item.url, !!item.audioOnly)}
                                                    className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Open folder"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            )}
                                            {item.status === 'cancelled' && (
                                                <button
                                                    onClick={() => handleRestore(item.id)}
                                                    className="p-1.5 hover:bg-green-500/10 rounded-md text-muted-foreground hover:text-green-500 transition-colors"
                                                    title={t.downloadList.restore}
                                                >
                                                    <RotateCcw className="w-4 h-4" />
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
            </div >

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

            <ConfirmDialog state={confirmDialog} onClose={closeConfirm} />
        </div >
    );
}
