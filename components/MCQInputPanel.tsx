import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Specialty, MCQMode, ModelConfig, CleaningResult, ModelStageConfig, DifficultyWeights, MCQOptions } from '../types';
import { ModelSelector } from './ModelSelector';
import { cleanAndRestructureText } from '../services/geminiService';
import { normalizeComparators, repairPdfExtractionArtifacts, comparatorAuditLine } from '../services/comparatorGuard';
import { LoadingSpinner } from './LoadingSpinner';
import { UploadCloudIcon, Wand2Icon, FileTextIcon, ListIcon, CheckIcon, ClipboardIcon, AlertTriangleIcon, ChevronDownIcon } from './Icons';
import { MarkdownToolbar } from './MarkdownToolbar';
import { MCQ_PROCESS_BLUEPRINT } from '../constants/mcqProcess';

declare var mammoth: any;
declare var pdfjsLib: any;

interface MCQInputPanelProps {
    onStartGeneration: (
        sections: { title: string, content: string }[], 
        specialty: Specialty, 
        mcqMode: MCQMode,
        difficultyWeights: DifficultyWeights,
        customInstructions: string,
        options: MCQOptions
    ) => void;
    mcqModelConfig: any;
    setMcqModelConfig: any;
}

type FlowState = 'idle' | 'processing' | 'review';

// Component Checkbox có trạng thái Indeterminate
const IndeterminateCheckbox = ({
  checked,
  indeterminate,
  onChange,
  className
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  className?: string;
}) => {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      type="checkbox"
      ref={ref}
      checked={checked}
      onChange={onChange}
      className={className}
    />
  );
};

// --- Helpers ported from InputPanel ---

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

interface ParsedSection {
    id: number;
    title: string;
    startLine: number;
    level: number;
    path: string;
    parentId: number | null;
}

