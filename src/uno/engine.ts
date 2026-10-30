import { createDeck, isSpecial, isWild, shuffle } from './deck';
import {
  Direction,
  GameSnapshot,
  PersonalizedState,
  PlayerSeat,
  UnoCall,
  UnoCard,
  UnoColor,
  UnoSaid,
} from './types';

export const DEFAULT_CARDS_PER_PLAYER = 7;
export const MIN_CARDS_PER_PLAYER = 1;
export const MAX_CARDS_PER_PLAYER = 15;

export type ActionResult =
  | { ok: true; game: GameSnapshot }
  | { ok: false; reason: string };

export function canPlay(card: UnoCard, top: UnoCard, currentColor: UnoColor): boolean {
  if (isWild(card.value)) {
    return true;
  }
  if (card.color === currentColor) {
    return true;
  }
  if (card.value === top.value && !isWild(top.value)) {
    return true;
  }
  return false;
}

export function createGame(
  players: { id: string; name: string }[],
  random: () => number = Math.random,
  /** Pre-ordered draw pile (top = last item). Tests use this to force the opening card. */
  deck?: UnoCard[],
  guaranteeSpecial = true,
  cardsPerPlayer = DEFAULT_CARDS_PER_PLAYER
): GameSnapshot {
  if (players.length < 2 || players.length > 6) {
    throw new Error('UNO requires 2 to 6 players');
  }
  if (
    !Number.isInteger(cardsPerPlayer) ||
    cardsPerPlayer < MIN_CARDS_PER_PLAYER ||
    cardsPerPlayer > MAX_CARDS_PER_PLAYER
  ) {
    throw new Error(
      `Cards per player must be ${MIN_CARDS_PER_PLAYER}-${MAX_CARDS_PER_PLAYER}`
    );
  }

  const drawPile = deck ? deck.slice() : shuffle(createDeck(), random);
  const seats: PlayerSeat[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    hand: [] as UnoCard[],
  }));

  const needed = cardsPerPlayer * players.length + 1;
  if (drawPile.length < needed) {
    throw new Error('Not enough cards to deal');
  }

  for (let round = 0; round < cardsPerPlayer; round++) {
    for (const seat of seats) {
      const card = drawPile.pop();
      if (!card) {
        throw new Error('Deck exhausted while dealing');
      }
      seat.hand.push(card);
    }
  }

  if (!deck && guaranteeSpecial) {
    ensureOpeningSpecial(seats, drawPile, random);
  }

  // Flip first discard; reshuffle wild4 back into draw pile until non-wild4.
  let first: UnoCard | undefined;
  let guard = 0;
  for (;;) {
    first = drawPile.pop();
    if (!first) {
      throw new Error('Deck exhausted while flipping discard');
    }
    if (first.value === 'wild4') {
      guard += 1;
      if (guard > drawPile.length + 8) {
        throw new Error('Could not flip a non-wild draw four');
      }
      drawPile.push(first);
      shuffle(drawPile, random);
      continue;
    }
    break;
  }

  const game: GameSnapshot = {
    players: seats,
    drawPile,
    discardPile: [first],
    currentColor: (first.color ?? 'red') as UnoColor,
    currentPlayerIndex: 0,
    direction: 1,
    winnerId: null,
    status: '',
    awaitingWildColor: false,
    unoPendingPlayerId: null,
    unoSaid: null,
    random,
  };

  if (first.value === 'wild') {
    game.awaitingWildColor = true;
    game.status = `${seats[0].name} must choose a color.`;
    return game;
  }

  applyOpening(game, first);
  return game;
}

/** Opening card is resolved against seat 0, who has not played it. */
function applyOpening(game: GameSnapshot, card: UnoCard): void {
  const n = game.players.length;
  if (card.color) {
    game.currentColor = card.color;
  }

  if (card.value === 'skip' || (card.value === 'reverse' && n === 2)) {
    advanceTurn(game);
    game.status = `Game started. ${game.players[game.currentPlayerIndex].name}'s turn.`;
    return;
  }

  if (card.value === 'reverse') {
    game.direction = -1;
    game.currentPlayerIndex = n - 1;
    game.status = `Game started. ${game.players[game.currentPlayerIndex].name}'s turn.`;
    return;
  }

  if (card.value === 'draw2') {
    const drawn = takeFromDraw(game, 2);
    game.players[0].hand.push(...drawn);
    advanceTurn(game);
    const starter = game.players[game.currentPlayerIndex].name;
    game.status = `Game started. ${game.players[0].name} draws ${drawn.length}. ${starter}'s turn.`;
    return;
  }

  game.status = `Game started. ${game.players[0].name}'s turn.`;
}

