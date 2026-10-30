import assert from 'assert';
import { describe, it } from 'node:test';
import { createDeck, isSpecial, isWild, shuffle } from './deck';
import {
  callUno,
  canPlay,
  catchUno,
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
  wildColor?: UnoColor,
  now?: number
): GameSnapshot {
  const result = playCard(game, playerId, cardId, wildColor, now);
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
  it('deals 7 cards to each of 2-6 players', () => {
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

  it('gives every player at least one special card', () => {
    const two = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const four = [
      ...two,
      { id: 'c', name: 'C' },
      { id: 'd', name: 'D' },
    ];
    const six = [
      ...four,
      { id: 'e', name: 'E' },
      { id: 'f', name: 'F' },
    ];
    for (const players of [two, four, six]) {
      const game = createGame(players, () => 0.42);
      for (const player of game.players) {
        assert.strictEqual(player.hand.length, 7);
        assert.ok(player.hand.some((card) => isSpecial(card.value)));
      }
    }
  });

  it('skips special guarantee when guaranteeSpecial is false', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      () => 0.42,
      undefined,
      false
    );
    assert.strictEqual(game.players.length, 2);
    for (const player of game.players) {
      assert.strictEqual(player.hand.length, 7);
    }
  });

  it('deals the requested cardsPerPlayer count', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      () => 0.42,
      undefined,
      true,
      5
    );
    for (const player of game.players) {
      assert.strictEqual(player.hand.length, 5);
    }
  });

  it('rejects invalid cardsPerPlayer', () => {
    assert.throws(() =>
      createGame(
        [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        () => 0.42,
        undefined,
        true,
        0
      )
    );
    assert.throws(() =>
      createGame(
        [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        () => 0.42,
        undefined,
        true,
        16
      )
    );
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
      ],
      () => 0,
      openingPile(face('open', 'red', 'skip'), 14)
    );
    assert.strictEqual(game.currentPlayerIndex, 1);
  });

  it('makes seat 0 draw two on an opening draw two', () => {
    const game = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      () => 0,
      openingPile(face('open', 'red', 'draw2'), 14, [
        face('x1', 'yellow', '1'),
        face('x2', 'yellow', '2'),
      ])
    );
    assert.strictEqual(game.players[0].hand.length, 9);
    assert.strictEqual(game.currentPlayerIndex, 1);
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
  });

  it('reverses and starts at the last seat with 3 or 4 players', () => {
    const three = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      () => 0,
      openingPile(face('open', 'red', 'reverse'), 21)
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
      openingPile(face('open', 'red', 'reverse'), 28)
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
        { id: '6', name: '6' },
        { id: '7', name: '7' },
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
    const result = playCard(game, 'b', 'h2');
    assert.strictEqual(result.ok, false);
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
    assert.strictEqual(next.winnerId, 'a');
  });

  it('requires wild color', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'h1', color: null, value: 'wild' },
            { id: 'keep', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
    });
    const result = playCard(game, 'a', 'h1');
    assert.strictEqual(result.ok, false);
  });

  it('wild sets color and advances', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'h1', color: null, value: 'wild' },
            { id: 'keep', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
    });
    const next = mustPlay(game, 'a', 'h1', 'green');
    assert.strictEqual(next.currentColor, 'green');
    assert.strictEqual(next.currentPlayerIndex, 1);
  });

  it('skip advances past next player', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'h1', color: 'red', value: 'skip' },
            { id: 'keep', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
        { id: 'c', name: 'C', hand: [{ id: 'h3', color: 'green', value: '4' }] },
      ],
      currentPlayerIndex: 0,
      currentColor: 'red',
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
    });
    const next = mustPlay(game, 'a', 'h1');
    assert.strictEqual(next.currentPlayerIndex, 2);
  });

  it('reverse with 2 players acts like skip', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'h1', color: 'red', value: 'reverse' },
            { id: 'keep', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      currentColor: 'red',
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
    });
    const next = mustPlay(game, 'a', 'h1');
    // Direction flips then one advance → back to the same seat with 2 players.
    assert.strictEqual(next.currentPlayerIndex, 0);
  });

  it('draw2 forces next to draw and skips them', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'h1', color: 'red', value: 'draw2' },
            { id: 'keep', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
        { id: 'c', name: 'C', hand: [{ id: 'h3', color: 'green', value: '4' }] },
      ],
      currentPlayerIndex: 0,
      currentColor: 'red',
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
      drawPile: [
        { id: 'p0', color: 'yellow', value: '1' },
        { id: 'p1', color: 'yellow', value: '2' },
      ],
    });
    const next = mustPlay(game, 'a', 'h1');
    assert.strictEqual(next.players[1].hand.length, 3);
    assert.strictEqual(next.currentPlayerIndex, 2);
  });

  it('wild4 draws four and skips', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'h1', color: null, value: 'wild4' },
            { id: 'keep', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
        { id: 'c', name: 'C', hand: [{ id: 'h3', color: 'green', value: '4' }] },
      ],
      currentPlayerIndex: 0,
      drawPile: [
        { id: 'p0', color: 'yellow', value: '1' },
        { id: 'p1', color: 'yellow', value: '2' },
        { id: 'p2', color: 'yellow', value: '3' },
        { id: 'p3', color: 'yellow', value: '4' },
      ],
    });
    const next = mustPlay(game, 'a', 'h1', 'blue');
    assert.strictEqual(next.players[1].hand.length, 5);
    assert.strictEqual(next.currentPlayerIndex, 2);
    assert.strictEqual(next.currentColor, 'blue');
  });
});

