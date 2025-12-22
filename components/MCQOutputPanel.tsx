
import React from 'react';
import { MCQCard, MCQGenerationResult } from '../types';
import { MCQCardView } from './MCQCard';
import { DownloadIcon, ShieldCheckIcon, AlertTriangleIcon } from './Icons';

interface MCQOutputPanelProps {
    mcqs: MCQCard[];
    auditReport?: string;
    onExportCSV: () => void;
}

export const MCQOutputPanel: React.FC<MCQOutputPanelProps> = ({ mcqs, auditReport, onExportCSV }) => {
    if (mcqs.length === 0) return null;

    return (
        <div className="mt-8 space-y-6">
            <div className="flex flex-wrap justify-between items-center pb-4 border-b border-slate-200 dark:border-slate-700">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Kết quả MCQ ({mcqs.length})</h2>
                    <p className="text-sm text-slate-500">Đã tạo xong. Vui lòng kiểm tra kỹ trước khi xuất.</p>
                </div>
                <button
                    onClick={onExportCSV}
                    className="flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
                >
                    <DownloadIcon className="h-4 w-4 mr-2" />
                    Xuất Anki CSV
                </button>
            </div>

            {auditReport && (
                <div className="bg-slate-50 dark:bg-slate-800/50 border-l-4 border-indigo-500 rounded-r-lg p-4 shadow-sm">
                    <h3 className="flex items-center text-sm font-bold text-indigo-900 dark:text-indigo-200 mb-2">
                        <ShieldCheckIcon className="h-5 w-5 mr-2" />
                        Báo cáo Thanh tra (Audit Report)
                    </h3>
                    <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                        {auditReport}
                    </div>
                </div>
            )}

            <div className="space-y-4">
                {mcqs.map((card, idx) => (
                    <MCQCardView key={card.id || idx} card={card} index={idx} />
                ))}
            </div>
        </div>
    );
};
