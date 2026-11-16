export type LudoColor = 'red' | 'green' | 'yellow' | 'blue';

export const LUDO_COLORS: readonly LudoColor[] = ['red', 'green', 'yellow', 'blue'];

export type LudoZone = 'yard' | 'track' | 'home' | 'done';

export interface LudoToken {
  id: string;
  playerId: string;
  color: LudoColor;
  /** -1 yard, 0–50 track, 51–55 home column, 56 center. */
  progress: number;
}

export interface LudoPlayer {
  id: string;
  name: string;
  color: LudoColor;
}

export interface LudoSession {
  players: LudoPlayer[];
  tokens: LudoToken[];
  currentPlayerIndex: number;
  awaiting: 'roll' | 'move';
  dice: number | null;
  consecutiveSixes: number;
  legalTokenIds: string[];
  winnerId: string | null;
  status: string;
  random: () => number;
}

export interface LudoTokenView {
  id: string;
  playerId: string;
  color: LudoColor;
  zone: LudoZone;
  /** Track cell, home step, or yard slot. Null when the token is finished. */
  index: number | null;
}

export interface LudoPlayerView {
  id: string;
  name: string;
  color: LudoColor;
  connected: boolean;
  tokensHome: number;
}

export interface LudoPublicState {
  players: LudoPlayerView[];
  tokens: LudoTokenView[];
  currentPlayerId: string;
  yourPlayerId: string;
  awaiting: 'roll' | 'move';
  dice: number | null;
  consecutiveSixes: number;
  legalTokenIds: string[];
  status: string;
  winnerId: string | null;
  turnDeadline: number | null;
}
