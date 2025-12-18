import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Specialty, ModelConfig, ModelStageConfig, ClozeType } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { cleanAndRestructureText, getClozeTypeRecommendations } from '../services/geminiService';
import { normalizeComparators, comparatorAuditLine, repairPdfExtractionArtifacts } from '../services/comparatorGuard';
import { MarkdownToolbar } from './MarkdownToolbar';
import { CheckIcon, ClipboardIcon, UploadCloudIcon, ChevronDownIcon, Wand2Icon, AlertTriangleIcon } from './Icons';
import { ModelSelector } from './ModelSelector';


declare var pdfjsLib: any;
declare var mammoth: any;

interface InputPanelProps {
  onGenerate: (lessonText: string, specialty: Specialty, focusSection: string, lessonSource: string, customInstructions: string, preferredClozeTypes: ClozeType[], config: ModelStageConfig, extraDisambiguationContext: string) => void;
  isLoading: boolean;
  modelConfig: ModelConfig;
  onModelConfigChange: (task: keyof ModelConfig, field: keyof ModelStageConfig, value: string | boolean) => void;
}

type FlowState = 'idle' | 'processing' | 'review';

const specialties: Specialty[] = ['Nội khoa', 'Nhi khoa', 'Sinh lý'];

const clozeTypes: { id: ClozeType; label: string; description: string; forPaediatricsOnly?: boolean }[] = [
  { id: 'basic', label: 'Cloze Cơ bản', description: 'Ưu tiên thẻ nguyên tử (1 thẻ-1 ý), theo nguyên tắc Tối thiểu Thông tin.' },
  { id: 'cluster', label: 'Cloze Nhóm', description: 'Học một bộ thông tin (tam chứng, tiêu chuẩn) như một khối.' },
  { id: 'overlapping', label: 'Cloze Chồng lấn', description: 'Học một quy trình/chuỗi có thứ tự qua nhiều thẻ.' },
  { id: 'hierarchical', label: 'Cloze Phân cấp', description: 'Học kiến thức nhiều tầng lớp (tổng quát → chi tiết).' },
  { id: 'bidirectional', label: 'Cloze Đảo chiều', description: 'Tạo thẻ hỏi xuôi & ngược cho quan hệ 1-đối-1.' },
  { id: 'disambiguation', label: 'Cloze Phân Biệt', description: 'Đặt 2+ mục dễ nhầm vào cùng thẻ để so sánh.' },
  { id: 'pedi_mindmap', label: 'Mindmap Nhi khoa', description: 'Bắt buộc AI tuân thủ cấu trúc mindmap (chỉ cho Nhi).', forPaediatricsOnly: true },
];

