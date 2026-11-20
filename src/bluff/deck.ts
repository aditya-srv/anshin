import { shuffle } from '../uno/deck';
import { BLUFF_RANKS, BLUFF_SUITS, BluffCard } from './types';

/** Standard 52-card deck without jokers. */
export function createDeck(): BluffCard[] {
  const cards: BluffCard[] = [];
  let seq = 0;
  for (const suit of BLUFF_SUITS) {
    for (const rank of BLUFF_RANKS) {
      cards.push({ id: `b${seq++}`, rank, suit });
    }
  }
  return cards;
}

export { shuffle };
