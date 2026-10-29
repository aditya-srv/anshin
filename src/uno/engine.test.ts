import assert from 'assert';
import { describe, it } from 'node:test';
import { createDeck, isWild, shuffle } from './deck';
import { canPlay, createGame, drawCard, makeTestGame, personalize, playCard } from './engine';
import { UnoCard } from './types';

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
    const next = playCard(game, 'b', 'h2');
    assert.strictEqual(next.status, 'Not your turn.');
    assert.strictEqual(next.players[1].hand.length, 1);
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
    const next = playCard(game, 'a', 'h1');
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
    assert.strictEqual(next.status, 'Choose a color for wild.');
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
    const next = playCard(game, 'a', 'w1', 'green');
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
    const next = playCard(game, 'a', 's1');
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
    const next = playCard(game, 'a', 'r1');
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
    const next = playCard(game, 'a', 'd2');
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
    const next = playCard(game, 'a', 'w4', 'blue');
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
    assert.strictEqual(next.players[0].hand.length, 1);
    assert.strictEqual(next.currentPlayerIndex, 1);
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
    assert.ok(isWild('wild'));
  });
});
