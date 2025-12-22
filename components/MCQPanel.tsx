





import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { MCQJob, MCQConfig, Specialty, MCQMode, MCQCard, MCQLane, MCQStage, MCQAuditResult, DifficultyWeights, MCQOptions } from '../types';
import { generateMCQBatch, auditMCQBatch } from '../services/geminiService';
import { normalizeComparators } from '../services/comparatorGuard';
import { MCQInputPanel } from './MCQInputPanel';
import { MCQProgressDashboard } from './MCQProgressDashboard';
import { MCQOutputPanel } from './MCQOutputPanel';

const MAX_LANES = 5;
const COOLDOWN_MS = 5000;

export const MCQPanel: React.FC = () => {
    // --- State ---
    const [mcqModelConfig, setMcqModelConfig] = useState<MCQConfig>({
        cleaning: { model: 'gemini-3-flash-preview', thinkMore: false },
        generation: { model: 'gemini-3-pro-preview', thinkMore: true },
        audit: { model: 'gemini-3-flash-preview', thinkMore: false }
    });

    const [stage, setStage] = useState<MCQStage>('setup');
    const [jobs, setJobs] = useState<MCQJob[]>([]);
    const [lanes, setLanes] = useState<MCQLane[]>(
        Array.from({ length: MAX_LANES }, (_, i) => ({ id: i + 1, status: 'idle', currentJobId: null, cooldownEndsAt: null, errorCount: 0 }))
    );
    const [generatedMCQs, setGeneratedMCQs] = useState<MCQCard[]>([]);
    const [auditResult, setAuditResult] = useState<MCQAuditResult | undefined>(undefined);

    // Refs to hold options for batch processing without global variables
    const batchOptionsRef = useRef<{ 
        specialty: Specialty; 
        mcqMode: MCQMode;
        difficultyWeights: DifficultyWeights;
        customInstructions: string;
        options: MCQOptions;
    } | null>(null);

    // --- Core Scheduler Logic (Replaces the while(true) loop) ---
    // This effect runs whenever jobs or lanes change, acting as the "Brain"
    useEffect(() => {
        if (stage !== 'generation') return;

        // 1. Check for Cooldown Expiry
        const now = Date.now();
        const lanesToWake = lanes.filter(l => l.status === 'cooldown' && l.cooldownEndsAt && now >= l.cooldownEndsAt);
        if (lanesToWake.length > 0) {
            setLanes(prev => prev.map(l => lanesToWake.find(w => w.id === l.id) ? { ...l, status: 'idle', cooldownEndsAt: null } : l));
            return; // State update will trigger re-run
        }

        // 2. Find Idle Lanes
        const idleLanes = lanes.filter(l => l.status === 'idle');
        if (idleLanes.length === 0) return;

        // 3. Find Queued Jobs
        // Logic: Status is 'queued' OR 'retrying' with passed timestamp
        const pendingJob = jobs.find(j => 
            j.status === 'queued' || 
            (j.status === 'retrying' && (!j.nextRetryTime || now >= j.nextRetryTime))
        );

        if (!pendingJob) {
            // Check if ALL jobs are done
            const allDone = jobs.every(j => j.status === 'completed' || j.status === 'failed');
            if (allDone && jobs.length > 0) {
                finalizeGeneration();
            }
            return;
        }

        // 4. Assign Job to First Idle Lane
        const lane = idleLanes[0];
        assignJobToLane(pendingJob.id, lane.id);

    }, [jobs, lanes, stage]);

    // --- Helpers ---

    const assignJobToLane = (jobId: string, laneId: number) => {
        // Optimistic update to prevent double assignment in next render cycle
        setLanes(prev => prev.map(l => l.id === laneId ? { ...l, status: 'busy', currentJobId: jobId } : l));
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'running', laneId } : j));
        
        // Trigger the actual async work
        runJob(jobId, laneId);
    };

    const runJob = async (jobId: string, laneId: number) => {
        const job = jobs.find(j => j.id === jobId);
        if (!job || !batchOptionsRef.current) return;
        
        const { specialty, mcqMode, difficultyWeights, customInstructions, options } = batchOptionsRef.current;
        const { sectionTitle, sectionContent } = job;

        try {
            // Simulated Step Updates for UI (Mapping to Process Steps)
            updateJobStep(jobId, 'decompose');
            await new Promise(r => setTimeout(r, 600)); 
            
            updateJobStep(jobId, 'generate'); // Step 2
            
            const result = await generateMCQBatch(
                sectionTitle,
                sectionContent,
                specialty,
                mcqMode,
                mcqModelConfig.generation.model,
                mcqModelConfig.generation.thinkMore,
                difficultyWeights,
                customInstructions,
                options
            );

            updateJobStep(jobId, 'evaluate'); // Step 3
            await new Promise(r => setTimeout(r, 400));
            updateJobStep(jobId, 'decide'); // Step 4-5
            await new Promise(r => setTimeout(r, 200));
            updateJobStep(jobId, 'done');

            // Success
            completeJob(jobId, laneId, result.mcqs);

        } catch (err: any) {
            console.error(`Job ${jobId} failed on lane ${laneId}`, err);
            handleJobError(jobId, laneId, err);
        }
    };

    const updateJobStep = (jobId: string, step: MCQJob['step']) => {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, step } : j));
    };

    const completeJob = (jobId: string, laneId: number, results: MCQCard[]) => {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'completed', result: results } : j));
        setLanes(prev => prev.map(l => l.id === laneId ? { ...l, status: 'idle', currentJobId: null, errorCount: 0 } : l));
    };

    const handleJobError = (jobId: string, laneId: number, error: any) => {
        const isRateLimit = error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED');
        
        setJobs(prev => {
            const currentJob = prev.find(j => j.id === jobId);
            if (!currentJob) return prev;

            const newRetryCount = currentJob.retryCount + 1;
            
            if (newRetryCount <= 3) {
                // Retry
                const backoff = 2000 * Math.pow(2, newRetryCount); // 4s, 8s, 16s
                return prev.map(j => j.id === jobId ? { 
                    ...j, 
                    status: 'retrying', 
                    retryCount: newRetryCount, 
                    nextRetryTime: Date.now() + backoff,
                    error: isRateLimit ? `Rate limit. Retry #${newRetryCount}` : error.message
                } : j);
            } else {
                // Fail
                return prev.map(j => j.id === jobId ? { ...j, status: 'failed', error: error.message } : j);
            }
        });

        // Lane Management
        if (isRateLimit) {
            // Put lane on cooldown
            setLanes(prev => prev.map(l => l.id === laneId ? { 
                ...l, 
                status: 'cooldown', 
                currentJobId: null, 
                cooldownEndsAt: Date.now() + COOLDOWN_MS 
            } : l));
        } else {
            // Just free the lane
            setLanes(prev => prev.map(l => l.id === laneId ? { ...l, status: 'idle', currentJobId: null } : l));
        }
    };

    const finalizeGeneration = () => {
        setStage('audit');
        // Aggregate MCQs
        const allMcqs = jobs.flatMap(j => j.result || []);
        
        if (allMcqs.length === 0) {
            setGeneratedMCQs([]);
            setStage('finished');
            return;
        }

        // Run Audit
        runAudit(allMcqs);
    };

    // --- Audit Logic ---
    const runAudit = async (mcqs: MCQCard[]) => {
        // 1. Code-based Audit (Deterministic)
        // Check if quote exists in the source content of the respective job
        
        const auditedMCQs = mcqs.map(card => {
            const job = jobs.find(j => j.sectionTitle === card.sourceHeading); // Heuristic link
            // If explicit link missing, search all jobs (costly but safer) or just trust.
            // Let's search in the job that matched the title, or fallback to all.
            
            // NOTE: job.sectionContent might now include "RELATED_CONTEXT" if cross-section is on,
            // so this search is already upgraded to handle context slicing automatically.
            const sourceText = job ? job.sectionContent : jobs.map(j => j.sectionContent).join('\n');
            const normalizedSource = normalizeComparators(sourceText).replace(/\s+/g, ' ').toLowerCase();
            const normalizedQuote = normalizeComparators(card.originalQuote).replace(/\s+/g, ' ').toLowerCase();
            
            // Allow simplified quote check (contains)
            // Remove punctuation for fuzzy match
            const simpleSource = normalizedSource.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
            const simpleQuote = normalizedQuote.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");

            const isQuoteFound = simpleSource.includes(simpleQuote);
            const isValidOption = ['A', 'B', 'C', 'D'].includes(card.correctOption.toUpperCase().trim());
            
            let status: 'pass' | 'fail' | 'warning' = 'pass';
            const notes = [];

            if (!isQuoteFound) {
                // Policy Upgrade: Check for External Sources Usage
                const explanationLC = (card.explanation || "").toLowerCase();
                const isExternal = explanationLC.includes("external reference") || 
                                   explanationLC.includes("nguồn ngoài") ||
                                   explanationLC.includes("tài liệu ngoài");
                
                if (isExternal) {
                    status = 'warning';
                    notes.push('External source citation detected. Manual verification recommended.');
                } else {
                    status = 'fail';
                    notes.push('Quote not found verbatim in source.');
                }
            }
            
            if (!isValidOption) {
                status = 'fail';
                notes.push('Invalid correct option format.');
            }
            if (card.originalQuote.length < 10) {
                status = 'warning';
                notes.push('Quote too short.');
            }

            return { ...card, auditStatus: status, auditNotes: notes };
        });

        // 2. LLM Audit (Optional/Stub for now to save tokens, or call if config enabled)
        
        const passedCount = auditedMCQs.filter(c => c.auditStatus === 'pass').length;
        const failedCount = auditedMCQs.filter(c => c.auditStatus === 'fail').length;
        
        setAuditResult({
            auditReport: `**AUDIT SUMMARY (BƯỚC 6)**\n- Total: ${auditedMCQs.length}\n- Passed: ${passedCount}\n- Failed/Warning: ${failedCount}\n\n*Code-based verification completed.*\n*Note: Warnings may indicate valid External Sources usage.*`,
            passedMCQs: auditedMCQs,
            failedCount
        });
        
        setGeneratedMCQs(auditedMCQs);
        setStage('finished');
    };

    // --- Handlers ---

    const handleStartGeneration = (
        sections: { title: string, content: string }[], 
        specialty: Specialty, 
        mcqMode: MCQMode,
        difficultyWeights: DifficultyWeights,
        customInstructions: string,
        options: MCQOptions
    ) => {
        batchOptionsRef.current = { specialty, mcqMode, difficultyWeights, customInstructions, options };
        
        const newJobs: MCQJob[] = sections.map((sec, idx) => ({
            id: `job-${Date.now()}-${idx}`,
            sectionTitle: sec.title,
            sectionContent: sec.content,
            status: 'queued',
            step: 'decompose',
            result: [],
            retryCount: 0
        }));

        setJobs(newJobs);
        setLanes(Array.from({ length: MAX_LANES }, (_, i) => ({ id: i + 1, status: 'idle', currentJobId: null, cooldownEndsAt: null, errorCount: 0 })));
        setGeneratedMCQs([]);
        setAuditResult(undefined);
        setStage('generation');
    };

    const handleReset = () => {
        setStage('setup');
        setJobs([]);
        setGeneratedMCQs([]);
        setAuditResult(undefined);
        batchOptionsRef.current = null;
    };

    const handleExport = () => {
        if (generatedMCQs.length === 0) return;
        
        const csvRows = generatedMCQs.map(c => {
            const front = `"${c.front.replace(/"/g, '""')}"`;
            const backContent = `**ĐÁP ÁN:** ${c.correctOption}\n\n**GIẢI THÍCH:**\n${c.explanation}\n\n**BẰNG CHỨNG:**\n> ${c.originalQuote}\n> *(${c.sourceHeading})*`;
            const back = `"${backContent.replace(/"/g, '""')}"`;
            const tags = `"${c.questionCategory} ${c.difficultyTag} ${c.auditStatus === 'fail' ? 'AUDIT_FAIL' : ''}"`;
            return `${front},${back},${tags}`;
        });
        
        const blob = new Blob([`\uFEFF${csvRows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `MCQ_Export_${new Date().toISOString()}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
                <MCQInputPanel 
                    onStartGeneration={handleStartGeneration}
                    mcqModelConfig={mcqModelConfig}
                    setMcqModelConfig={setMcqModelConfig}
                />
            </div>
            <div className="lg:col-span-2">
                {(stage !== 'setup') && (
                    <MCQProgressDashboard 
                        jobs={jobs} 
                        lanes={lanes}
                        stage={stage}
                        onReset={handleReset}
                    />
                )}
                <MCQOutputPanel 
                    mcqs={generatedMCQs} 
                    auditReport={auditResult?.auditReport} 
                    onExportCSV={handleExport} 
                />
            </div>
        </div>
    );
};
