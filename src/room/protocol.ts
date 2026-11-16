import { GameAction, GameOptions } from '../games/types';

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'resume'; token: string }
  | { type: 'leave' }
  | { type: 'setGame'; game: string }
  | { type: 'start'; options?: GameOptions }
  | { type: 'action'; action: GameAction };

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}

export type ServerMessage =
  | {
      type: 'lobby';
      players: LobbyPlayer[];
      joinUrl: string;
      joinUrls: string[];
      canStart: boolean;
      youAreHost: boolean;
      yourPlayerId: string;
      game: string;
      resumeToken?: string;
    }
  | {
      type: 'state';
      game: string;
      state: unknown;
      resumeToken?: string;
    }
  | {
      type: 'gameOver';
      game: string;
      state: unknown;
      winnerId: string;
      winnerName: string;
      resumeToken?: string;
    }
  | { type: 'waiting'; status: string }
  | { type: 'error'; reason: string }
  | {
      type: 'ended';
      reason: string;
    };

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || !('type' in data)) {
    return null;
  }
  const msg = data as { type: unknown };
  if (typeof msg.type !== 'string' || !msg.type) {
    return null;
  }
  switch (msg.type) {
    case 'join': {
      const name = (data as { name?: unknown }).name;
      if (typeof name !== 'string' || !name.trim()) {
        return null;
      }
      return { type: 'join', name: name.trim().slice(0, 24) };
    }
    case 'resume': {
      const token = (data as { token?: unknown }).token;
      if (typeof token !== 'string' || !token.trim()) {
        return null;
      }
      return { type: 'resume', token: token.trim() };
    }
    case 'leave':
      return { type: 'leave' };
    case 'setGame': {
      const game = (data as { game?: unknown }).game;
      if (typeof game !== 'string' || !game.trim()) {
        return null;
      }
      return { type: 'setGame', game: game.trim() };
    }
    case 'start':
      return parseStart(data);
    case 'action': {
      const action = (data as { action?: unknown }).action;
      if (!isAction(action)) {
        return null;
      }
      return { type: 'action', action };
    }
    default:
      return null;
  }
}

function parseStart(data: unknown): ClientMessage | null {
  const raw = data as { options?: unknown };
  if (raw.options === undefined) {
    return { type: 'start', options: {} };
  }
  if (!raw.options || typeof raw.options !== 'object' || Array.isArray(raw.options)) {
    return null;
  }
  return { type: 'start', options: { ...(raw.options as GameOptions) } };
}

function isAction(value: unknown): value is GameAction {
  return (
    !!value &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string' &&
    (value as { type: string }).type.length > 0
  );
}
