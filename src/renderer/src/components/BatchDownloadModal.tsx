import { X, ListTodo, Search, CheckCircle2, AlertCircle, Loader2, Play, Check, Music, Video, ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../utils/i18n';

type BatchDownloadModalProps = {
    isOpen: boolean;
    onClose: () => void;
    externalData?: {
        playlistTitle: string;
        items: any[];
        headers: any;
    } | null;
};

type PlaylistEntry = {
    id: string;
    url: string;
    title: string;
    duration?: number;
    selected: boolean;
};

export function BatchDownloadModal({ isOpen, onClose, externalData }: BatchDownloadModalProps) {
    const [urlInput, setUrlInput] = useState('');
    const [status, setStatus] = useState<'idle' | 'fetching' | 'listing' | 'adding' | 'success' | 'error'>('idle');
    const [playlistTitle, setPlaylistTitle] = useState('');
    const [entries, setEntries] = useState<PlaylistEntry[]>([]);
    const [audioOnly, setAudioOnly] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { t } = useTranslation();

    useEffect(() => {
        if (!isOpen) {
            setStatus('idle');
            setUrlInput('');
            setPlaylistTitle('');
            setEntries([]);
            setError(null);
        } else if (externalData) {
            // [v1.5.1] Auto-populate from extension
            setPlaylistTitle(externalData.playlistTitle);
            setEntries(externalData.items);
            setStatus('listing');
        }
    }, [isOpen, externalData]);

    const handleFetchPlaylist = async () => {
        if (!urlInput.trim()) return;

        setStatus('fetching');
        setError(null);

        try {
            const data = await window.api.getPlaylistInfo(urlInput.trim());
            setPlaylistTitle(data.title);
            setEntries(data.entries.map(e => ({ ...e, selected: true })));
            setStatus('listing');
        } catch (e: any) {
            console.error('Playlist fetch failed:', e);
            setStatus('error');
            setError(e.message || t.batch.errorFetch);
        }
    };

    const toggleSelectAll = () => {
        const anyUnselected = entries.some(e => !e.selected);
        setEntries(entries.map(e => ({ ...e, selected: anyUnselected })));
    };

    const toggleEntry = (id: string) => {
        setEntries(entries.map(e => e.id === id ? { ...e, selected: !e.selected } : e));
    };

    const handleBatchAdd = () => {
        const selectedItems = entries.filter(e => e.selected);
        if (selectedItems.length === 0) return;

        setStatus('adding');
        window.api.batchAddToQueue({
            items: selectedItems,
            playlistTitle: playlistTitle,
            audioOnly: audioOnly,
            headers: externalData?.headers || {} // [v1.5.1] Pass headers for Lok-lok/HLS
        });

        setTimeout(() => {
            setStatus('success');
            setTimeout(onClose, 2000);
        }, 1000);
    };

    const formatDuration = (seconds?: number) => {
        if (!seconds) return '--:--';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02] shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                            <ListTodo className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">{t.batch.title}</h2>
                            <p className="text-xs text-muted-foreground">{t.batch.subtitle}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                        <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-hidden flex flex-col gap-6 flex-1">
                    {status === 'idle' || status === 'error' || status === 'fetching' ? (
                        <div className="space-y-6 py-4">
                            <div className="space-y-3">
                                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t.batch.inputLabel}</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={urlInput}
                                        onChange={(e) => setUrlInput(e.target.value)}
                                        placeholder={t.batch.inputPlaceholder}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/50 transition-colors pr-12"
                                        onKeyDown={(e) => e.key === 'Enter' && handleFetchPlaylist()}
                                    />
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                        <Search className="w-5 h-5 text-white/20" />
                                    </div>
                                </div>
                            </div>

                            {status === 'error' && (
                                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-3 animate-in shake duration-300">
                                    <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                                    <p className="text-sm text-destructive">{error}</p>
                                </div>
                            )}

                            <button
                                onClick={handleFetchPlaylist}
                                disabled={!urlInput.trim() || status === 'fetching'}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all active:scale-[0.98]"
                            >
                                {status === 'fetching' ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        {t.batch.fetching}
                                    </>
                                ) : (
                                    <>
                                        {t.batch.fetchBtn}
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    ) : status === 'listing' ? (
                        <div className="flex flex-col gap-4 overflow-hidden h-full">
                            <div className="flex items-center justify-between shrink-0 px-2">
                                <div className="min-w-0">
                                    <h3 className="text-sm font-bold text-white truncate">{playlistTitle}</h3>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                                        {t.batch.selectedCount
                                            .replace('{selected}', entries.filter(e => e.selected).length.toString())
                                            .replace('{total}', entries.length.toString())}
                                    </p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        onClick={toggleSelectAll}
                                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-medium transition-colors"
                                    >
                                        {entries.every(e => e.selected) ? t.batch.deselectAll : t.batch.selectAll}
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                <div className="space-y-2">
                                    {entries.map((entry) => (
                                        <div
                                            key={entry.id}
                                            onClick={() => toggleEntry(entry.id)}
                                            className={clsx(
                                                "group flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-all",
                                                entry.selected
                                                    ? "bg-blue-500/10 border-blue-500/30"
                                                    : "bg-white/[0.02] border-white/5 hover:border-white/10"
                                            )}
                                        >
                                            <div className={clsx(
                                                "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                                                entry.selected ? "bg-blue-500 border-blue-500" : "bg-white/5 border-white/10"
                                            )}>
                                                {entry.selected && <Check className="w-3.5 h-3.5 text-white stroke-[3px]" />}
                                            </div>
                                            <div className="p-2 bg-white/5 rounded-lg group-hover:bg-white/10 transition-colors">
                                                <Play className="w-4 h-4 text-muted-foreground fill-current" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-white truncate">{entry.title}</p>
                                                <p className="text-[10px] text-muted-foreground font-mono">{formatDuration(entry.duration)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-4 pt-4 border-t border-white/5">
                                <div className="flex bg-white/5 p-1 rounded-xl">
                                    <button
                                        onClick={() => setAudioOnly(false)}
                                        className={clsx(
                                            "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all",
                                            !audioOnly ? "bg-blue-600 text-white shadow-lg" : "text-muted-foreground hover:text-white"
                                        )}
                                    >
                                        <Video className="w-4 h-4" />
                                        {t.batch.videoMode}
                                    </button>
                                    <button
                                        onClick={() => setAudioOnly(true)}
                                        className={clsx(
                                            "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all",
                                            audioOnly ? "bg-indigo-600 text-white shadow-lg" : "text-muted-foreground hover:text-white"
                                        )}
                                    >
                                        <Music className="w-4 h-4" />
                                        {t.batch.audioMode}
                                    </button>
                                </div>
                                <button
                                    onClick={handleBatchAdd}
                                    disabled={entries.filter(e => e.selected).length === 0}
                                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {t.batch.startBtn.replace('{count}', entries.filter(e => e.selected).length.toString())}
                                </button>
                            </div>
                        </div>
                    ) : status === 'adding' || status === 'success' ? (
                        <div className="py-12 text-center space-y-6">
                            <div className={clsx(
                                "inline-flex p-6 rounded-full transition-all duration-500 scale-125",
                                status === 'success' ? "bg-green-500/20" : "bg-blue-500/20"
                            )}>
                                {status === 'success' ? (
                                    <CheckCircle2 className="w-16 h-16 text-green-400 animate-in zoom-in duration-500" />
                                ) : (
                                    <Loader2 className="w-16 h-16 text-blue-400 animate-spin" />
                                )}
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-xl font-bold text-white">
                                    {status === 'success' ? t.batch.successTitle : t.batch.addingTitle}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {status === 'success' ? t.batch.successSub : t.batch.addingSub}
                                </p>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="p-4 bg-white/[0.01] border-t border-white/5 text-center shrink-0">
                    <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest font-bold">
                        DoulGet Smart Batch Engine v1.4.0
                    </p>
                </div>
            </div>
        </div>
    );
}
