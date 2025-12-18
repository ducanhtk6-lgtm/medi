
import React from 'react';
import type { EssayTopic, ReviewHistoryItem } from '../types';
import { XIcon, BrainCircuitIcon } from './Icons';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  topic: EssayTopic;
  history: ReviewHistoryItem[];
}

const ratingMap: { [key: number]: { text: string; className: string } } = {
  0: { text: 'Quên sạch', className: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' },
  1: { text: 'Nhớ mơ hồ', className: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' },
  2: { text: 'Nhớ được', className: 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200' },
  3: { text: 'Nhớ chắc', className: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200' },
};

export const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose, topic, history }) => {
  if (!isOpen) return null;
  
  const sortedHistory = [...history].sort((a, b) => new Date(b.review_date).getTime() - new Date(a.review_date).getTime());

  return (
    <div 
      className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex justify-center items-start p-4 pt-16 transition-opacity duration-300 animate-fadeIn"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div 
        className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-slate-200 dark:border-slate-700 animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-5 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Lịch sử ôn tập</h2>
            <p className="text-sm text-sky-600 dark:text-sky-400 font-semibold">{topic.title}</p>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label="Đóng"
          >
            <XIcon className="h-6 w-6" />
          </button>
        </div>
        <div className="overflow-y-auto p-6">
          {sortedHistory.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-100 dark:bg-slate-700/50 text-xs uppercase text-slate-700 dark:text-slate-400">
                  <tr>
                    <th className="p-3">Ngày ôn tập</th>
                    <th className="p-3 text-center">Rating</th>
                    <th className="p-3">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHistory.map((item, index) => (
                    <tr key={index} className="border-b dark:border-slate-800 bg-white dark:bg-slate-800/50">
                      <td className="p-3 font-medium text-slate-900 dark:text-slate-100">{item.review_date}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ratingMap[item.rating]?.className ?? ''}`}>
                            {ratingMap[item.rating]?.text ?? 'Không xác định'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-500 dark:text-slate-400">{item.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center p-10 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/20">
              <BrainCircuitIcon className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
              <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">Chưa có lịch sử</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Hãy bắt đầu một buổi luyện tập cho chủ đề này để xem lịch sử tại đây.
              </p>
            </div>
          )}
        </div>
      </div>
       <style>{`
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes scaleIn { from { transform: scale(0.95) translateY(-20px); } to { transform: scale(1) translateY(0); } }
          .animate-fadeIn { animation: fadeIn 0.2s ease-out forwards; }
          .animate-scaleIn { animation: scaleIn 0.2s ease-out forwards; }
       `}</style>
    </div>
  );
};
