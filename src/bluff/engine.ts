import { createDeck, MAX_BLUFF_DECKS, MIN_BLUFF_DECKS, shuffle } from './deck';
import {
  BLUFF_RANKS,
  BluffCard,
  BluffChallengeResult,
  BluffLastPlay,
  BluffPlayer,
  BluffPublicState,
  BluffRank,
  BluffSession,
} from './types';

export type BluffResult =
  | { ok: true; session: BluffSession }
  | { ok: false; reason: string };

export function isBluffRank(value: unknown): value is BluffRank {
  return typeof value === 'string' && (BLUFF_RANKS as readonly string[]).includes(value);
}

export function createGame(
  players: { id: string; name: string }[],
  random: () => number = Math.random,
  deckCount: number = MIN_BLUFF_DECKS
): BluffSession {
  if (players.length < 2 || players.length > 6) {
    throw new Error('Bluff requires 2 to 6 players');
  }
  if (
    !Number.isInteger(deckCount) ||
    deckCount < MIN_BLUFF_DECKS ||
    deckCount > MAX_BLUFF_DECKS
  ) {
    throw new Error(`Bluff supports ${MIN_BLUFF_DECKS} or ${MAX_BLUFF_DECKS} decks.`);
  }

  const deck = shuffle(createDeck(deckCount), random);
  const seats: BluffPlayer[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    hand: [] as BluffCard[],
  }));

  let index = 0;
  while (index < deck.length) {
    for (const seat of seats) {
      if (index >= deck.length) {
        break;
      }
      seat.hand.push(deck[index]);
      index += 1;
    }
  }

  for (const seat of seats) {
    seat.hand.sort(compareCards);
  }

  const startIndex = Math.floor(random() * seats.length);
  return {
    players: seats,
    discardPile: [],
    lastPlay: null,
    claimedRank: null,
    pendingWinPlayerId: null,
    lastChallenge: null,
    currentPlayerIndex: startIndex,
    winnerId: null,
    loserId: null,
    status: `Game started. ${seats[startIndex].name}'s turn.`,
    random,
  };
}

export function playCards(
  session: BluffSession,
  playerId: string,
  cardIds: string[],
  declaredRank: BluffRank
): BluffResult {
  if (session.winnerId) {
    return { ok: false, reason: 'Game is over.' };
  }
  if (!isBluffRank(declaredRank)) {
    return { ok: false, reason: 'Invalid message.' };
  }
  if (!Array.isArray(cardIds) || cardIds.length < 1) {
    return { ok: false, reason: 'Select at least 1 card.' };
  }
  if (new Set(cardIds).size !== cardIds.length) {
    return { ok: false, reason: 'Duplicate cards.' };
  }
  if (current(session).id !== playerId) {
    return { ok: false, reason: 'Not your turn.' };
  }

  const next = clone(session);

  // Playing without challenging confirms a pending empty-hand exit.
  let justOutName: string | null = null;
  if (next.pendingWinPlayerId) {
    const settled = confirmPendingOut(next);
    if (settled.kind === 'ended') {
      return { ok: true, session: next };
    }
    if (settled.kind === 'continued') {
      justOutName = settled.name;
    }
  }

  // While cards remain in the pile, every seat must keep the same declared rank.
  // The lock clears only when a challenge empties the pile.
  const lockedRank =
    next.discardPile.length > 0
      ? (next.claimedRank ?? next.lastPlay?.declaredRank ?? null)
      : null;
  if (lockedRank && declaredRank !== lockedRank) {
    return { ok: false, reason: `Must declare ${lockedRank}.` };
  }

  const actor = current(next);
  const selected: BluffCard[] = [];
  for (const cardId of cardIds) {
    const handIndex = actor.hand.findIndex((card) => card.id === cardId);
    if (handIndex === -1) {
      return { ok: false, reason: 'Card not in hand.' };
    }
    selected.push(actor.hand[handIndex]);
  }

  actor.hand = actor.hand.filter((card) => !cardIds.includes(card.id));
  next.discardPile.push(...selected.map((card) => ({ ...card })));
  next.lastPlay = {
    playerId: actor.id,
    playerName: actor.name,
    declaredRank,
    quantity: selected.length,
    cards: selected.map((card) => ({ ...card })),
  };
  next.claimedRank = declaredRank;
  next.lastChallenge = null;
  next.pendingWinPlayerId = actor.hand.length === 0 ? actor.id : null;

  advanceTurn(next);
  const claim = formatClaim(selected.length, declaredRank);
  const outPrefix = justOutName ? `${justOutName} is out. ` : '';
  if (next.pendingWinPlayerId) {
    next.status = `${outPrefix}${actor.name} played ${claim} and has no cards left. ${current(next).name} may call bluff or play.`;
  } else {
    next.status = `${outPrefix}${actor.name} played ${claim}. ${current(next).name}'s turn.`;
  }
  return { ok: true, session: next };
}