export const MCQInputPanel: React.FC<MCQInputPanelProps> = ({ onStartGeneration, mcqModelConfig, setMcqModelConfig }) => {
    // --- State ---
    const [flowState, setFlowState] = useState<FlowState>('idle');
    const [rawText, setRawText] = useState(''); // Acts as lessonText
    const [fileName, setFileName] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [fileNote, setFileNote] = useState<string>('');
    const [isFileProcessing, setIsFileProcessing] = useState(false);
    
    // Analysis Results
    const [cleanedData, setCleanedData] = useState<CleaningResult | null>(null);
    const [tableOfContents, setTableOfContents] = useState<string | null>(null);
    const [cleaningError, setCleaningError] = useState<string | null>(null);
    
    // Tree Selection State
    const [parsedSections, setParsedSections] = useState<ParsedSection[]>([]);
    const [checkedState, setCheckedState] = useState<Map<number, boolean>>(new Map()); // stores check status of *all* nodes

    // Config State
    // Default to 'Nội khoa', removed UI for selection
    const [selectedSpecialty] = useState<Specialty>('Nội khoa');
    const [mcqMode, setMcqMode] = useState<MCQMode>('theory');
    const [errors, setErrors] = useState<{ [key: string]: string }>({});

    // Difficulty Weights
    const [difficultyWeights, setDifficultyWeights] = useState<DifficultyWeights>({
        easy: 10,
        medium: 40,
        hard: 35,
        veryHard: 15
    });

    const [customInstructions, setCustomInstructions] = useState<string>('');
    const customInstructionsRef = useRef<HTMLTextAreaElement>(null);

    // Advanced Options (Feature Flags)
    const [mcqOptions, setMcqOptions] = useState<MCQOptions>({
        allowCrossSectionContext: false,
        allowExternalSources: false
    });
    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
    const [showProcessBlueprint, setShowProcessBlueprint] = useState(false);

    // --- Logic ---

    const resetAnalysis = () => {
        setFlowState('idle');
        setFileNote('');
        setCleaningError(null);
        setTableOfContents(null);
        setCleanedData(null);
        setParsedSections([]);
        setCheckedState(new Map<number, boolean>());
    };

    const handleTextChange = (text: string) => {
        const normalized = normalizeComparators(text);
        setRawText(normalized);
        if(errors.rawText) setErrors(prev => ({...prev, rawText: ''}));
        if (flowState === 'review') {
          resetAnalysis();
        }
    };

    const processFile = async (file: File) => {
        setFileName(file.name);
        setErrors(prev => ({ ...prev, rawText: '' }));
        setIsFileProcessing(true);
        resetAnalysis();
        setFileNote(`Đang xử lý file '${file.name}'...`);
        setRawText('');
    
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
            } else {
                setFileName('');
                setFileNote('Loại file không được hỗ trợ. Vui lòng chọn .txt, .pdf, hoặc .docx.');
                return;
            }
    
            const auditRaw = comparatorAuditLine('PDF_RAW', rawExtractedText);
            const normalizedText = normalizeComparators(text);
            const auditNorm = comparatorAuditLine('PDF_NORMALIZED', normalizedText);
    
            setRawText(normalizedText);
            
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

    const handleAnalyze = async () => {
        if (!rawText.trim()) {
            setErrors(prev => ({ ...prev, rawText: 'Vui lòng nhập nội dung.' }));
            return;
        }

        setFlowState('processing');
        setCleaningError(null);
        setFileNote('');
        setTableOfContents(null);
        setCleanedData(null);

        try {
            const { model, thinkMore } = mcqModelConfig.cleaning;
            const result = await cleanAndRestructureText(rawText, model, thinkMore);

            if (result.cleanedText === 'false') {
                throw new Error("AI không thể xử lý nội dung này.");
            }

            const numberedToc = formatNumberedOutline(result.tableOfContents);
            setRawText(result.cleanedText); // Update rawText to cleaned version for display
            setCleanedData(result);
            setTableOfContents(numberedToc);
            setFileNote('AI đã tái cấu trúc và làm sạch văn bản thành công!');

            // Parse sections for MCQ checklist with LEVELS and PATHS
            const lines = result.cleanedText.split('\n');
            const sections: ParsedSection[] = [];
            
            const stack: { level: number, id: number, title: string }[] = [];

            lines.forEach((line, idx) => {
                const match = line.match(/^(#{2,4})\s+(.+)$/);
                if (match) {
                    const level = match[1].length; // 2, 3, 4
                    const title = match[2].trim();
                    const id = sections.length;
                    
                    // Pop stack until we find a parent with level < current level
                    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                        stack.pop();
                    }

                    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
                    const fullPath = [...stack.map(s => s.title), title].join(' > ');

                    sections.push({ 
                        id,
                        title, 
                        startLine: idx,
                        level,
                        path: fullPath,
                        parentId: parent ? parent.id : null
                    });

                    stack.push({ level, id, title });
                }
            });

            setParsedSections(sections);
            
            // Auto-select all by default
            if (sections.length > 0) {
                 const initialCheck = new Map<number, boolean>();
                 sections.forEach(s => initialCheck.set(s.id, true));
                 setCheckedState(initialCheck);
            }

            setFlowState('review');

        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'Lỗi không xác định khi làm sạch văn bản.';
            setCleaningError(errorMessage);
            setFlowState('idle');
        }
    };

    // --- Tree Logic ---
    
    const getDescendants = useCallback((parentId: number) => {
        const descendants: number[] = [];
        const queue = [parentId];
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const children = parsedSections.filter(s => s.parentId === currentId);
            children.forEach(c => {
                descendants.push(c.id);
                queue.push(c.id);
            });
        }
        return descendants;
    }, [parsedSections]);

    // Moved before toggleNode to ensure it is defined when called
    const computeCheckState = (id: number, stateMap: Map<number, boolean>): 'checked' | 'unchecked' | 'indeterminate' => {
        // A node is checked if it is explicitly true in map.
        const isChecked = stateMap.get(id);
        if (isChecked) return 'checked';
        
        // Check descendants
        const descendants = getDescendants(id);
        // If leaf node and not checked -> unchecked
        if (descendants.length === 0) return 'unchecked';

        const hasCheckedDescendant = descendants.some(dId => stateMap.get(dId));
        
        if (hasCheckedDescendant) return 'indeterminate';
        return 'unchecked';
    };

    const toggleNode = (id: number) => {
        const descendants = getDescendants(id);
        // Explicitly type new Map to prevent 'Map<unknown, unknown>' error
        const newState = new Map<number, boolean>(checkedState);
        
        // Determine new status based on current status of the node
        const currentComputed = computeCheckState(id, newState);
        const targetValue = currentComputed !== 'checked'; // If checked -> uncheck, else check

        // 2. Set this node and ALL descendants to targetValue
        newState.set(id, targetValue);
        descendants.forEach(dId => newState.set(dId, targetValue));
        
        // Bubbling up Logic:
        let parentId = parsedSections[id].parentId;
        while(parentId !== null) {
            const siblings = parsedSections.filter(s => s.parentId === parentId);
            const allSiblingsChecked = siblings.every(s => newState.get(s.id));
            
            if (allSiblingsChecked) {
                newState.set(parentId, true);
            } else {
                newState.set(parentId, false);
            }
            parentId = parsedSections[parentId!].parentId;
        }

        setCheckedState(newState);
    };

    const handleSelectAll = () => {
        const allChecked = parsedSections.every(s => checkedState.get(s.id));
        const newState = new Map<number, boolean>();
        parsedSections.forEach(s => newState.set(s.id, !allChecked));
        setCheckedState(newState);
    }

    // --- Difficulty Logic ---
    const totalDifficulty = difficultyWeights.easy + difficultyWeights.medium + difficultyWeights.hard + difficultyWeights.veryHard;
    const isDifficultyValid = totalDifficulty === 100;

    const handleWeightChange = (key: keyof DifficultyWeights, val: string) => {
        const num = parseInt(val) || 0;
        setDifficultyWeights(prev => ({ ...prev, [key]: Math.max(0, Math.min(100, num)) }));
    };

    // --- Start Generation ---
    const handleStart = () => {
        if (!selectedSpecialty || !cleanedData || !isDifficultyValid) return;
        
        const tasks: { title: string, content: string }[] = [];
        const lines = cleanedData.cleanedText.split('\n');
        
        // Prepare Full Context (Safety Truncated) if allowed
        // Limit to ~35k chars to avoid blowing up context window when added to prompt
        const MAX_CONTEXT_CHARS = 35000;
        let crossSectionContext = "";
        
        if (mcqOptions.allowCrossSectionContext) {
            const fullText = cleanedData.cleanedText;
            if (fullText.length > MAX_CONTEXT_CHARS) {
                crossSectionContext = fullText.substring(0, MAX_CONTEXT_CHARS) + "\n\n...[CONTEXT TRUNCATED FOR SAFETY]...";
            } else {
                crossSectionContext = fullText;
            }
        }

        parsedSections.forEach((sec, index) => {
            // Only process if checked
            if (checkedState.get(sec.id)) {
                const start = sec.startLine;
                let nextSectionLine = lines.length;
                
                // Find end of section
                for (let i = index + 1; i < parsedSections.length; i++) {
                    if (parsedSections[i].level <= sec.level) {
                        nextSectionLine = parsedSections[i].startLine;
                        break;
                    }
                }
                
                const primaryContent = lines.slice(start, nextSectionLine).join('\n').trim();
                
                // Only add if there is substantial content
                if (primaryContent.length > sec.title.length + 5) {
                    
                    let finalContentPayload = "";
                    
                    if (mcqOptions.allowCrossSectionContext) {
                        // Pack both Primary and Related Context
                        finalContentPayload = `
## PRIMARY_SECTION (MUST FOCUS)
${primaryContent}

---
## RELATED_CONTEXT_FROM_SAME_LESSON (OPTIONAL, FOR COMPLEXITY/VIGNETTE)
${crossSectionContext}
`;
                    } else {
                        // Default behavior: just the slice
                        finalContentPayload = primaryContent;
                    }

                    tasks.push({ title: sec.path, content: finalContentPayload });
                }
            }
        });

        if (tasks.length === 0) {
            alert("Vui lòng chọn ít nhất một mục có nội dung.");
            return;
        }

        onStartGeneration(tasks, selectedSpecialty, mcqMode, difficultyWeights, customInstructions, mcqOptions);
    };

    const isProcessing = isFileProcessing || flowState === 'processing';
    const showAnalysisButton = flowState === 'idle';
    const showReview = flowState === 'review';

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 lg:sticky top-8">
            <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <FileTextIcon className="h-6 w-6 text-indigo-600" />
                Thiết lập MCQ
            </h2>

            {/* Process Blueprint Toggle */}
            <div className="mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">
                <button
                    type="button"
                    onClick={() => setShowProcessBlueprint(!showProcessBlueprint)}
                    className="flex items-center text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 focus:outline-none"
                >
                    <ChevronDownIcon className={`h-4 w-4 mr-1 transition-transform ${showProcessBlueprint ? 'rotate-180' : ''}`} />
                    Xem Quy trình Nghiên cứu (Research Process Blueprint)
                </button>
                {showProcessBlueprint && (
                    <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-xs font-mono text-slate-600 dark:text-slate-400 overflow-x-auto border border-slate-200 dark:border-slate-700 max-h-60 overflow-y-auto whitespace-pre-wrap">
                        {MCQ_PROCESS_BLUEPRINT}
                    </div>
                )}
            </div>

            {/* Config Block */}
             <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4 mb-6">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Cấu hình AI</h3>
                <ModelSelector 
                    label="Giai đoạn 1: Làm sạch (Intake)" 
                    config={mcqModelConfig.cleaning} 
                    onModelChange={(v) => setMcqModelConfig({...mcqModelConfig, cleaning: {...mcqModelConfig.cleaning, model: v}})}
                    onThinkMoreChange={(v) => setMcqModelConfig({...mcqModelConfig, cleaning: {...mcqModelConfig.cleaning, thinkMore: v}})}
                    proDescription="Tốt cho tài liệu OCR kém." flashDescription="Nhanh."
                />
                 <ModelSelector 
                    label="Giai đoạn 2: Tạo câu hỏi (Generation)" 
                    config={mcqModelConfig.generation} 
                    onModelChange={(v) => setMcqModelConfig({...mcqModelConfig, generation: {...mcqModelConfig.generation, model: v}})}
                    onThinkMoreChange={(v) => setMcqModelConfig({...mcqModelConfig, generation: {...mcqModelConfig.generation, thinkMore: v}})}
                    proDescription="Suy luận sâu (Tree of Thought), ít lỗi." flashDescription="Tốc độ cao."
                />
            </div>

            {/* Step 1: Mode (Specialty UI removed, defaulted to Nội khoa) */}
            <div className="mb-6">
                <label className="block text-base font-bold text-slate-800 dark:text-slate-200 mb-2">
                    <span className="text-indigo-500 font-black mr-2">1.</span> Chế độ tạo câu hỏi
                </label>
                <div className="flex gap-2">
                     <button
                        onClick={() => setMcqMode('theory')}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-semibold border ${mcqMode === 'theory' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-900/40 dark:border-indigo-500 dark:text-indigo-200' : 'border-slate-300 dark:border-slate-600 text-slate-500 bg-white dark:bg-slate-800'}`}
                    >
                        Lý thuyết
                    </button>
                    <button
                        onClick={() => setMcqMode('case')}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-semibold border ${mcqMode === 'case' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-900/40 dark:border-indigo-500 dark:text-indigo-200' : 'border-slate-300 dark:border-slate-600 text-slate-500 bg-white dark:bg-slate-800'}`}
                    >
                        Case Lâm sàng
                    </button>
                </div>
            </div>

            {/* Step 2: Content Input */}
            <div className="mb-4">
                 <label className="block text-base font-bold text-slate-800 dark:text-slate-200 mb-3">
                    <span className="text-indigo-500 font-black mr-2">2.</span> Dán nội dung hoặc tải lên file bài học
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">Ghi chú: Có thể sử dụng trích nội dung từ Notebook LM sẽ chính xác hơn.</p>
                
                <div 
                    onDrop={handleDrop} 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`mt-2 flex justify-center items-center px-6 pt-5 pb-6 border-2 ${isDragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-300 dark:border-slate-600'} border-dashed rounded-xl transition-colors min-h-[140px]`}
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
                                <label htmlFor="mcq-file-upload" className="relative cursor-pointer bg-transparent rounded-md font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 dark:focus-within:ring-offset-slate-800 focus-within:ring-indigo-500">
                                    <span>Tải lên một file</span>
                                    <input id="mcq-file-upload" name="mcq-file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".txt,.pdf,.docx"/>
                                </label>
                                <p className="pl-1">hoặc kéo và thả</p>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-500 truncate max-w-xs">{fileName || 'Hỗ trợ TXT, PDF, DOCX'}</p>
                        </div>
                    )}
                </div>

                <textarea
                    rows={10}
                    value={rawText}
                    onChange={(e) => handleTextChange(e.target.value)}
                    placeholder="Hoặc dán toàn bộ nội dung bài học của bạn vào đây..."
                    className={`mt-2 block w-full px-3 py-2 bg-white dark:bg-slate-700 border ${errors.rawText ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} text-slate-900 dark:text-white rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y`}
                />
                 {fileNote && <p className={`mt-2 text-sm whitespace-pre-wrap font-mono text-xs ${cleanedData ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{fileNote}</p>}
                 {cleaningError && <p className="mt-2 text-sm text-red-500 dark:text-red-400">{cleaningError}</p>}
                 {errors.rawText && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.rawText}</p>}
            </div>

            {/* Analyze Button */}
            {showAnalysisButton && (
                <button 
                    onClick={handleAnalyze} 
                    disabled={isProcessing || !rawText.trim()}
                    className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-indigo-800 dark:text-indigo-200 bg-indigo-100 dark:bg-indigo-900/40 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed transition-colors duration-300 min-h-[44px]"
                >
                    AI Tái cấu trúc & Phân tích
                </button>
            )}

             {flowState === 'processing' && (
                 <div className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-indigo-800 dark:text-indigo-200 bg-indigo-100 dark:bg-indigo-900/40 disabled:cursor-not-allowed transition-colors duration-300 min-h-[44px]">
                   <MiniSpinner className="text-indigo-800 dark:text-indigo-200 mr-2" />
                   <span>Đang phân tích...</span>
                </div>
            )}

            {/* Review & Post-Analysis */}
            {showReview && (
                <div className="space-y-6 animate-fadeIn mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                    
                     {/* TOC Display */}
                     {tableOfContents && (
                        <div className="p-4 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Mục lục Bài học</h4>
                                <CopyButton textToCopy={tableOfContents} label="Sao chép mục lục" />
                            </div>
                            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-slate-600 dark:text-slate-300 font-mono" dangerouslySetInnerHTML={{ __html: tableOfContents.replace(/ /g, '&nbsp;').replace(/\n/g, '<br/>') }} />
                        </div>
                    )}

                    {/* Pre-Flight Check */}
                     <div className="p-4 bg-amber-50 dark:bg-slate-700/50 border-l-4 border-amber-500 rounded-r-lg shadow-md">
                        <h3 className="flex items-center text-lg font-bold text-amber-900 dark:text-amber-200 mb-4">
                            <AlertTriangleIcon className="h-6 w-6 mr-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            Pre-Flight Check: Xem lại & Chọn phần
                        </h3>
                        <div className="text-sm space-y-2 text-slate-600 dark:text-slate-400">
                            <p><strong>Chuyên khoa:</strong> {selectedSpecialty}</p>
                            <p><strong>Chế độ:</strong> {mcqMode === 'case' ? 'Case Lâm sàng' : 'Lý thuyết'}</p>
                            <p><strong>Phân đoạn tìm thấy:</strong> {parsedSections.length}</p>
                        </div>
                         <button 
                            type="button" 
                            onClick={resetAnalysis}
                            className="mt-4 text-xs text-slate-500 hover:underline"
                         >
                            Chạy lại phân tích
                         </button>
                     </div>

                    {/* Section Selection Checklist (Tree) */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-semibold">Chọn các phần (Sections) để tạo câu hỏi</label>
                            <button onClick={handleSelectAll} className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                                Đảo chọn
                            </button>
                        </div>
                        <div className="max-h-80 overflow-y-auto border border-slate-300 dark:border-slate-600 rounded-lg p-2 bg-slate-50 dark:bg-slate-900/50">
                            {parsedSections.length === 0 ? (
                                <p className="p-4 text-center text-sm text-slate-500">Không tìm thấy đề mục nào. Vui lòng kiểm tra lại văn bản sạch.</p>
                            ) : (
                                <div className="space-y-1">
                                    {parsedSections.map((sec) => {
                                        const checkState = computeCheckState(sec.id, checkedState);
                                        const isChecked = checkState === 'checked';
                                        const isIndeterminate = checkState === 'indeterminate';

                                        // Indent based on level (2 -> 0, 3 -> 4, 4 -> 8)
                                        const indentClass = sec.level <= 2 ? 'ml-0' : sec.level === 3 ? 'ml-6' : 'ml-12';
                                        const fontClass = sec.level <= 2 ? 'font-bold text-slate-800 dark:text-slate-200' : 'font-medium text-slate-700 dark:text-slate-300';
                                        
                                        return (
                                            <div key={sec.id} className={`${indentClass} flex items-center`}>
                                                <label className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors w-full ${isChecked ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                                    <IndeterminateCheckbox
                                                        checked={isChecked}
                                                        indeterminate={isIndeterminate}
                                                        onChange={() => toggleNode(sec.id)}
                                                        className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                    />
                                                    <span className={`text-sm truncate ${fontClass}`} title={sec.path}>
                                                        {sec.title}
                                                    </span>
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Difficulty Weights UI */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg">
                        <label className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">
                            Trọng số độ khó (%) <span className={isDifficultyValid ? "text-emerald-500" : "text-red-500"}>
                                (Tổng: {totalDifficulty}%)
                            </span>
                        </label>
                        <div className="grid grid-cols-4 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-green-600 mb-1">Dễ</label>
                                <input 
                                    type="number" 
                                    min="0" max="100" 
                                    value={difficultyWeights.easy}
                                    onChange={(e) => handleWeightChange('easy', e.target.value)}
                                    className="w-full p-2 text-sm border rounded dark:bg-slate-800 dark:border-slate-600"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-yellow-600 mb-1">Trung bình</label>
                                <input 
                                    type="number" 
                                    min="0" max="100" 
                                    value={difficultyWeights.medium}
                                    onChange={(e) => handleWeightChange('medium', e.target.value)}
                                    className="w-full p-2 text-sm border rounded dark:bg-slate-800 dark:border-slate-600"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-red-600 mb-1">Khó</label>
                                <input 
                                    type="number" 
                                    min="0" max="100" 
                                    value={difficultyWeights.hard}
                                    onChange={(e) => handleWeightChange('hard', e.target.value)}
                                    className="w-full p-2 text-sm border rounded dark:bg-slate-800 dark:border-slate-600"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-purple-600 mb-1">Rất khó</label>
                                <input 
                                    type="number" 
                                    min="0" max="100" 
                                    value={difficultyWeights.veryHard}
                                    onChange={(e) => handleWeightChange('veryHard', e.target.value)}
                                    className="w-full p-2 text-sm border rounded dark:bg-slate-800 dark:border-slate-600"
                                />
                            </div>
                        </div>
                        {!isDifficultyValid && (
                            <p className="text-xs text-red-500 mt-2 font-semibold">Tổng trọng số phải bằng 100%. Vui lòng điều chỉnh lại.</p>
                        )}
                    </div>

                    {/* Advanced Options (Feature Flags) */}
                    <div>
                        <button
                            type="button"
                            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                            className="flex items-center text-sm font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                            <ChevronDownIcon className={`h-4 w-4 mr-2 transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`} />
                            Tùy chọn Nâng cao (Experimental)
                        </button>
                        
                        {showAdvancedOptions && (
                            <div className="mt-3 p-4 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3">
                                <div className="flex items-start">
                                    <input
                                        id="allowCrossSection"
                                        type="checkbox"
                                        checked={mcqOptions.allowCrossSectionContext}
                                        onChange={(e) => setMcqOptions(prev => ({...prev, allowCrossSectionContext: e.target.checked}))}
                                        className="mt-1 h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                    />
                                    <div className="ml-2">
                                        <label htmlFor="allowCrossSection" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                                            Cho phép dùng kiến thức chéo (Cross-Section Context)
                                        </label>
                                        <p className="text-xs text-slate-500">AI được phép dùng thêm kiến thức từ các phần khác trong bài để tăng độ khó. (Cảnh báo: Tăng lượng token sử dụng).</p>
                                    </div>
                                </div>
                                <div className="flex items-start">
                                    <input
                                        id="allowExternalSources"
                                        type="checkbox"
                                        checked={mcqOptions.allowExternalSources}
                                        onChange={(e) => setMcqOptions(prev => ({...prev, allowExternalSources: e.target.checked}))}
                                        className="mt-1 h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                    />
                                    <div className="ml-2">
                                        <label htmlFor="allowExternalSources" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                                            [NGUY HIỂM] Cho phép dùng Nguồn ngoài (External Sources)
                                        </label>
                                        <p className="text-xs text-red-500">AI được phép dùng kiến thức ngoài tài liệu (WHO, NEJM...). Cảnh báo: Nguy cơ Hallucination cao và khó kiểm chứng Quote.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Custom Instructions (Similar to Cloze) */}
                    <div>
                        <label htmlFor="customInstructions" className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">
                          Yêu cầu tùy chỉnh (Tùy chọn)
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
                                placeholder="Ví dụ: Tập trung vào chẩn đoán phân biệt..."
                                className="block w-full px-3 py-2 bg-white dark:bg-slate-700 border-t border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-b-lg placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 sm:text-sm resize-y"
                            />
                        </div>
                    </div>

                    <button 
                        onClick={handleStart}
                        disabled={Array.from(checkedState.values()).filter(v => v).length === 0 || !isDifficultyValid}
                        className="w-full py-4 bg-emerald-600 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-95 flex justify-center items-center gap-2"
                    >
                        <span>🚀 Bắt đầu Tạo MCQ</span>
                    </button>
                </div>
            )}
        </div>
    );
};