describe('drawCard', () => {
  it('draws one and advances turn', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [{ id: 'h1', color: 'red', value: '7' }] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      drawPile: [{ id: 'p0', color: 'yellow', value: '1' }],
    });
    const result = drawCard(game, 'a');
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.game.players[0].hand.length, 2);
      assert.strictEqual(result.game.currentPlayerIndex, 1);
    }
  });

  it('passes the turn when nothing can be drawn', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [{ id: 'h1', color: 'red', value: '7' }] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      drawPile: [],
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
    });
    const result = drawCard(game, 'a');
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.game.players[0].hand.length, 1);
      assert.strictEqual(result.game.currentPlayerIndex, 1);
    }
  });

  it('reshuffles the discard with the game random source', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [{ id: 'h1', color: 'red', value: '7' }] },
        { id: 'b', name: 'B', hand: [{ id: 'h2', color: 'blue', value: '3' }] },
      ],
      currentPlayerIndex: 0,
      drawPile: [],
      discardPile: [
        { id: 'd0', color: 'red', value: '5' },
        { id: 'd1', color: 'green', value: '2' },
        { id: 'd2', color: 'blue', value: '9' },
      ],
      random: () => 0.1,
    });
    const result = drawCard(game, 'a');
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.game.players[0].hand.length, 2);
      assert.strictEqual(result.game.discardPile.length, 1);
      assert.strictEqual(result.game.discardPile[0].id, 'd2');
    }
  });
});

describe('personalize', () => {
  it('hides opponent hands', () => {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'h1', color: 'red', value: '7' },
            { id: 'h2', color: 'blue', value: '1' },
          ],
        },
        { id: 'b', name: 'B', hand: [{ id: 'h3', color: 'green', value: '3' }] },
      ],
    });
    const view = personalize(game, 'a');
    assert.strictEqual(view.hand.length, 2);
    assert.strictEqual(view.opponents[0].cardCount, 1);
    assert.ok(!('hand' in view.opponents[0]));
  });

  it('counts recyclable discards as drawable', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [] },
        { id: 'b', name: 'B', hand: [] },
      ],
      drawPile: [{ id: 'p0', color: 'yellow', value: '1' }],
      discardPile: [
        { id: 'd0', color: 'red', value: '5' },
        { id: 'd1', color: 'green', value: '2' },
      ],
    });
    const view = personalize(game, 'a');
    assert.strictEqual(view.drawRemaining, 2);
  });

  it('lists opponents in turn order from the viewer', () => {
    const game = makeTestGame({
      players: [
        { id: 'a', name: 'A', hand: [] },
        { id: 'b', name: 'B', hand: [] },
        { id: 'c', name: 'C', hand: [] },
      ],
      direction: 1,
    });
    const fromA = personalize(game, 'a');
    assert.deepStrictEqual(
      fromA.opponents.map((o) => o.id),
      ['b', 'c']
    );
  });
});

