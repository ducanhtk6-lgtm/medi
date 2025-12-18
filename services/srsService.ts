


import type { FlashcardData, ReviewableFlashcard } from '../types';

const MIN_EASE_FACTOR = 1.3;
const INITIAL_EASE_FACTOR = 2.5;

/**
 * Calculates the next review parameters for a flashcard based on SM-2 algorithm.
 * @param card The flashcard's SRS data to update.
 * @param quality The user's performance rating (0-5).
 * @returns An object with the updated SRS parameters.
 */
export function calculateSrsParameters(
  card: Pick<ReviewableFlashcard, 'repetition' | 'interval' | 'easeFactor' | 'clozeText' | 'originalQuote' | 'relatedContext' | 'sourceHeading' | 'sourceLesson' | 'questionCategory' | 'extraInfo'>,
  quality: number
): Pick<ReviewableFlashcard, 'repetition' | 'interval' | 'easeFactor'> {

  if (quality < 0 || quality > 5) {
    throw new Error('Quality must be between 0 and 5.');
  }

  let { repetition, interval, easeFactor } = card;

  // 1. If quality is below 3, reset repetition and interval
  if (quality < 3) {
    repetition = 0;
    interval = 1;
  } else {
    // 2. Update ease factor
    easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < MIN_EASE_FACTOR) {
      easeFactor = MIN_EASE_FACTOR;
    }

    // 3. Update repetitions and interval
    repetition += 1;
    if (repetition === 1) {
      interval = 1;
    } else if (repetition === 2) {
      interval = 6;
    } else {
      interval = Math.ceil(interval * easeFactor);
    }
  }

  return { repetition, interval, easeFactor };
}


/**
 * Returns a new flashcard with initial SRS values.
 */
export const createNewReviewableCard = (card: FlashcardData): ReviewableFlashcard => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
        ...card,
        id: crypto.randomUUID(),
        dueDate: today.toISOString().split('T')[0],
        interval: 0,
        repetition: 0,
        easeFactor: INITIAL_EASE_FACTOR,
    };
};

/**
 * Calculates the next due date for a card.
 * @param interval The new interval in days.
 * @returns The next due date as a YYYY-MM-DD string.
 */
export const getNextDueDate = (interval: number): string => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextDueDate = new Date(today.setDate(today.getDate() + interval));
    return nextDueDate.toISOString().split('T')[0];
};