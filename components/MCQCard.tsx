

import React, { useState } from 'react';
import type { MCQCard } from '../types';
import { formatComparatorsForOutput, escapeHtml } from '../services/comparatorGuard';
import { CheckIcon, BookOpenIcon, LightbulbIcon, TagIcon } from './Icons';

// Reusing markdown rendering logic (simplified)
const MarkdownRenderer: React.FC<{ text: string, className?: string }> = ({ text, className = "" }) => {
    if (!text) return null;
    
    // Simple formatting: bold, italic, and handling bullet points
    let html = escapeHtml(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br />');

    // Handle bullet points roughly if not using a full parser
    html = html.replace(/<br \/>\s*(-|\*)\s+/g, '<br />• ');

    return <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
};

export const MCQCardView: React.FC<{ card: MCQCard, index: number }> = ({ card, index }) => {
    const [isFlipped, setIsFlipped] = useState(false);

    const getDifficultyColor = (tag: string) => {
        const lowerTag = tag?.toLowerCase().trim() || '';
        if (lowerTag.includes('rất khó')) return 'bg-purple-50 text-purple-700 border-purple-200';
        if (lowerTag.includes('khó')) return 'bg-red-50 text-red-700 border-red-200';
        if (lowerTag.includes('trung bình')) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
        return 'bg-green-50 text-green-700 border-green-200'; // Default Dễ
    };

    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-all">
            <div className="p-5">
                <div className="flex justify-between items-start gap-4 mb-3">
                    <span className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                        {index + 1}
                    </span>
                    <div className="flex-grow">
                        <MarkdownRenderer text={card.front} className="text-slate-800 dark:text-slate-200 text-base font-medium" />
                    </div>
                    <span className={`flex-shrink-0 px-2 py-1 rounded text-xs font-semibold border ${getDifficultyColor(card.difficultyTag)}`}>
                        {card.difficultyTag}
                    </span>
                </div>

                {/* Options area - if the front text explicitly has options, we rely on MarkdownRenderer. 
                    If options were parsed into an array (future proofing), we could render them here. 
                    For now, assuming options are in 'front'. */}

                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
                    <button 
                        onClick={() => setIsFlipped(!isFlipped)}
                        className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
                    >
                        {isFlipped ? "Ẩn đáp án" : "Xem đáp án & Giải thích"}
                    </button>
                    <span className="text-xs text-slate-400 font-mono">{card.questionCategory}</span>
                </div>
            </div>

            {isFlipped && (
                <div className="bg-slate-50 dark:bg-slate-700/30 p-5 border-t border-slate-200 dark:border-slate-700 animate-fadeIn">
                    <div className="flex items-center gap-2 mb-3">
                        <CheckIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">Đáp án đúng: {card.correctOption}</span>
                    </div>
                    
                    <div className="mb-4">
                        <h4 className="text-xs font-bold uppercase text-slate-500 mb-1">Giải thích</h4>
                        <MarkdownRenderer text={card.explanation} className="text-sm text-slate-700 dark:text-slate-300" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {card.originalQuote && (
                            <div className="bg-white dark:bg-slate-800 p-3 rounded border border-slate-200 dark:border-slate-600">
                                <div className="flex items-center gap-2 mb-1 text-xs font-bold text-blue-600 dark:text-blue-400">
                                    <BookOpenIcon className="h-3 w-3" />
                                    BẰNG CHỨNG (QUOTE)
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 italic">"{card.originalQuote}"</p>
                                <p className="text-[10px] text-right text-slate-400 mt-1">— {card.sourceHeading}</p>
                            </div>
                        )}
                        {card.hint && (
                            <div className="bg-white dark:bg-slate-800 p-3 rounded border border-slate-200 dark:border-slate-600">
                                <div className="flex items-center gap-2 mb-1 text-xs font-bold text-amber-600 dark:text-amber-400">
                                    <LightbulbIcon className="h-3 w-3" />
                                    GỢI Ý
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400">{card.hint}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};