export function chooseOpeningColor(
  game: GameSnapshot,
  playerId: string,
  color: UnoColor
): ActionResult {
  if (!game.awaitingWildColor) {
    return { ok: false, reason: 'No color to choose.' };
  }
  const playerIndex = game.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return { ok: false, reason: 'Unknown player.' };
  }
  if (playerIndex !== game.currentPlayerIndex) {
    return { ok: false, reason: 'Not your turn.' };
  }

  const next = cloneGame(game);
  next.awaitingWildColor = false;
  next.currentColor = color;
  next.status = `Game started. Wild sets color to ${color}. ${next.players[playerIndex].name}'s turn.`;
  return { ok: true, game: next };
}

export function playCard(
  game: GameSnapshot,
  playerId: string,
  cardId: string,
  wildColor?: UnoColor,
  now: number = Date.now()
): ActionResult {
  if (game.awaitingWildColor) {
    return { ok: false, reason: 'Choose a color first.' };
  }
  if (game.winnerId) {
    return { ok: false, reason: 'Game is over.' };
  }

  const playerIndex = game.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return { ok: false, reason: 'Unknown player.' };
  }
  if (playerIndex !== game.currentPlayerIndex) {
    return { ok: false, reason: 'Not your turn.' };
  }

  const player = game.players[playerIndex];
  const handIndex = player.hand.findIndex((c) => c.id === cardId);
  if (handIndex === -1) {
    return { ok: false, reason: 'Card not in hand.' };
  }

  const card = player.hand[handIndex];
  const top = topDiscard(game);
  if (!canPlay(card, top, game.currentColor)) {
    return { ok: false, reason: 'Illegal play.' };
  }

  if (isWild(card.value)) {
    if (!wildColor) {
      return { ok: false, reason: 'Choose a color for wild.' };
    }
  }

  const next: GameSnapshot = cloneGame(game);
  const nextPlayer = next.players[playerIndex];
  nextPlayer.hand.splice(handIndex, 1);
  next.discardPile.push(card);

  if (isWild(card.value)) {
    next.currentColor = wildColor!;
  } else {
    next.currentColor = card.color as UnoColor;
  }

  clearUnoSaid(next);

  if (nextPlayer.hand.length === 0) {
    clearUnoCall(next);
    next.winnerId = playerId;
    next.status = `${nextPlayer.name} wins!`;
    return { ok: true, game: next };
  }

  applyActionEffects(next, card, true);
  const turnName = next.players[next.currentPlayerIndex].name;
  const label = formatCard(card);
  next.status = `${nextPlayer.name} played ${label}. ${turnName}'s turn.`;
  releaseUnoIfHandChanged(next);
  if (nextPlayer.hand.length === 1) {
    openUnoCall(next, playerId);
  }
  return { ok: true, game: next };
}

export function drawCard(game: GameSnapshot, playerId: string): ActionResult {
  if (game.awaitingWildColor) {
    return { ok: false, reason: 'Choose a color first.' };
  }
  if (game.winnerId) {
    return { ok: false, reason: 'Game is over.' };
  }

  const playerIndex = game.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return { ok: false, reason: 'Unknown player.' };
  }
  if (playerIndex !== game.currentPlayerIndex) {
    return { ok: false, reason: 'Not your turn.' };
  }

  const next = cloneGame(game);
  clearUnoSaid(next);
  const drawn = takeFromDraw(next, 1);
  const actor = next.players[playerIndex].name;
  if (drawn.length === 0) {
    advanceTurn(next);
    const turnName = next.players[next.currentPlayerIndex].name;
    next.status = `Draw pile is empty. ${actor} passes. ${turnName}'s turn.`;
    releaseUnoIfHandChanged(next);
    return { ok: true, game: next };
  }

  next.players[playerIndex].hand.push(drawn[0]);
  advanceTurn(next);
  const turnName = next.players[next.currentPlayerIndex].name;
  next.status = `${actor} drew a card. ${turnName}'s turn.`;
  releaseUnoIfHandChanged(next);
  return { ok: true, game: next };
}

