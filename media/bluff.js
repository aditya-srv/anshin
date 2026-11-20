(function () {
  var post = function () {
    return undefined;
  };
  var selected = {};
  var declaredRank = 'Ace';
  var lastChallengeKey = '';
  var ranks = [
    'Ace',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    'Jack',
    'Queen',
    'King',
  ];

  function shortRankLabel(rank) {
    if (rank === 'Ace') return 'A';
    if (rank === 'Jack') return 'J';
    if (rank === 'Queen') return 'Q';
    if (rank === 'King') return 'K';
    return String(rank);
  }

  function ensureRankButtons() {
    var root = document.getElementById('bluffRanks');
    if (!root || root.dataset.filled) {
      return root;
    }
    root.dataset.filled = '1';
    ranks.forEach(function (value) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bluff-rank-btn';
      btn.dataset.rank = value;
      btn.title = value;
      btn.textContent = shortRankLabel(value);
      btn.addEventListener('click', function () {
        declaredRank = value;
        paintRankButtons();
        var game = window.__anshinBluffGame;
        if (game) {
          render(game);
        }
      });
      root.appendChild(btn);
    });
    return root;
  }

  function paintRankButtons(enabled) {
    var root = ensureRankButtons();
    if (!root) {
      return;
    }
    var buttons = root.querySelectorAll('.bluff-rank-btn');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var active = btn.dataset.rank === declaredRank;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (enabled !== undefined) {
        btn.disabled = !enabled;
      }
    }
  }

  function bind(send) {
    post = send;
    var play = document.getElementById('bluffPlay');
    var pass = document.getElementById('bluffPass');
    var challenge = document.getElementById('bluffChallenge');
    var leave = document.getElementById('bluffLeave');
    var close = document.getElementById('bluffRevealClose');

    ensureRankButtons();
    paintRankButtons(false);

    if (play && !play.dataset.bound) {
      play.dataset.bound = '1';
      play.addEventListener('click', function () {
        var ids = Object.keys(selected);
        if (!ids.length) {
          return;
        }
        post({
          type: 'action',
          action: { type: 'play', cardIds: ids, rank: declaredRank },
        });
        selected = {};
      });
    }

    if (pass && !pass.dataset.bound) {
      pass.dataset.bound = '1';
      pass.addEventListener('click', function () {
        selected = {};
        post({ type: 'action', action: { type: 'pass' } });
      });
    }

    if (challenge && !challenge.dataset.bound) {
      challenge.dataset.bound = '1';
      challenge.addEventListener('click', function () {
        post({ type: 'action', action: { type: 'challenge' } });
      });
    }

    if (leave && !leave.dataset.bound) {
      leave.dataset.bound = '1';
      leave.addEventListener('click', function () {
        post({ type: 'leave' });
      });
    }

    if (close && !close.dataset.bound) {
      close.dataset.bound = '1';
      close.addEventListener('click', function () {
        var reveal = document.getElementById('bluffReveal');
        if (reveal) {
          reveal.classList.add('hidden');
        }
      });
    }
  }

  function suitSymbol(suit) {
    if (suit === 'hearts') return '♥';
    if (suit === 'diamonds') return '♦';
    if (suit === 'clubs') return '♣';
    if (suit === 'spades') return '♠';
    return '';
  }

  function shortRank(rank) {
    return shortRankLabel(rank);
  }

  function isRed(suit) {
    return suit === 'hearts' || suit === 'diamonds';
  }

  function faceCard(card, interactive) {
    var el = document.createElement(interactive ? 'button' : 'div');
    if (interactive) {
      el.type = 'button';
    }
    el.className = 'bluff-card' + (isRed(card.suit) ? ' red' : '');
    el.dataset.cardId = card.id;
    el.innerHTML =
      '<span>' +
      shortRank(card.rank) +
      '</span><span>' +
      suitSymbol(card.suit) +
      '</span>';
    if (interactive) {
      if (selected[card.id]) {
        el.classList.add('selected');
      }
      el.addEventListener('click', function () {
        if (selected[card.id]) {
          delete selected[card.id];
        } else {
          if (Object.keys(selected).length >= 4) {
            return;
          }
          selected[card.id] = true;
        }
        var game = window.__anshinBluffGame;
        if (game) {
          render(game);
        }
      });
    }
    return el;
  }

  function backCard() {
    var el = document.createElement('div');
    el.className = 'bluff-card-back';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = '·';
    return el;
  }

  function challengeKey(result) {
    if (!result) {
      return '';
    }
    return [
      result.challengerId,
      result.accusedId,
      result.declaredRank,
      result.quantity,
      result.wasBluff ? '1' : '0',
      result.collectorId,
      (result.revealedCards || [])
        .map(function (card) {
          return card.id;
        })
        .join(','),
    ].join('|');
  }

  function syncSelection(hand) {
    var ids = {};
    (hand || []).forEach(function (card) {
      ids[card.id] = true;
    });
    Object.keys(selected).forEach(function (id) {
      if (!ids[id]) {
        delete selected[id];
      }
    });
  }

  function renderOpponents(game) {
    var root = document.getElementById('bluffOpponents');
    if (!root) {
      return;
    }
    root.innerHTML = '';
    (game.opponents || []).forEach(function (opponent) {
      var seat = document.createElement('div');
      seat.className = 'bluff-seat';
      if (opponent.id === game.currentPlayerId && !game.winnerId) {
        seat.classList.add('your-turn');
      }
      if (opponent.connected === false) {
        seat.classList.add('offline');
      }
      seat.innerHTML =
        '<span class="bluff-seat-name"></span><span class="bluff-seat-count"></span>';
      seat.querySelector('.bluff-seat-name').textContent = opponent.name;
      seat.querySelector('.bluff-seat-count').textContent =
        opponent.cardCount + (opponent.cardCount === 1 ? ' card' : ' cards');
      root.appendChild(seat);
    });
  }

  function renderPile(game) {
    var pile = document.getElementById('bluffPile');
    var claim = document.getElementById('bluffClaim');
    if (!pile) {
      return;
    }
    pile.innerHTML = '';
    var count = Math.min(game.discardCount || 0, 8);
    for (var i = 0; i < count; i++) {
      pile.appendChild(backCard());
    }
    if ((game.discardCount || 0) > 8) {
      var more = document.createElement('span');
      more.className = 'bluff-seat-count';
      more.textContent = '+' + (game.discardCount - 8);
      pile.appendChild(more);
    }
    if (claim) {
      if (game.lastPlay) {
        claim.textContent =
          game.lastPlay.playerName +
          ' claims ' +
          game.lastPlay.quantity +
          '× ' +
          game.lastPlay.declaredRank;
      } else if (game.discardCount) {
        claim.textContent = game.discardCount + ' cards in the pile';
      } else {
        claim.textContent = 'Empty pile · declare any rank';
      }
    }
  }

  function renderHand(game, myTurn) {
    var handEl = document.getElementById('bluffHand');
    var youCount = document.getElementById('bluffYouCount');
    var youLabel = document.getElementById('bluffYouLabel');
    if (!handEl) {
      return;
    }
    handEl.innerHTML = '';
    syncSelection(game.hand);
    (game.hand || []).forEach(function (card) {
      handEl.appendChild(faceCard(card, myTurn && !game.winnerId));
    });
    if (youCount) {
      youCount.textContent = (game.hand || []).length + ' cards';
    }
    if (youLabel) {
      youLabel.textContent = myTurn && !game.winnerId ? 'You · your turn' : 'You';
    }
  }

  function renderReveal(game) {
    var reveal = document.getElementById('bluffReveal');
    var title = document.getElementById('bluffRevealTitle');
    var msg = document.getElementById('bluffRevealMsg');
    var cards = document.getElementById('bluffRevealCards');
    if (!reveal || !game.lastChallenge) {
      if (reveal && !game.lastChallenge) {
        reveal.classList.add('hidden');
      }
      return;
    }
    var key = challengeKey(game.lastChallenge);
    if (key !== lastChallengeKey) {
      lastChallengeKey = key;
      reveal.classList.remove('hidden');
    }
    if (title) {
      title.textContent = game.lastChallenge.wasBluff ? 'Bluff caught' : 'Wrong challenge';
    }
    if (msg) {
      msg.textContent =
        game.lastChallenge.message +
        ' Declared ' +
        game.lastChallenge.quantity +
        '× ' +
        game.lastChallenge.declaredRank +
        '.';
    }
    if (cards) {
      cards.innerHTML = '';
      (game.lastChallenge.revealedCards || []).forEach(function (card) {
        cards.appendChild(faceCard(card, false));
      });
    }
  }

  function render(game) {
    window.__anshinBluffGame = game;
    if (!game) {
      return;
    }
    var myTurn = game.currentPlayerId === game.yourPlayerId && !game.winnerId;
    renderOpponents(game);
    renderPile(game);
    paintRankButtons(myTurn);
    renderHand(game, myTurn);
    renderReveal(game);

    var play = document.getElementById('bluffPlay');
    var pass = document.getElementById('bluffPass');
    var challenge = document.getElementById('bluffChallenge');
    var status = document.getElementById('bluffStatus');
    var tableStatus = document.getElementById('bluffTableStatus');
    var selectedLine = document.getElementById('bluffSelected');
    var selectedCount = Object.keys(selected).length;

    if (play) {
      play.disabled = !myTurn || selectedCount < 1 || selectedCount > 4;
      play.textContent = selectedCount ? 'Play cards (' + selectedCount + ')' : 'Play cards';
    }
    if (pass) {
      pass.disabled = !myTurn;
    }
    if (challenge) {
      challenge.disabled = !game.canChallenge;
    }
    if (selectedLine) {
      var parts = [];
      if (selectedCount) {
        parts.push('Selected: ' + selectedCount);
      }
      parts.push('Rank: ' + declaredRank);
      selectedLine.textContent = parts.join(' · ');
    }
    if (status) {
      status.textContent = game.status || '';
    }
    if (tableStatus) {
      tableStatus.textContent = game.winnerId ? 'Game over' : myTurn ? 'Your move' : 'Waiting…';
    }
  }

  window.AnshinBluff = {
    bind: bind,
    render: render,
  };
})();
