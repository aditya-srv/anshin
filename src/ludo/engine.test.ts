import assert from 'assert';
import { describe, it } from 'node:test';
import { START_INDEX, TRACK_LENGTH, boardCells, isSafeTrack, trackIndexFor } from './board';
import {
  blockedTrackIndexes,
  createGame,
  dropPlayer,
  forcePassTurn,
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
    assert.strictEqual(capture.session.dice, null);
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

  it('allows jumping over two of the same color and stacking your own', () => {
    let over = createGame(PLAYERS, fixed([2]));
    over = placeToken(over, 'p1:0', 0);
    over = placeToken(over, 'p2:0', progressOn('green', 1));
    over = placeToken(over, 'p2:1', progressOn('green', 1));
    const jumped = rollDice(over, 'p1', 2);
    assert.strictEqual(jumped.ok, true);
    if (!jumped.ok) {
      return;
    }
    assert.strictEqual(token(jumped.session, 'p1:0').progress, 2);
    assert.strictEqual(token(jumped.session, 'p2:0').progress, progressOn('green', 1));
    assert.strictEqual(token(jumped.session, 'p2:1').progress, progressOn('green', 1));

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

  it('blocks landing on and passing an opponent pair when blockades are on', () => {
    let land = createGame(PLAYERS, fixed([1]), true);
    land = placeToken(land, 'p1:0', 0);
    land = placeToken(land, 'p2:0', progressOn('green', 1));
    land = placeToken(land, 'p2:1', progressOn('green', 1));
    const blockedLand = rollDice(land, 'p1', 1);
    assert.strictEqual(blockedLand.ok, true);
    if (!blockedLand.ok) {
      return;
    }
    assert.strictEqual(token(blockedLand.session, 'p1:0').progress, 0);
    assert.strictEqual(blockedLand.session.currentPlayerIndex, 1);
    assert.deepStrictEqual(blockedTrackIndexes(land), [trackIndexFor('green', progressOn('green', 1))]);

    let pass = createGame(PLAYERS, fixed([2]), true);
    pass = placeToken(pass, 'p1:0', 0);
    pass = placeToken(pass, 'p2:0', progressOn('green', 1));
    pass = placeToken(pass, 'p2:1', progressOn('green', 1));
    const blockedPass = rollDice(pass, 'p1', 2);
    assert.strictEqual(blockedPass.ok, true);
    if (!blockedPass.ok) {
      return;
    }
    assert.strictEqual(token(blockedPass.session, 'p1:0').progress, 0);
    assert.strictEqual(blockedPass.session.currentPlayerIndex, 1);
  });

  it('lets you pass and stack your own blockade', () => {
    let session = createGame(PLAYERS, fixed([1]), true);
    session = placeToken(session, 'p1:0', 0);
    session = placeToken(session, 'p1:1', 1);
    session = placeToken(session, 'p1:2', 56);
    session = placeToken(session, 'p1:3', 56);
    const rolled = rollDice(session, 'p1', 1);
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
    assert.deepStrictEqual(blockedTrackIndexes(joined.session), [trackIndexFor('red', 1)]);
  });

  it('requires an exact roll to finish and grants another roll when a piece goes home', () => {
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
    assert.strictEqual(overshoot.session.currentPlayerIndex, 1);

    let bonus = createGame(PLAYERS, fixed([1]));
    bonus = placeToken(bonus, 'p1:0', 55);
    bonus = placeToken(bonus, 'p1:1', -1);
    bonus = placeToken(bonus, 'p1:2', 56);
    bonus = placeToken(bonus, 'p1:3', 56);
    const finished = rollDice(bonus, 'p1', 1);
    assert.strictEqual(finished.ok, true);
    if (!finished.ok) {
      return;
    }
    assert.strictEqual(token(finished.session, 'p1:0').progress, 56);
    assert.strictEqual(finished.session.winnerId, null);
    assert.strictEqual(finished.session.currentPlayerIndex, 0);
    assert.strictEqual(finished.session.awaiting, 'roll');
    assert.strictEqual(finished.session.dice, null);
    assert.match(finished.session.status, /got a piece home\. Roll again/);
  });

  it('wins when the last piece finishes without granting another roll', () => {
    let session = createGame(PLAYERS, fixed([1]));
    session = placeToken(session, 'p1:0', 55);
    session = placeToken(session, 'p1:1', 56);
    session = placeToken(session, 'p1:2', 56);
    session = placeToken(session, 'p1:3', 56);
    const finished = rollDice(session, 'p1', 1);
    assert.strictEqual(finished.ok, true);
    if (!finished.ok) {
      return;
    }
    assert.strictEqual(finished.session.winnerId, 'p1');
    assert.match(finished.session.status, /wins!/);
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

  it('keeps a clear-path out piece in legalTokenIds when choosing among tokens', () => {
    let session = createGame(PLAYERS, fixed([6]));
    session = placeToken(session, 'p1:0', 10);
    const rolled = rollDice(session, 'p1', 6);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    assert.strictEqual(rolled.session.awaiting, 'move');
    assert.ok(rolled.session.legalTokenIds.includes('p1:0'));
  });

  it('clears dice after no legal move so the next seat is not stuck on the old roll', () => {
    const session = createGame(PLAYERS, fixed([1]));
    const rolled = rollDice(session, 'p1', 1);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    assert.strictEqual(rolled.session.players[rolled.session.currentPlayerIndex].id, 'p2');
    assert.strictEqual(rolled.session.dice, null);
    assert.strictEqual(rolled.session.awaiting, 'roll');
  });

  it('lets the current player roll again after another seat leaves mid-move', () => {
    const three = [
      { id: 'p1', name: 'Ada' },
      { id: 'p2', name: 'Bea' },
      { id: 'p3', name: 'Cy' },
    ];
    const session = createGame(three, fixed([6]));
    const rolled = rollDice(session, 'p1', 6);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    assert.strictEqual(rolled.session.awaiting, 'move');
    const afterLeave = dropPlayer(rolled.session, 'p2');
    assert.strictEqual(afterLeave.awaiting, 'roll');
    assert.strictEqual(afterLeave.dice, null);
    assert.strictEqual(afterLeave.players[afterLeave.currentPlayerIndex].id, 'p1');
    const again = rollDice(afterLeave, 'p1', 3);
    assert.strictEqual(again.ok, true);
  });

  it('forcePassTurn clears move phase and advances the seat', () => {
    const session = createGame(PLAYERS, fixed([6]));
    const rolled = rollDice(session, 'p1', 6);
    assert.strictEqual(rolled.ok, true);
    if (!rolled.ok) {
      return;
    }
    assert.strictEqual(rolled.session.awaiting, 'move');
    const skipped = forcePassTurn(rolled.session);
    assert.strictEqual(skipped.awaiting, 'roll');
    assert.strictEqual(skipped.dice, null);
    assert.deepStrictEqual(skipped.legalTokenIds, []);
    assert.strictEqual(skipped.players[skipped.currentPlayerIndex].id, 'p2');
  });

  it('timeout with an empty move list force-passes the turn', () => {
    let session = createGame(PLAYERS, fixed([1]));
    session = placeToken(session, 'p1:0', 0);
    session = {
      ...session,
      awaiting: 'move',
      dice: 2,
      legalTokenIds: [],
    };
    const next = ludoModule.onTimeout(session, 'p1', fixed([1])) as LudoSession;
    assert.strictEqual(next.players[next.currentPlayerIndex].id, 'p2');
    assert.strictEqual(next.awaiting, 'roll');
    assert.strictEqual(token(next, 'p1:0').progress, 0);
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
