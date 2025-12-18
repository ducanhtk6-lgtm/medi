import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { SpacedRepetitionDB, EssayTopic, ConversationTurn, ModelConfig, ModelStageConfig } from '../types';
import { cleanAndRestructureText, getEssayGraderResponse } from '../services/geminiService';
import { normalizeComparators } from '../services/comparatorGuard';
import { LoadingSpinner } from './LoadingSpinner';
import { EditIcon, BrainCircuitIcon, UploadCloudIcon, HistoryIcon } from './Icons';
import { ModelSelector } from './ModelSelector';
import { HistoryModal } from './HistoryModal';

declare var mammoth: any;
declare var pdfjsLib: any;

type View = 'dashboard' | 'session' | 'grading_report';
type SessionStatus = 'idle' | 'cleaning' | 'selecting_section' |'writing' | 'interacting' | 'grading' | 'graded';
type InputMethod = 'upload' | 'paste';

interface EssayGraderPanelProps {
    modelConfig: ModelConfig;
    onModelConfigChange: (task: keyof ModelConfig, field: keyof ModelStageConfig, value: string | boolean) => void;
}

const initialSrDb: SpacedRepetitionDB = {
  topics: [
    {"id":"T01","title":"Cấp cứu ngừng thở ngừng tim","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T02","title":"Hôn mê trẻ em: Tiếp cận chẩn đoán và xử trí","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T03","title":"Sốc trẻ em: Tiếp cận chẩn đoán và xử trí","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T04","title":"Ngộ độc cấp trẻ em","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T05","title":"Rối loạn nước và điện giải","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T06","title":"Hen trẻ em","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T07","title":"Viêm phổi cộng đồng trẻ em","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T08","title":"Viêm tiểu phế quản","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T09","title":"Viêm màng não vi khuẩn trẻ em","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T10","title":"Bệnh tay chân miệng trẻ em","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T11","title":"Hội chứng thận hư","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T12","title":"Viêm cầu thận cấp","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T13","title":"Nhiễm trùng tiểu","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T14","title":"Suy giáp ở trẻ em","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T15","title":"Xuất huyết giảm tiểu cầu miễn dịch","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T16","title":"Thiếu máu thiếu sắt ở trẻ nhũ nhi","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T17","title":"Tiêu chảy cấp","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T18","title":"Nuôi con bằng sữa mẹ","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T19","title":"Suy tim trẻ em","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T20","title":"Vàng da tăng bilirubin gián tiếp","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T21","title":"Nhiễm trùng sơ sinh","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
    {"id":"T22","title":"Suy hô hấp sơ sinh","attempts":0,"last_review":null,"last_rating":null,"next_due":null,"interval_days":0,"error_notes":[]},
  ],
  "history": []
};

const standardIntervals = [1, 3, 7, 14, 30, 60];

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const FormattedHierarchicalText: React.FC<{ text: string }> = ({ text }) => {
    // This component correctly handles paragraphs with line breaks and markdown list blocks.
    const blocks = text.split(/\n\s*\n/); // Split by blank lines

    const html = blocks.map(block => {
        if (block.trim() === '') return '';

        let processedBlock = block
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');

        // Check if it's a list block
        if (/^\s*(-|\*|\+)\s/.test(processedBlock)) {
            const listItems = processedBlock.split('\n').map(item => {
                // This will render nested lists with simple indentation
                const indentMatch = item.match(/^(\s*)/);
                const indentLevel = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
                const content = item.replace(/^\s*(-|\*|\+)\s/, '');
                return `<li style="margin-left: ${indentLevel * 1.5}em;">${content}</li>`;
            }).join('');
            return `<ul class="list-disc pl-5 space-y-1">${listItems}</ul>`;
        }
        
        // It's a paragraph
        return `<p>${processedBlock.replace(/\n/g, '<br />')}</p>`;
    }).join('');

    return (
        <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
    );
};


export const EssayGraderPanel: React.FC<EssayGraderPanelProps> = ({ modelConfig, onModelConfigChange }) => {
    const [srsData, setSrsData] = useState<SpacedRepetitionDB>(initialSrDb);
    const [view, setView] = useState<View>('dashboard');
    
    const [activeTopic, setActiveTopic] = useState<EssayTopic | null>(null);
    const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
    const [rawText, setRawText] = useState('');
    const [cleanedText, setCleanedText] = useState('');
    const [tableOfContents, setTableOfContents] = useState<string | null>(null);
    const [selectedSection, setSelectedSection] = useState('');
    const [userAnswer, setUserAnswer] = useState('');
    const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
    const [lastGradingReport, setLastGradingReport] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const conversationEndRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [fileName, setFileName] = useState('');
    const [inputMethod, setInputMethod] = useState<InputMethod>('upload');

    // State for history modal
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [selectedTopicForHistory, setSelectedTopicForHistory] = useState<EssayTopic | null>(null);

    useEffect(() => {
        try {
            const savedData = localStorage.getItem('srs-essay-data');
            if (savedData) setSrsData(JSON.parse(savedData));
        } catch (e) {
            console.error("Failed to load data from localStorage", e);
            localStorage.removeItem('srs-essay-data');
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem('srs-essay-data', JSON.stringify(srsData));
        } catch (e) {
            console.error("Failed to save SRS data to localStorage", e);
        }
    }, [srsData]);

    useEffect(() => {
        conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [conversationHistory]);


    const todayPlan = useMemo(() => {
        const today = getTodayDateString();
        const due = srsData.topics.filter(t => t.next_due && t.next_due <= today);
        const newTopics = srsData.topics.filter(t => t.attempts === 0);
        
        const sortedDue = due.sort((a, b) => (a.last_rating ?? 3) - (b.last_rating ?? 3));
        return { due: sortedDue, new: newTopics };
    }, [srsData]);

    const calculateNewInterval = (topic: EssayTopic, rating: number): Pick<EssayTopic, 'interval_days' | 'next_due'> => {
        const currentAttemptIndex = Math.min(topic.attempts, standardIntervals.length - 1);
        let newIntervalIndex = currentAttemptIndex;

        switch(rating) {
            case 3: newIntervalIndex = Math.min(currentAttemptIndex + 1, standardIntervals.length - 1); break;
            case 2: newIntervalIndex = currentAttemptIndex; break;
            case 1: newIntervalIndex = Math.max(currentAttemptIndex - 1, 0); break;
            case 0: newIntervalIndex = 0; break;
        }

        const interval_days = standardIntervals[newIntervalIndex];
        const nextDueDate = new Date();
        nextDueDate.setDate(nextDueDate.getDate() + interval_days);
        const next_due = nextDueDate.toISOString().split('T')[0];

        return { interval_days, next_due };
    };

    const handleStartSession = (topic: EssayTopic) => {
        setActiveTopic(topic);
        setSessionStatus('idle');
        setRawText('');
        setCleanedText('');
        setTableOfContents(null);
        setSelectedSection('');
        setUserAnswer('');
        setConversationHistory([]);
        setLastGradingReport(null);
        setError(null);
        setFileName('');
        setInputMethod('upload');
        setView('session');
    };
    
     const handleFileProcess = async (file: File) => {
        setSessionStatus('cleaning');
        setError(null);
        setFileName(file.name);

        try {
            let text = '';
            if (file.type === 'text/plain') {
                text = await file.text();
            } else if (file.type === 'application/pdf') {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    text += textContent.items.map((item: any) => item.str).join(' ') + '\n\n';
                }
            } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                text = result.value;
            } else {
                throw new Error('Loại file không được hỗ trợ: .txt, .pdf, .docx.');
            }
            const normalizedText = normalizeComparators(text);
            setRawText(normalizedText);
            const { model, thinkMore } = modelConfig.essayCleaning;
            const cleanedResult = await cleanAndRestructureText(normalizedText, model, thinkMore);
            setCleanedText(cleanedResult.cleanedText);
            setTableOfContents(cleanedResult.tableOfContents);
            setSessionStatus('selecting_section');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Lỗi không xác định khi xử lý file.');
            setSessionStatus('idle');
        }
    };

    const handleUseCleanedText = () => {
        if (!rawText.trim()) {
            setError("Vui lòng dán nội dung vào ô văn bản.");
            return;
        }
        setError(null);
        setCleanedText(normalizeComparators(rawText));
        setTableOfContents(null);
        setSessionStatus('selecting_section');
    };

    const handleInteractiveCommand = async (mode: 'check' | 'hint' | 'hint++', commandText: string) => {
        if (!userAnswer.trim() || !activeTopic || !selectedSection) return;
        const newHistory: ConversationTurn[] = [...conversationHistory, { role: 'user', content: commandText }];
        setConversationHistory(newHistory);
        setSessionStatus('interacting');
        
        try {
            const { model, thinkMore } = modelConfig.essayInteraction;
            const normalizedAnswer = normalizeComparators(userAnswer);
            const response = await getEssayGraderResponse(mode, cleanedText, selectedSection, normalizedAnswer, newHistory, model, thinkMore);
            if(typeof response === 'string') {
                setConversationHistory(prev => [...prev, { role: 'model', content: response }]);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Lỗi tương tác với AI.';
            setConversationHistory(prev => [...prev, { role: 'model', content: `LỖI: ${errorMessage}` }]);
        } finally {
            setSessionStatus('writing');
        }
    };

    const handleGradeAndRate = async () => {
        if (!userAnswer.trim() || !activeTopic || !selectedSection) return;
        const newHistory: ConversationTurn[] = [...conversationHistory, { role: 'user', content: '[[NỘP BÀI VÀ CHẤM ĐIỂM]]' }];
        setConversationHistory(newHistory);
        setSessionStatus('grading');

        try {
            const { model, thinkMore } = modelConfig.essayGrading;
            const normalizedAnswer = normalizeComparators(userAnswer);
            const response = await getEssayGraderResponse('grade', cleanedText, selectedSection, normalizedAnswer, newHistory, model, thinkMore);
            if (typeof response !== 'object') {
                throw new Error("AI response was not in the expected format.");
            }
            
            const { gradingReport, srsRating } = response;
            setLastGradingReport(gradingReport);
            
            setSrsData(prevDb => {
                const topicIndex = prevDb.topics.findIndex(t => t.id === activeTopic.id);
                if (topicIndex === -1) return prevDb;

                const originalTopic = prevDb.topics[topicIndex];
                const { interval_days, next_due } = calculateNewInterval(originalTopic, srsRating);

                const updatedTopic: EssayTopic = {
                    ...originalTopic,
                    attempts: originalTopic.attempts + 1,
                    last_review: getTodayDateString(),
                    last_rating: srsRating,
                    interval_days,
                    next_due
                };

                const newTopics = [...prevDb.topics];
                newTopics[topicIndex] = updatedTopic;
                
                const newHistoryItem = {
                    topicId: activeTopic.id,
                    review_date: getTodayDateString(),
                    rating: srsRating,
                    notes: "Graded by AI."
                };

                return {
                    topics: newTopics,
                    history: [...prevDb.history, newHistoryItem]
                };
            });
            
            setSessionStatus('graded');
            setView('grading_report');

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Lỗi khi chấm bài.';
            setConversationHistory(prev => [...prev, { role: 'model', content: `LỖI: ${errorMessage}` }]);
            setSessionStatus('writing');
        }
    };
    
    const handleUserAnswerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setUserAnswer(val);
    };

    const handleViewHistory = (topic: EssayTopic) => {
        setSelectedTopicForHistory(topic);
        setIsHistoryModalOpen(true);
    };

    const renderDashboard = () => (
        <div>
            <div className="mb-8 p-4 bg-sky-50 dark:bg-slate-700/50 border-l-4 border-sky-500 rounded-r-lg">
                <h2 className="text-xl font-bold text-sky-800 dark:text-sky-200">Kế hoạch Ôn tập Hôm nay</h2>
                {(todayPlan.due.length === 0 && todayPlan.new.length === 0) && <p className="text-sm mt-2 text-slate-600 dark:text-slate-300">Tuyệt vời! Bạn đã hoàn thành hết các bài cần ôn.</p>}
                
                {todayPlan.due.length > 0 && (
                    <div className="mt-2">
                        <h3 className="font-semibold text-slate-800 dark:text-slate-200">Đến hạn ôn tập ({todayPlan.due.length}):</h3>
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                            {todayPlan.due.map(topic => (
                                <li key={topic.id} className="text-sm">
                                    <button onClick={() => handleStartSession(topic)} className="text-sky-600 dark:text-sky-400 hover:underline">{topic.title}</button>
                                    <span className="text-xs text-slate-500 ml-2">(Lần cuối: {topic.last_review}, Rating: {topic.last_rating})</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                 {todayPlan.new.length > 0 && (
                    <div className="mt-3">
                        <h3 className="font-semibold text-slate-800 dark:text-slate-200">Bài mới ({todayPlan.new.length}):</h3>
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                            {todayPlan.new.map(topic => (
                                <li key={topic.id} className="text-sm">
                                    <button onClick={() => handleStartSession(topic)} className="text-emerald-600 dark:text-emerald-400 hover:underline">{topic.title}</button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

             <div className="mt-8 mb-8 p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Cấu hình AI (Luyện thi)</h3>
                <ModelSelector
                    label="Giai đoạn 1: Làm sạch & Tái cấu trúc file"
                    config={modelConfig.essayCleaning}
                    onModelChange={(model) => onModelConfigChange('essayCleaning', 'model', model)}
                    onThinkMoreChange={(checked) => onModelConfigChange('essayCleaning', 'thinkMore', checked)}
                    proDescription="Phân tích sâu, tái cấu trúc tài liệu phức tạp tốt hơn."
                    flashDescription="Tốc độ nhanh, phù hợp với văn bản đã sạch."
                />
                 <ModelSelector
                    label="Giai đoạn 2: Tương tác & Gợi ý (Check, Hint)"
                    config={modelConfig.essayInteraction}
                    onModelChange={(model) => onModelConfigChange('essayInteraction', 'model', model)}
                    onThinkMoreChange={(checked) => onModelConfigChange('essayInteraction', 'thinkMore', checked)}
                    proDescription="Gợi ý chi tiết, sâu sắc hơn."
                    flashDescription="Phản hồi tức thì, giữ nhịp độ luyện tập."
                />
                 <ModelSelector
                    label="Giai đoạn 3: Chấm điểm chi tiết"
                    config={modelConfig.essayGrading}
                    onModelChange={(model) => onModelConfigChange('essayGrading', 'model', model)}
                    onThinkMoreChange={(checked) => onModelConfigChange('essayGrading', 'thinkMore', checked)}
                    proDescription="Chấm điểm nghiêm khắc, phân tích lỗi sai cặn kẽ."
                    flashDescription="Chấm điểm nhanh, tổng quan."
                />
            </div>

            <div>
                <h2 className="text-xl font-bold mb-3 text-slate-800 dark:text-slate-100">Toàn bộ tiến độ</h2>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-100 dark:bg-slate-700/50 text-xs uppercase text-slate-700 dark:text-slate-400">
                            <tr>
                                <th className="p-3">Bài tự luận</th>
                                <th className="p-3 text-center">Lần ôn</th>
                                <th className="p-3 text-center">Rating cuối</th>
                                <th className="p-3">Ngày ôn cuối</th>
                                <th className="p-3">Ngày ôn tới</th>
                                <th className="p-3 text-center">Lịch sử</th>
                            </tr>
                        </thead>
                        <tbody>
                            {srsData.topics.map((topic, index) => (
                                <tr key={topic.id} className={`border-b dark:border-slate-800 ${index % 2 === 0 ? 'bg-white dark:bg-slate-800/50' : 'bg-slate-50 dark:bg-slate-800'}`}>
                                    <td className="p-3 font-medium text-slate-900 dark:text-slate-100">
                                         <button onClick={() => handleStartSession(topic)} className="text-left hover:text-sky-500 transition-colors">{topic.title}</button>
                                    </td>
                                    <td className="p-3 text-center text-slate-500 dark:text-slate-400">{topic.attempts}</td>
                                    <td className="p-3 text-center text-slate-500 dark:text-slate-400">{topic.last_rating ?? 'N/A'}</td>
                                    <td className="p-3 text-slate-500 dark:text-slate-400">{topic.last_review ?? 'Chưa ôn'}</td>
                                    <td className="p-3 font-semibold text-sky-600 dark:text-sky-400">{topic.next_due ?? 'N/A'}</td>
                                    <td className="p-3 text-center">
                                        <button 
                                          onClick={() => handleViewHistory(topic)}
                                          className="p-1.5 text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                          aria-label={`Xem lịch sử cho ${topic.title}`}
                                          title="Xem lịch sử"
                                        >
                                            <HistoryIcon className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderSession = () => {
        if (!activeTopic) return null;
        
        const isProcessing = ['cleaning', 'interacting', 'grading'].includes(sessionStatus);
        const isInputDisabled = isProcessing || sessionStatus === 'graded';

        return (
            <div>
                 <button onClick={() => setView('dashboard')} className="mb-4 text-sm text-sky-500 hover:underline">&larr; Quay lại Bảng điều khiển</button>
                 <h2 className="text-xl font-bold mb-2">Luyện tập: <span className="text-sky-500">{activeTopic.title}</span></h2>

                {sessionStatus === 'idle' && (
                     <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                        <h3 className="font-semibold text-center text-lg">Bước 1: Cung cấp tài liệu gốc</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4">Chọn cách cung cấp nội dung cho buổi học.</p>
                        
                        <div className="flex justify-center border-b dark:border-slate-600 mb-4">
                            <button 
                                onClick={() => setInputMethod('upload')} 
                                className={`py-2 px-4 font-semibold text-sm transition-colors duration-200 ${inputMethod === 'upload' ? 'border-b-2 border-sky-500 text-sky-600 dark:text-sky-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border-b-2 border-transparent'}`}
                            >
                                Tải file gốc (AI làm sạch)
                            </button>
                             <button 
                                onClick={() => setInputMethod('paste')} 
                                className={`py-2 px-4 font-semibold text-sm transition-colors duration-200 ${inputMethod === 'paste' ? 'border-b-2 border-sky-500 text-sky-600 dark:text-sky-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border-b-2 border-transparent'}`}
                            >
                                Dán văn bản sạch (Nhanh)
                            </button>
                        </div>

                        {inputMethod === 'upload' ? (
                            <div>
                                <p className="text-center text-sm text-slate-500 dark:text-slate-400 mb-4">Tải lên file PDF, DOCX, hoặc TXT. AI sẽ đọc, làm sạch và tái cấu trúc nó.</p>
                                <div 
                                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); if (e.dataTransfer.files?.[0]) handleFileProcess(e.dataTransfer.files[0]); }} 
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
                                    className={`mx-auto max-w-lg flex justify-center items-center px-6 py-10 border-2 ${isDragging ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'border-slate-300 dark:border-slate-600'} border-dashed rounded-xl transition-colors`}
                                >
                                    <div className="space-y-1 text-center">
                                        <UploadCloudIcon className="mx-auto h-10 w-10 text-slate-400"/>
                                        <div className="flex text-sm text-slate-600 dark:text-slate-400">
                                            <label htmlFor="file-upload-srs" className="relative cursor-pointer bg-transparent rounded-md font-medium text-sky-600 dark:text-sky-400 hover:text-sky-500">
                                                <span>Tải lên file</span>
                                                <input id="file-upload-srs" name="file-upload-srs" type="file" className="sr-only" onChange={(e) => { if(e.target.files?.[0]) handleFileProcess(e.target.files[0]); e.target.value = ''; }} accept=".txt,.pdf,.docx"/>
                                            </label>
                                            <p className="pl-1">hoặc kéo và thả</p>
                                        </div>
                                        <p className="text-xs text-slate-500">{fileName || 'Hỗ trợ TXT, PDF, DOCX'}</p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                             <div>
                                <p className="text-center text-sm text-slate-500 dark:text-slate-400 mb-4">Dán trực tiếp nội dung đã được làm sạch.</p>
                                <textarea
                                    value={rawText}
                                    onChange={(e) => { setRawText(e.target.value); if(error) setError(null); }}
                                    rows={15}
                                    className="w-full p-3 border rounded-md resize-y bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 focus:ring-sky-500 focus:border-sky-500"
                                    placeholder="Dán nội dung từ Notebook LM của bạn vào đây..."
                                />
                                <button
                                    onClick={handleUseCleanedText}
                                    disabled={!rawText.trim()}
                                    className="mt-4 w-full py-2 px-4 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                >
                                    Bắt đầu Luyện tập với Văn bản này
                                </button>
                            </div>
                        )}
                     </div>
                )}
                
                {sessionStatus === 'selecting_section' && (
                    <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                        <h3 className="font-semibold text-center text-lg">Bước 2: Chọn phần cần luyện viết</h3>
                        {tableOfContents && (
                            <div className="mt-4 mb-4 p-4 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg">
                                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">Mục lục gợi ý</h4>
                                <pre className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-slate-600 dark:text-slate-300 font-mono">{tableOfContents}</pre>
                            </div>
                        )}
                        <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4">
                            {tableOfContents ? 'Dựa vào mục lục trên, hãy' : 'Hãy'} nhập tên phần chính bạn muốn ôn tập (ví dụ: "Lâm sàng").
                        </p>
                        <input
                            type="text"
                            value={selectedSection}
                            onChange={(e) => setSelectedSection(e.target.value)}
                            placeholder="Ví dụ: Lâm sàng"
                            className="w-full p-2 border rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                        />
                         <button
                            onClick={() => {if(selectedSection.trim()) setSessionStatus('writing')}}
                            disabled={!selectedSection.trim()}
                            className="mt-4 w-full py-2 px-4 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
                        >
                            Bắt đầu viết
                        </button>
                    </div>
                )}

                {sessionStatus === 'cleaning' && (
                     <div className="text-center p-6">
                        <LoadingSpinner />
                        <p className="mt-2 font-semibold">AI đang phân tích và làm sạch tài liệu...</p>
                    </div>
                )}
                
                {error && (
                    <div className="text-center text-red-500 p-4 bg-red-50 dark:bg-red-900/30 rounded-lg">
                        <p><strong>Lỗi:</strong> {error}</p>
                        <button onClick={() => { setError(null); setSessionStatus('idle'); }} className="mt-2 py-1 px-3 bg-red-500 text-white rounded">Thử lại</button>
                    </div>
                )}

                { (sessionStatus === 'writing' || sessionStatus === 'interacting' || sessionStatus === 'grading') && (
                    <div className="grid lg:grid-cols-2 gap-4 mt-4 h-[70vh]">
                        <div className="flex flex-col">
                            <h3 className="font-semibold mb-2 flex-shrink-0">Bước 3: Viết bài (Closed-book) cho phần "{selectedSection}"</h3>
                            <textarea
                                value={userAnswer}
                                onChange={handleUserAnswerChange}
                                placeholder="Viết câu trả lời của bạn ở đây..."
                                className="w-full flex-grow p-3 border rounded-md resize-none bg-white dark:bg-slate-700/50 text-slate-900 dark:text-slate-100"
                                disabled={isInputDisabled}
                            />
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2 flex-shrink-0">
                                <button onClick={() => handleInteractiveCommand('check', '[[CHECK]]')} disabled={isInputDisabled} className="py-2 px-3 bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors">Check</button>
                                <button onClick={() => handleInteractiveCommand('hint', '[[HINT]]')} disabled={isInputDisabled} className="py-2 px-3 bg-cyan-500 text-white font-semibold rounded-lg hover:bg-cyan-600 disabled:opacity-50 transition-colors">Hint</button>
                                <button onClick={() => handleInteractiveCommand('hint++', '[[HINT ++]]')} disabled={isInputDisabled} className="py-2 px-3 bg-cyan-700 text-white font-semibold rounded-lg hover:bg-cyan-800 disabled:opacity-50 transition-colors">Hint ++</button>
                                <button onClick={handleGradeAndRate} disabled={isInputDisabled || !userAnswer.trim()} className="py-2 px-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">NỘP BÀI</button>
                            </div>
                        </div>

                        <div className="bg-slate-100 dark:bg-slate-800/50 p-3 rounded-md flex flex-col h-full">
                            <h3 className="font-semibold border-b pb-2 mb-2 flex-shrink-0 text-slate-800 dark:text-slate-200">Góp ý từ Giáo sư AI</h3>
                            <div className="overflow-y-auto flex-grow">
                                <div className="space-y-4 text-sm pr-2">
                                    {conversationHistory.map((turn, index) => (
                                         <div key={index} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[85%] p-3 rounded-xl ${turn.role === 'user' ? 'bg-sky-500 text-white' : 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>
                                                 <FormattedHierarchicalText text={turn.content} />
                                            </div>
                                        </div>
                                    ))}
                                    {isProcessing && <div className="flex justify-center py-4"><LoadingSpinner /></div>}
                                    <div ref={conversationEndRef} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderGradingReport = () => {
        if (!lastGradingReport) return null;

        const harshQuoteIdentifier = "🙂Học thì dốt , làm việc thì lười biếng";
        const fullHarshQuote = `🙂Học thì dốt , làm việc thì lười biếng\nMà lúc nào cũng muốn làm người tài giỏi\nNgoài đời không có chuyện vô lý như vậy đâu”\nBẠN ĐỪNG CÓ MÀ MƠ👇`;
        const isHarsh = lastGradingReport.includes(harshQuoteIdentifier);

        let reportContent = lastGradingReport.replace(fullHarshQuote, "").trim();

        return (
             <div className="p-4 md:p-6">
                <div className="max-w-4xl mx-auto">
                    <div className="p-4 md:p-6 rounded-lg bg-emerald-50 dark:bg-slate-800/50 border border-emerald-200 dark:border-emerald-700/50 shadow-xl">
                        <h4 className="font-bold text-emerald-800 dark:text-emerald-300 mb-4 text-center text-2xl">Báo cáo Chấm điểm</h4>
                        {isHarsh && (
                            <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/40 border-l-4 border-red-500 rounded-md">
                                <pre className="whitespace-pre-wrap font-sans text-red-700 dark:text-red-300 font-semibold text-center">{fullHarshQuote}</pre>
                            </div>
                        )}
                        <div className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300 leading-relaxed">
                            <FormattedHierarchicalText text={reportContent} />
                        </div>
                    </div>
                     <div className="mt-6 text-center">
                        <button
                            onClick={() => { setView('dashboard'); setLastGradingReport(null); }}
                            className="py-2 px-8 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 transition-colors duration-200"
                        >
                            Đã xem & Quay lại Bảng điều khiển
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    const renderContent = () => {
        switch(view) {
            case 'dashboard': return renderDashboard();
            case 'session': return renderSession();
            case 'grading_report': return renderGradingReport();
            default: return renderDashboard();
        }
    }

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 min-h-[500px]">
            {renderContent()}
            {isHistoryModalOpen && selectedTopicForHistory && (
                <HistoryModal
                    isOpen={isHistoryModalOpen}
                    onClose={() => setIsHistoryModalOpen(false)}
                    topic={selectedTopicForHistory}
                    history={srsData.history.filter(h => h.topicId === selectedTopicForHistory.id)}
                />
            )}
        </div>
    );
};
