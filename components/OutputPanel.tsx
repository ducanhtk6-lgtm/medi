

import React, { useMemo } from 'react';
import type { FlashcardData } from '../types';
import { Flashcard } from './Flashcard';
import { LoadingSpinner } from './LoadingSpinner';
import { LightbulbIcon, ShieldCheckIcon, DownloadIcon, BrainCircuitIcon, FileTextIcon, AlertTriangleIcon } from './Icons';
import { MindmapPreview } from './MindmapPreview';
import { escapeHtml } from '../services/comparatorGuard';

interface OutputPanelProps {
  flashcards: FlashcardData[];
  isLoading: boolean;
  error: string | null;
  report: string | null;
  onAddToDeck: (cards: FlashcardData[]) => void;
}

const Callout: React.FC<{ type: 'warning' | 'error' | 'info'; title: string; children: React.ReactNode }> = ({ type, title, children }) => {
    const styles = {
        warning: {
            container: 'bg-amber-50 dark:bg-slate-700/50 border-amber-500 dark:border-amber-400 text-amber-900 dark:text-amber-200',
            icon: 'text-amber-600 dark:text-amber-400',
            iconComponent: <AlertTriangleIcon className="h-5 w-5" />
        },
        error: {
            container: 'bg-red-50 dark:bg-red-900/30 border-red-500 text-red-900 dark:text-red-200',
            icon: 'text-red-600 dark:text-red-400',
            iconComponent: <AlertTriangleIcon className="h-5 w-5" /> // Using same icon, different color
        },
        info: {
            container: 'bg-sky-50 dark:bg-sky-700/50 border-sky-500 dark:border-sky-400 text-sky-900 dark:text-sky-200',
            icon: 'text-sky-600 dark:text-sky-400',
            iconComponent: <LightbulbIcon className="h-5 w-5" />
        },
    };
    
    const currentStyle = styles[type];

    return (
        <div className={`p-4 my-4 border-l-4 rounded-r-lg ${currentStyle.container}`}>
            <h4 className={`flex items-center text-base font-bold mb-2`}>
                <span className={`mr-3 flex-shrink-0 ${currentStyle.icon}`}>{currentStyle.iconComponent}</span>
                {title}
            </h4>
            <div className="text-sm text-slate-700 dark:text-slate-300 font-mono text-xs leading-relaxed space-y-2">
                {children}
            </div>
        </div>
    );
};