const formatNumberedOutline = (tocString: string): string => {
    if (!tocString) return '';

    const lines = tocString.split('\n').filter(line => line.trim() !== '');
    const numberedLines: string[] = [];
    const counters: number[] = [];

    for (const line of lines) {
        const expandedLine = line.replace(/\t/g, '  ');
        const indentation = expandedLine.match(/^\s*/)?.[0]?.length || 0;
        
        let desiredLevel = Math.floor(indentation / 2);
        
        const currentDepth = counters.length - 1; 
        const level = Math.min(desiredLevel, currentDepth + 1);
        
        const text = line.trim().replace(/^([#]+|[-*+•]|\d+\.)\s*/, '').trim();

        if (!text) continue;

        if (counters.length > level + 1) {
            counters.length = level + 1;
        }

        while (counters.length <= level) {
            counters.push(0);
        }

        counters[level]++;

        const prefix = counters.join('.');
        const indentationSpaces = '  '.repeat(level);
        numberedLines.push(`${indentationSpaces}${prefix}. ${text}`);
    }

    return numberedLines.join('\n');
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
          ? 'bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300'
          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
      } ${className}`}
    >
      {isCopied ? (
        <>
          <CheckIcon className="h-3 w-3 mr-1.5" />
          Đã sao chép
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

const MiniSpinner: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`animate-spin h-5 w-5 ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

interface DisambiguationSet {
    id: string;
    title: string;
    confusingReason: string;
    discriminators: string;
    location: string;
}
interface Recommendation {
  suggested: string[];
  legend: string | null;
  rationale: string[];
  warnings: string[];
  helper: string[];
  disambiguationTargets?: {
    strong: DisambiguationSet[];
    weak: DisambiguationSet[];
    designHints: string[];
  }
}

const parseRecommendation = (report: string | null): Recommendation | null => {
    if (!report) return null;

    const suggestedMatch = report.match(/1\)\s*Suggested selection \(IDs\)([\s\S]*?)(Legend \(VN\):|2\)\s*Decision rationale)/);
    const legendMatch = report.match(/Legend \(VN\):\s*(.*)/);
    const rationaleMatch = report.match(/2\)\s*Decision rationale \(signals → types\)([\s\S]*?)(\[Disambiguation Targets|3\)\s*Best-use warning)/);
    const warningMatch = report.match(/3\)\s*Best-use warning \(pitfalls to avoid\)([\s\S]*?)4\)\s*UI helper/);
    const helperMatch = report.match(/4\)\s*UI helper \(descriptions for selection UI\)([\s\S]*)$/);
    
    const disambiguationBlockMatch = report.match(/\[Disambiguation Targets \(Confusion Sets Found\)\]([\s\S]*?)(?:\n3\)\s*Best-use warning|$)/);

    let disambiguationTargets: Recommendation['disambiguationTargets'] | undefined = undefined;

    if (disambiguationBlockMatch) {
        const blockContent = disambiguationBlockMatch[1];
        const strongCandidatesMatch = blockContent.match(/A\) Strong candidates \(use disambiguation\)([\s\S]*?)(B\) Possible but weak|Design hints|$)/);
        const weakCandidatesMatch = blockContent.match(/B\) Possible but weak \(do not force\)([\s\S]*?)(Design hints|$)/);
        const designHintsMatch = blockContent.match(/Design hints:([\s\S]*)$/);
        
        const parseSets = (content: string | null | undefined): DisambiguationSet[] => {
            if (!content) return [];
            const sets: DisambiguationSet[] = [];
            const setsRegex = /- Set #(\d+): (.*?)\n\s+- Why confusing: (.*?)\n\s+- Discriminators in text: (.*?)\n\s+- Where found: (.*?)(?=\n- Set #|\n\n|$)/gs;
            let match;
            while ((match = setsRegex.exec(content)) !== null) {
                sets.push({
                    id: `Set #${match[1]}`,
                    title: match[2].trim(),
                    confusingReason: match[3].trim(),
                    discriminators: match[4].trim().replace(/^- /gm, ''),
                    location: match[5].trim()
                });
            }
            return sets;
        };

        disambiguationTargets = {
            strong: parseSets(strongCandidatesMatch?.[1]),
            weak: parseSets(weakCandidatesMatch?.[1]),
            designHints: designHintsMatch ? designHintsMatch[1].trim().split('\n').map(l => l.replace(/^- /, '').trim()) : []
        };
    }


    const parseLines = (text: string | null | undefined): string[] => text ? text.trim().split('\n').map(l => l.trim()).filter(Boolean) : [];

    return {
        suggested: parseLines(suggestedMatch?.[1]),
        legend: legendMatch ? legendMatch[1].trim() : null,
        rationale: parseLines(rationaleMatch?.[1]),
        warnings: parseLines(warningMatch?.[1]),
        helper: parseLines(helperMatch?.[1]),
        disambiguationTargets,
    };
}


