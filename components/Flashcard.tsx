import React, { useState } from 'react';
import type { FlashcardData } from '../types';
import { CheckIcon, ClipboardIcon, SparklesIcon, BookOpenIcon, LinkIcon, TagIcon } from './Icons';
import { formatComparatorsForOutput, escapeHtml } from '../services/comparatorGuard';

// Helper function to make cloze text more readable in previews
const cleanClozeText = (text: string): string => {
  return text
    .replace(/{{c\d+::([\s\S]*?)::[\s\S]*?}}/g, '[...$1...]')
    .replace(/{{c\d+::([\s\S]*?)}}/g, '[...$1...]');
};

// Function to render cloze text with highlighting and hints
const renderClozeText = (text: string) => {
    const parts = text.split(/({{c\d+::[\s\S]*?}})/g);
    return (
        <p className="text-lg text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
            {parts.map((part, index) => {
                const match = part.match(/{{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?}}/);
                if (match) {
                    const hint = match[3];
                    return (
                        <span key={index} className="px-2 py-1 bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 font-bold rounded-md border border-amber-300 dark:border-amber-700/50 inline-flex items-center mx-1">
                           <span>[...]</span>
                           {hint && <span className="ml-2 text-xs text-amber-800 dark:text-amber-400 font-normal italic">({hint})</span>}
                        </span>
                    );
                }
                return part;
            })}
        </p>
    );
};

const HierarchicalContent: React.FC<{ text: string; isQuote?: boolean }> = ({ text, isQuote = false }) => {
    if (!text || !text.trim()) return null;

    let textForParsing = text;
    // Heuristic: If text is a single line and contains bullet-like separators, reformat it by adding newlines.
    if (!textForParsing.includes('\n') && (textForParsing.includes(' - ') || textForParsing.includes(' • ') || textForParsing.includes(' + '))) {
        // This turns "Heading - item1 - item2" into "Heading\n- item1\n- item2".
        textForParsing = textForParsing
            .replace(/\s+-\s+/g, '\n- ')
            .replace(/\s+•\s+/g, '\n• ')
            .replace(/\s+\+\s+/g, '\n+ ');

        // Also handle cases like "Heading:- Item 1"
        textForParsing = textForParsing.replace(/:\s*(-|\*|\+)\s*/g, ':\n$1 ');
    }
    
    // Per request: format for display safety, escape HTML, then apply bold formatting.
    const normalizedForDisplay = formatComparatorsForOutput(textForParsing);
    const safeText = escapeHtml(normalizedForDisplay);
    const textWithBold = safeText.replace(/\*\*(.*?)\*\*/g, '<strong class="not-italic font-semibold text-blue-700 dark:text-blue-400">$1</strong>');
    
    const isStructuredList = /^\s*(-|\*|\+)/m.test(textWithBold) || textWithBold.split('\n').filter(Boolean).length > 1;

    if (isQuote && !isStructuredList) {
        return (
             <blockquote className="italic text-slate-600 dark:text-slate-400">
                "<span dangerouslySetInnerHTML={{ __html: textWithBold }} />"
            </blockquote>
        );
    }
    
    const lines = textWithBold.split('\n');
    let html = '';
    let inList = false;

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        const isListItem = /^\s*(-|\*|\+)\s/.test(line);

        if (isListItem) {
            const indentMatch = line.match(/^(\s*)/);
            const indentLevel = indentMatch ? Math.floor(indentMatch[1].replace(/\t/g, '  ').length / 2) : 0;
            const content = line.replace(/^\s*(-|\*|\+)\s/, '').trim();
            
            if (!inList) {
                html += '<ul class="list-disc pl-5 space-y-1">';
                inList = true;
            }
            if(content) html += `<li style="margin-left: ${indentLevel * 1.5}em;">${content}</li>`;

        } else {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            if (trimmedLine) {
                 const nextNonEmptyLine = lines.slice(index + 1).find(l => l.trim() !== '');
                 const isHeading = trimmedLine.endsWith(':') || 
                                   (nextNonEmptyLine && /^\s*(-|\*|\+)\s/.test(nextNonEmptyLine));

                 if (isHeading) {
                     html += `<p class="font-semibold text-slate-700 dark:text-slate-300 mb-1">${trimmedLine}</p>`;
                 } else {
                     html += `<p>${trimmedLine}</p>`;
                 }
            }
        }
    });

    if (inList) {
        html += '</ul>';
    }
    
    return <div className="text-slate-600 dark:text-slate-400" dangerouslySetInnerHTML={{ __html: html }} />;
};

const CopyButton: React.FC<{ textToCopy: string; className?: string; label?: string }> = ({ textToCopy, className, label = 'Sao chép' }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    if (isCopied) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert('Không thể sao chép văn bản.');
    });
  };

  return (
    <button
      onClick={handleCopy}
      aria-label={label}
      className={`flex-shrink-0 flex items-center px-2 py-1 rounded-md text-xs font-semibold transition-all duration-200 ${
        isCopied
          ? 'bg-teal-100 dark:bg-teal-800 text-teal-700 dark:text-teal-300'
          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
      } ${className}`}
    >
      {isCopied ? (
        <>
          <CheckIcon className="h-3 w-3 mr-1.5" />
          Đã chép
        </>
      ) : (
        <>
          <ClipboardIcon className="h-3 w-3 mr-1.5" />
          {label}
        </>
      )}
    </button>
  );
};

