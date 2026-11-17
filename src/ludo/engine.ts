import { DONE_PROGRESS, LAST_TRACK, isSafeTrack, trackIndexFor } from './board';
import { LUDO_COLORS, LudoPlayer, LudoSession, LudoToken, LudoTokenView, LudoZone } from './types';

export const TOKENS_PER_PLAYER = 4;
const DONE = DONE_PROGRESS;

export type LudoResult =
  | { ok: true; session: LudoSession }
  | { ok: false; reason: string };

export function createGame(
  players: { id: string; name: string }[],
  random: () => number = Math.random
): LudoSession {
  if (players.length < 2 || players.length > 4) {
    throw new Error('Ludo requires 2 to 4 players');
  }
  const seated: LudoPlayer[] = players.map((player, index) => ({
    id: player.id,
    name: player.name,
    color: LUDO_COLORS[index],
  }));
  const tokens: LudoToken[] = [];
  for (const player of seated) {
    for (let slot = 0; slot < TOKENS_PER_PLAYER; slot++) {
      tokens.push({
        id: `${player.id}:${slot}`,
        playerId: player.id,
        color: player.color,
        progress: -1,
      });
    }
  }
  return {
    players: seated,
    tokens,
    currentPlayerIndex: 0,
    awaiting: 'roll',
    dice: null,
    consecutiveSixes: 0,
    legalTokenIds: [],
    winnerId: null,
    status: `${seated[0].name}'s turn. Roll the dice.`,
    random,
  };
}

export function rollDice(session: LudoSession, playerId: string, dice: number): LudoResult {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    return { ok: false, reason: 'Invalid roll.' };
  }
  const gate = gateTurn(session, playerId, 'roll');
  if (!gate.ok) {
    return gate;
  }
  const next = clone(session);
  const actor = current(next);
  next.dice = dice;

  if (dice === 6 && next.consecutiveSixes >= 2) {
    next.consecutiveSixes = 0;
    next.legalTokenIds = [];
    next.awaiting = 'roll';
    passTurn(next);
    next.status = `${actor.name} rolled a third 6. The turn passes.`;
    return { ok: true, session: next };
  }

  const legal = legalTokenIds(next, dice);
  if (legal.length === 0) {
    next.consecutiveSixes = 0;
    next.legalTokenIds = [];
    next.awaiting = 'roll';
    passTurn(next);
    next.status = `${actor.name} rolled ${dice}. No legal move. ${current(next).name}'s turn.`;
    return { ok: true, session: next };
  }

  if (legal.length === 1) {
    const result = applyTokenMove(next, legal[0], dice);
    finishTurn(next, actor.name, dice, result.captured, result.finished);
    return { ok: true, session: next };
  }

  next.awaiting = 'move';
  next.legalTokenIds = legal;
  next.status = `${actor.name} rolled ${dice}. Choose a token.`;
  return { ok: true, session: next };
}

export function moveToken(session: LudoSession, playerId: string, tokenId: string): LudoResult {
  const gate = gateTurn(session, playerId, 'move');
  if (!gate.ok) {
    return gate;
  }
  if (!session.legalTokenIds.includes(tokenId) || session.dice == null) {
    return { ok: false, reason: 'That token cannot move.' };
  }
  const next = clone(session);
  const actor = current(next);
  const dice = next.dice ?? 0;
  const result = applyTokenMove(next, tokenId, dice);
  finishTurn(next, actor.name, dice, result.captured, result.finished);
  return { ok: true, session: next };
}

export function placeToken(session: LudoSession, tokenId: string, progress: number): LudoSession {
  const next = clone(session);
  const token = next.tokens.find((item) => item.id === tokenId);
  if (!token) {
    throw new Error(`Unknown token ${tokenId}`);
  }
  if (!Number.isInteger(progress) || progress < -1 || progress > DONE) {
    throw new Error('Progress out of range');
  }
  token.progress = progress;
  return next;
}

export function setCurrentPlayer(session: LudoSession, playerId: string): LudoSession {
  const next = clone(session);
  const index = next.players.findIndex((player) => player.id === playerId);
  if (index === -1) {
    throw new Error('Unknown player');
  }
  next.currentPlayerIndex = index;
  next.awaiting = 'roll';
  next.legalTokenIds = [];
  next.dice = null;
  next.consecutiveSixes = 0;
  return next;
}

