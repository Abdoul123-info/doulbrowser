import { Music, Minimize2, ListTodo, Maximize2, X, Loader2 } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

type TaskType = 'converter' | 'compressor' | 'batch';

interface BackgroundTask {
    id: TaskType;
    title: string;
    progress: number;
    status: 'active' | 'success' | 'error';
}

interface BackgroundTasksProps {
    tasks: BackgroundTask[];
    onRestore: (type: TaskType) => void;
    onClose: (type: TaskType) => void;
}

export function BackgroundTasks({ tasks, onRestore, onClose }: BackgroundTasksProps) {
    const { t } = useTranslation();

    if (tasks.length === 0) return null;

    const getIcon = (type: TaskType) => {
        switch (type) {
            case 'converter': return <Music className="w-4 h-4 text-indigo-400" />;
            case 'compressor': return <Minimize2 className="w-4 h-4 text-pink-400" />;
            case 'batch': return <ListTodo className="w-4 h-4 text-blue-400" />;
        }
    };

    const getLabel = (type: TaskType) => {
        switch (type) {
            case 'converter': return t.sidebarExtra.converter;
            case 'compressor': return t.sidebarExtra.compressor;
            case 'batch': return t.sidebarExtra.batch;
        }
    };

    return (
        <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-40">
            {tasks.map((task) => (
                <div
                    key={task.id}
                    className="w-64 bg-[#1e293b]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-right-4 duration-300"
                >
                    <div className="p-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="p-1.5 bg-white/5 rounded-lg flex-shrink-0">
                                {getIcon(task.id)}
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-bold text-white truncate leading-tight">
                                    {getLabel(task.id)}
                                </p>
                                <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-mono">
                                    {task.status === 'active' ? `${task.progress}%` : task.status}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => onRestore(task.id)}
                                className="p-1.5 hover:bg-white/10 rounded-lg text-muted-foreground hover:text-white transition-colors"
                                title="Agrandir"
                            >
                                <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => onClose(task.id)}
                                className="p-1.5 hover:bg-white/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
                                title="Fermer"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-1 w-full bg-white/5">
                        <div
                            className={`h-full transition-all duration-300 ${task.status === 'success' ? 'bg-green-500' :
                                    task.status === 'error' ? 'bg-destructive' :
                                        'bg-blue-500'
                                }`}
                            style={{ width: `${task.progress}%` }}
                        />
                    </div>

                    {task.status === 'active' && (
                        <div className="absolute top-0 right-0 p-1">
                            <Loader2 className="w-2 h-2 text-blue-400 animate-spin opacity-50" />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
