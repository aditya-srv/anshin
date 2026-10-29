import assert from 'assert';
import { describe, it } from 'node:test';
import { createDeck, isWild, shuffle } from './deck';
import {
  canPlay,
  chooseOpeningColor,
  createGame,
  drawCard,
  makeTestGame,
  personalize,
  playCard,
} from './engine';
import { GameSnapshot, UnoCard, UnoColor, UnoValue } from './types';

function face(id: string, color: UnoColor | null, value: UnoValue): UnoCard {
  return { id, color, value };
}

/** Draw pile whose next pops deal `dealt` cards, then the opening card, leaving `under` beneath it. */
function openingPile(opening: UnoCard, dealt: number, under: UnoCard[] = []): UnoCard[] {
  const dealtCards: UnoCard[] = [];
  for (let i = 0; i < dealt; i++) {
    dealtCards.push(face(`dealt${i}`, 'blue', '1'));
  }
  return [...under, opening, ...dealtCards];
}

function mustPlay(
  game: GameSnapshot,
  playerId: string,
  cardId: string,
  wildColor?: UnoColor
): GameSnapshot {
  const result = playCard(game, playerId, cardId, wildColor);
  if (!result.ok) {
    assert.fail(result.reason);
  }
  return result.game;
}

describe('deck', () => {
  it('has 108 cards', () => {
    assert.strictEqual(createDeck().length, 108);
  });

  it('shuffle preserves length', () => {
    const deck = createDeck();
    const shuffled = shuffle([...deck], () => 0.3);
    assert.strictEqual(shuffled.length, 108);
  });
});

describe('canPlay', () => {
  const top: UnoCard = { id: 't', color: 'red', value: '5' };

  it('allows same color', () => {
    assert.ok(canPlay({ id: '1', color: 'red', value: '9' }, top, 'red'));
  });

  it('allows same value', () => {
    assert.ok(canPlay({ id: '1', color: 'blue', value: '5' }, top, 'red'));
  });

  it('rejects mismatch', () => {
    assert.ok(!canPlay({ id: '1', color: 'blue', value: '3' }, top, 'red'));
  });

  it('allows wild always', () => {
    assert.ok(canPlay({ id: '1', color: null, value: 'wild' }, top, 'red'));
    assert.ok(canPlay({ id: '2', color: null, value: 'wild4' }, top, 'red'));
  });
});

describe('createGame', () => {
  it('deals 7 cards to each of 2-4 players', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      () => 0.42
    );
    assert.strictEqual(game.players.length, 3);
    for (const p of game.players) {
      assert.strictEqual(p.hand.length, 7);
    }
    assert.ok(game.discardPile.length >= 1);
    assert.ok(game.discardPile[0].value !== 'wild4');
    assert.strictEqual(game.awaitingWildColor, false);
  });

  it('starts a number card at seat 0', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      () => 0,
      openingPile(face('open', 'red', '5'), 14)
    );
    assert.strictEqual(game.discardPile[0].id, 'open');
    assert.strictEqual(game.currentPlayerIndex, 0);
    assert.strictEqual(game.currentColor, 'red');
  });

  it('skips seat 0 when the opening card is a skip', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      () => 0,
      openingPile(face('open', 'red', 'skip'), 21)
    );
    assert.strictEqual(game.currentPlayerIndex, 1);
  });

  it('makes seat 0 draw two on an opening draw two', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      () => 0,
      openingPile(face('open', 'red', 'draw2'), 21, [
        face('u0', 'yellow', '2'),
        face('u1', 'yellow', '3'),
      ])
    );
    assert.strictEqual(game.players[0].hand.length, 9);
    assert.strictEqual(game.currentPlayerIndex, 1);
    assert.strictEqual(game.players[1].hand.length, 7);
  });

  it('treats an opening reverse as a skip with 2 players', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      () => 0,
      openingPile(face('open', 'red', 'reverse'), 14)
    );
    assert.strictEqual(game.currentPlayerIndex, 1);
    assert.strictEqual(game.direction, 1);
  });

  it('reverses and starts at the last seat with 3 or 4 players', () => {
    const three = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      () => 0,
      openingPile(face('open', 'green', 'reverse'), 21)
    );
    assert.strictEqual(three.direction, -1);
    assert.strictEqual(three.currentPlayerIndex, 2);

    const four = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
        { id: 'd', name: 'D' },
      ],
      () => 0,
      openingPile(face('open', 'green', 'reverse'), 28)
    );
    assert.strictEqual(four.direction, -1);
    assert.strictEqual(four.currentPlayerIndex, 3);
  });

  it('waits for seat 0 to color an opening wild', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      () => 0,
      openingPile(face('open', null, 'wild'), 14)
    );
    assert.strictEqual(game.awaitingWildColor, true);
    assert.strictEqual(game.currentPlayerIndex, 0);
    assert.strictEqual(playCard(game, 'a', game.players[0].hand[0].id).ok, false);
    assert.strictEqual(drawCard(game, 'a').ok, false);

    const wrong = chooseOpeningColor(game, 'b', 'red');
    assert.strictEqual(wrong.ok, false);
    assert.strictEqual(game.awaitingWildColor, true);

    const chosen = chooseOpeningColor(game, 'a', 'blue');
    assert.ok(chosen.ok);
    if (chosen.ok) {
      assert.strictEqual(chosen.game.awaitingWildColor, false);
      assert.strictEqual(chosen.game.currentColor, 'blue');
      assert.strictEqual(chosen.game.currentPlayerIndex, 0);
    }
  });

  it('rejects invalid player counts', () => {
    assert.throws(() => createGame([{ id: 'a', name: 'A' }]));
    assert.throws(() =>
      createGame([
        { id: '1', name: '1' },
        { id: '2', name: '2' },
        { id: '3', name: '3' },
        { id: '4', name: '4' },
        { id: '5', name: '5' },
      ])
    );
  });
});

