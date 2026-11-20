export type BluffRank =
  | 'Ace'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'Jack'
  | 'Queen'
  | 'King';

export type BluffSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export const BLUFF_RANKS: readonly BluffRank[] = [
  'Ace',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'Jack',
  'Queen',
  'King',
];

export const BLUFF_SUITS: readonly BluffSuit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export interface BluffCard {
  id: string;
  rank: BluffRank;
  suit: BluffSuit;
}

export interface BluffPlayer {
  id: string;
  name: string;
  hand: BluffCard[];
}

/** Server-only record of the most recent face-down play. */
export interface BluffLastPlay {
  playerId: string;
  playerName: string;
  declaredRank: BluffRank;
  quantity: number;
  cards: BluffCard[];
}

export interface BluffChallengeResult {
  challengerId: string;
  challengerName: string;
  accusedId: string;
  accusedName: string;
  declaredRank: BluffRank;
  quantity: number;
  revealedCards: BluffCard[];
  wasBluff: boolean;
  collectorId: string;
  collectorName: string;
  message: string;
}

export interface BluffSession {
  players: BluffPlayer[];
  discardPile: BluffCard[];
  lastPlay: BluffLastPlay | null;
  /** Player who emptied their hand; win is delayed until the next seat plays or times out. */
  pendingWinPlayerId: string | null;
  lastChallenge: BluffChallengeResult | null;
  currentPlayerIndex: number;
  winnerId: string | null;
  status: string;
  random: () => number;
}

export interface BluffOpponentView {
  id: string;
  name: string;
  cardCount: number;
  connected: boolean;
}

export interface BluffLastPlayView {
  playerId: string;
  playerName: string;
  declaredRank: BluffRank;
  quantity: number;
}

export interface BluffPublicState {
  opponents: BluffOpponentView[];
  hand: BluffCard[];
  discardCount: number;
  lastPlay: BluffLastPlayView | null;
  lastChallenge: BluffChallengeResult | null;
  canChallenge: boolean;
  currentPlayerId: string;
  yourPlayerId: string;
  status: string;
  winnerId: string | null;
  playerCount: number;
  turnDeadline: number | null;
}