/**
 * Challenge the last play by inspecting exactly one of its face-down cards.
 * Bluff is caught only if that selected card's rank differs from the claim.
 */
export function callChallenge(
  session: BluffSession,
  challengerId: string,
  selectedCardId: string
): BluffResult {
  if (session.winnerId) {
    return { ok: false, reason: 'Game is over.' };
  }
  if (current(session).id !== challengerId) {
    return { ok: false, reason: 'Not your turn.' };
  }
  if (!session.lastPlay) {
    return { ok: false, reason: 'Nothing to challenge.' };
  }
  if (session.lastPlay.playerId === challengerId) {
    return { ok: false, reason: 'You cannot challenge yourself.' };
  }
  if (typeof selectedCardId !== 'string' || !selectedCardId) {
    return { ok: false, reason: 'Pick one card to check.' };
  }

  const next = clone(session);
  const play = next.lastPlay as BluffLastPlay;
  const selected = play.cards.find((card) => card.id === selectedCardId);
  if (!selected) {
    return { ok: false, reason: 'That card is not in the last play.' };
  }

  const challenger = next.players.find((player) => player.id === challengerId);
  const accused = next.players.find((player) => player.id === play.playerId);
  if (!challenger || !accused) {
    return { ok: false, reason: 'Unknown player.' };
  }

  const wasBluff = selected.rank !== play.declaredRank;
  const collector = wasBluff ? accused : challenger;
  const pile = next.discardPile.map((card) => ({ ...card }));
  collector.hand.push(...pile);
  collector.hand.sort(compareCards);
  next.discardPile = [];
  next.lastPlay = null;
  next.claimedRank = null;

  const message = wasBluff
    ? `BLUFF CAUGHT! ${accused.name} must collect all cards.`
    : `WRONG CHALLENGE! ${challenger.name} must collect all cards.`;

  const result: BluffChallengeResult = {
    challengerId: challenger.id,
    challengerName: challenger.name,
    accusedId: accused.id,
    accusedName: accused.name,
    declaredRank: play.declaredRank,
    quantity: play.quantity,
    revealedCards: [{ ...selected }],
    wasBluff,
    collectorId: collector.id,
    collectorName: collector.name,
    message,
  };
  next.lastChallenge = result;
  next.status = message;

  if (next.pendingWinPlayerId) {
    const pending = next.players.find((player) => player.id === next.pendingWinPlayerId);
    if (pending && pending.hand.length === 0) {
      // Wrong challenge: empty-hand play stands and that seat is out.
      next.pendingWinPlayerId = null;
      if (finishOut(next, pending)) {
        next.status = `${message} ${pending.name} is out. ${loserName(next)} loses!`;
        return { ok: true, session: next };
      }
      const collectorIndex = next.players.findIndex((player) => player.id === collector.id);
      next.currentPlayerIndex = (collectorIndex + 1) % next.players.length;
      skipFinishedSeats(next);
      next.status = `${message} ${pending.name} is out. ${current(next).name}'s turn.`;
      return { ok: true, session: next };
    }
    next.pendingWinPlayerId = null;
  }

  const collectorIndex = next.players.findIndex((player) => player.id === collector.id);
  next.currentPlayerIndex = (collectorIndex + 1) % next.players.length;
  skipFinishedSeats(next);
  next.status = `${message} ${current(next).name}'s turn.`;
  return { ok: true, session: next };
}

export function personalize(
  session: BluffSession,
  forPlayerId: string,
  connected: (playerId: string) => boolean = () => true,
  turnDeadline: number | null = null
): BluffPublicState {
  const you = session.players.find((player) => player.id === forPlayerId);
  if (!you) {
    throw new Error('Player not in game');
  }

  const me = session.players.findIndex((player) => player.id === forPlayerId);
  const n = session.players.length;
  const opponents = [];
  for (let step = 1; step < n; step++) {
    const seat = session.players[(me + step) % n];
    opponents.push({
      id: seat.id,
      name: seat.name,
      cardCount: seat.hand.length,
      connected: connected(seat.id),
    });
  }

  const currentId = session.players[session.currentPlayerIndex]?.id ?? '';
  const myTurn = currentId === forPlayerId && !session.winnerId;
  const canChallenge = myTurn && !!session.lastPlay;

  return {
    opponents,
    hand: you.hand.map((card) => ({ ...card })),
    discardCount: session.discardPile.length,
    lastPlay: session.lastPlay
      ? {
          playerId: session.lastPlay.playerId,
          playerName: session.lastPlay.playerName,
          declaredRank: session.lastPlay.declaredRank,
          quantity: session.lastPlay.quantity,
          // Ids only — challenger picks one face-down card without seeing ranks.
          ...(canChallenge
            ? { challengeCardIds: session.lastPlay.cards.map((card) => card.id) }
            : {}),
        }
      : null,
    // Expose a lock only while the face-down pile still has cards.
    claimedRank:
      session.discardPile.length > 0
        ? (session.claimedRank ?? session.lastPlay?.declaredRank ?? null)
        : null,
    lastChallenge: session.lastChallenge
      ? {
          ...session.lastChallenge,
          revealedCards: session.lastChallenge.revealedCards.map((card) => ({ ...card })),
        }
      : null,
    canChallenge,
    currentPlayerId: currentId,
    yourPlayerId: forPlayerId,
    status: session.status,
    winnerId: session.winnerId,
    loserId: session.loserId,
    playerCount: session.players.length,
    turnDeadline,
  };
}