describe('playCard', () => {
  it('rejects out of turn', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [{ id: 'h1', color: 'red', value: '7' }] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
    });
    const before = game.status;
    const next = playCard(game, 'b', 'h2');
    assert.strictEqual(next.ok, false);
    if (!next.ok) {
      assert.strictEqual(next.reason, 'Not your turn.');
    }
    assert.strictEqual(game.status, before);
    assert.strictEqual(game.players[1].hand.length, 1);
  });

  it('plays matching color and advances', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [{ id: 'h1', color: 'red', value: '7' }] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      currentColor: 'red',
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
    });
    const next = mustPlay(game, 'a', 'h1');
    assert.strictEqual(next.players[0].hand.length, 0);
    assert.strictEqual(next.winnerId, 'a');
  });

  it('requires wild color', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [{ id: 'w1', color: null, value: 'wild' }] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
    });
    const next = playCard(game, 'a', 'w1');
    assert.strictEqual(next.ok, false);
    if (!next.ok) {
      assert.strictEqual(next.reason, 'Choose a color for wild.');
    }
    assert.strictEqual(game.players[0].hand.length, 1);
  });

  it('wild sets color and advances', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'w1', color: null, value: 'wild' },
            { id: 'h1', color: 'red', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
    });
    const next = mustPlay(game, 'a', 'w1', 'green');
    assert.strictEqual(next.currentColor, 'green');
    assert.strictEqual(next.currentPlayerIndex, 1);
  });

  it('skip advances past next player', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [{ id: 's1', color: 'red', value: 'skip' }, { id: 'x', color: 'blue', value: '1' }] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
        { id: 'c', name: 'C', hand: [{ id: 'h3', color: 'green', value: '4' }] },
      ],
      currentPlayerIndex: 0,
      currentColor: 'red',
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
    });
    const next = mustPlay(game, 'a', 's1');
    assert.strictEqual(next.currentPlayerIndex, 2);
  });

  it('reverse with 2 players acts like skip', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'r1', color: 'red', value: 'reverse' },
            { id: 'x', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      currentColor: 'red',
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
    });
    const next = mustPlay(game, 'a', 'r1');
    assert.strictEqual(next.currentPlayerIndex, 0);
  });

  it('draw2 forces next to draw and skips them', () => {
    const drawPile: UnoCard[] = [
      { id: 'p1', color: 'yellow', value: '1' },
      { id: 'p0', color: 'yellow', value: '2' },
    ];
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'd2', color: 'red', value: 'draw2' },
            { id: 'x', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
        { id: 'c', name: 'C', hand: [{ id: 'h3', color: 'green', value: '4' }] },
      ],
      currentPlayerIndex: 0,
      currentColor: 'red',
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
      drawPile,
    });
    const next = mustPlay(game, 'a', 'd2');
    assert.strictEqual(next.players[1].hand.length, 3);
    assert.strictEqual(next.currentPlayerIndex, 2);
  });

  it('wild4 draws four and skips', () => {
    const drawPile: UnoCard[] = Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`,
      color: 'yellow' as const,
      value: '1' as const,
    }));
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'w4', color: null, value: 'wild4' },
            { id: 'x', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      drawPile,
    });
    const next = mustPlay(game, 'a', 'w4', 'blue');
    assert.strictEqual(next.players[1].hand.length, 5);
    assert.strictEqual(next.currentColor, 'blue');
    assert.strictEqual(next.currentPlayerIndex, 0);
  });
});

describe('drawCard', () => {
  it('draws one and advances turn', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      drawPile: [{ id: 'p0', color: 'green', value: '8' }],
    });
    const next = drawCard(game, 'a');
    assert.ok(next.ok);
    if (next.ok) {
      assert.strictEqual(next.game.players[0].hand.length, 1);
      assert.strictEqual(next.game.currentPlayerIndex, 1);
    }
  });

  it('passes the turn when nothing can be drawn', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      drawPile: [],
      discardPile: [{ id: 'only', color: 'red', value: '5' }],
    });
    const next = drawCard(game, 'a');
    assert.ok(next.ok);
    if (next.ok) {
      assert.strictEqual(next.game.players[0].hand.length, 0);
      assert.strictEqual(next.game.currentPlayerIndex, 1);
    }
    assert.strictEqual(game.currentPlayerIndex, 0);
  });

  it('reshuffles the discard with the game random source', () => {
    let calls = 0;
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      drawPile: [],
      discardPile: [
        { id: 'bot', color: 'blue', value: '1' },
        { id: 'mid', color: 'green', value: '2' },
        { id: 'top', color: 'red', value: '5' },
      ],
      random: () => {
        calls += 1;
        return 0;
      },
    });
    const next = drawCard(game, 'a');
    assert.ok(calls > 0);
    assert.ok(next.ok);
    if (next.ok) {
      assert.strictEqual(next.game.players[0].hand.length, 1);
      assert.strictEqual(next.game.discardPile.length, 1);
      assert.strictEqual(next.game.discardPile[0].id, 'top');
      assert.strictEqual(next.game.drawPile.length, 1);
    }
  });
});

describe('personalize', () => {
  it('hides opponent hands', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [{ id: 'h1', color: 'red', value: '7' }] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
    });
    const view = personalize(game, 'a');
    assert.strictEqual(view.hand.length, 1);
    assert.strictEqual(view.opponents.length, 1);
    assert.strictEqual(view.opponents[0].cardCount, 1);
    assert.strictEqual(view.drawRemaining, 0);
    assert.notStrictEqual(view.discard, game.discardPile[game.discardPile.length - 1]);
    assert.ok(isWild('wild'));
  });

  it('counts recyclable discards as drawable', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [] },
        { id: 'b', name: 'B', hand: [] },
      ],
      drawPile: [{ id: 'p0', color: 'red', value: '1' }],
      discardPile: [
        { id: 'd0', color: 'blue', value: '2' },
        { id: 'd1', color: 'green', value: '3' },
        { id: 'd2', color: 'yellow', value: '4' },
      ],
    });
    const view = personalize(game, 'a');
    assert.strictEqual(view.drawRemaining, 3);
  });

  it('lists opponents in turn order from the viewer', () => {
    const players = [
      { id: 'a', name: 'A', hand: [] as UnoCard[] },
      { id: 'b', name: 'B', hand: [] as UnoCard[] },
      { id: 'c', name: 'C', hand: [] as UnoCard[] },
      { id: 'd', name: 'D', hand: [] as UnoCard[] },
    ];
    const clockwise = personalize(makeTestGame({ players, direction: 1 }), 'c');
    assert.deepStrictEqual(
      clockwise.opponents.map((p) => p.id),
      ['d', 'a', 'b']
    );
    const counter = personalize(makeTestGame({ players, direction: -1 }), 'c');
    assert.deepStrictEqual(
      counter.opponents.map((p) => p.id),
      ['b', 'a', 'd']
    );
  });
});
