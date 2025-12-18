
import React, { useState, useMemo } from 'react';
import type { ReviewableFlashcard } from '../types';
import { Flashcard } from './Flashcard';

interface ReviewSessionProps {
  sessionCards: ReviewableFlashcard[];
  onUpdateCard: (cardId: string, quality: number) => void;
  onEndSession: () => void;
}

const renderClozeText = (text: string) => {
    // Regex matches {{c1::Answer::Hint}} or {{c1::Answer}} handling multiline content
    const parts = text.split(/({{c\d+::[\s\S]*?}})/g);
    return (
        <div className="text-2xl text-slate-800 dark:text-slate-200 leading-relaxed text-center whitespace-pre-wrap">
            {parts.map((part, index) => {
                const match = part.match(/{{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?}}/);
                if (match) {
                    const hint = match[3];
                    return (
                        <span key={index} className="px-2 py-1 bg-amber-200 dark:bg-amber-400/20 text-amber-900 dark:text-amber-200 font-bold rounded-md border border-amber-400 dark:border-amber-500/30 inline-flex items-center mx-1">
                           <span>[...]</span>
                           {hint && <span className="ml-2 text-sm text-amber-800 dark:text-amber-300 font-normal italic">({hint})</span>}
                        </span>
                    );
                }
                return part;
            })}
        </div>
    );
};

export const ReviewSession: React.FC<ReviewSessionProps> = ({ sessionCards, onUpdateCard, onEndSession }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isAnswerVisible, setIsAnswerVisible] = useState(false);
    
    const shuffledCards = useMemo(() => [...sessionCards].sort(() => Math.random() - 0.5), [sessionCards]);

    const currentCard = shuffledCards[currentIndex];
    const progressPercentage = (currentIndex / shuffledCards.length) * 100;

    const handleSelectQuality = (quality: number) => {
        onUpdateCard(currentCard.id, quality);
        if (currentIndex + 1 < shuffledCards.length) {
            setIsAnswerVisible(false);
            setCurrentIndex(currentIndex + 1);
        } else {
            onEndSession();
        }
    };

    if (!currentCard) {
        return (
             <div className="fixed inset-0 bg-slate-900 bg-opacity-80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                <div className="bg-white dark:bg-slate-800 rounded-lg p-8 shadow-2xl text-center max-w-sm w-full">
                    <h2 className="text-2xl font-bold mb-4 text-slate-800 dark:text-slate-100">Hoàn thành!</h2>
                    <p className="mb-6 text-slate-600 dark:text-slate-300">Bạn đã ôn tập xong các thẻ cho hôm nay. Hãy quay lại vào ngày mai!</p>
                    <button onClick={onEndSession} className="px-6 py-2 bg-sky-600 text-white rounded-lg font-semibold hover:bg-sky-700 transition-colors">
                        Đóng
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-slate-100 dark:bg-slate-900 z-50 flex flex-col p-4 md:p-8">
            <div className="flex-shrink-0 mb-4">
                 <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-lg text-slate-800 dark:text-slate-200">Ôn tập</span>
                    <span className="text-sm font-mono text-slate-500 dark:text-slate-400">{currentIndex + 1} / {shuffledCards.length}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div className="bg-sky-500 h-2 rounded-full transition-all duration-300 ease-in-out" style={{ width: `${progressPercentage}%` }}></div>
                </div>
            </div>
            
            <div className="flex-grow flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto">
                {!isAnswerVisible ? (
                    <div className="w-full max-w-4xl">
                        {renderClozeText(currentCard.clozeText)}
                    </div>
                ) : (
                    <div className="w-full max-w-4xl">
                        <Flashcard card={currentCard} index={currentIndex} allCards={shuffledCards} />
                    </div>
                )}
            </div>
            
            <div className="flex-shrink-0 mt-6">
                {!isAnswerVisible ? (
                    <button 
                        onClick={() => setIsAnswerVisible(true)}
                        className="w-full py-3 px-4 rounded-lg shadow-sm text-lg font-bold text-white bg-sky-600 hover:bg-sky-700 focus:outline-none transition-transform transform hover:scale-105"
                    >
                        Hiển thị đáp án
                    </button>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <button onClick={() => handleSelectQuality(1)} className="py-3 px-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-transform transform hover:scale-105">Làm lại <span className="block text-xs font-normal opacity-80">(Ngày mai)</span></button>
                        <button onClick={() => handleSelectQuality(3)} className="py-3 px-2 rounded-lg text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 transition-transform transform hover:scale-105">Khó <span className="block text-xs font-normal opacity-80">(~{Math.max(currentCard.interval, 1)} ngày)</span></button>
                        <button onClick={() => handleSelectQuality(4)} className="py-3 px-2 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-transform transform hover:scale-105">Tốt <span className="block text-xs font-normal opacity-80">(~{Math.ceil((Math.max(currentCard.interval, 1)) * currentCard.easeFactor)} ngày)</span></button>
                        <button onClick={() => handleSelectQuality(5)} className="py-3 px-2 rounded-lg text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 transition-transform transform hover:scale-105">Dễ <span className="block text-xs font-normal opacity-80">(~{Math.ceil((Math.max(currentCard.interval, 1)) * (currentCard.easeFactor + 0.15))} ngày)</span></button>
                    </div>
                )}
                 <button onClick={onEndSession} className="w-full mt-3 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                    Kết thúc
                </button>
            </div>
        </div>
    );
};