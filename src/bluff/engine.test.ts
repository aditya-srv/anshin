import assert from 'assert';
import { describe, it } from 'node:test';
import { createDeck, shuffle } from './deck';
import {
  callChallenge,
  createGame,
  dropPlayer,
  forcePassTurn,
  makeTestGame,
  passTurn,
  personalize,
  playCards,
} from './engine';
import { bluffModule } from './module';
import { BluffCard, BluffRank } from './types';

const PLAYERS = [
  { id: 'p1', name: 'Ada' },
  { id: 'p2', name: 'Bea' },
];

const FOUR = [
  { id: 'p1', name: 'Ada' },
  { id: 'p2', name: 'Bea' },
  { id: 'p3', name: 'Cal' },
  { id: 'p4', name: 'Deb' },
];

function card(id: string, rank: BluffRank, suit: BluffCard['suit'] = 'hearts'): BluffCard {
  return { id, rank, suit };
}

function fixed(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

describe('bluff deck', () => {
  it('creates a 52-card deck without jokers', () => {
    const deck = createDeck();
    assert.strictEqual(deck.length, 52);
    assert.strictEqual(new Set(deck.map((item) => item.id)).size, 52);
    assert.strictEqual(deck.filter((item) => item.rank === 'Ace').length, 4);
    assert.strictEqual(deck.filter((item) => item.suit === 'spades').length, 13);
  });

  it('creates two decks with unique ids', () => {
    const deck = createDeck(2);
    assert.strictEqual(deck.length, 104);
    assert.strictEqual(new Set(deck.map((item) => item.id)).size, 104);
    assert.strictEqual(deck.filter((item) => item.rank === 'Ace').length, 8);
  });

  it('rejects invalid deck counts', () => {
    assert.throws(() => createDeck(0), /1 or 2 decks/);
    assert.throws(() => createDeck(3), /1 or 2 decks/);
  });

  it('shuffles without changing membership', () => {
    const deck = createDeck();
    const ids = deck.map((item) => item.id).sort();
    shuffle(deck, fixed([0.9, 0.1, 0.5, 0.2, 0.8]));
    assert.deepStrictEqual(deck.map((item) => item.id).sort(), ids);
  });
});

const SIX = [
  { id: 'p1', name: 'Ada' },
  { id: 'p2', name: 'Bea' },
  { id: 'p3', name: 'Cal' },
  { id: 'p4', name: 'Deb' },
  { id: 'p5', name: 'Eve' },
  { id: 'p6', name: 'Fay' },
];

describe('bluff deal', () => {
  it('deals all cards across 2–6 players', () => {
    const two = createGame(PLAYERS, fixed([0.2]));
    assert.strictEqual(two.players.reduce((sum, seat) => sum + seat.hand.length, 0), 52);
    assert.strictEqual(two.players[0].hand.length, 26);
    assert.strictEqual(two.players[1].hand.length, 26);

    const three = createGame(
      [
        { id: 'p1', name: 'Ada' },
        { id: 'p2', name: 'Bea' },
        { id: 'p3', name: 'Cal' },
      ],
      fixed([0.1])
    );
    const counts = three.players.map((seat) => seat.hand.length).sort();
    assert.deepStrictEqual(counts, [17, 17, 18]);

    const four = createGame(FOUR, fixed([0.4]));
    assert.ok(four.players.every((seat) => seat.hand.length === 13));

    const five = createGame(SIX.slice(0, 5), fixed([0.3]));
    const fiveCounts = five.players.map((seat) => seat.hand.length).sort();
    assert.deepStrictEqual(fiveCounts, [10, 10, 10, 11, 11]);

    const six = createGame(SIX, fixed([0.5]));
    const sixCounts = six.players.map((seat) => seat.hand.length).sort();
    assert.deepStrictEqual(sixCounts, [8, 8, 9, 9, 9, 9]);
  });

  it('deals two full decks when deckCount is 2', () => {
    const two = createGame(PLAYERS, fixed([0.2]), 2);
    assert.strictEqual(two.players.reduce((sum, seat) => sum + seat.hand.length, 0), 104);
    assert.strictEqual(two.players[0].hand.length, 52);
    assert.strictEqual(two.players[1].hand.length, 52);

    const four = createGame(FOUR, fixed([0.4]), 2);
    assert.ok(four.players.every((seat) => seat.hand.length === 26));

    const six = createGame(SIX, fixed([0.5]), 2);
    const sixCounts = six.players.map((seat) => seat.hand.length).sort();
    assert.deepStrictEqual(sixCounts, [17, 17, 17, 17, 18, 18]);
  });

  it('rejects invalid player counts', () => {
    assert.throws(() => createGame([{ id: 'p1', name: 'Ada' }]), /2 to 6/);
    assert.throws(
      () =>
        createGame([
          ...SIX,
          { id: 'p7', name: 'Gus' },
        ]),
      /2 to 6/
    );
  });

  it('rejects invalid deck counts', () => {
    assert.throws(() => createGame(PLAYERS, fixed([0.1]), 0), /1 or 2 decks/);
    assert.throws(() => createGame(PLAYERS, fixed([0.1]), 3), /1 or 2 decks/);
  });
});

describe('bluff play and challenge', () => {
  it('allows any declared rank and hides actual cards in personalize', () => {
    const session = makeTestGame({
      players: [
        {
          id: 'p1',
          name: 'Ada',
          hand: [card('c1', 'King'), card('c2', 'King'), card('c3', '2')],
        },
        { id: 'p2', name: 'Bea', hand: [card('c4', 'Ace')] },
      ],
      currentPlayerIndex: 0,
    });

    const played = playCards(session, 'p1', ['c1', 'c2'], 'Ace');
    assert.strictEqual(played.ok, true);
    if (!played.ok) {
      return;
    }
    assert.strictEqual(played.session.lastPlay?.declaredRank, 'Ace');
    assert.strictEqual(played.session.lastPlay?.quantity, 2);
    assert.strictEqual(played.session.lastPlay?.cards[0].rank, 'King');
    assert.strictEqual(played.session.discardPile.length, 2);
    assert.strictEqual(played.session.currentPlayerIndex, 1);

    const view = personalize(played.session, 'p2');
    assert.strictEqual(view.lastPlay?.declaredRank, 'Ace');
    assert.strictEqual(view.lastPlay?.quantity, 2);
    assert.ok(!('cards' in (view.lastPlay as object)));
    assert.deepStrictEqual(view.lastPlay?.challengeCardIds, ['c1', 'c2']);
    assert.strictEqual(view.opponents[0].cardCount, 1);
    assert.strictEqual(view.canChallenge, true);
    assert.deepStrictEqual(
      view.hand.map((item) => item.id),
      ['c4']
    );

    // Non-challenger seats do not receive pickable card ids.
    const accusedView = personalize(played.session, 'p1');
    assert.strictEqual(accusedView.canChallenge, false);
    assert.ok(!('challengeCardIds' in (accusedView.lastPlay as object)));
  });

  it('rejects invalid selections and out-of-turn plays', () => {
    const session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', '3'), card('c2', '4')] },
        { id: 'p2', name: 'Bea', hand: [card('c3', '5')] },
      ],
    });
    assert.strictEqual(playCards(session, 'p2', ['c3'], '5').ok, false);
    assert.strictEqual(playCards(session, 'p1', [], '5').ok, false);
    assert.strictEqual(playCards(session, 'p1', ['c1', 'c2', 'c1'], '5').ok, false);
    assert.strictEqual(playCards(session, 'p1', ['missing'], '5').ok, false);
    assert.strictEqual(playCards(session, 'p1', ['c1', 'c2', 'x', 'y', 'z'], '5').ok, false);
  });

  it('locks declared rank to the previous claim until the pile clears', () => {
    const session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', '2'), card('c2', '3')] },
        { id: 'p2', name: 'Bea', hand: [card('c3', '4'), card('c4', '5')] },
      ],
    });
    const first = playCards(session, 'p1', ['c1'], 'Ace');
    assert.strictEqual(first.ok, true);
    if (!first.ok) {
      return;
    }
    const wrongRank = playCards(first.session, 'p2', ['c3'], 'King');
    assert.strictEqual(wrongRank.ok, false);
    if (wrongRank.ok) {
      return;
    }
    assert.match(wrongRank.reason, /Must declare Ace/);

    const sameRank = playCards(first.session, 'p2', ['c3'], 'Ace');
    assert.strictEqual(sameRank.ok, true);
    if (!sameRank.ok) {
      return;
    }
    assert.strictEqual(sameRank.session.lastPlay?.declaredRank, 'Ace');
    assert.strictEqual(sameRank.session.claimedRank, 'Ace');
    assert.strictEqual(sameRank.session.discardPile.length > 0, true);
    assert.strictEqual(personalize(sameRank.session, 'p1').claimedRank, 'Ace');
    assert.strictEqual(personalize(sameRank.session, 'p1').discardCount > 0, true);

    // Rank stays locked when the turn returns to the player who started the pile,
    // until a challenge empties the upper pile.
    const backToStarter = playCards(sameRank.session, 'p1', ['c2'], 'King');
    assert.strictEqual(backToStarter.ok, false);
    if (!backToStarter.ok) {
      assert.match(backToStarter.reason, /Must declare Ace/);
    }

    const starterSameRank = playCards(sameRank.session, 'p1', ['c2'], 'Ace');
    assert.strictEqual(starterSameRank.ok, true);
    if (!starterSameRank.ok) {
      return;
    }
    assert.strictEqual(starterSameRank.session.claimedRank, 'Ace');
    assert.strictEqual(starterSameRank.session.discardPile.length > 0, true);
  });

  it('catches a bluff and gives the pile to the accused', () => {
    let session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', 'King'), card('c2', '2')] },
        { id: 'p2', name: 'Bea', hand: [card('c3', 'Ace')] },
      ],
      discardPile: [card('old', 'Queen')],
    });
    const played = playCards(session, 'p1', ['c1'], 'Ace');
    assert.strictEqual(played.ok, true);
    if (!played.ok) {
      return;
    }
    const challenged = callChallenge(played.session, 'p2', 'c1');
    assert.strictEqual(challenged.ok, true);
    if (!challenged.ok) {
      return;
    }
    assert.strictEqual(challenged.session.lastChallenge?.wasBluff, true);
    assert.match(challenged.session.lastChallenge?.message ?? '', /BLUFF CAUGHT/);
    assert.deepStrictEqual(
      challenged.session.lastChallenge?.revealedCards.map((item) => item.id),
      ['c1']
    );
    assert.strictEqual(challenged.session.discardPile.length, 0);
    assert.strictEqual(challenged.session.claimedRank, null);
    assert.strictEqual(challenged.session.players[0].hand.length, 3); // leftover 2 + King + Queen
    assert.strictEqual(challenged.session.currentPlayerIndex, 1); // after collector Ada
  });

  it('punishes a wrong challenge', () => {
    let session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', 'Ace'), card('c2', '2')] },
        { id: 'p2', name: 'Bea', hand: [card('c3', 'King')] },
      ],
      discardPile: [card('old', '3')],
    });
    const played = playCards(session, 'p1', ['c1'], 'Ace');
    assert.strictEqual(played.ok, true);
    if (!played.ok) {
      return;
    }
    const challenged = callChallenge(played.session, 'p2', 'c1');
    assert.strictEqual(challenged.ok, true);
    if (!challenged.ok) {
      return;
    }
    assert.strictEqual(challenged.session.lastChallenge?.wasBluff, false);
    assert.match(challenged.session.lastChallenge?.message ?? '', /WRONG CHALLENGE/);
    assert.strictEqual(challenged.session.claimedRank, null);
    assert.strictEqual(challenged.session.players[1].hand.length, 3);
    assert.strictEqual(challenged.session.currentPlayerIndex, 0); // after collector Bea
  });

  it('judges only the selected card when a mixed play is challenged', () => {
    const session = makeTestGame({
      players: [
        {
          id: 'p1',
          name: 'Ada',
          hand: [card('c1', 'Ace'), card('c2', 'King'), card('c3', '2')],
        },
        { id: 'p2', name: 'Bea', hand: [card('c4', '3')] },
      ],
      discardPile: [card('old', 'Queen')],
    });
    const played = playCards(session, 'p1', ['c1', 'c2'], 'Ace');
    assert.strictEqual(played.ok, true);
    if (!played.ok) {
      return;
    }

    // Picking the truthful Ace fails the challenge even though a King was also played.
    const miss = callChallenge(played.session, 'p2', 'c1');
    assert.strictEqual(miss.ok, true);
    if (!miss.ok) {
      return;
    }
    assert.strictEqual(miss.session.lastChallenge?.wasBluff, false);
    assert.deepStrictEqual(
      miss.session.lastChallenge?.revealedCards.map((item) => item.rank),
      ['Ace']
    );

    const again = playCards(
      makeTestGame({
        players: [
          {
            id: 'p1',
            name: 'Ada',
            hand: [card('c1', 'Ace'), card('c2', 'King'), card('c3', '2')],
          },
          { id: 'p2', name: 'Bea', hand: [card('c4', '3')] },
        ],
        discardPile: [card('old', 'Queen')],
      }),
      'p1',
      ['c1', 'c2'],
      'Ace'
    );
    assert.strictEqual(again.ok, true);
    if (!again.ok) {
      return;
    }
    const hit = callChallenge(again.session, 'p2', 'c2');
    assert.strictEqual(hit.ok, true);
    if (!hit.ok) {
      return;
    }
    assert.strictEqual(hit.session.lastChallenge?.wasBluff, true);
    assert.deepStrictEqual(
      hit.session.lastChallenge?.revealedCards.map((item) => item.id),
      ['c2']
    );
  });

  it('rejects challenges without a valid selected card', () => {
    const session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', '2')] },
        { id: 'p2', name: 'Bea', hand: [card('c2', '3')] },
      ],
    });
    const played = playCards(session, 'p1', ['c1'], 'Ace');
    assert.strictEqual(played.ok, true);
    if (!played.ok) {
      return;
    }
    assert.strictEqual(callChallenge(played.session, 'p2', '').ok, false);
    assert.strictEqual(callChallenge(played.session, 'p2', 'missing').ok, false);
  });

  it('blocks challenges after a newer play and blocks empty discard challenges', () => {
    let session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', '2'), card('c2', '3')] },
        { id: 'p2', name: 'Bea', hand: [card('c3', '4'), card('c4', '5')] },
      ],
    });
    assert.strictEqual(callChallenge(session, 'p1', 'c1').ok, false);

    const first = playCards(session, 'p1', ['c1'], 'Ace');
    assert.strictEqual(first.ok, true);
    if (!first.ok) {
      return;
    }
    const second = playCards(first.session, 'p2', ['c3'], 'Ace');
    assert.strictEqual(second.ok, true);
    if (!second.ok) {
      return;
    }
    // Only the latest play is challengeable, and only by the current seat (p1).
    assert.strictEqual(callChallenge(second.session, 'p2', 'c3').ok, false);
    assert.strictEqual(second.session.lastPlay?.playerId, 'p2');
  });
});

