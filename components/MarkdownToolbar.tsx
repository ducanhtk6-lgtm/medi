
import React from 'react';
import { BoldIcon, ItalicIcon, CodeIcon, ListIcon } from './Icons';

type FormatType = 'bold' | 'italic' | 'code' | 'list';

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onContentChange: (newContent: string) => void;
}

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ textareaRef, onContentChange }) => {
  const applyFormat = (type: FormatType) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    let newText = '';
    let cursorOffset = 0;

    if (type === 'list') {
      const lines = selectedText.split('\n');
      const areAllLinesBulleted = lines.every(line => line.trim().startsWith('- '));
      
      if (areAllLinesBulleted) {
        // Remove bullets
        newText = lines.map(line => line.replace(/^- /, '')).join('\n');
      } else {
        // Add bullets
        newText = lines.map(line => line.trim() === '' ? '' : `- ${line}`).join('\n');
      }
    } else {
      const syntax = {
        bold: '**',
        italic: '*',
        code: '`'
      };
      const marker = syntax[type];
      
      // Check if the selected text is already wrapped with the marker
      if (selectedText.startsWith(marker) && selectedText.endsWith(marker)) {
        // Unwrap
        newText = selectedText.substring(marker.length, selectedText.length - marker.length);
      } else {
        // Wrap
        newText = `${marker}${selectedText}${marker}`;
        cursorOffset = marker.length;
      }
    }

    const updatedValue = textarea.value.substring(0, start) + newText + textarea.value.substring(end);
    onContentChange(updatedValue);
    
    // We need to wait for React to re-render the textarea with the new value
    // before we can set the selection.
    setTimeout(() => {
      textarea.focus();
      if (selectedText.length > 0) {
        textarea.setSelectionRange(start, start + newText.length);
      } else {
        textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
      }
    }, 0);
  };
  
  const buttons: { type: FormatType, icon: React.FC<any>, label: string }[] = [
    { type: 'bold', icon: BoldIcon, label: 'Bold' },
    { type: 'italic', icon: ItalicIcon, label: 'Italic' },
    { type: 'code', icon: CodeIcon, label: 'Code' },
    { type: 'list', icon: ListIcon, label: 'Bulleted List' },
  ];

  return (
    <div className="flex items-center space-x-1 p-1 bg-gray-100 dark:bg-gray-700/50 border border-b-0 border-gray-300 dark:border-gray-600 rounded-t-md">
      {buttons.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          type="button"
          onClick={() => applyFormat(type)}
          aria-label={label}
          title={label}
          className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-colors"
        >
          <Icon className="w-4 h-4" strokeWidth="2.5" />
        </button>
      ))}
    </div>
  );
};
