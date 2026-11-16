import assert from 'assert';
import { describe, it } from 'node:test';
import { START_INDEX, TRACK_LENGTH, boardCells, isSafeTrack, trackIndexFor } from './board';
import {
  createGame,
  dropPlayer,
  moveToken,
  placeToken,
  rollDice,
  setCurrentPlayer,
} from './engine';
import { ludoModule } from './module';
import { LudoSession } from './types';

const PLAYERS = [
  { id: 'p1', name: 'Ada' },
  { id: 'p2', name: 'Bea' },
];

function fixed(dice: number[]): () => number {
  let index = 0;
  return () => {
    const value = dice[Math.min(index, dice.length - 1)];
    index += 1;
    return (value - 1) / 6;
  };
}

function token(session: LudoSession, id: string) {
  const found = session.tokens.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

describe('ludo board', () => {
  it('has 52 track cells, four starts, and four stars', () => {
    assert.strictEqual(TRACK_LENGTH, 52);
    assert.deepStrictEqual(Object.values(START_INDEX), [0, 13, 26, 39]);
    for (const index of [0, 8, 13, 21, 26, 34, 39, 47]) {
      assert.strictEqual(isSafeTrack(index), true);
    }
    assert.strictEqual(isSafeTrack(1), false);
    const cells = boardCells();
    assert.strictEqual(cells.filter((cell) => cell.kind === 'track').length, 52);
    assert.strictEqual(trackIndexFor('red', 50), 50);
    assert.strictEqual(trackIndexFor('green', 0), 13);
  });
});

describe('ludo rules', () => {
  it('opens on red and needs a 6 to leave the yard', () => {
    const session = createGame(PLAYERS, fixed([1]));
    assert.strictEqual(session.players[0].color, 'red');
    assert.strictEqual(session.players[1].color, 'green');
    const rolled = rollDice(session, 'p1', 1);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    assert.strictEqual(rolled.session.players[rolled.session.currentPlayerIndex].id, 'p2');
    assert.ok(rolled.session.tokens.every((item) => item.progress === -1));
  });

  it('lets the player choose which token a 6 brings out, then rolls again', () => {
    const session = createGame(PLAYERS, fixed([6]));
    const rolled = rollDice(session, 'p1', 6);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    assert.strictEqual(rolled.session.awaiting, 'move');
    assert.strictEqual(rolled.session.legalTokenIds.length, 4);
    const moved = moveToken(rolled.session, 'p1', 'p1:0');
    assert.strictEqual(moved.ok, true);
    if (!moved.ok) {
      return;
    }
    assert.strictEqual(token(moved.session, 'p1:0').progress, 0);
    assert.strictEqual(moved.session.consecutiveSixes, 1);
    assert.strictEqual(moved.session.currentPlayerIndex, 0);
    assert.strictEqual(moved.session.awaiting, 'roll');
  });

  it('moves the only legal token without a click', () => {
    let session = createGame(PLAYERS, fixed([3]));
    session = placeToken(session, 'p1:0', 0);
    session = placeToken(session, 'p1:1', 56);
    session = placeToken(session, 'p1:2', 56);
    session = placeToken(session, 'p1:3', 56);
    const rolled = rollDice(session, 'p1', 3);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    assert.strictEqual(token(rolled.session, 'p1:0').progress, 3);
    assert.strictEqual(rolled.session.awaiting, 'roll');
    assert.strictEqual(rolled.session.currentPlayerIndex, 1);
  });

  it('sends an opponent home, passes over a single token, and shares a safe square', () => {
    let session = createGame(PLAYERS, fixed([1]));
    session = placeToken(session, 'p1:0', 0);
    session = placeToken(session, 'p2:0', progressOn('green', 1));
    const capture = rollDice(session, 'p1', 1);
    assert.strictEqual(capture.ok, true);
    if (!capture.ok) {
      return;
    }
    assert.strictEqual(token(capture.session, 'p2:0').progress, -1);
    assert.strictEqual(capture.session.currentPlayerIndex, 0);
    assert.strictEqual(capture.session.awaiting, 'roll');
    assert.match(capture.session.status, /captured a token\. Roll again/);

    let passed = createGame(PLAYERS, fixed([2]));
    passed = placeToken(passed, 'p1:0', 0);
    passed = placeToken(passed, 'p2:0', progressOn('green', 1));
    const over = rollDice(passed, 'p1', 2);
    assert.strictEqual(over.ok, true);
    if (!over.ok) {
      return;
    }
    assert.strictEqual(token(over.session, 'p1:0').progress, 2);
    assert.strictEqual(token(over.session, 'p2:0').progress, progressOn('green', 1));

    let safe = createGame(PLAYERS, fixed([1]));
    safe = placeToken(safe, 'p1:0', 7);
    safe = placeToken(safe, 'p2:0', progressOn('green', 8));
    const shared = rollDice(safe, 'p1', 1);
    assert.strictEqual(shared.ok, true);
    if (!shared.ok) {
      return;
    }
    assert.strictEqual(token(shared.session, 'p2:0').progress, progressOn('green', 8));
    assert.strictEqual(token(shared.session, 'p1:0').progress, 8);
  });

  it('blocks passage with two of the same color and still allows stacking your own', () => {
    let blocked = createGame(PLAYERS, fixed([2]));
    blocked = placeToken(blocked, 'p1:0', 0);
    blocked = placeToken(blocked, 'p2:0', progressOn('green', 1));
    blocked = placeToken(blocked, 'p2:1', progressOn('green', 1));
    const stopped = rollDice(blocked, 'p1', 2);
    assert.strictEqual(stopped.ok, true);
    if (!stopped.ok) {
      return;
    }
    assert.strictEqual(token(stopped.session, 'p1:0').progress, 0);
    assert.strictEqual(stopped.session.currentPlayerIndex, 1);

    let stacked = createGame(PLAYERS, fixed([1]));
    stacked = placeToken(stacked, 'p1:0', 0);
    stacked = placeToken(stacked, 'p1:1', 1);
    stacked = placeToken(stacked, 'p1:2', 56);
    stacked = placeToken(stacked, 'p1:3', 56);
    const rolled = rollDice(stacked, 'p1', 1);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    const joined = moveToken(rolled.session, 'p1', 'p1:0');
    assert.strictEqual(joined.ok, true);
    if (!joined.ok) {
      return;
    }
    assert.strictEqual(token(joined.session, 'p1:0').progress, 1);
    assert.strictEqual(token(joined.session, 'p1:1').progress, 1);
  });

  it('requires an exact roll to finish and does not grant another roll', () => {
    let session = createGame(PLAYERS, fixed([2]));
    session = placeToken(session, 'p1:0', 55);
    session = placeToken(session, 'p1:1', 56);
    session = placeToken(session, 'p1:2', 56);
    session = placeToken(session, 'p1:3', 56);
    const overshoot = rollDice(session, 'p1', 2);
    assert.strictEqual(overshoot.ok, true);
    if (!overshoot.ok) {
      return;
    }
    assert.strictEqual(token(overshoot.session, 'p1:0').progress, 55);
    assert.strictEqual(overshoot.session.winnerId, null);

    const finished = rollDice(session, 'p1', 1);
    assert.strictEqual(finished.ok, true);
    if (!finished.ok) {
      return;
    }
    assert.strictEqual(finished.session.winnerId, 'p1');
  });

  it('forfeits the third 6 and keeps the earlier moves', () => {
    let session = createGame(PLAYERS, fixed([6]));
    session = placeToken(session, 'p1:0', 0);
    session = placeToken(session, 'p1:1', 56);
    session = placeToken(session, 'p1:2', 56);
    session = placeToken(session, 'p1:3', 56);
    const first = rollDice(session, 'p1', 6);
    assert.strictEqual(first.ok, true);
    if (!first.ok) {
      return;
    }
    assert.strictEqual(token(first.session, 'p1:0').progress, 6);
    const second = rollDice(first.session, 'p1', 6);
    assert.strictEqual(second.ok, true);
    if (!second.ok) {
      return;
    }
    assert.strictEqual(token(second.session, 'p1:0').progress, 12);
    const third = rollDice(second.session, 'p1', 6);
    assert.strictEqual(third.ok, true);
    if (!third.ok) {
      return;
    }
    assert.strictEqual(token(third.session, 'p1:0').progress, 12);
    assert.strictEqual(third.session.currentPlayerIndex, 1);
    assert.strictEqual(third.session.consecutiveSixes, 0);
  });

  it('does not add an unusable 6 to the streak', () => {
    let session = createGame(PLAYERS, fixed([6]));
    session = placeToken(session, 'p1:0', 56);
    session = placeToken(session, 'p1:1', 56);
    session = placeToken(session, 'p1:2', 56);
    session = placeToken(session, 'p1:3', 55);
    const rolled = rollDice(session, 'p1', 6);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    assert.strictEqual(token(rolled.session, 'p1:3').progress, 55);
    assert.strictEqual(rolled.session.consecutiveSixes, 0);
    assert.strictEqual(rolled.session.currentPlayerIndex, 1);
  });

  it('gives the remaining player the win when someone leaves', () => {
    const session = createGame(PLAYERS, fixed([1]));
    const next = dropPlayer(session, 'p2');
    assert.strictEqual(next.winnerId, 'p1');
  });

  it('on timeout rolls and then picks one of several tokens', () => {
    const session = createGame(PLAYERS, fixed([1]));
    const next = ludoModule.onTimeout(session, 'p1', fixed([6, 1])) as LudoSession;
    const out = next.tokens.filter((item) => item.playerId === 'p1' && item.progress === 0);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(next.consecutiveSixes, 1);
    assert.strictEqual(next.awaiting, 'roll');
    assert.strictEqual(next.currentPlayerIndex, 0);
  });

  it('hides legal tokens from the other seat', () => {
    const session = createGame(PLAYERS, fixed([6]));
    const rolled = rollDice(session, 'p1', 6);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    const yours = ludoModule.personalize(rolled.session, 'p1', {
      turnDeadline: null,
      connected: () => true,
    }) as { legalTokenIds: string[] };
    const theirs = ludoModule.personalize(rolled.session, 'p2', {
      turnDeadline: null,
      connected: () => true,
    }) as { legalTokenIds: string[] };
    assert.strictEqual(yours.legalTokenIds.length, 4);
    assert.deepStrictEqual(theirs.legalTokenIds, []);
  });

  it('follows join order around the colors', () => {
    const session = createGame(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
        { id: 'd', name: 'D' },
      ],
      fixed([1])
    );
    assert.deepStrictEqual(
      session.players.map((player) => player.color),
      ['red', 'green', 'yellow', 'blue']
    );
    const turned = setCurrentPlayer(session, 'd');
    assert.strictEqual(turned.currentPlayerIndex, 3);
  });
});

function progressOn(color: 'red' | 'green' | 'yellow' | 'blue', absolute: number): number {
  const start = color === 'red' ? 0 : color === 'green' ? 13 : color === 'yellow' ? 26 : 39;
  return (absolute - start + TRACK_LENGTH) % TRACK_LENGTH;
}