interface FlashcardProps {
  card: FlashcardData;
  index: number;
  allCards?: FlashcardData[];
}

const InfoCard: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }> = ({ icon, title, children, className }) => (
    <div className={`relative p-4 pl-12 rounded-lg ${className}`}>
        <div className="absolute left-4 top-4 text-slate-500 dark:text-slate-400">{icon}</div>
        <strong className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">{title}</strong>
        <div className="text-sm">{children}</div>
    </div>
);

export const Flashcard: React.FC<FlashcardProps> = ({ card, index, allCards }) => {

  const parentCard = allCards && card.parentId
    ? allCards.find(c => c.cardId === card.parentId)
    : null;

  const getBackContentText = (card: FlashcardData): string => {
    const parts = [];
    if (card.extraInfo) {
      parts.push(`🌠 Củng cố & Mở rộng (AI):\n${card.extraInfo}`);
    }
    const formattedQuote = card.originalQuote.replace(/\*\*(.*?)\*\*/g, '$1');
    parts.push(`📷 Nội dung gốc (Core):\n"${formattedQuote}"`);
    if (card.relatedContext && card.relatedContext.length > 0) {
      const relatedContentText = card.relatedContext.map(item => `${item.category}:\n"${item.quote}"`).join('\n\n');
      parts.push(`🌃 Ngữ cảnh liên quan (Trích dẫn gốc):\n${relatedContentText}`);
    }
    return parts.join('\n\n');
  };

  const getMetadataText = (card: FlashcardData): string => {
    const parts = [];
    parts.push(`🏷️ Metadata (Tags)`);
    parts.push(`Đề mục: ${card.sourceHeading}`);
    parts.push(`Nguồn: ${card.sourceLesson}`);
    parts.push(`Phân loại: ${card.questionCategory}`);
    return parts.join('\n');
  };
  
  const getCombinedBackAndMetadataText = (card: FlashcardData): string => {
    const backContent = getBackContentText(card);
    const metadataContent = getMetadataText(card);
    return `${backContent}\n\n${metadataContent}`;
  };

  const displayCloze = card.clozeText; // Already formatted from service

  return (
    <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300 space-y-5 p-5">
      {/* Front Side */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-center gap-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-base font-bold text-white shadow-md">
                {index + 1}
            </span>
            <div className="flex-grow">
                {renderClozeText(displayCloze)}
            </div>
        </div>
        <CopyButton textToCopy={card.clozeText} label="Chép Cloze" />
      </div>

       {parentCard && (
          <InfoCard icon={<LinkIcon className="h-5 w-5" />} title="Liên kết từ thẻ cha" className="bg-slate-100 dark:bg-slate-700/50">
             <div className="text-slate-700 dark:text-slate-300">
                <p className="font-semibold text-blue-600 dark:text-blue-400 mb-1">{parentCard.questionCategory}:</p>
                <HierarchicalContent text={cleanClozeText(parentCard.clozeText)} />
             </div>
          </InfoCard>
        )}
      
      {/* Back Side */}
      <div className="space-y-4">
        <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700 pt-4">
          <h4 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nội dung mặt sau</h4>
           <CopyButton textToCopy={getCombinedBackAndMetadataText(card)} label="Chép toàn bộ" />
        </div>
        
        <div className="space-y-3">
            {card.extraInfo && (
              <InfoCard icon={<SparklesIcon className="h-5 w-5" />} title="Củng cố & Mở rộng (AI)" className="bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800/50">
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{card.extraInfo}</p>
              </InfoCard>
            )}

            <InfoCard icon={<BookOpenIcon className="h-5 w-5" />} title="Nội dung gốc (Core)" className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/50">
                 <HierarchicalContent text={card.originalQuote} isQuote={true} />
            </InfoCard>

            {card.relatedContext && card.relatedContext.length > 0 && (
              <InfoCard icon={<LinkIcon className="h-5 w-5" />} title="Ngữ cảnh liên quan (Trích dẫn gốc)" className="bg-slate-100 dark:bg-slate-700/50">
                <div className="space-y-3">
                  {card.relatedContext.map((item, idx) => (
                    <div key={idx}>
                      <strong className='text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider'>{item.category}</strong>
                      <div className="mt-1">
                          <HierarchicalContent text={item.quote} isQuote={true} />
                      </div>
                    </div>
                  ))}
                </div>
              </InfoCard>
            )}
        </div>
      </div>

      {/* Metadata */}
      <div>
        <div className="flex items-center mb-3 border-t border-slate-200 dark:border-slate-700 pt-4">
            <TagIcon className="h-5 w-5 mr-3 text-slate-400" />
            <h4 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Metadata (Tags)
            </h4>
        </div>
         <div className="flex flex-wrap gap-2 text-sm">
            <span className="bg-slate-200 dark:bg-slate-700 px-3 py-1 rounded-full text-xs font-semibold text-slate-700 dark:text-slate-200">ĐM: {card.sourceHeading}</span>
            <span className="bg-slate-200 dark:bg-slate-700 px-3 py-1 rounded-full text-xs font-semibold text-slate-700 dark:text-slate-200">Nguồn: {card.sourceLesson}</span>
            <span className="bg-slate-200 dark:bg-slate-700 px-3 py-1 rounded-full text-xs font-semibold text-slate-700 dark:text-slate-200">Loại: {card.questionCategory}</span>
        </div>
      </div>

    </div>
  );
};
