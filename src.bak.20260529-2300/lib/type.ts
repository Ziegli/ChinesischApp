export type Card = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning_de: string;
  radicals?: string;
  tags?: string;
  createdAt: number;
  updatedAt: number;
};

export type ReviewState = {
  cardId: string;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  dueAt: number;
  lastReviewedAt?: number;
};