describe('bluff win and final challenge', () => {
  it('delays win until the next player plays instead of challenging', () => {
    let session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', 'Ace')] },
        { id: 'p2', name: 'Bea', hand: [card('c2', 'King'), card('c3', '2')] },
      ],
    });
    const played = playCards(session, 'p1', ['c1'], 'Ace');
    assert.strictEqual(played.ok, true);
    if (!played.ok) {
      return;
    }
    assert.strictEqual(played.session.winnerId, null);
    assert.strictEqual(played.session.pendingWinPlayerId, 'p1');

    const next = playCards(played.session, 'p2', ['c2'], 'Ace');
    assert.strictEqual(next.ok, true);
    if (!next.ok) {
      return;
    }
    assert.strictEqual(next.session.winnerId, 'p1');
  });

  it('lets a truthful final play win after a wrong challenge', () => {
    let session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', 'Ace')] },
        { id: 'p2', name: 'Bea', hand: [card('c2', 'King')] },
      ],
    });
    const played = playCards(session, 'p1', ['c1'], 'Ace');
    assert.strictEqual(played.ok, true);
    if (!played.ok) {
      return;
    }
    const challenged = callChallenge(played.session, 'p2', 'c1');
    assert.strictEqual(challenged.ok, true);
    if (!challenged.ok) {
      return;
    }
    assert.strictEqual(challenged.session.winnerId, 'p1');
    assert.strictEqual(challenged.session.lastChallenge?.wasBluff, false);
  });

  it('keeps playing when a final bluff is caught', () => {
    let session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', 'King')] },
        { id: 'p2', name: 'Bea', hand: [card('c2', 'Ace')] },
      ],
      discardPile: [card('old', '2')],
    });
    const played = playCards(session, 'p1', ['c1'], 'Ace');
    assert.strictEqual(played.ok, true);
    if (!played.ok) {
      return;
    }
    const challenged = callChallenge(played.session, 'p2', 'c1');
    assert.strictEqual(challenged.ok, true);
    if (!challenged.ok) {
      return;
    }
    assert.strictEqual(challenged.session.winnerId, null);
    assert.ok(challenged.session.players[0].hand.length > 0);
    assert.strictEqual(challenged.session.pendingWinPlayerId, null);
  });

  it('settles a pending win on forcePassTurn', () => {
    let session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [] },
        { id: 'p2', name: 'Bea', hand: [card('c2', 'King')] },
      ],
      currentPlayerIndex: 1,
      pendingWinPlayerId: 'p1',
      lastPlay: {
        playerId: 'p1',
        playerName: 'Ada',
        declaredRank: 'Ace',
        quantity: 1,
        cards: [card('c1', 'Ace')],
      },
      discardPile: [card('c1', 'Ace')],
    });
    const next = forcePassTurn(session);
    assert.strictEqual(next.winnerId, 'p1');
  });

  it('lets the current player pass to the next seat', () => {
    const session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', '2')] },
        { id: 'p2', name: 'Bea', hand: [card('c2', '3')] },
      ],
      currentPlayerIndex: 0,
    });
    const passed = passTurn(session, 'p1');
    assert.strictEqual(passed.ok, true);
    if (!passed.ok) {
      return;
    }
    assert.strictEqual(passed.session.currentPlayerIndex, 1);
    assert.match(passed.session.status, /passed/);
    assert.strictEqual(passTurn(session, 'p2').ok, false);
  });

  it('awards a pending win when the next seat passes', () => {
    const session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [] },
        { id: 'p2', name: 'Bea', hand: [card('c2', 'King')] },
      ],
      currentPlayerIndex: 1,
      pendingWinPlayerId: 'p1',
      lastPlay: {
        playerId: 'p1',
        playerName: 'Ada',
        declaredRank: 'Ace',
        quantity: 1,
        cards: [card('c1', 'Ace')],
      },
      discardPile: [card('c1', 'Ace')],
    });
    const passed = passTurn(session, 'p2');
    assert.strictEqual(passed.ok, true);
    if (!passed.ok) {
      return;
    }
    assert.strictEqual(passed.session.winnerId, 'p1');
  });
});

