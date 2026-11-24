import { shuffle } from '../uno/deck';
import { BLUFF_RANKS, BLUFF_SUITS, BluffCard } from './types';

export const MIN_BLUFF_DECKS = 1;
export const MAX_BLUFF_DECKS = 2;

/** One or more standard 52-card decks without jokers. Ids stay unique across copies. */
export function createDeck(deckCount: number = MIN_BLUFF_DECKS): BluffCard[] {
  if (
    !Number.isInteger(deckCount) ||
    deckCount < MIN_BLUFF_DECKS ||
    deckCount > MAX_BLUFF_DECKS
  ) {
    throw new Error(`Bluff supports ${MIN_BLUFF_DECKS} or ${MAX_BLUFF_DECKS} decks.`);
  }
  const cards: BluffCard[] = [];
  let seq = 0;
  for (let copy = 0; copy < deckCount; copy++) {
    for (const suit of BLUFF_SUITS) {
      for (const rank of BLUFF_RANKS) {
        cards.push({ id: `b${seq++}`, rank, suit });
      }
    }
  }
  return cards;
}

export { shuffle };
