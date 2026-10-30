import { PersonalizedState, UnoColor } from './types';

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'start'; guaranteeSpecial?: boolean; cardsPerPlayer?: number }
  | { type: 'play'; cardId: string; wildColor?: UnoColor }
  | { type: 'draw' }
  | { type: 'chooseColor'; color: UnoColor }
  | { type: 'uno' }
  | { type: 'catch' }
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
    case 'start': {
      const raw = data as { guaranteeSpecial?: unknown; cardsPerPlayer?: unknown };
      let guaranteeSpecial = true;
      if (raw.guaranteeSpecial !== undefined) {
        if (typeof raw.guaranteeSpecial !== 'boolean') {
          return null;
        }
        guaranteeSpecial = raw.guaranteeSpecial;
      }
      let cardsPerPlayer = 7;
      if (raw.cardsPerPlayer !== undefined) {
        if (
          typeof raw.cardsPerPlayer !== 'number' ||
          !Number.isInteger(raw.cardsPerPlayer) ||
          raw.cardsPerPlayer < 1 ||
          raw.cardsPerPlayer > 15
        ) {
          return null;
        }
        cardsPerPlayer = raw.cardsPerPlayer;
      }
      return { type: 'start', guaranteeSpecial, cardsPerPlayer };
    }
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
    case 'uno':
      return { type: 'uno' };
    case 'catch':
      return { type: 'catch' };
    case 'leave':
      return { type: 'leave' };
    default:
      return null;
  }
}
