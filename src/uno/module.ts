import {
  ApplyResult,
  GameAction,
  GameModule,
  GameOptions,
  GamePlayer,
  PersonalizeContext,
} from '../games/types';
import {
  callUno,
  canPlayCard,
  catchUno,
  chooseOpeningColor,
  createGame,
  drawCard,
  dropPlayer,
  forcePassTurn,
  personalize,
  playCard,
} from './engine';
import { GameSnapshot, PersonalizedState, UnoColor } from './types';

function colorOf(value: unknown): UnoColor | undefined {
  return value === 'red' || value === 'yellow' || value === 'green' || value === 'blue'
    ? value
    : undefined;
}

function apply(session: GameSnapshot, playerId: string, action: GameAction): ApplyResult<GameSnapshot> {
  switch (action.type) {
    case 'play': {
      if (typeof action.cardId !== 'string') {
        return { ok: false, reason: 'Invalid message.' };
      }
      const result = playCard(session, playerId, action.cardId, colorOf(action.wildColor));
      return result.ok ? { ok: true, session: result.game } : result;
    }
    case 'draw': {
      const result = drawCard(session, playerId);
      return result.ok ? { ok: true, session: result.game } : result;
    }
    case 'chooseColor': {
      const color = colorOf(action.color);
      if (!color) {
        return { ok: false, reason: 'Invalid message.' };
      }
      const result = chooseOpeningColor(session, playerId, color);
      return result.ok ? { ok: true, session: result.game } : result;
    }
    case 'uno': {
      const result = callUno(session, playerId);
      return result.ok ? { ok: true, session: result.game } : result;
    }
    case 'catch': {
      const result = catchUno(session, playerId);
      return result.ok ? { ok: true, session: result.game } : result;
    }
    default:
      return { ok: false, reason: 'Invalid message.' };
  }
}

function onTimeout(session: GameSnapshot, playerId: string): GameSnapshot {
  if (session.winnerId || session.players[session.currentPlayerIndex]?.id !== playerId) {
    return session;
  }
  const name = session.players.find((player) => player.id === playerId)?.name ?? 'Player';
  if (session.awaitingWildColor) {
    const chosen = chooseOpeningColor(session, playerId, 'red');
    if (!chosen.ok) {
      return forcePassTurn(session);
    }
    return { ...chosen.game, status: `${name} timed out. Color set to red.` };
  }
  const penalty = session.pendingDraw > 0 ? session.pendingDraw : 1;
  const drawn = drawCard(session, playerId);
  if (!drawn.ok) {
    return forcePassTurn(session);
  }
  if (drawn.game.winnerId) {
    return drawn.game;
  }
  const turnName = drawn.game.players[drawn.game.currentPlayerIndex]?.name ?? 'Next';
  if (penalty > 1) {
    return {
      ...drawn.game,
      status: `${name} timed out and draws ${penalty}. ${turnName}'s turn.`,
    };
  }
  return {
    ...drawn.game,
    status: `${name} timed out and drew a card. ${turnName}'s turn.`,
  };
}

export const unoModule: GameModule<GameSnapshot, PersonalizedState> = {
  id: 'uno',
  label: 'Uno',
  minPlayers: 2,
  maxPlayers: 6,
  create(players: GamePlayer[], random: () => number, options: GameOptions): GameSnapshot {
    return createGame(
      players,
      random,
      undefined,
      options.guaranteeSpecial !== false,
      typeof options.cardsPerPlayer === 'number' ? options.cardsPerPlayer : 7,
      options.stackDraws === true
    );
  },
  apply,
  onTimeout,
  personalize(session: GameSnapshot, playerId: string, context: PersonalizeContext): PersonalizedState {
    const state = personalize(session, playerId);
    const myTurn =
      state.currentPlayerId === state.yourPlayerId && !state.winnerId && !state.awaitingWildColor;
    return {
      ...state,
      turnDeadline: context.turnDeadline,
      hand: state.hand.map((card) => ({
        ...card,
        playable:
          myTurn &&
          canPlayCard(
            card,
            state.discard,
            state.currentColor,
            session.pendingDraw,
            session.pendingDrawKind
          ),
      })),
      opponents: state.opponents.map((opponent) => ({
        ...opponent,
        connected: context.connected(opponent.id),
      })),
    };
  },
  dropPlayer(session: GameSnapshot, playerId: string): GameSnapshot {
    return dropPlayer(session, playerId);
  },
  forcePassTurn(session: GameSnapshot): GameSnapshot {
    return forcePassTurn(session);
  },
  winner(session: GameSnapshot): { id: string; name: string } | null {
    if (!session.winnerId) {
      return null;
    }
    const player = session.players.find((item) => item.id === session.winnerId);
    return { id: session.winnerId, name: player?.name ?? 'Someone' };
  },
  currentPlayerId(session: GameSnapshot): string {
    return session.players[session.currentPlayerIndex]?.id ?? '';
  },
  setStatus(session: GameSnapshot, status: string): GameSnapshot {
    return { ...session, status };
  },
  playerIds(session: GameSnapshot): string[] {
    return session.players.map((player) => player.id);
  },
};
