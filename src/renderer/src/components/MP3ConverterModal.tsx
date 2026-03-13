import { X, FileVideo, Music, CheckCircle2, AlertCircle, Loader2, ArrowRight, Minimize2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../utils/i18n';

type MP3ConverterModalProps = {
    isOpen: boolean;
    onClose: () => void;
    isMinimized?: boolean;
    onMinimize?: () => void;
    onReportState?: (state: { status: string; progress: number }) => void;
};

export function MP3ConverterModal({ isOpen, onClose, isMinimized, onMinimize, onReportState }: MP3ConverterModalProps) {
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'converting' | 'success' | 'error'>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [resultPath, setResultPath] = useState<string | null>(null);
    const { t } = useTranslation();

    useEffect(() => {
        if (!isOpen && !isMinimized) {
            // Reset state ONLY if not open AND not minimized (completely closed)
            setStatus('idle');
            setSelectedPath(null);
            setProgress(0);
            setError(null);
            setResultPath(null);
        }
    }, [isOpen, isMinimized]);

    useEffect(() => {
        // Setup listener for conversion progress (persistent if minimized)
        const removeListener = window.api.onConversionProgress((_event, data: any) => {
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

    const handleConvert = async () => {
        if (!selectedPath) return;

        setStatus('converting');
        setProgress(0);
        setError(null);

        try {
            const result = await window.api.localConvertVideoToMp3(selectedPath);
            if (result.success) {
                setStatus('success');
                setResultPath(result.path);
            }
        } catch (e: any) {
            console.error('Conversion failed:', e);
            setStatus('error');
            setError(e.message || t.converter.failed);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <Music className="w-5 h-5 text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">{t.converter.title}</h2>
                            <p className="text-xs text-muted-foreground">{t.converter.subtitle}</p>
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
                                        ? "border-indigo-500/50 bg-indigo-500/5"
                                        : "border-white/10 hover:border-indigo-500/30 hover:bg-white/[0.02]"
                                )}
                            >
                                <div className={clsx(
                                    "p-4 rounded-full transition-transform group-hover:scale-110",
                                    selectedPath ? "bg-indigo-500/20" : "bg-white/5"
                                )}>
                                    <FileVideo className={clsx("w-8 h-8", selectedPath ? "text-indigo-400" : "text-muted-foreground")} />
                                </div>
                                <div className="text-center px-4">
                                    <p className="text-sm font-medium text-white mb-1">
                                        {selectedPath ? t.converter.videoSelected : t.converter.chooseVideo}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                                        {selectedPath ? selectedPath : "MP4, MKV, AVI, MOV..."}
                                    </p>
                                </div>
                            </button>

                            {selectedPath && (
                                <button
                                    onClick={handleConvert}
                                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98]"
                                >
                                    {t.converter.startBtn}
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}

                    {status === 'converting' && (
                        <div className="py-8 text-center space-y-6">
                            <div className="relative inline-block">
                                <Loader2 className="w-16 h-16 text-indigo-500 animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-indigo-300">
                                    {progress}%
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-lg font-medium text-white">{t.converter.converting}</h3>
                                <p className="text-sm text-muted-foreground">{t.converter.convertingSub}</p>
                            </div>
                            <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                                <div
                                    className="bg-indigo-500 h-full transition-all duration-300 transition-timing-ease"
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
                                <h3 className="text-xl font-bold text-white">{t.converter.success}</h3>
                                <p className="text-sm text-muted-foreground">{t.converter.successSub}</p>
                            </div>
                            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-xs text-muted-foreground break-all font-mono">
                                {resultPath}
                            </div>
                            <button
                                onClick={() => setStatus('idle')}
                                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-medium transition-colors"
                            >
                                {t.converter.anotherBtn}
                            </button>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="py-6 text-center space-y-6 animate-in shake duration-300">
                            <div className="inline-flex p-4 bg-destructive/20 rounded-full">
                                <AlertCircle className="w-12 h-12 text-destructive" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-xl font-bold text-white">{t.converter.error}</h3>
                                <p className="text-sm text-muted-foreground font-mono">{error}</p>
                            </div>
                            <button
                                onClick={() => setStatus('idle')}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition-colors"
                            >
                                {t.converter.retryBtn}
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-white/[0.01] border-t border-white/5 text-center">
                    <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest font-bold">
                        DoulGet Multimedia Engine
                    </p>
                </div>
            </div>
        </div>
    );
}