export function dropPlayer(session: LudoSession, playerId: string): LudoSession {
  const next = clone(session);
  const index = next.players.findIndex((player) => player.id === playerId);
  if (index === -1 || next.winnerId) {
    return next;
  }
  const removed = next.players[index];
  next.players.splice(index, 1);
  next.tokens = next.tokens.filter((token) => token.playerId !== playerId);
  next.legalTokenIds = [];
  if (next.awaiting === 'move') {
    next.awaiting = 'roll';
    next.dice = null;
    next.consecutiveSixes = 0;
  }
  if (next.players.length === 0) {
    next.currentPlayerIndex = 0;
    next.status = `${removed.name} left.`;
    return next;
  }
  if (next.players.length === 1) {
    next.currentPlayerIndex = 0;
    next.winnerId = next.players[0].id;
    next.awaiting = 'roll';
    next.dice = null;
    next.consecutiveSixes = 0;
    next.status = `${next.players[0].name} wins!`;
    return next;
  }
  if (index < next.currentPlayerIndex) {
    next.currentPlayerIndex -= 1;
  } else if (index === next.currentPlayerIndex) {
    next.currentPlayerIndex = index % next.players.length;
    next.awaiting = 'roll';
    next.dice = null;
    next.consecutiveSixes = 0;
  }
  next.status = `${removed.name} left. ${current(next).name}'s turn.`;
  return next;
}

export function tokenView(token: LudoToken): LudoTokenView {
  return {
    id: token.id,
    playerId: token.playerId,
    color: token.color,
    zone: zoneOf(token.progress),
    index: viewIndex(token),
  };
}

function gateTurn(session: LudoSession, playerId: string, phase: 'roll' | 'move'): LudoResult {
  if (session.winnerId) {
    return { ok: false, reason: 'Game is over.' };
  }
  if (current(session).id !== playerId) {
    return { ok: false, reason: 'Not your turn.' };
  }
  if (session.awaiting !== phase) {
    return { ok: false, reason: phase === 'roll' ? 'Move a token first.' : 'Roll the dice first.' };
  }
  return { ok: true, session };
}

function finishTurn(
  session: LudoSession,
  actorName: string,
  dice: number,
  captured: boolean,
  finished: boolean
): void {
  if (session.winnerId) {
    const winner = session.players.find((player) => player.id === session.winnerId);
    session.status = `${winner?.name ?? actorName} wins!`;
    session.awaiting = 'roll';
    session.legalTokenIds = [];
    return;
  }
  if (dice === 6) {
    session.consecutiveSixes += 1;
    session.awaiting = 'roll';
    session.legalTokenIds = [];
    if (captured && finished) {
      session.status = `${actorName} rolled a 6, captured, and got a piece home. Roll again.`;
    } else if (captured) {
      session.status = `${actorName} rolled a 6 and captured. Roll again.`;
    } else if (finished) {
      session.status = `${actorName} rolled a 6 and got a piece home. Roll again.`;
    } else {
      session.status = `${actorName} rolled a 6. Roll again.`;
    }
    return;
  }
  if (captured || finished) {
    session.consecutiveSixes = 0;
    session.awaiting = 'roll';
    session.legalTokenIds = [];
    if (captured && finished) {
      session.status = `${actorName} captured a token and got a piece home. Roll again.`;
    } else if (captured) {
      session.status = `${actorName} captured a token. Roll again.`;
    } else {
      session.status = `${actorName} got a piece home. Roll again.`;
    }
    return;
  }
  session.consecutiveSixes = 0;
  session.awaiting = 'roll';
  session.legalTokenIds = [];
  passTurn(session);
  session.status = `${actorName} rolled ${dice}. ${current(session).name}'s turn.`;
}

function passTurn(session: LudoSession): void {
  session.currentPlayerIndex = (session.currentPlayerIndex + 1) % session.players.length;
  session.dice = null;
}

/** Clear phase locks and advance past the current player (disconnect / timeout fallback). */
export function forcePassTurn(session: LudoSession): LudoSession {
  if (session.winnerId || session.players.length === 0) {
    return session;
  }
  const next = clone(session);
  const skipped = current(next);
  next.awaiting = 'roll';
  next.legalTokenIds = [];
  next.consecutiveSixes = 0;
  passTurn(next);
  next.status = `${skipped.name}'s turn was skipped. ${current(next).name}'s turn.`;
  return next;
}

