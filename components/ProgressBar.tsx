
import React from 'react';

interface ProgressBarProps {
  progress: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
  return (
    <div className="w-full text-center">
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
        <div 
          className="bg-white h-2.5 rounded-full transition-all duration-100 ease-linear" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
};
