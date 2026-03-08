import { useState } from 'react'
import { Star, X, Send, MessageSquare } from 'lucide-react'
import { useTranslation } from '../utils/i18n'

interface FeedbackModalProps {
    isOpen: boolean
    onClose: () => void
}

export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
    const [rating, setRating] = useState(0)
    const [hoverRating, setHoverRating] = useState(0)
    const [comment, setComment] = useState('')
    const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const { t } = useTranslation()

    if (!isOpen) return null

    const handleSubmit = async () => {
        if (rating === 0) return
        setStatus('sending')
        setErrorMessage(null)
        try {
            const res = await window.api.submitFeedback(rating, comment)
            if (res.success) {
                setStatus('success')
                setTimeout(() => {
                    onClose()
                    setRating(0)
                    setComment('')
                    setStatus('idle')
                }, 2000)
            } else {
                setStatus('error')
                setErrorMessage(res.error || null)
            }
        } catch (e: any) {
            setStatus('error')
            setErrorMessage(e.message || null)
        }
    }

    const ratingLabels = ['', t.feedback.bad, t.feedback.okay, t.feedback.good, t.feedback.veryGood, t.feedback.excellent]

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-[#0f1729] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                {/* Header */}
                <div className="relative bg-gradient-to-r from-blue-900/40 to-purple-900/40 p-6 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-white">{t.feedback.title}</h2>
                            <p className="text-xs text-white/50">{t.feedback.subtitle}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-5">
                    {status === 'success' ? (
                        <div className="text-center py-6 space-y-3">
                            <div className="text-4xl">🎉</div>
                            <p className="text-white font-semibold">{t.feedback.thankYou}</p>
                            <p className="text-white/50 text-sm">{t.feedback.thankYouSub}</p>
                        </div>
                    ) : (
                        <>
                            {/* Stars */}
                            <div className="flex flex-col items-center gap-3">
                                <div className="flex gap-2">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                            key={star}
                                            onMouseEnter={() => setHoverRating(star)}
                                            onMouseLeave={() => setHoverRating(0)}
                                            onClick={() => setRating(star)}
                                            className="transition-transform hover:scale-110"
                                        >
                                            <Star
                                                className={`w-9 h-9 transition-colors ${star <= (hoverRating || rating)
                                                    ? 'text-yellow-400 fill-yellow-400'
                                                    : 'text-white/20'
                                                    }`}
                                            />
                                        </button>
                                    ))}
                                </div>
                                {(hoverRating || rating) > 0 && (
                                    <span className="text-xs font-semibold text-yellow-400">
                                        {ratingLabels[hoverRating || rating]}
                                    </span>
                                )}
                            </div>

                            {/* Comment */}
                            <div className="space-y-1.5">
                                <label className="flex items-center gap-1.5 text-xs font-medium text-white/60">
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    {t.feedback.commentLabel}
                                </label>
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder={t.feedback.commentPlaceholder}
                                    rows={3}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                                />
                            </div>

                            {status === 'error' && (
                                <div className="text-center space-y-1">
                                    <p className="text-xs text-red-400">
                                        {t.feedback.sendError}
                                    </p>
                                    {errorMessage && (
                                        <p className="text-[10px] text-red-400/60 font-mono">
                                            {errorMessage}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={onClose}
                                    className="flex-1 py-2.5 rounded-xl text-xs font-medium text-white/40 border border-white/10 hover:bg-white/5 transition-colors"
                                >
                                    {t.feedback.later}
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={rating === 0 || status === 'sending'}
                                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                >
                                    {status === 'sending' ? (
                                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <Send className="w-3.5 h-3.5" />
                                            {t.feedback.send}
                                        </>
                                    )}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
