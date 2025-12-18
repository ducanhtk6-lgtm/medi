
import React, { useMemo, useState } from 'react';
import type { FlashcardData } from '../types';

interface TreeNode {
  card: FlashcardData;
  children: TreeNode[];
}

const buildTree = (cards: FlashcardData[]): TreeNode[] => {
    const cardMap = new Map<string, TreeNode>();
    const rootNodes: TreeNode[] = [];
    const validCards = cards.filter(card => card.cardId);

    validCards.forEach(card => {
        cardMap.set(card.cardId!, { card, children: [] });
    });

    validCards.forEach(card => {
        if (card.parentId && cardMap.has(card.parentId)) {
            cardMap.get(card.parentId)!.children.push(cardMap.get(card.cardId!)!);
        } else {
            rootNodes.push(cardMap.get(card.cardId!)!);
        }
    });
    return rootNodes;
};

const cleanClozeText = (text: string): string => {
  return text
    .replace(/{{c\d::(.*?)::.*?}}/g, '[...$1...]')
    .replace(/{{c\d::(.*?)}}/g, '[...$1...]');
};

const MindmapNode: React.FC<{ node: TreeNode }> = ({ node }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasChildren = node.children.length > 0;

    return (
        <li className="relative pl-8 before:absolute before:left-3 before:top-0 before:h-full before:w-px before:bg-slate-300 dark:before:bg-slate-600">
            <div className="relative flex items-center space-x-2 py-1.5">
                <span className="absolute left-[-21px] top-5 h-px w-5 bg-slate-300 dark:bg-slate-600" />

                {hasChildren && (
                    <button 
                        onClick={() => setIsExpanded(!isExpanded)} 
                        className="absolute left-[-38px] top-3 flex-shrink-0 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-transform transform"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                         <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                )}
                 
                <div className="flex-grow p-2 rounded-md bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-sm shadow-sm">
                    <span className="font-semibold text-sky-600 dark:text-sky-400">{node.card.questionCategory}: </span>
                    <span className="text-slate-700 dark:text-slate-300">{cleanClozeText(node.card.clozeText)}</span>
                </div>
            </div>
            {isExpanded && hasChildren && (
                <ul className="pt-1">
                    {node.children.map(childNode => (
                        <MindmapNode key={childNode.card.cardId} node={childNode} />
                    ))}
                </ul>
            )}
        </li>
    );
};


export const MindmapPreview: React.FC<{ flashcards: FlashcardData[] }> = ({ flashcards }) => {
    const tree = useMemo(() => buildTree(flashcards), [flashcards]);

    if (tree.length === 0) {
        return null;
    }
    
    return (
        <div className="mt-8 p-5 bg-sky-50 dark:bg-slate-800/50 border-l-4 border-sky-500 dark:border-sky-400 rounded-r-lg shadow-md">
            <h3 className="text-xl font-bold text-sky-900 dark:text-sky-200 mb-4">
                Xem trước Cấu trúc Mindmap
            </h3>
            <ul className="space-y-1">
                {tree.map(rootNode => (
                    <MindmapNode key={rootNode.card.cardId} node={rootNode} />
                ))}
            </ul>
        </div>
    );
};