describe('bluff drop and module', () => {
  it('awards the last remaining player', () => {
    const session = makeTestGame({
      players: [
        { id: 'p1', name: 'Ada', hand: [card('c1', '2')] },
        { id: 'p2', name: 'Bea', hand: [card('c2', '3')] },
      ],
    });
    const next = dropPlayer(session, 'p2');
    assert.strictEqual(next.winnerId, 'p1');
  });

  it('maps module actions and keeps private cards out of personalize', () => {
    const session = createGame(PLAYERS, fixed([0.3]));
    const me = session.players[session.currentPlayerIndex];
    const cardIds = me.hand.slice(0, 1).map((item) => item.id);
    const applied = bluffModule.apply(session, me.id, {
      type: 'play',
      cardIds,
      rank: 'Queen',
    });
    assert.strictEqual(applied.ok, true);
    if (!applied.ok) {
      return;
    }
    const other = applied.session.players.find((player) => player.id !== me.id)!;
    const view = bluffModule.personalize(applied.session, other.id, {
      turnDeadline: null,
      connected: () => true,
    });
    assert.strictEqual(view.canChallenge, true);
    assert.ok(view.lastPlay);
    assert.strictEqual(
      Object.keys(view.lastPlay).sort().join(','),
      'challengeCardIds,declaredRank,playerId,playerName,quantity'
    );
    assert.deepStrictEqual(view.lastPlay.challengeCardIds, cardIds);
    const raw = JSON.stringify(view.lastPlay);
    assert.ok(!raw.includes('suit'));
    assert.ok(!raw.includes('"rank"'));
  });

  it('honors deckCount from create options', () => {
    const one = bluffModule.create(PLAYERS, fixed([0.2]), {});
    assert.strictEqual(one.players.reduce((sum, seat) => sum + seat.hand.length, 0), 52);

    const two = bluffModule.create(PLAYERS, fixed([0.2]), { deckCount: 2 });
    assert.strictEqual(two.players.reduce((sum, seat) => sum + seat.hand.length, 0), 104);

    const fallback = bluffModule.create(PLAYERS, fixed([0.2]), { deckCount: 9 });
    assert.strictEqual(fallback.players.reduce((sum, seat) => sum + seat.hand.length, 0), 52);
  });
});