export function dropPlayer(session: BluffSession, playerId: string): BluffSession {
  const next = clone(session);
  const index = next.players.findIndex((player) => player.id === playerId);
  if (index === -1 || next.winnerId) {
    return next;
  }

  const removed = next.players[index];
  next.players.splice(index, 1);

  if (next.lastPlay?.playerId === playerId) {
    next.lastPlay = null;
  }
  if (next.pendingWinPlayerId === playerId) {
    next.pendingWinPlayerId = null;
  }

  if (next.players.length === 0) {
    next.currentPlayerIndex = 0;
    next.status = `${removed.name} left.`;
    return next;
  }

  if (next.players.length === 1) {
    // Forfeit: last remaining seat wins (others left the room).
    next.currentPlayerIndex = 0;
    next.winnerId = next.players[0].id;
    next.loserId = null;
    next.pendingWinPlayerId = null;
    next.lastPlay = null;
    next.claimedRank = null;
    next.status = `${next.players[0].name} wins!`;
    return next;
  }

  if (index < next.currentPlayerIndex) {
    next.currentPlayerIndex -= 1;
  } else if (index === next.currentPlayerIndex) {
    next.currentPlayerIndex = index % next.players.length;
  }
  skipFinishedSeats(next);
  next.status = `${removed.name} left. ${current(next).name}'s turn.`;
  return next;
}

/**
 * Current player passes: accept the prior claim (no challenge) and advance.
 * Confirms a pending empty-hand exit the same way as playing without challenging.
 */
export function passTurn(session: BluffSession, playerId: string): BluffResult {
  if (session.winnerId) {
    return { ok: false, reason: 'Game is over.' };
  }
  if (current(session).id !== playerId) {
    return { ok: false, reason: 'Not your turn.' };
  }
  const next = clone(session);
  let justOutName: string | null = null;
  if (next.pendingWinPlayerId) {
    const settled = confirmPendingOut(next);
    if (settled.kind === 'ended') {
      return { ok: true, session: next };
    }
    if (settled.kind === 'continued') {
      justOutName = settled.name;
    }
  }
  const actor = current(next);
  next.lastChallenge = null;
  advanceTurn(next);
  const outPrefix = justOutName ? `${justOutName} is out. ` : '';
  next.status = `${outPrefix}${actor.name} passed. ${current(next).name}'s turn.`;
  return { ok: true, session: next };
}

/**
 * Disconnect / timeout on the current seat.
 * Confirms a pending empty-hand exit (accept without challenge), otherwise advances.
 */
export function forcePassTurn(session: BluffSession): BluffSession {
  if (session.winnerId) {
    return session;
  }
  const next = clone(session);
  let justOutName: string | null = null;
  if (next.pendingWinPlayerId) {
    const settled = confirmPendingOut(next);
    if (settled.kind === 'ended') {
      return next;
    }
    if (settled.kind === 'continued') {
      justOutName = settled.name;
    }
  }
  const skipped = current(next);
  advanceTurn(next);
  const outPrefix = justOutName ? `${justOutName} is out. ` : '';
  next.status = `${outPrefix}${skipped.name} timed out. ${current(next).name}'s turn.`;
  return next;
}

/** Test helper: build a controlled session without dealing. */
export function makeTestGame(partial: Partial<BluffSession> & { players: BluffPlayer[] }): BluffSession {
  return {
    discardPile: [],
    lastPlay: null,
    claimedRank: null,
    pendingWinPlayerId: null,
    lastChallenge: null,
    currentPlayerIndex: 0,
    winnerId: null,
    loserId: null,
    status: '',
    random: Math.random,
    ...partial,
    players: partial.players.map((player) => ({
      id: player.id,
      name: player.name,
      hand: player.hand.map((card) => ({ ...card })),
    })),
  };
}