/** Player with one card announces UNO. */
export function callUno(game: GameSnapshot, callerId: string): ActionResult {
  if (!game.unoPendingPlayerId) {
    return { ok: false, reason: 'No UNO call is open.' };
  }
  if (callerId !== game.unoPendingPlayerId) {
    return { ok: false, reason: 'Only the player with one card can call UNO.' };
  }
  const caller = game.players.find((p) => p.id === callerId);
  if (!caller) {
    return { ok: false, reason: 'Unknown player.' };
  }
  if (caller.hand.length !== 1) {
    return { ok: false, reason: 'No UNO call is open.' };
  }

  const next = cloneGame(game);
  const name = next.players.find((p) => p.id === callerId)?.name ?? caller.name;
  clearUnoCall(next);
  next.unoSaid = { playerId: callerId, playerName: name };
  next.status = `${name} called UNO.`;
  return { ok: true, game: next };
}

/** Another player catches someone who forgot to call UNO. */
export function catchUno(game: GameSnapshot, callerId: string): ActionResult {
  if (!game.unoPendingPlayerId) {
    return { ok: false, reason: 'No UNO call is open.' };
  }
  if (callerId === game.unoPendingPlayerId) {
    return { ok: false, reason: 'You cannot catch yourself.' };
  }
  const caller = game.players.find((p) => p.id === callerId);
  if (!caller) {
    return { ok: false, reason: 'Unknown player.' };
  }

  const next = cloneGame(game);
  const pending = next.players.find((p) => p.id === next.unoPendingPlayerId);
  if (!pending || pending.hand.length !== 1) {
    clearUnoCall(next);
    return { ok: true, game: next };
  }
  const drawn = takeFromDraw(next, 2);
  pending.hand.push(...drawn);
  clearUnoCall(next);
  next.status = `${caller.name} caught ${pending.name} without UNO. ${pending.name} draws ${drawn.length}.`;
  return { ok: true, game: next };
}

export function personalize(
  game: GameSnapshot,
  forPlayerId: string,
  now: number = Date.now()
): PersonalizedState {
  const you = game.players.find((p) => p.id === forPlayerId);
  if (!you) {
    throw new Error('Player not in game');
  }

  const me = game.players.findIndex((p) => p.id === forPlayerId);
  const n = game.players.length;
  const opponents = [];
  for (let step = 1; step < n; step++) {
    const idx = (((me + game.direction * step) % n) + n) % n;
    const seat = game.players[idx];
    opponents.push({
      id: seat.id,
      name: seat.name,
      cardCount: seat.hand.length,
    });
  }

  const recyclable = Math.max(0, game.discardPile.length - 1);

  return {
    opponents,
    discard: { ...topDiscard(game) },
    currentColor: game.currentColor,
    hand: you.hand.map((c) => ({ ...c })),
    drawRemaining: game.drawPile.length + recyclable,
    currentPlayerId: game.players[game.currentPlayerIndex].id,
    yourPlayerId: forPlayerId,
    direction: game.direction,
    status: game.status,
    winnerId: game.winnerId,
    playerCount: game.players.length,
    awaitingWildColor: game.awaitingWildColor,
    unoCall: unoCallView(game),
    unoSaid: game.unoSaid ? { ...game.unoSaid } : null,
  };
}

function applyActionEffects(
  game: GameSnapshot,
  card: UnoCard,
  advanceAfter: boolean
): GameSnapshot {
  const n = game.players.length;

  switch (card.value) {
    case 'reverse': {
      if (n === 2) {
        // Reverse with 2 players acts like Skip.
        advanceTurn(game);
        advanceTurn(game);
      } else {
        game.direction = (game.direction === 1 ? -1 : 1) as Direction;
        if (advanceAfter) {
          advanceTurn(game);
        }
      }
      break;
    }
    case 'skip': {
      advanceTurn(game);
      advanceTurn(game);
      break;
    }
    case 'draw2': {
      advanceTurn(game);
      const victim = game.players[game.currentPlayerIndex];
      victim.hand.push(...takeFromDraw(game, 2));
      advanceTurn(game);
      break;
    }
    case 'wild4': {
      advanceTurn(game);
      const victim = game.players[game.currentPlayerIndex];
      victim.hand.push(...takeFromDraw(game, 4));
      advanceTurn(game);
      break;
    }
    default: {
      if (advanceAfter) {
        advanceTurn(game);
      }
      break;
    }
  }

  return game;
}

