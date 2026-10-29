import { UnoCard, UnoColor, UnoValue } from './types';

const COLORS: UnoColor[] = ['red', 'yellow', 'green', 'blue'];
const NUMBERS_ONCE: UnoValue[] = ['0'];
const NUMBERS_TWICE: UnoValue[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTIONS: UnoValue[] = ['skip', 'reverse', 'draw2'];

export function createDeck(): UnoCard[] {
  const cards: UnoCard[] = [];
  let seq = 0;

  const push = (color: UnoColor | null, value: UnoValue): void => {
    cards.push({ id: `c${seq++}`, color, value });
  };

  for (const color of COLORS) {
    for (const value of NUMBERS_ONCE) {
      push(color, value);
    }
    for (const value of NUMBERS_TWICE) {
      push(color, value);
      push(color, value);
    }
    for (const value of ACTIONS) {
      push(color, value);
      push(color, value);
    }
  }

  for (let i = 0; i < 4; i++) {
    push(null, 'wild');
    push(null, 'wild4');
  }

  return cards;
}

/** Fisher–Yates; mutates and returns the same array. */
export function shuffle<T>(cards: T[], random: () => number = Math.random): T[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

export function isWild(value: UnoValue): boolean {
  return value === 'wild' || value === 'wild4';
}

/** Skip, Reverse, Draw Two, Wild, and Wild Draw Four. */
export function isSpecial(value: UnoValue): boolean {
  return value === 'skip' || value === 'reverse' || value === 'draw2' || isWild(value);
}
