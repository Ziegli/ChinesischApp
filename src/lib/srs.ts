import type { ReviewState } from './types';

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export function initReviewState(cardId: string): ReviewState {
  const now = Date.now();
  return {
    cardId,
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    dueAt: now
  };
}

export function review(prev: ReviewState, rating: Rating): ReviewState {
  const now = Date.now();
  let { easeFactor, repetitions, intervalDays, lapses } = prev;
  const q = rating === 'again' ? 0 : rating === 'hard' ? 2 : rating === 'good' ? 3 : 4;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    lapses += 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 3;
    else intervalDays = Math.round(intervalDays * easeFactor * (rating === 'hard' ? 0.8 : rating === 'easy' ? 1.3 : 1.0));

    easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    easeFactor = Math.max(1.3, easeFactor);
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const dueAt = now + intervalDays * dayMs;

  return {
    ...prev,
    easeFactor: Number(easeFactor.toFixed(2)),
    repetitions,
    intervalDays,
    lapses,
    dueAt,
    lastReviewedAt: now
  };
}
