
import React from 'react';
import type { ModelName, ModelStageConfig } from '../types';

interface ModelSelectorProps {
    label: string;
    config: ModelStageConfig;
    onModelChange: (model: ModelName) => void;
    onThinkMoreChange: (checked: boolean) => void;
    proDescription: string;
    flashDescription: string;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
    label,
    config,
    onModelChange,
    onThinkMoreChange,
    proDescription,
    flashDescription,
}) => {
    const isPro = config.model === 'gemini-3-pro-preview' || config.model === 'gemini-2.5-pro';
    const description = isPro ? proDescription : flashDescription;

    return (
        <div className="text-sm border-t border-gray-200 dark:border-gray-600 pt-3">
            <label className="block font-semibold text-gray-700 dark:text-gray-300">{label}</label>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 items-center">
                <select
                    value={config.model}
                    onChange={e => onModelChange(e.target.value as ModelName)}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 focus:ring-blue-500 focus:border-blue-500"
                >
                    <option value="gemini-3-pro-preview">3.0 Pro (Chất lượng cao nhất)</option>
                    <option value="gemini-2.5-pro">2.5 Pro (Cân bằng)</option>
                    <option value="gemini-2.5-flash">2.5 Flash (Nhanh nhất)</option>
                </select>
                <div className="flex items-center">
                    <input
                        id={`think-more-${label}`}
                        type="checkbox"
                        checked={config.thinkMore}
                        onChange={e => onThinkMoreChange(e.target.checked)}
                        disabled={!isPro}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <label 
                        htmlFor={`think-more-${label}`}
                        className={`ml-2 text-gray-700 dark:text-gray-300 ${!isPro ? 'text-gray-400 dark:text-gray-500' : ''}`}
                    >
                        Think More (Pro models only)
                    </label>
                </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        </div>
    );
};