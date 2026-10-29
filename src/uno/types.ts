export type UnoColor = 'red' | 'yellow' | 'green' | 'blue';

export type UnoValue =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'skip'
  | 'reverse'
  | 'draw2'
  | 'wild'
  | 'wild4';

export interface UnoCard {
  id: string;
  /** Null for wild / wild4 until played (face color is none). */
  color: UnoColor | null;
  value: UnoValue;
}

export type Direction = 1 | -1;

export type UnoCallPhase = 'priority' | 'catch';

export interface UnoCall {
  playerId: string;
  playerName: string;
  phase: UnoCallPhase;
  remainingMs: number;
}

export interface PlayerSeat {
  id: string;
  name: string;
  hand: UnoCard[];
}

export interface GameSnapshot {
  players: PlayerSeat[];
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  currentColor: UnoColor;
  currentPlayerIndex: number;
  direction: Direction;
  winnerId: string | null;
  status: string;
  /** True after an opening wild until the starting player picks a color. */
  awaitingWildColor: boolean;
  /** Player who just played down to one card and has not called UNO. */
  unoPendingPlayerId: string | null;
  unoPhase: UnoCallPhase | null;
  /** Epoch ms when the current UNO window opened. */
  unoStartedAt: number;
  /** Server-side shuffle source. Not sent to clients. */
  random: () => number;
}

export interface OpponentPublic {
  id: string;
  name: string;
  cardCount: number;
}

export interface PersonalizedState {
  opponents: OpponentPublic[];
  discard: UnoCard;
  currentColor: UnoColor;
  hand: UnoCard[];
  drawRemaining: number;
  currentPlayerId: string;
  yourPlayerId: string;
  direction: Direction;
  status: string;
  winnerId: string | null;
  playerCount: number;
  awaitingWildColor: boolean;
  unoCall: UnoCall | null;
}
