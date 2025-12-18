import React, { useState, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { OutputPanel } from './components/OutputPanel';
import { ReviewPanel } from './components/ReviewPanel';
import { ReviewSession } from './components/ReviewSession';
import { EssayGraderPanel } from './components/EssayGraderPanel';
import { LightbulbIcon, BrainCircuitIcon, EditIcon } from './components/Icons';
import { generateClozeFlashcards } from './services/geminiService';
import { calculateSrsParameters, createNewReviewableCard, getNextDueDate } from './services/srsService';
import type { FlashcardData, Specialty, ReviewableFlashcard, ModelConfig, ModelStageConfig, ClozeType } from './types';

const App: React.FC = () => {
  // Generator state
  const [generatedFlashcards, setGeneratedFlashcards] = useState<FlashcardData[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // App state
  const [activeTab, setActiveTab] = useState<'generator' | 'review' | 'essayGrader'>('generator');
  const [deck, setDeck] = useState<ReviewableFlashcard[]>([]);
  const [reviewSessionCards, setReviewSessionCards] = useState<ReviewableFlashcard[] | null>(null);
  
  // Shared Model Configuration State
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    clozeCleaning: { model: 'gemini-3-pro-preview', thinkMore: true },
    clozeAdvisor: { model: 'gemini-3-pro-preview', thinkMore: true },
    clozeGeneration: { model: 'gemini-3-pro-preview', thinkMore: true },
    essayCleaning: { model: 'gemini-3-pro-preview', thinkMore: true },
    essayInteraction: { model: 'gemini-2.5-flash', thinkMore: false },
    essayGrading: { model: 'gemini-3-pro-preview', thinkMore: true },
  });

  // Load deck and model config from local storage on initial render
  useEffect(() => {
    try {
      const savedDeck = localStorage.getItem('anki-deck');
      if (savedDeck) setDeck(JSON.parse(savedDeck));

      const savedModelConfig = localStorage.getItem('srs-model-config');
      if (savedModelConfig) {
          const parsedConfig = JSON.parse(savedModelConfig);
          // Ensure all keys are present and structure is valid to avoid errors with older configs
          setModelConfig(prev => ({...prev, ...parsedConfig}));
      }
    } catch (e) {
      console.error("Failed to load data from local storage", e);
      localStorage.removeItem('anki-deck');
      localStorage.removeItem('srs-model-config');
    }
  }, []);

  // Save deck to local storage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('anki-deck', JSON.stringify(deck));
    } catch (e) {
      console.error("Failed to save deck to local storage", e);
    }
  }, [deck]);
  
  // Save model config to local storage whenever it changes
  useEffect(() => {
    try {
        localStorage.setItem('srs-model-config', JSON.stringify(modelConfig));
    } catch (e) {
        console.error("Failed to save model config to localStorage", e);
    }
  }, [modelConfig]);

  const handleModelConfigChange = useCallback((
    task: keyof ModelConfig, 
    field: keyof ModelStageConfig, 
    value: string | boolean
  ) => {
      setModelConfig(prev => {
          const newConfig = { ...prev };
          const taskConfig = { ...newConfig[task] };

          if (field === 'model') {
              (taskConfig.model as any) = value;
              // Disable 'thinkMore' if model is not Pro
              if (!['gemini-3-pro-preview', 'gemini-2.5-pro'].includes(value as string)) {
                  taskConfig.thinkMore = false;
              }
          } else if (field === 'thinkMore') {
              taskConfig.thinkMore = value as boolean;
          }
          
          newConfig[task] = taskConfig;
          return newConfig;
      });
  }, []);

  const handleGenerate = useCallback(async (
    lessonText: string,
    specialty: Specialty,
    focusSection: string,
    lessonSource: string,
    customInstructions: string,
    preferredClozeTypes: ClozeType[],
    config: ModelStageConfig,
    extraDisambiguationContext: string
  ) => {
    setIsLoading(true);
    setError(null);
    setGeneratedFlashcards([]);
    setReport(null);

    try {
      const result = await generateClozeFlashcards(
        lessonText, 
        specialty, 
        focusSection, 
        lessonSource, 
        customInstructions,
        preferredClozeTypes,
        config.model,
        config.thinkMore,
        extraDisambiguationContext
      );
      setGeneratedFlashcards(result.flashcards);
      setReport(result.report);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.';
      console.error(err);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleAddToDeck = useCallback((newCards: FlashcardData[]) => {
    const newReviewableCards = newCards.map(card => createNewReviewableCard(card));
    
    const existingClozeTexts = new Set(deck.map(c => c.clozeText));
    const uniqueNewCards = newReviewableCards.filter(c => !existingClozeTexts.has(c.clozeText));

    if(uniqueNewCards.length > 0) {
        setDeck(prevDeck => [...prevDeck, ...uniqueNewCards]);
    }
    
    setActiveTab('review');

  }, [deck]);

  const handleStartReview = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    const dueCards = deck.filter(card => card.dueDate <= today);
    setReviewSessionCards(dueCards);
  }, [deck]);

  const handleUpdateCardReview = useCallback((cardId: string, quality: number) => {
    setDeck(prevDeck => {
      const cardIndex = prevDeck.findIndex(c => c.id === cardId);
      if (cardIndex === -1) return prevDeck;
      
      const cardToUpdate = prevDeck[cardIndex];
      const { id, dueDate, ...srsData } = cardToUpdate;
      
      const updatedSrs = calculateSrsParameters(srsData, quality);
      const nextDueDate = getNextDueDate(updatedSrs.interval);

      const updatedCard: ReviewableFlashcard = {
        ...cardToUpdate,
        ...updatedSrs,
        dueDate: nextDueDate,
      };

      const newDeck = [...prevDeck];
      newDeck[cardIndex] = updatedCard;
      return newDeck;
    });
  }, []);

  const handleEndReview = () => {
    setReviewSessionCards(null);
  }

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'generator':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <InputPanel 
              onGenerate={handleGenerate} 
              isLoading={isLoading}
              modelConfig={modelConfig}
              onModelConfigChange={handleModelConfigChange}
            />
            <OutputPanel 
              flashcards={generatedFlashcards} 
              isLoading={isLoading} 
              error={error} 
              report={report}
              onAddToDeck={handleAddToDeck}
            />
          </div>
        );
      case 'review':
        return <ReviewPanel deck={deck} onStartReview={handleStartReview} />;
      case 'essayGrader':
        return <EssayGraderPanel modelConfig={modelConfig} onModelConfigChange={handleModelConfigChange} />;
      default:
        return null;
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300">
      <Header />
      <main className="container mx-auto p-4 md:p-6 lg:p-8">
        <div className="mb-8 border-b border-slate-200 dark:border-slate-700">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                <button
                    onClick={() => setActiveTab('generator')}
                    className={`group inline-flex items-center gap-2 whitespace-nowrap py-4 px-1 border-b-2 font-semibold text-sm transition-colors duration-200 ease-in-out ${
                        activeTab === 'generator'
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                >
                    <LightbulbIcon className={`h-5 w-5 transition-colors ${activeTab === 'generator' ? 'text-blue-500' : 'text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-400'}`} />
                    Tạo thẻ
                </button>
                <button
                    onClick={() => setActiveTab('review')}
                    className={`group relative inline-flex items-center gap-2 whitespace-nowrap py-4 px-1 border-b-2 font-semibold text-sm transition-colors duration-200 ease-in-out ${
                        activeTab === 'review'
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                >
                    <BrainCircuitIcon className={`h-5 w-5 transition-colors ${activeTab === 'review' ? 'text-blue-500' : 'text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-400'}`} />
                    Bộ thẻ ôn tập
                    {deck.length > 0 && (
                      <span className="absolute -top-1 -right-5 ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-blue-100 bg-blue-600 rounded-full">
                        {deck.length}
                      </span>
                    )}
                </button>
                 <button
                    onClick={() => setActiveTab('essayGrader')}
                    className={`group inline-flex items-center gap-2 whitespace-nowrap py-4 px-1 border-b-2 font-semibold text-sm transition-colors duration-200 ease-in-out ${
                        activeTab === 'essayGrader'
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                >
                    <EditIcon className={`h-5 w-5 transition-colors ${activeTab === 'essayGrader' ? 'text-blue-500' : 'text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-400'}`} />
                    Luyện thi Tự luận
                </button>
            </nav>
        </div>
        
        {renderActiveTab()}

        {reviewSessionCards && (
            <ReviewSession 
                sessionCards={reviewSessionCards}
                onUpdateCard={handleUpdateCardReview}
                onEndSession={handleEndReview}
            />
        )}
      </main>
    </div>
  );
};

export default App;