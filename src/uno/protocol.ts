import { PersonalizedState, UnoColor } from './types';

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'start' }
  | { type: 'play'; cardId: string; wildColor?: UnoColor }
  | { type: 'draw' }
  | { type: 'chooseColor'; color: UnoColor }
  | { type: 'leave' };

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
}

export type ServerMessage =
  | {
      type: 'lobby';
      players: LobbyPlayer[];
      joinUrl: string;
      canStart: boolean;
      youAreHost: boolean;
      yourPlayerId: string;
    }
  | {
      type: 'state';
      state: PersonalizedState;
    }
  | {
      type: 'gameOver';
      state: PersonalizedState;
      winnerId: string;
      winnerName: string;
    }
  | {
      type: 'error';
      reason: string;
    }
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
  const msg = data as { type: string };
  switch (msg.type) {
    case 'join': {
      const name = (data as { name?: unknown }).name;
      if (typeof name !== 'string' || !name.trim()) {
        return null;
      }
      return { type: 'join', name: name.trim().slice(0, 24) };
    }
    case 'start':
      return { type: 'start' };
    case 'play': {
      const cardId = (data as { cardId?: unknown }).cardId;
      const wildColor = (data as { wildColor?: unknown }).wildColor;
      if (typeof cardId !== 'string') {
        return null;
      }
      const color =
        wildColor === 'red' ||
        wildColor === 'yellow' ||
        wildColor === 'green' ||
        wildColor === 'blue'
          ? wildColor
          : undefined;
      return { type: 'play', cardId, wildColor: color };
    }
    case 'draw':
      return { type: 'draw' };
    case 'chooseColor': {
      const wildColor = (data as { color?: unknown }).color;
      const color =
        wildColor === 'red' ||
        wildColor === 'yellow' ||
        wildColor === 'green' ||
        wildColor === 'blue'
          ? wildColor
          : undefined;
      if (!color) {
        return null;
      }
      return { type: 'chooseColor', color };
    }
    case 'leave':
      return { type: 'leave' };
    default:
      return null;
  }
}
