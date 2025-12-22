


import React from 'react';
import type { MCQJob, MCQLane, MCQStage } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { AlertTriangleIcon, CheckIcon, BrainCircuitIcon } from './Icons';

interface MCQProgressDashboardProps {
    jobs: MCQJob[];
    lanes: MCQLane[];
    stage: MCQStage;
    onReset: () => void;
}

const StageStepper: React.FC<{ currentStage: MCQStage }> = ({ currentStage }) => {
    // Mapping internal stages to User Facing Process Steps
    const stages = [
        { id: 'setup', label: 'Bước 1: Thiết lập & Làm sạch' },
        { id: 'generation', label: 'Bước 2-5: ToT & Tạo câu hỏi' },
        { id: 'audit', label: 'Bước 6: Thanh tra & Báo cáo' },
    ];

    const getStatus = (id: string) => {
        if (currentStage === 'finished' && id === 'audit') return 'completed';
        if (currentStage === id) return 'active';
        const currentIndex = stages.findIndex(s => s.id === currentStage);
        const thisIndex = stages.findIndex(s => s.id === id);
        return thisIndex < currentIndex || currentStage === 'finished' ? 'completed' : 'pending';
    };

    return (
        <div className="flex items-center justify-between w-full mb-8 relative">
            <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-slate-200 dark:bg-slate-700 -z-10"></div>
            {stages.map((s, idx) => {
                const status = getStatus(s.id);
                return (
                    <div key={s.id} className="flex flex-col items-center bg-white dark:bg-slate-800 px-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors ${
                            status === 'active' ? 'border-indigo-600 bg-indigo-600 text-white' :
                            status === 'completed' ? 'border-emerald-500 bg-emerald-500 text-white' :
                            'border-slate-300 bg-white dark:bg-slate-700 text-slate-400'
                        }`}>
                            {status === 'completed' ? <CheckIcon className="w-5 h-5"/> : idx + 1}
                        </div>
                        <span className={`mt-2 text-xs font-semibold ${
                            status === 'active' ? 'text-indigo-600 dark:text-indigo-400' :
                            status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' :
                            'text-slate-500'
                        }`}>{s.label}</span>
                    </div>
                );
            })}
        </div>
    );
};

const LaneCard: React.FC<{ lane: MCQLane, jobs: MCQJob[] }> = ({ lane, jobs }) => {
    const currentJob = jobs.find(j => j.id === lane.currentJobId);
    
    // Calculate cooldown remaining
    const [cooldownSecs, setCooldownSecs] = React.useState(0);
    
    React.useEffect(() => {
        if (lane.status === 'cooldown' && lane.cooldownEndsAt) {
            const interval = setInterval(() => {
                const diff = Math.ceil((lane.cooldownEndsAt! - Date.now()) / 1000);
                setCooldownSecs(diff > 0 ? diff : 0);
            }, 1000);
            return () => clearInterval(interval);
        } else {
            setCooldownSecs(0);
        }
    }, [lane.status, lane.cooldownEndsAt]);
    
    const getStepLabel = (step: string) => {
        switch(step) {
            case 'decompose': return 'Phân rã (ToT)';
            case 'generate': return 'B2: Tạo nháp';
            case 'evaluate': return 'B3: Kiểm tra QC';
            case 'decide': return 'B4-5: Hint/Quote';
            case 'done': return 'Hoàn tất';
            default: return step;
        }
    }

    return (
        <div className={`border rounded-lg p-3 transition-all ${
            lane.status === 'busy' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 shadow-md transform scale-105' :
            lane.status === 'cooldown' ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' :
            'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
        }`}>
            <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold uppercase text-slate-500">Worker #{lane.id}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    lane.status === 'busy' ? 'bg-indigo-100 text-indigo-700' :
                    lane.status === 'cooldown' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-500'
                }`}>
                    {lane.status === 'cooldown' ? `COOLDOWN ${cooldownSecs}s` : lane.status}
                </span>
            </div>

            <div className="h-20 flex flex-col justify-center items-center text-center">
                {lane.status === 'busy' && currentJob ? (
                    <div className="w-full">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate px-1 mb-1" title={currentJob.sectionTitle}>
                            {currentJob.sectionTitle}
                        </p>
                        <div className="flex items-center justify-center gap-1.5">
                            <LoadingSpinner />
                            <span className="text-xs text-indigo-600 font-mono">{getStepLabel(currentJob.step)}...</span>
                        </div>
                    </div>
                ) : lane.status === 'cooldown' ? (
                     <div className="text-amber-600 text-xs font-medium px-2">
                        Rate limit hit. Pausing...
                     </div>
                ) : (
                    <span className="text-slate-300 dark:text-slate-600 text-xs italic">Idle</span>
                )}
            </div>
        </div>
    );
};

export const MCQProgressDashboard: React.FC<MCQProgressDashboardProps> = ({ jobs, lanes, stage, onReset }) => {
    if (stage === 'setup') return null;

    const completed = jobs.filter(j => j.status === 'completed').length;
    const failed = jobs.filter(j => j.status === 'failed').length;
    const total = jobs.length;
    const percent = Math.round(((completed + failed) / total) * 100) || 0;

    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-lg mb-8">
            <StageStepper currentStage={stage} />
            
            <div className="flex justify-between items-end mb-4">
                <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100">Tiến độ Xử lý (Quy trình 6 Bước)</h3>
                    <p className="text-xs text-slate-500">
                        {completed} xong, {failed} lỗi / {total} tổng
                    </p>
                </div>
                {stage !== 'finished' && (
                     <button onClick={onReset} className="text-xs text-red-500 hover:underline border border-red-200 px-2 py-1 rounded bg-red-50">
                        Dừng & Reset
                     </button>
                )}
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mb-6 overflow-hidden">
                <div className={`h-2.5 rounded-full transition-all duration-500 ${
                    stage === 'finished' ? 'bg-emerald-500' : 'bg-indigo-600'
                }`} style={{ width: `${percent}%` }}></div>
            </div>

            {/* Lanes */}
            <div className="mb-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Concurrency Lanes (5 Active Workers)</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {lanes.map(lane => (
                        <LaneCard key={lane.id} lane={lane} jobs={jobs} />
                    ))}
                </div>
            </div>

            {/* Audit Status Hook */}
            {stage === 'audit' && (
                <div className="flex items-center justify-center p-4 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 rounded-lg animate-pulse">
                    <BrainCircuitIcon className="h-5 w-5 text-sky-600 mr-2" />
                    <span className="text-sm font-semibold text-sky-700 dark:text-sky-300">Đang thực hiện thanh tra độc lập (Bước 6)...</span>
                </div>
            )}
        </div>
    );
};