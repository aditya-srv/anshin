import {
  ApplyResult,
  GameAction,
  GameModule,
  GameOptions,
  GamePlayer,
  PersonalizeContext,
} from '../games/types';
import {
  blockedTrackIndexes,
  createGame,
  diceFromRandom,
  dropPlayer,
  forcePassTurn,
  moveToken,
  rollDice,
  tokenView,
} from './engine';
import { LudoPublicState, LudoSession } from './types';

function settled(result: { ok: true; session: LudoSession } | { ok: false; reason: string }): ApplyResult<LudoSession> {
  return result.ok ? { ok: true, session: result.session } : result;
}

function chooseTimeoutMove(session: LudoSession, playerId: string, random: () => number): LudoSession {
  if (session.winnerId) {
    return session;
  }
  if (session.players[session.currentPlayerIndex]?.id !== playerId) {
    return session;
  }
  if (session.awaiting !== 'move') {
    return session;
  }
  const ids = session.legalTokenIds;
  if (ids.length === 0) {
    return forcePassTurn(session);
  }
  const tokenId = ids[Math.floor(random() * ids.length)] ?? ids[0];
  const moved = moveToken(session, playerId, tokenId);
  return moved.ok ? moved.session : forcePassTurn(session);
}

export const ludoModule: GameModule<LudoSession, LudoPublicState> = {
  id: 'ludo',
  label: 'Ludo',
  minPlayers: 2,
  maxPlayers: 4,
  create(players: GamePlayer[], random: () => number, options: GameOptions): LudoSession {
    return createGame(players, random, options.blockades === true);
  },
  apply(session: LudoSession, playerId: string, action: GameAction): ApplyResult<LudoSession> {
    if (action.type === 'roll') {
      return settled(rollDice(session, playerId, diceFromRandom(session.random)));
    }
    if (action.type === 'move') {
      if (typeof action.tokenId !== 'string') {
        return { ok: false, reason: 'Invalid message.' };
      }
      return settled(moveToken(session, playerId, action.tokenId));
    }
    return { ok: false, reason: 'Invalid message.' };
  },
  onTimeout(session: LudoSession, playerId: string, random: () => number): LudoSession {
    if (session.winnerId || session.players[session.currentPlayerIndex]?.id !== playerId) {
      return session;
    }
    if (session.awaiting === 'roll') {
      const rolled = rollDice(session, playerId, diceFromRandom(random));
      if (!rolled.ok) {
        return forcePassTurn(session);
      }
      return chooseTimeoutMove(rolled.session, playerId, random);
    }
    return chooseTimeoutMove(session, playerId, random);
  },
  personalize(session: LudoSession, playerId: string, context: PersonalizeContext): LudoPublicState {
    const you = session.players.find((player) => player.id === playerId);
    if (!you) {
      throw new Error('Player not in game');
    }
    const currentId = session.players[session.currentPlayerIndex]?.id ?? '';
    const showMoves = currentId === playerId && session.awaiting === 'move' && !session.winnerId;
    return {
      players: session.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        connected: context.connected(player.id),
        tokensHome: session.tokens.filter((token) => token.playerId === player.id && token.progress === 56).length,
      })),
      tokens: session.tokens.map(tokenView),
      currentPlayerId: currentId,
      yourPlayerId: playerId,
      awaiting: session.awaiting,
      dice: session.dice,
      consecutiveSixes: session.consecutiveSixes,
      legalTokenIds: showMoves ? session.legalTokenIds.slice() : [],
      blockedTrackIndexes: blockedTrackIndexes(session),
      status: session.status,
      winnerId: session.winnerId,
      turnDeadline: context.turnDeadline,
    };
  },
  dropPlayer(session: LudoSession, playerId: string): LudoSession {
    return dropPlayer(session, playerId);
  },
  forcePassTurn(session: LudoSession): LudoSession {
    return forcePassTurn(session);
  },
  winner(session: LudoSession): { id: string; name: string } | null {
    if (!session.winnerId) {
      return null;
    }
    const player = session.players.find((item) => item.id === session.winnerId);
    return { id: session.winnerId, name: player?.name ?? 'Someone' };
  },
  currentPlayerId(session: LudoSession): string {
    return session.players[session.currentPlayerIndex]?.id ?? '';
  },
  setStatus(session: LudoSession, status: string): LudoSession {
    return { ...session, status };
  },
  playerIds(session: LudoSession): string[] {
    return session.players.map((player) => player.id);
  },
};
