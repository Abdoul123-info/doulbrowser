import { X, FileVideo, Minimize2, CheckCircle2, AlertCircle, Loader2, ArrowRight, Share2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../utils/i18n';

type VideoCompressorModalProps = {
    isOpen: boolean;
    onClose: () => void;
    isMinimized?: boolean;
    onMinimize?: () => void;
    onReportState?: (state: { status: string; progress: number }) => void;
};

type CompressionQuality = 'low' | 'medium' | 'whatsapp';

export function VideoCompressorModal({ isOpen, onClose, isMinimized, onMinimize, onReportState }: VideoCompressorModalProps) {
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'compressing' | 'success' | 'error'>('idle');
    const [quality, setQuality] = useState<CompressionQuality>('whatsapp');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [resultName, setResultName] = useState<string | null>(null);
    const { t } = useTranslation();

    useEffect(() => {
        if (!isOpen && !isMinimized) {
            setStatus('idle');
            setSelectedPath(null);
            setProgress(0);
            setError(null);
            setResultName(null);
        }
    }, [isOpen, isMinimized]);

    useEffect(() => {
        const removeListener = window.api.onCompressionProgress((_event, data: any) => {
            setProgress(data.progress);
        });
        return () => {
            if (typeof removeListener === 'function') removeListener();
        };
    }, []);

    // Report state to parent for BackgroundTasks pill
    useEffect(() => {
        if (onReportState) {
            let reportedStatus = 'active';
            if (status === 'idle') reportedStatus = 'idle';
            else if (status === 'success') reportedStatus = 'success';
            else if (status === 'error') reportedStatus = 'error';

            onReportState({
                status: reportedStatus,
                progress
            });
        }
    }, [status, progress, onReportState]);

    const handleSelectFile = async () => {
        try {
            const path = await window.api.selectLocalVideo();
            if (path) {
                setSelectedPath(path);
                setStatus('idle');
                setError(null);
            }
        } catch (e) {
            console.error('File selection failed:', e);
        }
    };

    const handleCompress = async () => {
        if (!selectedPath) return;

        setStatus('compressing');
        setProgress(0);
        setError(null);

        try {
            const result = await window.api.localCompressVideo(selectedPath, quality);
            if (result.success) {
                setStatus('success');
                setResultName(result.filename);
            }
        } catch (e: any) {
            console.error('Compression failed:', e);
            setStatus('error');
            setError(e.message || t.compressor.failed);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-pink-500/20 rounded-lg">
                            <Minimize2 className="w-5 h-5 text-pink-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">{t.compressor.title}</h2>
                            <p className="text-xs text-muted-foreground">{t.compressor.subtitle}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {onMinimize && (
                            <button onClick={onMinimize} className="p-2 hover:bg-white/5 rounded-full transition-colors text-muted-foreground hover:text-white" title="Réduire">
                                <Minimize2 className="w-4 h-4" />
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                            <X className="w-5 h-5 text-muted-foreground" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-8 space-y-6">
                    {status === 'idle' && (
                        <div className="space-y-6">
                            <button
                                onClick={handleSelectFile}
                                className={clsx(
                                    "w-full aspect-video border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-4 transition-all group",
                                    selectedPath
                                        ? "border-pink-500/50 bg-pink-500/5"
                                        : "border-white/10 hover:border-pink-500/30 hover:bg-white/[0.02]"
                                )}
                            >
                                <div className={clsx(
                                    "p-4 rounded-full transition-transform group-hover:scale-110",
                                    selectedPath ? "bg-pink-500/20" : "bg-white/5"
                                )}>
                                    <FileVideo className={clsx("w-8 h-8", selectedPath ? "text-pink-400" : "text-muted-foreground")} />
                                </div>
                                <div className="text-center px-4">
                                    <p className="text-sm font-medium text-white mb-1">
                                        {selectedPath ? t.compressor.videoSelected : t.compressor.chooseVideo}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                                        {selectedPath ? selectedPath : "MP4, MKV, AVI, MOV..."}
                                    </p>
                                </div>
                            </button>

                            {selectedPath && (
                                <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-300">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t.compressor.qualityLabel}</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { id: 'low', label: t.compressor.qLow, desc: t.compressor.qLowDesc },
                                                { id: 'medium', label: t.compressor.qMed, desc: t.compressor.qMedDesc },
                                                { id: 'whatsapp', label: t.compressor.qWhatsapp, desc: t.compressor.qWhatsappDesc }
                                            ].map((q) => (
                                                <button
                                                    key={q.id}
                                                    onClick={() => setQuality(q.id as CompressionQuality)}
                                                    className={clsx(
                                                        "flex flex-col items-center justify-center p-3 rounded-xl border transition-all",
                                                        quality === q.id
                                                            ? "bg-pink-500/20 border-pink-500/50 text-pink-300"
                                                            : "bg-white/5 border-white/5 text-muted-foreground hover:bg-white/10"
                                                    )}
                                                >
                                                    <span className="text-sm font-bold">{q.label}</span>
                                                    <span className="text-[10px] opacity-60">{q.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleCompress}
                                        className="w-full py-4 bg-pink-600 hover:bg-pink-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-pink-600/20 transition-all active:scale-[0.98]"
                                    >
                                        {t.compressor.startBtn}
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {status === 'compressing' && (
                        <div className="py-8 text-center space-y-6">
                            <div className="relative inline-block">
                                <Loader2 className="w-16 h-16 text-pink-500 animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-pink-300">
                                    {progress}%
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-lg font-medium text-white">{t.compressor.compressing}</h3>
                                <p className="text-sm text-muted-foreground">{t.compressor.compressingSub}</p>
                            </div>
                            <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                                <div
                                    className="bg-pink-500 h-full transition-all duration-300 transition-timing-ease"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="py-6 text-center space-y-6 animate-in zoom-in duration-300">
                            <div className="inline-flex p-4 bg-green-500/20 rounded-full">
                                <CheckCircle2 className="w-12 h-12 text-green-400" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-xl font-bold text-white">{t.compressor.success}</h3>
                                <p className="text-sm text-muted-foreground">{t.compressor.successSub}</p>
                            </div>
                            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl">
                                <div className="flex items-center gap-3 text-left">
                                    <div className="p-2 bg-pink-500/10 rounded-lg">
                                        <Share2 className="w-4 h-4 text-pink-400" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white truncate">{resultName}</p>
                                        <p className="text-[10px] text-muted-foreground truncate font-mono">{t.compressor.saveLocation}</p>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setStatus('idle')}
                                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-medium transition-colors"
                            >
                                {t.compressor.anotherBtn}
                            </button>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="py-6 text-center space-y-6 animate-in shake duration-300">
                            <div className="inline-flex p-4 bg-destructive/20 rounded-full">
                                <AlertCircle className="w-12 h-12 text-destructive" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-xl font-bold text-white">{t.compressor.error}</h3>
                                <p className="text-sm text-muted-foreground font-mono">{error}</p>
                            </div>
                            <button
                                onClick={() => setStatus('idle')}
                                className="w-full py-3 bg-pink-600 hover:bg-pink-500 text-white rounded-xl text-sm font-bold transition-colors"
                            >
                                {t.compressor.retryBtn}
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-white/[0.01] border-t border-white/5 text-center">
                    <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest font-bold">
                        Powered by DoulGet UltraCompressor
                    </p>
                </div>
            </div>
        </div>
    );
}