function applyTokenMove(
  session: LudoSession,
  tokenId: string,
  dice: number
): { captured: boolean; finished: boolean } {
  const token = session.tokens.find((item) => item.id === tokenId);
  if (!token) {
    return { captured: false, finished: false };
  }
  const prior = token.progress;
  let captured = false;
  if (token.progress < 0) {
    token.progress = 0;
  } else {
    token.progress += dice;
    captured = capture(session, token);
  }
  const finished = token.progress === DONE && prior !== DONE;
  if (session.tokens.filter((item) => item.playerId === token.playerId && item.progress === DONE).length === TOKENS_PER_PLAYER) {
    session.winnerId = token.playerId;
  }
  return { captured, finished };
}

function capture(session: LudoSession, moved: LudoToken): boolean {
  if (moved.progress < 0 || moved.progress > LAST_TRACK) {
    return false;
  }
  const landed = trackIndexFor(moved.color, moved.progress);
  if (isSafeTrack(landed)) {
    return false;
  }
  const opponents = session.tokens.filter(
    (token) =>
      token.playerId !== moved.playerId &&
      token.progress >= 0 &&
      token.progress <= LAST_TRACK &&
      trackIndexFor(token.color, token.progress) === landed
  );
  if (opponents.length === 1) {
    opponents[0].progress = -1;
    return true;
  }
  return false;
}

function legalTokenIds(session: LudoSession, dice: number): string[] {
  const player = current(session);
  return session.tokens
    .filter((token) => token.playerId === player.id && canMove(session, token, dice))
    .map((token) => token.id);
}

function canMove(session: LudoSession, token: LudoToken, dice: number): boolean {
  if (token.progress === DONE) {
    return false;
  }
  if (token.progress < 0) {
    return dice === 6 && !opponentBlock(session, token.playerId, trackIndexFor(token.color, 0));
  }
  const next = token.progress + dice;
  if (next > DONE) {
    return false;
  }
  const lastTrackStep = Math.min(LAST_TRACK, next);
  for (let step = token.progress + 1; step <= lastTrackStep; step++) {
    if (opponentBlock(session, token.playerId, trackIndexFor(token.color, step))) {
      return false;
    }
  }
  if (next <= LAST_TRACK) {
    const landed = trackIndexFor(token.color, next);
    if (!isSafeTrack(landed) && opponentTokens(session, token.playerId, landed).length >= 2) {
      return false;
    }
  }
  return true;
}

function opponentBlock(session: LudoSession, playerId: string, trackIndex: number): boolean {
  const counts = new Map<string, number>();
  for (const token of opponentTokens(session, playerId, trackIndex)) {
    counts.set(token.playerId, (counts.get(token.playerId) ?? 0) + 1);
  }
  for (const count of counts.values()) {
    if (count >= 2) {
      return true;
    }
  }
  return false;
}

function opponentTokens(session: LudoSession, playerId: string, trackIndex: number): LudoToken[] {
  return session.tokens.filter(
    (token) =>
      token.playerId !== playerId &&
      token.progress >= 0 &&
      token.progress <= LAST_TRACK &&
      trackIndexFor(token.color, token.progress) === trackIndex
  );
}

function current(session: LudoSession): LudoPlayer {
  return session.players[session.currentPlayerIndex];
}

function zoneOf(progress: number): LudoZone {
  if (progress < 0) {
    return 'yard';
  }
  if (progress <= LAST_TRACK) {
    return 'track';
  }
  if (progress < DONE) {
    return 'home';
  }
  return 'done';
}

function viewIndex(token: LudoToken): number | null {
  if (token.progress < 0) {
    const slot = Number(token.id.slice(token.id.lastIndexOf(':') + 1));
    return Number.isInteger(slot) ? slot : 0;
  }
  if (token.progress <= LAST_TRACK) {
    return trackIndexFor(token.color, token.progress);
  }
  if (token.progress < DONE) {
    return token.progress - 51;
  }
  return null;
}

function clone(session: LudoSession): LudoSession {
  return {
    ...session,
    players: session.players.map((player) => ({ ...player })),
    tokens: session.tokens.map((token) => ({ ...token })),
    legalTokenIds: session.legalTokenIds.slice(),
  };
}

export function diceFromRandom(random: () => number): number {
  return 1 + Math.floor(random() * 6);
}