function ensureOpeningSpecial(
  seats: PlayerSeat[],
  drawPile: UnoCard[],
  random: () => number
): void {
  for (const seat of seats) {
    if (seat.hand.some((card) => isSpecial(card.value))) {
      continue;
    }
    const handIndex = Math.floor(random() * seat.hand.length);
    const pileSpecials = drawPile
      .map((card, index) => (isSpecial(card.value) ? index : -1))
      .filter((index) => index >= 0);
    if (pileSpecials.length > 0) {
      const pileIndex = pileSpecials[Math.floor(random() * pileSpecials.length)];
      const number = seat.hand[handIndex];
      seat.hand[handIndex] = drawPile[pileIndex];
      drawPile[pileIndex] = number;
      continue;
    }

    const donors = seats.filter(
      (other) => other !== seat && other.hand.filter((card) => isSpecial(card.value)).length >= 2
    );
    if (donors.length === 0) {
      throw new Error('Not enough special cards to deal');
    }
    const donor = donors[Math.floor(random() * donors.length)];
    const donorSpecials = donor.hand
      .map((card, index) => (isSpecial(card.value) ? index : -1))
      .filter((index) => index >= 0);
    const donorIndex = donorSpecials[Math.floor(random() * donorSpecials.length)];
    const number = seat.hand[handIndex];
    seat.hand[handIndex] = donor.hand[donorIndex];
    donor.hand[donorIndex] = number;
  }
}

function advanceTurn(game: GameSnapshot): void {
  const n = game.players.length;
  game.currentPlayerIndex = (game.currentPlayerIndex + game.direction + n) % n;
}

function takeFromDraw(game: GameSnapshot, count: number): UnoCard[] {
  const taken: UnoCard[] = [];
  for (let i = 0; i < count; i++) {
    if (game.drawPile.length === 0) {
      recycleDiscard(game);
    }
    const card = game.drawPile.pop();
    if (!card) {
      break;
    }
    taken.push(card);
  }
  return taken;
}

function recycleDiscard(game: GameSnapshot): void {
  if (game.discardPile.length <= 1) {
    return;
  }
  const top = game.discardPile.pop()!;
  const rest = game.discardPile.splice(0, game.discardPile.length);
  game.discardPile.push(top);
  shuffle(rest, game.random);
  game.drawPile.push(...rest);
}

function topDiscard(game: GameSnapshot): UnoCard {
  return game.discardPile[game.discardPile.length - 1];
}

function cloneGame(game: GameSnapshot): GameSnapshot {
  return {
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      hand: p.hand.map((c) => ({ ...c })),
    })),
    drawPile: game.drawPile.map((c) => ({ ...c })),
    discardPile: game.discardPile.map((c) => ({ ...c })),
    currentColor: game.currentColor,
    currentPlayerIndex: game.currentPlayerIndex,
    direction: game.direction,
    winnerId: game.winnerId,
    status: game.status,
    awaitingWildColor: game.awaitingWildColor,
    unoPendingPlayerId: game.unoPendingPlayerId,
    unoSaid: game.unoSaid ? { ...game.unoSaid } : null,
    random: game.random,
  };
}

function openUnoCall(game: GameSnapshot, playerId: string): void {
  game.unoPendingPlayerId = playerId;
}

function clearUnoCall(game: GameSnapshot): void {
  game.unoPendingPlayerId = null;
}

function clearUnoSaid(game: GameSnapshot): void {
  game.unoSaid = null;
}

function releaseUnoIfHandChanged(game: GameSnapshot): void {
  if (!game.unoPendingPlayerId) {
    return;
  }
  const pending = game.players.find((p) => p.id === game.unoPendingPlayerId);
  if (!pending || pending.hand.length !== 1) {
    clearUnoCall(game);
  }
}

function unoCallView(game: GameSnapshot): UnoCall | null {
  if (!game.unoPendingPlayerId) {
    return null;
  }
  const player = game.players.find((p) => p.id === game.unoPendingPlayerId);
  if (!player || player.hand.length !== 1) {
    return null;
  }
  return {
    playerId: player.id,
    playerName: player.name,
  };
}

function formatCard(card: UnoCard): string {
  if (isWild(card.value)) {
    return card.value === 'wild4' ? 'Wild Draw Four' : 'Wild';
  }
  const color = card.color ? capitalize(card.color) : '';
  switch (card.value) {
    case 'skip':
      return `${color} Skip`;
    case 'reverse':
      return `${color} Reverse`;
    case 'draw2':
      return `${color} Draw Two`;
    default:
      return `${color} ${card.value}`;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Test helper: inject a controlled snapshot. */
export function makeTestGame(partial: Partial<GameSnapshot> & { players: PlayerSeat[] }): GameSnapshot {
  return {
    drawPile: [],
    discardPile: [{ id: 'top', color: 'red', value: '5' }],
    currentColor: 'red',
    currentPlayerIndex: 0,
    direction: 1,
    winnerId: null,
    status: '',
    awaitingWildColor: false,
    unoPendingPlayerId: null,
    unoSaid: null as UnoSaid | null,
    random: Math.random,
    ...partial,
  };
}