export const InputPanel: React.FC<InputPanelProps> = ({ onGenerate, isLoading, modelConfig, onModelConfigChange }) => {
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [lessonText, setLessonText] = useState<string>('');
  const [selectedSpecialty, setSelectedSpecialty] = useState<Specialty | null>(null);
  const [focusSection, setFocusSection] = useState<string>('');
  const [lessonSource, setLessonSource] = useState<string>('');
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [extraDisambiguationContext, setExtraDisambiguationContext] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [fileNote, setFileNote] = useState<string>('');
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  
  const [isTextCleaned, setIsTextCleaned] = useState(false);
  const [cleaningError, setCleaningError] = useState<string | null>(null);
  const [tableOfContents, setTableOfContents] = useState<string | null>(null);
  const [preferredClozeTypes, setPreferredClozeTypes] = useState<Set<ClozeType>>(new Set());
  const [isPrioritySelectorOpen, setIsPrioritySelectorOpen] = useState(false);
  const customInstructionsRef = useRef<HTMLTextAreaElement>(null);

  // State for AI Advisor
  const [isAdvising, setIsAdvising] = useState(false);
  const [recommendationReport, setRecommendationReport] = useState<string|null>(null);
  const [recommendationError, setRecommendationError] = useState<string|null>(null);
  
  const parsedRecommendation = parseRecommendation(recommendationReport);
  
  const generateDisambiguationGuidance = useCallback((strongSets: DisambiguationSet[] | undefined): string => {
    if (!strongSets || strongSets.length === 0) {
        return "No strong disambiguation targets found.";
    }

    const header = "[DISAMBIGUATION GUIDANCE — Paste into Custom Instructions]\n- Please prioritize creating Disambiguation Cloze for the following confusion sets found in the source text:";
    
    const setsList = strongSets.map((set, index) => {
        const discriminators = set.discriminators.replace(/\n\s*/g, '; ');
        return `  ${index + 1}) <${set.title}> — discriminators: <${discriminators}> — location: <${set.location}>`;
    }).join('\n');

    const footer = `- Constraints:\n  - Use ONLY verbatim text from the document for clozeText and quotes.\n  - Cloze the discriminators (differences), not the shared features.\n  - If a set lacks clear discriminators in the source, skip it and report why.`;

    return `${header}\n${setsList}\n${footer}`;
  }, []);

  const generateDisambiguationContextFromAdvisor = useCallback((strongSets: DisambiguationSet[]): string => {
    const header = "[ADVISOR → DISAMBIGUATION EXTRA CONTEXT]\n- Use Disambiguation Cloze for these confusion sets found in the source:";
    const setsList = strongSets.map((set, index) => {
        const discriminators = set.discriminators.replace(/\n\s*/g, '; ');
        return `  ${index + 1}) <${set.title}> — discriminators: <${discriminators}> — location: <${set.location}>`;
    }).join('\n');
    const footer = `- Constraints:\n  - Use ONLY verbatim text for clozeText and quotes.\n  - Cloze the discriminators, not the shared features.\n  - If discriminators are not explicit in provided text segments, skip and report why.`;
    return `${header}\n${setsList}\n${footer}`;
  }, []);

  // Auto-fill extra context for disambiguation
  useEffect(() => {
    if (flowState === 'review' && parsedRecommendation?.disambiguationTargets?.strong?.length > 0 && preferredClozeTypes.has('disambiguation')) {
        const guidance = generateDisambiguationContextFromAdvisor(parsedRecommendation.disambiguationTargets.strong);
        setExtraDisambiguationContext(prev => {
            if (!prev.trim()) {
                return guidance;
            }
            if (!prev.includes(guidance)) {
                 return `${prev}\n\n---\n\n[Advisor Auto-Generated]\n${guidance}`;
            }
            return prev;
        });
    }
  }, [flowState, parsedRecommendation, preferredClozeTypes, generateDisambiguationContextFromAdvisor]);


  useEffect(() => {
    if (selectedSpecialty !== 'Nhi khoa' && preferredClozeTypes.has('pedi_mindmap')) {
        const newTypes = new Set(preferredClozeTypes);
        newTypes.delete('pedi_mindmap');
        setPreferredClozeTypes(newTypes);
    }
  }, [selectedSpecialty, preferredClozeTypes]);

  const resetAnalysis = () => {
    setFlowState('idle');
    setFileNote('');
    setIsTextCleaned(false);
    setCleaningError(null);
    setTableOfContents(null);
    setRecommendationReport(null);
    setRecommendationError(null);
  };

  const handleTextChange = (text: string) => {
    const normalized = normalizeComparators(text);
    setLessonText(normalized);
    if(errors.lessonText) setErrors(prev => ({...prev, lessonText: ''}));
    if (flowState === 'review') {
      resetAnalysis();
    }
  }

  const handleToggleClozeType = (type: ClozeType) => {
    setPreferredClozeTypes(prev => {
        const newSet = new Set(prev);
        if (newSet.has(type)) {
            newSet.delete(type);
        } else {
            newSet.add(type);
        }
        return newSet;
    });
  }

  const processFile = async (file: File) => {
    setFileName(file.name);
    setErrors(prev => ({ ...prev, lessonText: '' }));
    setIsFileProcessing(true);
    resetAnalysis();
    setFileNote(`Đang xử lý file '${file.name}'...`);
    setLessonText('');

    try {
        let text = '';
        let rawExtractedText = '';
        let repairNotes: string[] = [];

        if (file.type === 'text/plain') {
            text = await file.text();
            rawExtractedText = text;
        } else if (file.type === 'application/pdf') {
            if (typeof pdfjsLib === 'undefined') {
                throw new Error("Thư viện đọc PDF chưa tải xong. Vui lòng tải lại trang hoặc kiểm tra kết nối mạng.");
            }
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                fullText += pageText + '\n\n';
            }
            rawExtractedText = fullText;

            const { repairedText, repairs, unknownPUA } = repairPdfExtractionArtifacts(rawExtractedText);
            text = repairedText;

            if (repairs.some(r => r.count > 0)) {
                const report = repairs.filter(r => r.count > 0).map(r => `${r.count} ký tự '${r.label}'`).join(', ');
                repairNotes.push(`- Đã tự động sửa: ${report}.`);
            }
            if (unknownPUA.length > 0) {
                repairNotes.push(`- ⚠️ CẢNH BÁO: PDF chứa ${unknownPUA.length} loại ký tự lạ. Kết quả có thể không chính xác.`);
                const samples = unknownPUA.slice(0, 2).map(pua => `'${pua.char}' trong "...${pua.samples[0]}..."`).join('; ');
                repairNotes.push(`  Ví dụ: ${samples}`);
            }

        } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
             if (typeof mammoth === 'undefined') {
                 throw new Error("Thư viện đọc Word (mammoth) chưa tải xong. Vui lòng tải lại trang hoặc kiểm tra kết nối mạng.");
             }
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
            text = result.value;
            rawExtractedText = text;
        } else if (file.type === 'application/msword') {
            setFileName('');
            setFileNote('Định dạng .doc không được hỗ trợ tự động. Vui lòng lưu file dưới dạng .docx hoặc .pdf rồi thử lại.');
            return;
        } else {
            setFileName('');
            setFileNote('Loại file không được hỗ trợ. Vui lòng chọn .txt, .pdf, hoặc .docx.');
            return;
        }

        const auditRaw = comparatorAuditLine('PDF_RAW', rawExtractedText);
        const normalizedText = normalizeComparators(text);
        const auditNorm = comparatorAuditLine('PDF_NORMALIZED', normalizedText);

        setLessonText(normalizedText);
        
        const finalNotes = [`Đã trích xuất... Comparator Guard ON.`];
        if (repairNotes.length > 0) {
            finalNotes.push(`[PDF Sanitizer Report]:\n${repairNotes.join('\n')}`);
        }
        finalNotes.push(auditRaw, auditNorm);
        setFileNote(finalNotes.join('\n'));

    } catch (err) {
        console.error("Error processing file:", err);
        setFileName('');
        const errorMessage = err instanceof Error ? err.message : `Đã xảy ra lỗi khi xử lý file '${file.name}'. File có thể bị hỏng.`;
        setFileNote(errorMessage);
    } finally {
        setIsFileProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
      e.target.value = '';
    }
  };
  
  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          processFile(e.dataTransfer.files[0]);
          e.dataTransfer.clearData();
      }
  };
  
  const validateInputs = (isFinalSubmit: boolean = false): boolean => {
    const newErrors: { [key: string]: string } = {};
    if (!lessonText.trim()) newErrors.lessonText = 'Vui lòng dán nội dung hoặc tải lên file bài học.';

    if(isFinalSubmit) {
      if (!selectedSpecialty) newErrors.specialty = 'Vui lòng chọn một chuyên khoa.';
      if (!lessonSource.trim()) newErrors.lessonSource = 'Vui lòng nhập tên bài học hoặc nguồn.';
      if (!focusSection.trim()) newErrors.focusSection = 'Vui lòng nhập đề mục cần tạo Anki Cloze.';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAnalyze = async () => {
    if(!validateInputs(false)) return;

    setFlowState('processing');
    setCleaningError(null);
    setFileNote('');
    setTableOfContents(null);
    setRecommendationReport(null);
    setRecommendationError(null);
    setIsAdvising(true); // combine cleaning and advising into one processing state

    try {
        const { model, thinkMore } = modelConfig.clozeCleaning;
        // The lessonText is already normalized from file processing or text area change.
        const result = await cleanAndRestructureText(lessonText, model, thinkMore);
        
        if (result.cleanedText === 'false') {
             throw new Error("AI không thể xử lý nội dung này.");
        }

        const numberedToc = formatNumberedOutline(result.tableOfContents);
        setLessonText(result.cleanedText);
        setTableOfContents(numberedToc);
        setIsTextCleaned(true);
        setFileNote('AI đã tái cấu trúc và làm sạch văn bản thành công!');
        
        try {
            const { model: advisorModel, thinkMore: advisorThinkMore } = modelConfig.clozeAdvisor;
            const recommendations = await getClozeTypeRecommendations(
                selectedSpecialty || 'Nội khoa', // Default to avoid null
                focusSection,
                result.cleanedText,
                customInstructions,
                advisorModel,
                advisorThinkMore
            );
            setRecommendationReport(recommendations);
        } catch (adviseErr) {
            const errorMessage = adviseErr instanceof Error ? adviseErr.message : 'Lỗi không xác định khi lấy khuyến nghị.';
            setRecommendationError(errorMessage);
        } finally {
            setIsAdvising(false);
            setFlowState('review');
        }

    } catch(err) {
        const errorMessage = err instanceof Error ? err.message : 'Lỗi không xác định khi làm sạch văn bản.';
        setCleaningError(errorMessage);
        setFlowState('idle');
        setIsAdvising(false);
    } 
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateInputs(true) && selectedSpecialty) {
      onGenerate(lessonText, selectedSpecialty, focusSection, lessonSource, customInstructions, Array.from(preferredClozeTypes), modelConfig.clozeGeneration, extraDisambiguationContext);
      setFlowState('idle');
      resetAnalysis();
    }
  };
  
  const isProcessing = isLoading || isFileProcessing || flowState === 'processing';
  const showAnalysisButton = flowState === 'idle';
  const showPreFlight = flowState === 'review';

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 lg:sticky top-8">
      <form onSubmit={handleSubmit} className="space-y-8">

        <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Cấu hình AI (Tạo thẻ)</h3>
            <ModelSelector
                label="Giai đoạn 1: Làm sạch & Tái cấu trúc"
                config={modelConfig.clozeCleaning}
                onModelChange={(model) => onModelConfigChange('clozeCleaning', 'model', model)}
                onThinkMoreChange={(checked) => onModelConfigChange('clozeCleaning', 'thinkMore', checked)}
                proDescription="Phân tích sâu, tái cấu trúc tài liệu phức tạp tốt hơn."
                flashDescription="Tốc độ nhanh, phù hợp với văn bản đã sạch."
            />
             <ModelSelector
                label="Giai đoạn 1.5: Cố vấn Dạng thẻ"
                config={modelConfig.clozeAdvisor}
                onModelChange={(model) => onModelConfigChange('clozeAdvisor', 'model', model)}
                onThinkMoreChange={(checked) => onModelConfigChange('clozeAdvisor', 'thinkMore', checked)}
                proDescription="Phân tích sâu hơn về cấu trúc văn bản để đưa ra khuyến nghị chiến lược."
                flashDescription="Phân tích nhanh, phù hợp cho các cấu trúc văn bản đơn giản."
            />
            <ModelSelector
                label="Giai đoạn 2: Tạo thẻ Anki Cloze"
                config={modelConfig.clozeGeneration}
                onModelChange={(model) => onModelConfigChange('clozeGeneration', 'model', model)}
                onThinkMoreChange={(checked) => onModelConfigChange('clozeGeneration', 'thinkMore', checked)}
                proDescription="Tạo thẻ chi tiết, liên kết tốt, suy luận sâu hơn."
                flashDescription="Tạo thẻ nhanh, hiệu quả cho các khái niệm đơn giản."
            />
        </div>


        <div>
          <label className="block text-base font-bold text-slate-800 dark:text-slate-200 mb-3">
            <span className="text-sky-500 font-black mr-2">1.</span> Chọn chuyên khoa
          </label>
          <div className="flex flex-wrap gap-2">
            {specialties.map((specialty) => (
              <button
                key={specialty}
                type="button"
                onClick={() => { setSelectedSpecialty(specialty); if(errors.specialty) setErrors(prev => ({...prev, specialty: ''})); }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800 focus:ring-sky-500 ${
                  selectedSpecialty === specialty
                    ? 'bg-sky-600 dark:bg-sky-500 text-white shadow-md'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                {specialty}
              </button>
            ))}
          </div>
           {errors.specialty && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.specialty}</p>}
        </div>

        <div>
           <label htmlFor="lessonSource" className="block text-base font-bold text-slate-800 dark:text-slate-200 mb-3">
            <span className="text-sky-500 font-black mr-2">2.</span> Tên bài học / Nguồn
          </label>
          <input
            id="lessonSource"
            type="text"
            value={lessonSource}
            onChange={(e) => { setLessonSource(e.target.value); if(errors.lessonSource) setErrors(prev => ({...prev, lessonSource: ''})); }}
            placeholder="Ví dụ: Bài giảng Viêm Phổi - PGS.TS. Nguyễn Văn A"
            className={`mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border ${errors.lessonSource ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} text-slate-900 dark:text-white rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500`}
          />
          {errors.lessonSource && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.lessonSource}</p>}
        </div>

        <div>
          <label className="block text-base font-bold text-slate-800 dark:text-slate-200 mb-3">
            <span className="text-sky-500 font-black mr-2">3.</span> Dán nội dung hoặc tải lên file bài học
          </label>
           <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">Ghi chú: Có thể sử dụng trích nội dung từ Notebook LM sẽ chính xác hơn.</p>
          <div 
            onDrop={handleDrop} 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`mt-2 flex justify-center items-center px-6 pt-5 pb-6 border-2 ${isDragging ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'border-slate-300 dark:border-slate-600'} border-dashed rounded-xl transition-colors min-h-[140px]`}
          >
            {isFileProcessing ? (
                <div className="text-center">
                    <LoadingSpinner />
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Đang trích xuất văn bản...</p>
                </div>
            ) : (
                <div className="space-y-1 text-center">
                    <UploadCloudIcon className="mx-auto h-12 w-12 text-slate-400" />
                    <div className="flex text-sm text-slate-600 dark:text-slate-400">
                        <label htmlFor="file-upload" className="relative cursor-pointer bg-transparent rounded-md font-medium text-sky-600 dark:text-sky-400 hover:text-sky-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 dark:focus-within:ring-offset-slate-800 focus-within:ring-sky-500">
                            <span>Tải lên một file</span>
                            <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".txt,.pdf,.docx"/>
                        </label>
                        <p className="pl-1">hoặc kéo và thả</p>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-500 truncate max-w-xs">{fileName || 'Hỗ trợ TXT, PDF, DOCX'}</p>
                </div>
            )}
          </div>
          <textarea
            id="lessonText"
            rows={10}
            value={lessonText}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Hoặc dán toàn bộ nội dung bài học của bạn vào đây..."
            className={`mt-2 block w-full px-3 py-2 bg-white dark:bg-slate-700 border ${errors.lessonText ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} text-slate-900 dark:text-white rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-y`}
          />
           {fileNote && <p className={`mt-2 text-sm whitespace-pre-wrap font-mono text-xs ${isTextCleaned ? 'text-emerald-600 dark:text-emerald-400' : 'text-sky-600 dark:text-sky-400'}`}>{fileNote}</p>}
           {cleaningError && <p className="mt-2 text-sm text-red-500 dark:text-red-400">{cleaningError}</p>}
           {errors.lessonText && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.lessonText}</p>}
        </div>
        
        {showAnalysisButton && (
            <button
                type="button"
                onClick={handleAnalyze}
                disabled={isProcessing || !lessonText.trim()}
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-sky-800 dark:text-sky-200 bg-sky-100 dark:bg-sky-900/40 hover:bg-sky-200 dark:hover:bg-sky-900/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed transition-colors duration-300 min-h-[44px]"
            >
                AI Tái cấu trúc & Phân tích
            </button>
        )}
        
        {flowState === 'processing' && (
             <div className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-sky-800 dark:text-sky-200 bg-sky-100 dark:bg-sky-900/40 disabled:cursor-not-allowed transition-colors duration-300 min-h-[44px]">
               <MiniSpinner className="text-sky-800 dark:text-sky-200 mr-2" />
               <span>Đang phân tích...</span>
            </div>
        )}

        { (showPreFlight) &&
            <div className="space-y-4">
                {tableOfContents && (
                <div className="p-4 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Mục lục Bài học</h4>
                        <CopyButton textToCopy={tableOfContents} label="Sao chép mục lục" />
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-slate-600 dark:text-slate-300 font-mono" dangerouslySetInnerHTML={{ __html: tableOfContents.replace(/ /g, '&nbsp;').replace(/\n/g, '<br/>') }} />
                </div>
                )}
                
                <div className="p-4 bg-fuchsia-50 dark:bg-slate-800 border-l-4 border-fuchsia-500 dark:border-fuchsia-400 rounded-r-lg shadow-md">
                    <h3 className="flex items-center text-lg font-bold text-fuchsia-900 dark:text-fuchsia-200 mb-4">
                        <Wand2Icon className="h-6 w-6 mr-3 text-fuchsia-600 dark:text-fuchsia-400 flex-shrink-0" />
                        Cố vấn AI: Khuyến nghị Dạng thẻ
                    </h3>
                    {isAdvising && (
                        <div className="flex items-center justify-center py-4">
                            <MiniSpinner className="text-fuchsia-600 dark:fuchsia-400 mr-2"/>
                            <span className="text-sm font-medium text-fuchsia-800 dark:text-fuchsia-300">AI đang phân tích văn bản...</span>
                        </div>
                    )}
                    {recommendationError && <p className="text-sm text-red-500 dark:text-red-400">{recommendationError}</p>}
                    {parsedRecommendation && (
                        <div className="space-y-4 text-sm">
                            <div>
                                <h4 className="font-semibold text-fuchsia-800 dark:text-fuchsia-300">Lựa chọn đề xuất:</h4>
                                <ul className="list-disc pl-5 mt-1 text-slate-700 dark:text-slate-300 space-y-1">
                                    {parsedRecommendation.suggested.map((line, i) => <li key={i}>{line.replace(/^-/, '').trim()}</li>)}
                                </ul>
                                {parsedRecommendation.legend && (
                                    <p className="mt-2 text-xs text-fuchsia-700 dark:text-fuchsia-400 italic">
                                        <span className="font-semibold not-italic">Chú thích: </span>{parsedRecommendation.legend}
                                    </p>
                                )}
                            </div>
                             <div>
                                <h4 className="font-semibold text-fuchsia-800 dark:text-fuchsia-300 mt-2">Cơ sở lý luận:</h4>
                                <ul className="list-disc pl-5 mt-1 text-slate-700 dark:text-slate-300 space-y-1">
                                    {parsedRecommendation.rationale.map((line, i) => <li key={i}>{line.replace(/^-/, '').trim()}</li>)}
                                </ul>
                            </div>

                            {parsedRecommendation.disambiguationTargets && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/50 rounded-lg">
                                    <div className="flex justify-between items-center mb-2">
                                        <h4 className="font-semibold text-blue-800 dark:text-blue-300">Mục tiêu cho Cloze Phân Biệt:</h4>
                                        <CopyButton 
                                            textToCopy={generateDisambiguationGuidance(parsedRecommendation.disambiguationTargets.strong)}
                                            label="Sao chép Hướng dẫn"
                                        />
                                    </div>
                                    {parsedRecommendation.disambiguationTargets.strong.length > 0 && (
                                        <div>
                                            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Ứng viên mạnh:</p>
                                            <ul className="mt-1 space-y-2 text-xs">
                                                {parsedRecommendation.disambiguationTargets.strong.map(set => (
                                                    <li key={set.id} className="p-2 bg-white dark:bg-blue-900/40 rounded">
                                                        <strong className="text-blue-700 dark:text-blue-400">{set.title}</strong>
                                                        <p className="text-slate-600 dark:text-slate-300"><strong className="font-medium">Lý do nhầm:</strong> {set.confusingReason}</p>
                                                        <p className="text-slate-600 dark:text-slate-300"><strong className="font-medium">Điểm phân biệt:</strong> {set.discriminators}</p>
                                                        <p className="text-slate-500 dark:text-slate-400 italic">Tại: {set.location}</p>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {parsedRecommendation.disambiguationTargets.weak.length > 0 && (
                                         <div className="mt-2">
                                            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Ứng viên yếu (cân nhắc):</p>
                                            <ul className="mt-1 space-y-2 text-xs">
                                                {parsedRecommendation.disambiguationTargets.weak.map(set => (
                                                    <li key={set.id}>
                                                        <strong className="text-blue-700 dark:text-blue-400">{set.title}</strong> - <span className="text-slate-500 dark:text-slate-400">Thiếu điểm phân biệt rõ.</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                     {parsedRecommendation.disambiguationTargets.designHints.length > 0 && (
                                        <div className="mt-2">
                                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Gợi ý thiết kế:</p>
                                             <ul className="list-disc pl-4 mt-1 text-xs text-slate-600 dark:text-slate-400">
                                                {parsedRecommendation.disambiguationTargets.designHints.map((hint, i) => <li key={i}>{hint}</li>)}
                                            </ul>
                                        </div>
                                     )}
                                </div>
                            )}

                            <div>
                                <h4 className="font-semibold text-amber-800 dark:text-amber-400 mt-2">Cảnh báo sử dụng:</h4>
                                <ul className="list-disc pl-5 mt-1 text-slate-700 dark:text-slate-300 space-y-1">
                                     {parsedRecommendation.warnings.map((line, i) => <li key={i}>{line.replace(/^-/, '').trim()}</li>)}
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        }

        {showPreFlight && (
             <div className="p-4 bg-amber-50 dark:bg-slate-700/50 border-l-4 border-amber-500 rounded-r-lg shadow-md">
                <h3 className="flex items-center text-lg font-bold text-amber-900 dark:text-amber-200 mb-4">
                    <AlertTriangleIcon className="h-6 w-6 mr-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    Pre-Flight Check: Xem lại & Chỉnh sửa
                </h3>
                <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
                    AI đã phân tích xong. Bây giờ là lúc bạn xem lại, chỉnh sửa các tham số dưới đây trước khi bắt đầu tạo thẻ cuối cùng.
                </p>
                <div className="text-sm space-y-2 text-slate-600 dark:text-slate-400">
                    <p><strong>Chuyên khoa:</strong> {selectedSpecialty || 'Chưa chọn'}</p>
                    <p><strong>Đề mục:</strong> {focusSection || 'Chưa nhập'}</p>
                    <p><strong>Chế độ:</strong> {preferredClozeTypes.size > 0 ? `EXCLUSIVE (${Array.from(preferredClozeTypes).join(', ')})` : 'AUTO'}</p>
                </div>
                 <button 
                    type="button" 
                    onClick={resetAnalysis}
                    className="mt-4 text-xs text-slate-500 hover:underline"
                 >
                    Chạy lại phân tích
                 </button>
             </div>
        )}

        <div>
           <label htmlFor="focusSection" className="block text-base font-bold text-slate-800 dark:text-slate-200 mb-3">
            <span className="text-sky-500 font-black mr-2">4.</span> Nhập đề mục cần tạo anki_cloze
          </label>
          <input
            id="focusSection"
            type="text"
            value={focusSection}
            onChange={(e) => { setFocusSection(e.target.value); if(errors.focusSection) setErrors(prev => ({...prev, focusSection: ''})); }}
            placeholder="Ví dụ: 3.1. Chẩn đoán xác định"
            className={`mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border ${errors.focusSection ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} text-slate-900 dark:text-white rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500`}
          />
          {errors.focusSection && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.focusSection}</p>}
        </div>
        
        <div>
            <label htmlFor="customInstructions" className="block text-base font-bold text-slate-800 dark:text-slate-200 mb-3">
              <span className="text-sky-500 font-black mr-2">5.</span> Yêu cầu tùy chỉnh (Tùy chọn)
            </label>
            <div className="mt-1 shadow-sm rounded-lg border border-slate-300 dark:border-slate-600">
                <MarkdownToolbar
                    textareaRef={customInstructionsRef}
                    onContentChange={setCustomInstructions}
                />
                <textarea
                    id="customInstructions"
                    ref={customInstructionsRef}
                    rows={3}
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="Ví dụ: Tập trung vào các con số và liều lượng thuốc. Không bỏ qua bất kỳ mục nào trong phần 'Điều trị'."
                    className="block w-full px-3 py-2 bg-white dark:bg-slate-700 border-t border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-b-lg placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 sm:text-sm resize-y"
                />
            </div>
        </div>

        <div>
            <div className="border-b border-slate-200 dark:border-slate-700 mb-4">
                <button
                    type="button"
                    onClick={() => setIsPrioritySelectorOpen(!isPrioritySelectorOpen)}
                    className="flex justify-between items-center w-full py-2"
                    aria-expanded={isPrioritySelectorOpen}
                >
                    <span className="text-base font-bold text-slate-800 dark:text-slate-200">
                        <span className="text-sky-500 font-black mr-2">6.</span> Chế độ độc quyền: Chỉ tạo các dạng thẻ được chọn
                    </span>
                    <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isPrioritySelectorOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>
            {isPrioritySelectorOpen && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-slate-50 dark:bg-slate-900/30 rounded-lg">
                        {clozeTypes.map(type => {
                            const isDisabled = type.forPaediatricsOnly && selectedSpecialty !== 'Nhi khoa';
                            return (
                                <div key={type.id} className="relative flex items-start">
                                    <div className="flex h-6 items-center">
                                        <input
                                            id={type.id}
                                            name={type.id}
                                            type="checkbox"
                                            checked={!isDisabled && preferredClozeTypes.has(type.id)}
                                            onChange={() => handleToggleClozeType(type.id)}
                                            disabled={isDisabled}
                                            className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>
                                    <div className="ml-3 text-sm leading-6">
                                        <label htmlFor={type.id} className={`font-medium ${isDisabled ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'}`}>
                                            {type.label}
                                        </label>
                                        <p className={`text-xs ${isDisabled ? 'text-slate-400 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'}`}>
                                            {type.description}
                                        </p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                     {preferredClozeTypes.has('disambiguation') && (
                        <div className="mt-4 p-4 bg-slate-100 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                            <label htmlFor="disambiguationExtraContext" className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">
                                Bối cảnh bổ sung cho thẻ Phân Biệt (Tùy chọn)
                            </label>
                            <textarea
                                id="disambiguationExtraContext"
                                rows={4}
                                value={extraDisambiguationContext}
                                onChange={(e) => setExtraDisambiguationContext(e.target.value)}
                                placeholder="Dán đoạn ngoài đề mục có chứa phần đối chiếu/tiêu chí/điểm phân biệt (A vs B)..."
                                className="block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 sm:text-sm resize-y"
                            />
                        </div>
                    )}
                </>
            )}
        </div>


        <button
          type="submit"
          disabled={isProcessing || isLoading}
          className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-lg text-base font-bold text-white bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800 focus:ring-sky-500 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 min-h-[48px]"
        >
          {isLoading ? (
             <div className="flex items-center">
               <MiniSpinner className="text-white mr-2" />
               <span>Đang tạo thẻ...</span>
            </div>
          ) : 'Xác nhận & Tạo Anki_Cloze'}
        </button>
      </form>
    </div>
  );
};