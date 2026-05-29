import localforage from 'localforage';
import type { Card, ReviewState } from './types';

localforage.config({
  name: 'cn-srs',
  storeName: 'cn_srs_store',
  description: 'Chinesisch SRS lokal'
});

const KEYS = {
  cards: 'cards',
  reviews: 'reviews'
};

export async function getAll(): Promise<{ cards: Card[]; reviews: Record<string, ReviewState> }> {
  const cards = (await localforage.getItem<Card[]>(KEYS.cards)) || [];
  const reviews = (await localforage.getItem<Record<string, ReviewState>>(KEYS.reviews)) || {};
  return { cards, reviews };
}

export async function saveAll(cards: Card[], reviews: Record<string, ReviewState>) {
  await localforage.setItem(KEYS.cards, cards);
  await localforage.setItem(KEYS.reviews, reviews);
}

export async function upsertCard(card: Card) {
  const { cards, reviews } = await getAll();
  const idx = cards.findIndex(c => c.id === card.id);
  if (idx >= 0) cards[idx] = card; else cards.push(card);
  await saveAll(cards, reviews);
}

export async function deleteCard(id: string) {
  const { cards, reviews } = await getAll();
  const nextCards = cards.filter(c => c.id !== id);
  delete reviews[id];
  await saveAll(nextCards, reviews);
}

export async function upsertReview(state: ReviewState) {
  const { cards, reviews } = await getAll();
  reviews[state.cardId] = state;
  await saveAll(cards, reviews);
}