type ConfirmOutResult =
  | { kind: 'ended' }
  | { kind: 'continued'; name: string }
  | { kind: 'none' };

/**
 * Confirm a pending empty-hand exit. Returns `ended` when only one active
 * player remains (that player loses), `continued` when others still play,
 * or `none` if the pending seat was invalid.
 */
function confirmPendingOut(session: BluffSession): ConfirmOutResult {
  const pendingId = session.pendingWinPlayerId;
  if (!pendingId) {
    return { kind: 'none' };
  }
  const pending = session.players.find((player) => player.id === pendingId);
  session.pendingWinPlayerId = null;
  if (!pending || pending.hand.length > 0) {
    return { kind: 'none' };
  }
  if (finishOut(session, pending)) {
    return { kind: 'ended' };
  }
  return { kind: 'continued', name: pending.name };
}

/** Mark `finished` as out. If one active seat remains, they lose and the match ends. */
function finishOut(session: BluffSession, finished: BluffPlayer): boolean {
  const active = session.players.filter((player) => player.hand.length > 0);
  if (active.length === 1) {
    const loser = active[0];
    session.loserId = loser.id;
    session.winnerId = finished.id;
    session.pendingWinPlayerId = null;
    session.lastPlay = null;
    session.claimedRank = null;
    session.status = `${finished.name} is out. ${loser.name} loses!`;
    return true;
  }
  if (active.length === 0) {
    // Degenerate: everyone empty — treat the finisher as the announced winner.
    session.winnerId = finished.id;
    session.loserId = null;
    session.pendingWinPlayerId = null;
    session.lastPlay = null;
    session.claimedRank = null;
    session.status = `${finished.name} wins!`;
    return true;
  }
  return false;
}

function loserName(session: BluffSession): string {
  const loser = session.players.find((player) => player.id === session.loserId);
  return loser?.name ?? 'Someone';
}

function current(session: BluffSession): BluffPlayer {
  return session.players[session.currentPlayerIndex];
}

function advanceTurn(session: BluffSession): void {
  const n = session.players.length;
  if (n === 0) {
    return;
  }
  session.currentPlayerIndex = (session.currentPlayerIndex + 1) % n;
  skipFinishedSeats(session);
}

/** Skip seats that already emptied their hand (still seated for the table view). */
function skipFinishedSeats(session: BluffSession): void {
  const n = session.players.length;
  if (n === 0 || session.winnerId) {
    return;
  }
  for (let step = 0; step < n; step++) {
    if (session.players[session.currentPlayerIndex].hand.length > 0) {
      return;
    }
    session.currentPlayerIndex = (session.currentPlayerIndex + 1) % n;
  }
}

function formatClaim(quantity: number, rank: BluffRank): string {
  const label = quantity === 1 ? rank : pluralRank(rank);
  return `${quantity} ${label}`;
}

function pluralRank(rank: BluffRank): string {
  if (rank === '6') {
    return '6es';
  }
  if (rank === 'Ace') {
    return 'Aces';
  }
  if (rank === 'Jack') {
    return 'Jacks';
  }
  if (rank === 'Queen') {
    return 'Queens';
  }
  if (rank === 'King') {
    return 'Kings';
  }
  return `${rank}s`;
}

function compareCards(a: BluffCard, b: BluffCard): number {
  const rankDiff = BLUFF_RANKS.indexOf(a.rank) - BLUFF_RANKS.indexOf(b.rank);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  return a.suit.localeCompare(b.suit);
}

function clone(session: BluffSession): BluffSession {
  return {
    players: session.players.map((player) => ({
      id: player.id,
      name: player.name,
      hand: player.hand.map((card) => ({ ...card })),
    })),
    discardPile: session.discardPile.map((card) => ({ ...card })),
    lastPlay: session.lastPlay
      ? {
          playerId: session.lastPlay.playerId,
          playerName: session.lastPlay.playerName,
          declaredRank: session.lastPlay.declaredRank,
          quantity: session.lastPlay.quantity,
          cards: session.lastPlay.cards.map((card) => ({ ...card })),
        }
      : null,
    claimedRank: session.claimedRank,
    pendingWinPlayerId: session.pendingWinPlayerId,
    lastChallenge: session.lastChallenge
      ? {
          ...session.lastChallenge,
          revealedCards: session.lastChallenge.revealedCards.map((card) => ({ ...card })),
        }
      : null,
    currentPlayerIndex: session.currentPlayerIndex,
    winnerId: session.winnerId,
    loserId: session.loserId,
    status: session.status,
    random: session.random,
  };
}
