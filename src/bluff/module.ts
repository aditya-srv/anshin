import {
  ApplyResult,
  GameAction,
  GameModule,
  GameOptions,
  GamePlayer,
  PersonalizeContext,
} from '../games/types';
import { MAX_BLUFF_DECKS, MIN_BLUFF_DECKS } from './deck';
import {
  callChallenge,
  forcePassTurn,
  isBluffRank,
  passTurn,
  personalize,
  playCards,
  createGame,
  dropPlayer,
} from './engine';
import { BluffPublicState, BluffSession } from './types';

function deckCountOf(options: GameOptions): number {
  const value = options.deckCount;
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= MIN_BLUFF_DECKS && value <= MAX_BLUFF_DECKS) {
      return value;
    }
  }
  return MIN_BLUFF_DECKS;
}

function asCardIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item) {
      return null;
    }
    ids.push(item);
  }
  return ids;
}

function apply(session: BluffSession, playerId: string, action: GameAction): ApplyResult<BluffSession> {
  switch (action.type) {
    case 'play': {
      const cardIds = asCardIds(action.cardIds);
      if (!cardIds || !isBluffRank(action.rank)) {
        return { ok: false, reason: 'Invalid message.' };
      }
      const result = playCards(session, playerId, cardIds, action.rank);
      return result.ok ? { ok: true, session: result.session } : result;
    }
    case 'challenge': {
      if (typeof action.cardId !== 'string' || !action.cardId) {
        return { ok: false, reason: 'Pick one card to check.' };
      }
      const result = callChallenge(session, playerId, action.cardId);
      return result.ok ? { ok: true, session: result.session } : result;
    }
    case 'pass': {
      const result = passTurn(session, playerId);
      return result.ok ? { ok: true, session: result.session } : result;
    }
    default:
      return { ok: false, reason: 'Invalid message.' };
  }
}

function onTimeout(session: BluffSession, playerId: string): BluffSession {
  if (session.winnerId || session.players[session.currentPlayerIndex]?.id !== playerId) {
    return session;
  }
  return forcePassTurn(session);
}

export const bluffModule: GameModule<BluffSession, BluffPublicState> = {
  id: 'bluff',
  label: 'Bluff',
  minPlayers: 2,
  maxPlayers: 6,
  turnClock: false,
  create(players: GamePlayer[], random: () => number, options: GameOptions): BluffSession {
    return createGame(players, random, deckCountOf(options));
  },
  apply,
  onTimeout,
  personalize(session: BluffSession, playerId: string, context: PersonalizeContext): BluffPublicState {
    // No turn timer for Bluff — Pass advances the seat instead.
    return personalize(session, playerId, context.connected, null);
  },
  dropPlayer(session: BluffSession, playerId: string): BluffSession {
    return dropPlayer(session, playerId);
  },
  forcePassTurn(session: BluffSession): BluffSession {
    return forcePassTurn(session);
  },
  winner(session: BluffSession): { id: string; name: string } | null {
    if (!session.winnerId) {
      return null;
    }
    const player = session.players.find((item) => item.id === session.winnerId);
    return { id: session.winnerId, name: player?.name ?? 'Someone' };
  },
  currentPlayerId(session: BluffSession): string {
    return session.players[session.currentPlayerIndex]?.id ?? '';
  },
  setStatus(session: BluffSession, status: string): BluffSession {
    return { ...session, status };
  },
  playerIds(session: BluffSession): string[] {
    return session.players.map((player) => player.id);
  },
};
