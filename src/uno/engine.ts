import { createDeck, isWild, shuffle } from './deck';
import {
  Direction,
  GameSnapshot,
  PersonalizedState,
  PlayerSeat,
  UnoCard,
  UnoColor,
} from './types';

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
  random: () => number = Math.random
): GameSnapshot {
  if (players.length < 2 || players.length > 4) {
    throw new Error('UNO requires 2 to 4 players');
  }

  const drawPile = shuffle(createDeck(), random);
  const seats: PlayerSeat[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    hand: [] as UnoCard[],
  }));

  for (let round = 0; round < 7; round++) {
    for (const seat of seats) {
      const card = drawPile.pop();
      if (!card) {
        throw new Error('Deck exhausted while dealing');
      }
      seat.hand.push(card);
    }
  }

  // Flip first discard; reshuffle wild4 back into draw pile until non-wild4.
  let first: UnoCard | undefined;
  for (;;) {
    first = drawPile.pop();
    if (!first) {
      throw new Error('Deck exhausted while flipping discard');
    }
    if (first.value === 'wild4') {
      drawPile.push(first);
      shuffle(drawPile, random);
      continue;
    }
    break;
  }

  let currentColor: UnoColor;
  let status: string;
  let currentPlayerIndex = 0;
  let direction: Direction = 1;

  if (first.value === 'wild') {
    currentColor = pickRandomColor(random);
    status = `Game started. Wild sets color to ${currentColor}. ${seats[0].name}'s turn.`;
  } else {
    currentColor = first.color as UnoColor;
    // Apply opening action card effects against the first player (index 0).
    const opening = applyActionEffects(
      {
        players: seats,
        drawPile,
        discardPile: [first],
        currentColor,
        currentPlayerIndex: 0,
        direction: 1,
        winnerId: null,
        status: '',
      },
      first,
      /*advanceAfter*/ true
    );
    currentPlayerIndex = opening.currentPlayerIndex;
    direction = opening.direction;
    currentColor = opening.currentColor;
    status = `Game started. ${seats[currentPlayerIndex].name}'s turn.`;
  }

  return {
    players: seats,
    drawPile,
    discardPile: [first],
    currentColor,
    currentPlayerIndex,
    direction,
    winnerId: null,
    status,
  };
}

export function playCard(
  game: GameSnapshot,
  playerId: string,
  cardId: string,
  wildColor?: UnoColor
): GameSnapshot {
  if (game.winnerId) {
    return withStatus(game, 'Game is over.');
  }

  const playerIndex = game.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return withStatus(game, 'Unknown player.');
  }
  if (playerIndex !== game.currentPlayerIndex) {
    return withStatus(game, 'Not your turn.');
  }

  const player = game.players[playerIndex];
  const handIndex = player.hand.findIndex((c) => c.id === cardId);
  if (handIndex === -1) {
    return withStatus(game, 'Card not in hand.');
  }

  const card = player.hand[handIndex];
  const top = topDiscard(game);
  if (!canPlay(card, top, game.currentColor)) {
    return withStatus(game, 'Illegal play.');
  }

  if (isWild(card.value)) {
    if (!wildColor) {
      return withStatus(game, 'Choose a color for wild.');
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

  if (nextPlayer.hand.length === 0) {
    next.winnerId = playerId;
    next.status = `${nextPlayer.name} wins!`;
    return next;
  }

  applyActionEffects(next, card, true);
  const turnName = next.players[next.currentPlayerIndex].name;
  const label = formatCard(card);
  next.status = `${nextPlayer.name} played ${label}. ${turnName}'s turn.`;
  return next;
}

export function drawCard(game: GameSnapshot, playerId: string): GameSnapshot {
  if (game.winnerId) {
    return withStatus(game, 'Game is over.');
  }

  const playerIndex = game.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return withStatus(game, 'Unknown player.');
  }
  if (playerIndex !== game.currentPlayerIndex) {
    return withStatus(game, 'Not your turn.');
  }

  const next = cloneGame(game);
  const drawn = takeFromDraw(next, 1);
  if (drawn.length === 0) {
    next.status = 'Draw pile is empty.';
    return next;
  }

  next.players[playerIndex].hand.push(drawn[0]);
  advanceTurn(next);
  const turnName = next.players[next.currentPlayerIndex].name;
  next.status = `${next.players[playerIndex].name} drew a card. ${turnName}'s turn.`;
  return next;
}

export function personalize(game: GameSnapshot, forPlayerId: string): PersonalizedState {
  const you = game.players.find((p) => p.id === forPlayerId);
  if (!you) {
    throw new Error('Player not in game');
  }

  const opponents = game.players
    .filter((p) => p.id !== forPlayerId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand.length,
    }));

  return {
    opponents,
    discard: topDiscard(game),
    currentColor: game.currentColor,
    hand: you.hand.map((c) => ({ ...c })),
    drawRemaining: game.drawPile.length,
    currentPlayerId: game.players[game.currentPlayerIndex].id,
    yourPlayerId: forPlayerId,
    direction: game.direction,
    status: game.status,
    winnerId: game.winnerId,
    playerCount: game.players.length,
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
  shuffle(rest);
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
  };
}

function withStatus(game: GameSnapshot, status: string): GameSnapshot {
  const next = cloneGame(game);
  next.status = status;
  return next;
}

function pickRandomColor(random: () => number): UnoColor {
  const colors: UnoColor[] = ['red', 'yellow', 'green', 'blue'];
  return colors[Math.floor(random() * colors.length)];
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
    ...partial,
  };
}
