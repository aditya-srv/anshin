export interface GamePlayer {
  id: string;
  name: string;
}

/** Opaque start options. Each module reads only the keys it understands. */
export type GameOptions = Record<string, unknown>;

export interface GameAction {
  type: string;
  [key: string]: unknown;
}

export interface PersonalizeContext {
  turnDeadline: number | null;
  connected(playerId: string): boolean;
}

export type ApplyResult<TSession = unknown> =
  | { ok: true; session: TSession }
  | { ok: false; reason: string };

/** One game. The room calls these and does not read the session itself. */
export interface GameModule<TSession = unknown, TState = unknown> {
  id: string;
  label: string;
  minPlayers: number;
  maxPlayers: number;
  create(players: GamePlayer[], random: () => number, options: GameOptions): TSession;
  apply(session: TSession, playerId: string, action: GameAction): ApplyResult<TSession>;
  onTimeout(session: TSession, playerId: string, random: () => number): TSession;
  personalize(session: TSession, playerId: string, context: PersonalizeContext): TState;
  dropPlayer(session: TSession, playerId: string): TSession;
  /** Always advance past the current player (clear phase locks). Used when that seat is disconnected. */
  forcePassTurn(session: TSession): TSession;
  winner(session: TSession): { id: string; name: string } | null;
  currentPlayerId(session: TSession): string;
  setStatus(session: TSession, status: string): TSession;
  playerIds(session: TSession): string[];
}
