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
  /** The single card the challenger chose to inspect. */
  revealedCards: BluffCard[];
  wasBluff: boolean;
  collectorId: string;
  collectorName: string;
  message: string;
}

/** How the next seat must declare while the pile still has cards. */
export type BluffClaimMode = 'same' | 'next';

export interface BluffSession {
  players: BluffPlayer[];
  discardPile: BluffCard[];
  lastPlay: BluffLastPlay | null;
  /** Host option: same rank for the pile, or ascending next rank each play. */
  claimMode: BluffClaimMode;
  /**
   * Rank the current seat must declare while the pile still has cards.
   * Same mode: last declared rank. Next mode: rank after the last play.
   * Cleared when a challenge empties the pile.
   */
  claimedRank: BluffRank | null;
  /**
   * Player who emptied their hand; they are only marked out after the next seat
   * plays, passes, times out, or fails a challenge on that play.
   */
  pendingWinPlayerId: string | null;
  lastChallenge: BluffChallengeResult | null;
  currentPlayerIndex: number;
  /**
   * Set when the match ends. For a card-elimination finish this is the player
   * who most recently went out (used by the room's winner announcement).
   * For a forfeit (everyone else left) this is the remaining player.
   */
  winnerId: string | null;
  /** Last player still holding cards when the match ends by elimination. */
  loserId: string | null;
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
  /**
   * Opaque ids of the face-down cards in the last play.
   * Only sent to the current seat when a challenge is allowed — ranks/suits stay hidden.
   */
  challengeCardIds?: string[];
}

export interface BluffPublicState {
  opponents: BluffOpponentView[];
  hand: BluffCard[];
  discardCount: number;
  lastPlay: BluffLastPlayView | null;
  /** Rank the current seat must declare until a challenge clears the pile. */
  claimedRank: BluffRank | null;
  claimMode: BluffClaimMode;
  lastChallenge: BluffChallengeResult | null;
  canChallenge: boolean;
  currentPlayerId: string;
  yourPlayerId: string;
  status: string;
  winnerId: string | null;
  loserId: string | null;
  playerCount: number;
  turnDeadline: number | null;
}
