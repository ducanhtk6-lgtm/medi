
import React from 'react';
import type { ReviewableFlashcard } from '../types';
import { BrainCircuitIcon } from './Icons';

interface ReviewPanelProps {
  deck: ReviewableFlashcard[];
  onStartReview: () => void;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({ deck, onStartReview }) => {
  
  const getTodayString = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toISOString().split('T')[0];
  }

  const dueTodayCount = deck.filter(card => card.dueDate <= getTodayString()).length;
  const totalCards = deck.length;

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 min-h-[500px] flex flex-col justify-center items-center text-center">
      <BrainCircuitIcon className="h-16 w-16 text-sky-500 dark:text-sky-400 mb-4" />
      <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">Bộ thẻ ôn tập</h2>
      <p className="text-slate-600 dark:text-slate-400 mb-8 max-w-md">
        Áp dụng phương pháp lặp lại ngắt quãng (Spaced Repetition) để củng cố kiến thức và ghi nhớ lâu dài.
      </p>

      <div className="grid grid-cols-2 gap-4 w-full max-w-sm mb-8">
        <div className="bg-slate-100 dark:bg-slate-700/50 p-4 rounded-lg">
          <p className="text-4xl font-extrabold text-sky-600 dark:text-sky-400">{totalCards}</p>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-300">Tổng số thẻ</p>
        </div>
        <div className="bg-slate-100 dark:bg-slate-700/50 p-4 rounded-lg">
          <p className={`text-4xl font-extrabold ${dueTodayCount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}`}>
            {dueTodayCount}
          </p>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-300">Thẻ cần ôn</p>
        </div>
      </div>
      
      <button
        onClick={onStartReview}
        disabled={dueTodayCount === 0}
        className="w-full max-w-sm flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-lg text-base font-bold text-white bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800 focus:ring-sky-500 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105"
      >
        {dueTodayCount > 0 ? `Bắt đầu ôn tập (${dueTodayCount} thẻ)` : 'Không có thẻ nào cần ôn hôm nay'}
      </button>
       <button
        onClick={() => { if(window.confirm('Bạn có chắc muốn xoá toàn bộ bộ thẻ? Hành động này không thể hoàn tác.')) { localStorage.removeItem('anki-deck'); window.location.reload(); } }}
        className="mt-4 text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
       >
        Xoá bộ thẻ
       </button>
    </div>
  );
};