describe('uno call', () => {
  function downToOne(): GameSnapshot {
    const game = makeTestGame({
      players: [
        {
          id: 'a',
          name: 'A',
          hand: [
            { id: 'h1', color: 'red', value: '7' },
            { id: 'keep', color: 'blue', value: '1' },
          ],
        },
        {
          id: 'b',
          name: 'B',
          hand: [
            { id: 'h3', color: 'blue', value: '3' },
            { id: 'h4', color: 'green', value: '4' },
          ],
        },
      ],
      currentPlayerIndex: 0,
      currentColor: 'red',
      discardPile: [{ id: 'd0', color: 'red', value: '5' }],
      drawPile: [
        { id: 'p0', color: 'yellow', value: '1' },
        { id: 'p1', color: 'yellow', value: '2' },
      ],
    });
    return mustPlay(game, 'a', 'h1');
  }

  it('opens a call when a player plays down to one card', () => {
    const next = downToOne();
    assert.strictEqual(next.unoPendingPlayerId, 'a');
    assert.strictEqual(next.players[0].hand.length, 1);
    const view = personalize(next, 'b');
    assert.strictEqual(view.unoCall?.playerId, 'a');
    assert.strictEqual(view.unoSaid, null);
  });

  it('lets the owner call UNO and announces it', () => {
    const next = callUno(downToOne(), 'a');
    assert.ok(next.ok);
    if (next.ok) {
      assert.strictEqual(next.game.unoPendingPlayerId, null);
      assert.strictEqual(next.game.players[0].hand.length, 1);
      assert.strictEqual(next.game.status, 'A called UNO.');
      assert.deepStrictEqual(next.game.unoSaid, { playerId: 'a', playerName: 'A' });
      const view = personalize(next.game, 'b');
      assert.deepStrictEqual(view.unoSaid, { playerId: 'a', playerName: 'A' });
    }
  });

  it('rejects another player calling UNO', () => {
    const next = callUno(downToOne(), 'b');
    assert.strictEqual(next.ok, false);
    if (!next.ok) {
      assert.strictEqual(next.reason, 'Only the player with one card can call UNO.');
    }
  });

  it('lets another player catch them anytime while open', () => {
    const pending = downToOne();
    const turn = pending.currentPlayerIndex;
    const next = catchUno(pending, 'b');
    assert.ok(next.ok);
    if (next.ok) {
      assert.strictEqual(next.game.players[0].hand.length, 3);
      assert.strictEqual(next.game.unoPendingPlayerId, null);
      assert.strictEqual(next.game.unoSaid, null);
      assert.strictEqual(next.game.currentPlayerIndex, turn);
      assert.match(next.game.status, /caught A without UNO/);
    }
  });

  it('rejects the owner catching themselves', () => {
    const next = catchUno(downToOne(), 'a');
    assert.strictEqual(next.ok, false);
    if (!next.ok) {
      assert.strictEqual(next.reason, 'You cannot catch yourself.');
    }
  });

  it('clears the announced UNO on the next play', () => {
    const called = callUno(downToOne(), 'a');
    assert.ok(called.ok);
    if (!called.ok) {
      return;
    }
    assert.ok(called.game.unoSaid);
    called.game.players[1].hand.push({ id: 'h5', color: 'red', value: '2' });
    called.game.currentPlayerIndex = 1;
    const after = mustPlay(called.game, 'b', 'h5');
    assert.strictEqual(after.unoSaid, null);
  });

  it('clears the announced UNO on the next draw', () => {
    const called = callUno(downToOne(), 'a');
    assert.ok(called.ok);
    if (!called.ok) {
      return;
    }
    called.game.currentPlayerIndex = 1;
    const result = drawCard(called.game, 'b');
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.game.unoSaid, null);
    }
  });

  it('clears the call without a penalty when that player draws', () => {
    const pending = downToOne();
    pending.currentPlayerIndex = 0;
    const next = drawCard(pending, 'a');
    assert.ok(next.ok);
    if (next.ok) {
      assert.strictEqual(next.game.players[0].hand.length, 2);
      assert.strictEqual(next.game.unoPendingPlayerId, null);
    }
  });

  it('does not open a call when the last card wins', () => {
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
    assert.strictEqual(next.winnerId, 'a');
    assert.strictEqual(next.unoPendingPlayerId, null);
  });
});