const FormattedReport: React.FC<{ report: string }> = ({ report }) => {
    const summaryWarnings: React.ReactNode[] = [];
    let processedReport = report;

    // Rule C: Any mismatch / violation (HIGHEST PRIORITY)
    const violationKeywords = ['không trung thực', 'paraphrase', 'đổi đơn vị', 'đổi dấu so sánh', 'vi phạm'];
    const violationRegex = new RegExp(violationKeywords.join('|'), 'gi');
    if (violationRegex.test(report)) {
         summaryWarnings.push(
            <Callout key="violation-err" type="error" title="SAI SÓT TIỀM TÀNG">
                <p>Báo cáo có thể chứa các từ khóa chỉ ra sự vi phạm các quy tắc cốt lõi (ví dụ: "paraphrase", "vi phạm"). Vui lòng xem xét kỹ lưỡng các thẻ được tạo.</p>
            </Callout>
        );
    }

    // Rule A: EXCLUSIVE implications
    if (/mode: "EXCLUSIVE"/i.test(report)) {
        summaryWarnings.push(
            <Callout key="exclusive-warn" type="warning" title="CẢNH BÁO: Chế độ Độc quyền (EXCLUSIVE)">
                <p>Các loại thẻ ngoài danh sách được chọn đã bị vô hiệu hóa. Một số kiến thức phù hợp với loại thẻ khác có thể đã bị bỏ qua.</p>
            </Callout>
        );
    }

    // Rule B: Skips / omissions
    const skippedMatch = report.match(/skippedUnitsCount: (\d+)/i);
    if (skippedMatch && parseInt(skippedMatch[1], 10) > 0) {
        summaryWarnings.push(
            <Callout key="skipped-warn" type="warning" title={`CẢNH BÁO: ${skippedMatch[1]} đơn vị kiến thức bị bỏ qua`}>
                <p>Lý do chính có thể là do Chế độ Độc quyền hoặc các đơn vị này không thỏa mãn điều kiện để tạo thẻ chất lượng cao. Chi tiết được liệt kê trong mục "Phân tích Nội dung đã Bỏ qua".</p>
            </Callout>
        );
        
        // Highlight titles in the skipped section
        const skippedSectionRegex = /(Phân tích Nội dung đã Bỏ qua \(Quan trọng nhất\):)([\s\S]*?)(?=Kiểm tra Chéo và Đối chiếu|Báo cáo Ưu tiên Cloze|$)/;
        processedReport = processedReport.replace(skippedSectionRegex, (match, title, content) => {
            const highlightedContent = content.replace(/(- |• )(.+?:)/g, '$1**$2**');
            return `${title}${highlightedContent}`;
        });
    }

    // Rule D: Weak/uncertain evidence
    const weakEvidenceRegex = /(Possible but weak|không chắc|thiếu discriminator)/gi;
    processedReport = processedReport.replace(weakEvidenceRegex, (match) => `**ℹ️ LƯU Ý:** ${match}`);
    
    // Rule E: Cross-check warnings
    const warningRegex = /CẢNH BÁO:/gi;
    processedReport = processedReport.replace(warningRegex, `**⚠️ CẢNH BÁO:**`);

    // Convert markdown to simple HTML for rendering, ensuring safety
    const safeReport = escapeHtml(processedReport);
    const htmlReport = safeReport
        .split('\n')
        .map(line => line.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-800 dark:text-slate-100">$1</strong>'))
        .join('<br />');

    return (
        <div>
            {summaryWarnings.length > 0 && (
                <div className="mb-4">
                    <h5 className="font-bold text-lg text-slate-800 dark:text-slate-100 border-b border-slate-300 dark:border-slate-600 pb-2 mb-2">Tóm tắt Cảnh báo</h5>
                    {summaryWarnings}
                </div>
            )}
            <div 
                className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono text-xs leading-relaxed" 
                dangerouslySetInnerHTML={{ __html: htmlReport }} 
            />
        </div>
    );
};


export const OutputPanel: React.FC<OutputPanelProps> = ({ flashcards, isLoading, error, report, onAddToDeck }) => {

  const hasHierarchy = useMemo(() => flashcards.some(c => c.cardId), [flashcards]);

  const escapeCSV = (field: string | undefined): string => {
    if (field === undefined || field === null) return '';
    const str = String(field);
    if (/[",\n\r]/.test(str)) {
      const escapedField = str.replace(/"/g, '""');
      return `"${escapedField}"`;
    }
    return str;
  };

  const formatExtraFieldForCSV = (card: FlashcardData): string => {
    const backParts = [];
    if (card.extraInfo) {
      backParts.push(`🌠 Củng cố & Mở rộng (AI):\n${card.extraInfo}`);
    }

    const formattedQuote = card.originalQuote.replace(/\*\*(.*?)\*\*/g, '$1');
    backParts.push(`📷 Nội dung gốc (Core):\n"${formattedQuote}"`);
    
    if (card.relatedContext && card.relatedContext.length > 0) {
      const relatedContentText = card.relatedContext.map(item => `${item.category}:\n"${item.quote}"`).join('\n\n');
      backParts.push(`🌃 Ngữ cảnh liên quan (Trích dẫn gốc):\n${relatedContentText}`);
    }

    const metadataParts = [];
    metadataParts.push(`🏷️ Metadata (Tags)`);
    metadataParts.push(`Đề mục: ${card.sourceHeading}`);
    metadataParts.push(`Nguồn: ${card.sourceLesson}`);
    metadataParts.push(`Phân loại: ${card.questionCategory}`);
    
    const backContent = backParts.join('\n\n');
    const metadataContent = metadataParts.join('\n');
    
    return `${backContent}\n\n${metadataContent}`;
  };

  const sanitizeFilename = (name: string): string => {
    return name.replace(/[^a-z0-9_.\-]/gi, '_').replace(/_+/g, '_');
  };

  const handleExportCSV = () => {
    if (flashcards.length === 0) return;

    const csvRows = flashcards.map(card => {
        const text = escapeCSV(card.clozeText); // Already formatted by geminiService
        const extra = escapeCSV(formatExtraFieldForCSV(card)); // Already formatted
        return `${text},${extra}`;
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });

    const sourceLesson = flashcards[0].sourceLesson || 'Untitled';
    const sourceHeading = flashcards[0].sourceHeading || 'General';
    const fileName = `Anki_Export_${sanitizeFilename(sourceLesson)}_${sanitizeFilename(sourceHeading)}.csv`;

    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
  };


  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="text-center p-10">
          <LoadingSpinner />
          <p className="mt-4 text-slate-600 dark:text-slate-400 font-semibold animate-pulse">AI đang phân tích và tạo thẻ. Vui lòng chờ...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center p-10 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg">
          <p className="font-bold text-red-700 dark:text-red-400">Đã xảy ra lỗi</p>
          <p className="mt-2 text-red-600 dark:text-red-500">{error}</p>
        </div>
      );
    }

    if (flashcards.length > 0) {
      return (
        <>
          <div className="space-y-4">
            {flashcards.map((card, index) => (
              <Flashcard key={card.cardId || index} card={card} index={index} allCards={flashcards} />
            ))}
          </div>

          {hasHierarchy && <MindmapPreview flashcards={flashcards} />}

          {report && (
            <div className="mt-8 p-5 bg-slate-50 dark:bg-slate-800/50 border-l-4 border-slate-500 dark:border-slate-400 rounded-r-lg shadow-md">
              <h3 className="flex items-center text-xl font-bold text-slate-900 dark:text-slate-200 mb-4">
                <ShieldCheckIcon className="h-7 w-7 mr-3 text-slate-600 dark:text-slate-400 flex-shrink-0" />
                Báo cáo Thanh tra & Xác minh của AI
              </h3>
              <FormattedReport report={report} />
            </div>
          )}
        </>
      );
    }

    return (
      <div className="text-center p-10 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/20">
        <FileTextIcon className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
        <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">Sẵn sàng để tạo thẻ</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Điền thông tin và nhấn "Tạo Anki_Cloze" để xem kết quả tại đây.
        </p>
      </div>
    );
  };
  
  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 min-h-[500px]">
       <div className="flex flex-wrap justify-between items-center gap-4 mb-4 border-b border-slate-200 dark:border-slate-700 pb-4">
         <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Kết quả Flashcard Anki</h2>
         {flashcards.length > 0 && !isLoading && (
            <div className="flex items-center gap-2">
                <button
                  onClick={() => onAddToDeck(flashcards)}
                  className="flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-emerald-600 dark:bg-emerald-500 text-white hover:bg-emerald-700 dark:hover:bg-emerald-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800 focus:ring-emerald-500"
                  disabled={isLoading}
                  aria-label="Add generated cards to review deck"
                  title="Thêm các thẻ đã tạo vào bộ ôn tập"
                >
                  <BrainCircuitIcon className="h-4 w-4 mr-2" />
                  Thêm vào bộ ôn tập
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-sky-600 dark:bg-sky-500 text-white hover:bg-sky-700 dark:hover:bg-sky-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800 focus:ring-sky-500"
                  disabled={isLoading}
                  aria-label="Export flashcards to CSV"
                >
                  <DownloadIcon className="h-4 w-4 mr-2" />
                  Export to CSV
                </button>
            </div>
         )}
       </div>
       {renderContent()}
    </div>
  );
};
