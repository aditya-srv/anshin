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
  color: UnoColor | null;
  value: UnoValue;
}

export type Direction = 1 | -1;

/** Open window: this player played down to one card and has not called UNO yet. */
export interface UnoCall {
  playerId: string;
  playerName: string;
}

/** Successful UNO call shown near the discard until the next play/draw. */
export interface UnoSaid {
  playerId: string;
  playerName: string;
}

export interface PlayerSeat {
  id: string;
  name: string;
  hand: UnoCard[];
}

/** Draw penalty that can be stacked when the house rule is on. */
export type PendingDrawKind = 'draw2' | 'wild4';

export interface GameSnapshot {
  players: PlayerSeat[];
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  currentColor: UnoColor;
  currentPlayerIndex: number;
  direction: Direction;
  /** Players who emptied their hand, in finish order. First entry is the winner when the round ends. */
  finishedOrder: string[];
  winnerId: string | null;
  status: string;
  /** True after an opening wild until the starting player picks a color. */
  awaitingWildColor: boolean;
  /** Host option: Draw Two / Wild Draw Four may be stacked instead of paid immediately. */
  stackDraws: boolean;
  /** Cards the current seat must draw unless they stack another matching draw card. */
  pendingDraw: number;
  /** Kind of draw card that opened or last stacked the pending penalty. */
  pendingDrawKind: PendingDrawKind | null;
  /** Player who just played down to one card and has not called UNO. */
  unoPendingPlayerId: string | null;
  /** Epoch ms when the UNO call opened; catch is blocked briefly after this. */
  unoPendingAt: number | null;
  /** Last successful UNO call; cleared on the next play or draw. */
  unoSaid: UnoSaid | null;
  /** Server-side shuffle source. Not sent to clients. */
  random: () => number;
}

export interface OpponentPublic {
  id: string;
  name: string;
  cardCount: number;
  /** False while that player's socket is down and their seat is held. */
  connected?: boolean;
}

export type HandCard = UnoCard & { playable?: boolean };

export interface PersonalizedState {
  opponents: OpponentPublic[];
  discard: UnoCard;
  currentColor: UnoColor;
  hand: HandCard[];
  drawRemaining: number;
  currentPlayerId: string;
  yourPlayerId: string;
  direction: Direction;
  status: string;
  winnerId: string | null;
  playerCount: number;
  awaitingWildColor: boolean;
  /** Cards waiting to be drawn unless the current seat stacks. 0 when none. */
  pendingDraw: number;
  unoCall: UnoCall | null;
  unoSaid: UnoSaid | null;
  /** Epoch ms when Catch becomes available; null when no call is open. */
  catchAvailableAt: number | null;
  /** Epoch ms when the current turn is forced. Null while that player is disconnected. */
  turnDeadline?: number | null;
}
