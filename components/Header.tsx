import React, { useState } from 'react';
import { BrainCircuitIcon } from './Icons';
import { ChangelogModal, changelogData } from './ChangelogModal';

export const Header: React.FC = () => {
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const latestVersion = changelogData[0]?.version || 'v1.7';

  return (
    <>
      <header className="sticky top-0 z-40 w-full backdrop-blur flex-none transition-colors duration-500 lg:z-50 lg:border-b lg:border-slate-900/10 dark:border-slate-50/[0.06] bg-white/80 dark:bg-slate-900/80">
        <div className="container mx-auto px-4 py-4 md:px-6 flex items-center justify-center text-center relative">
          <BrainCircuitIcon className="h-8 w-8 text-blue-600 dark:text-blue-400 mr-3" />
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">
            AI Medical Anki Cloze Generator
          </h1>
          <button
            onClick={() => setIsChangelogOpen(true)}
            className="ml-3 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-100 dark:text-blue-200 dark:bg-blue-500/20 rounded-full hover:bg-blue-200 dark:hover:bg-blue-500/30 transition-colors"
            aria-label="Xem lịch sử cập nhật"
            title="Xem lịch sử cập nhật"
          >
            {latestVersion}
          </button>
        </div>
      </header>
      <ChangelogModal isOpen={isChangelogOpen} onClose={() => setIsChangelogOpen(false)} />
    </>
  );
};