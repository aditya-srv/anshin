(function () {
  const vscode = acquireVsCodeApi();

  const menuScreen = document.getElementById('menuScreen');
  const lobbyScreen = document.getElementById('lobbyScreen');
  const gameScreen = document.getElementById('gameScreen');
  const nameInput = document.getElementById('nameInput');
  const urlInput = document.getElementById('urlInput');
  const hostBtn = document.getElementById('hostBtn');
  const joinBtn = document.getElementById('joinBtn');
  const menuStatus = document.getElementById('menuStatus');
  const joinUrlDisplay = document.getElementById('joinUrlDisplay');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const lobbyList = document.getElementById('lobbyList');
  const startBtn = document.getElementById('startBtn');
  const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
  const lobbyStatus = document.getElementById('lobbyStatus');
  const discardEl = document.getElementById('discard');
  const handEl = document.getElementById('hand');
  const statusEl = document.getElementById('status');
  const youCountEl = document.getElementById('youCount');
  const youLabelEl = document.getElementById('youLabel');
  const discardLabelEl = document.getElementById('discardLabel');
  const colorLineEl = document.getElementById('colorLine');
  const appTitleEl = document.getElementById('appTitle');
  const unoBtn = document.getElementById('unoBtn');
  const drawBtn = document.getElementById('drawBtn');
  const leaveGameBtn = document.getElementById('leaveGameBtn');
  const wildPicker = document.getElementById('wildPicker');
  const cancelWildBtn = document.getElementById('cancelWildBtn');
  const guiUltraBtn = document.getElementById('guiUltraBtn');
  const guiLowBtn = document.getElementById('guiLowBtn');
  const guiHighBtn = document.getElementById('guiHighBtn');
  const seatSlots = [
    document.querySelector('[data-seat-slot="0"]'),
    document.querySelector('[data-seat-slot="1"]'),
    document.querySelector('[data-seat-slot="2"]'),
  ];

  hostBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'host', name: nameInput.value });
  });

  joinBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'join', name: nameInput.value, url: urlInput.value });
  });

  startBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'startGame' });
  });

  leaveLobbyBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'leave' });
  });

  leaveGameBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'leave' });
  });

  copyUrlBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'copyJoinUrl' });
  });

  drawBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'draw' });
  });

  unoBtn.addEventListener('click', function () {
    if (unoBtn.disabled) {
      return;
    }
    vscode.postMessage({ type: 'callUno' });
  });

  cancelWildBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'cancelWild' });
  });

  wildPicker.querySelectorAll('.wild-color').forEach(function (btn) {
    btn.addEventListener('click', function () {
      vscode.postMessage({ type: 'chooseWildColor', color: btn.getAttribute('data-color') });
    });
  });

  guiUltraBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'setGuiMode', mode: 'ultra' });
  });
  guiLowBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'setGuiMode', mode: 'low' });
  });
  guiHighBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'setGuiMode', mode: 'high' });
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || message.type !== 'ui') {
      return;
    }
    render(message.state);
  });

  vscode.postMessage({ type: 'ready' });

  function normalizeMode(mode) {
    if (mode === 'ultra' || mode === 'high' || mode === 'low') {
      return mode;
    }
    return 'low';
  }

  function tokenFor(card) {
    return (card.color ? card.color.charAt(0) : 'w') + shortValue(card.value);
  }

  function shortValue(value) {
    if (value === 'skip') return 'S';
    if (value === 'reverse') return 'R';
    if (value === 'draw2') return '+2';
    if (value === 'wild') return 'W';
    if (value === 'wild4') return '+4';
    return value;
  }

  function showScreen(screen) {
    menuScreen.classList.toggle('hidden', screen !== 'menu');
    lobbyScreen.classList.toggle('hidden', screen !== 'lobby');
    gameScreen.classList.toggle('hidden', screen !== 'game');
  }

  function render(state) {
    const mode = normalizeMode(state.guiMode);
    const ultra = mode === 'ultra';

    document.body.classList.remove('gui-ultra', 'gui-low', 'gui-high');
    document.body.classList.add('gui-' + mode);

    guiUltraBtn.classList.toggle('active', mode === 'ultra');
    guiLowBtn.classList.toggle('active', mode === 'low');
    guiHighBtn.classList.toggle('active', mode === 'high');

    showScreen(state.screen);

    if (state.screen === 'menu') {
      appTitleEl.textContent = ultra ? 'Anshin' : 'Anshin · UNO';
      menuStatus.textContent = state.status || '';
      renderUnoButton(null);
      return;
    }

    if (state.screen === 'lobby') {
      appTitleEl.textContent = ultra ? 'Anshin · lobby' : 'Anshin · UNO · Lobby';
      joinUrlDisplay.textContent = state.joinUrl || '';
      lobbyStatus.textContent = state.status || '';
      renderUnoButton(null);
      startBtn.disabled = !state.youAreHost || !state.canStart;
      startBtn.classList.toggle('hidden', !state.youAreHost);
      renderLobby(state.lobbyPlayers || []);
      return;
    }

    const game = state.game;
    if (!game) {
      return;
    }

    const n = game.playerCount || 2;
    appTitleEl.textContent = ultra ? 'Anshin' : 'Anshin · UNO · ' + n + 'P';
    discardLabelEl.textContent = ultra ? 'Active' : 'Discard';
    youLabelEl.textContent = ultra ? 'local' : 'You';
    if (game.awaitingWildColor) {
      colorLineEl.textContent = ultra ? 'tone ?' : 'Color: waiting';
    } else {
      colorLineEl.textContent = ultra
        ? 'tone ' + game.currentColor
        : 'Color: ' + game.currentColor + (game.direction === 1 ? ' · clockwise' : ' · counter-clockwise');
    }

    renderOpponents(game.opponents || [], ultra, game.currentPlayerId, game.winnerId);
    renderDiscard(game.discard, ultra);
    renderHand(game.hand, state.selectedId, ultra);

    const handCount = (game.hand || []).length;
    youCountEl.textContent = ultra ? handCount + ' items' : handCount + ' cards';
    const yourSeat = youLabelEl.closest('.seat-you');
    if (yourSeat) {
      yourSeat.classList.toggle(
        'your-turn',
        game.currentPlayerId === game.yourPlayerId && !game.winnerId
      );
    }

    statusEl.textContent = state.status || game.status || '';

    const myTurn = game.currentPlayerId === game.yourPlayerId && !game.winnerId;
    drawBtn.disabled = !myTurn || !!game.awaitingWildColor;
    if (ultra) {
      drawBtn.textContent =
        game.drawRemaining === 0 ? 'Fetch (empty)' : 'Fetch (' + game.drawRemaining + ')';
    } else {
      drawBtn.textContent =
        game.drawRemaining === 0
          ? 'Draw (empty)'
          : 'Draw (' + game.drawRemaining + ' left)';
    }

    renderUnoButton(game.unoCall, game.yourPlayerId, ultra);

    const choosingOpening = !!game.awaitingWildColor && game.currentPlayerId === game.yourPlayerId;
    wildPicker.classList.toggle('hidden', !state.pendingWildCardId && !choosingOpening);
    if (cancelWildBtn) {
      cancelWildBtn.classList.toggle('hidden', choosingOpening);
    }
  }

  let unoTick = null;

  function renderUnoButton(unoCall, yourPlayerId, ultra) {
    if (unoTick) {
      clearInterval(unoTick);
      unoTick = null;
    }
    if (!unoCall) {
      unoBtn.classList.add('hidden');
      unoBtn.disabled = true;
      return;
    }
    const mine = unoCall.playerId === yourPlayerId;
    const enabled = unoCall.phase === 'priority' ? mine : !mine;
    const endsAt = Date.now() + (unoCall.remainingMs || 0);
    unoBtn.classList.remove('hidden');
    unoBtn.disabled = !enabled;

    function paint() {
      const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (ultra) {
        unoBtn.textContent = enabled ? 'Mark (' + seconds + 's)' : 'Wait (' + seconds + 's)';
        return;
      }
      if (mine && unoCall.phase === 'priority') {
        unoBtn.textContent = 'UNO (' + seconds + 's)';
        return;
      }
      if (!mine && unoCall.phase === 'catch') {
        unoBtn.textContent = 'Catch UNO (' + seconds + 's)';
        return;
      }
      unoBtn.textContent = mine ? 'Too late (' + seconds + 's)' : 'UNO (' + seconds + 's)';
    }

    paint();
    unoTick = setInterval(paint, 250);
  }

  function renderLobby(players) {
    lobbyList.innerHTML = '';
    players.forEach(function (p) {
      const li = document.createElement('li');
      li.textContent = p.name + (p.isHost ? ' (host)' : '');
      lobbyList.appendChild(li);
    });
  }

  function renderOpponents(opponents, ultra, currentPlayerId, winnerId) {
    seatSlots.forEach(function (section) {
      if (section) {
        section.classList.add('hidden');
      }
    });

    opponents.forEach(function (seat, index) {
      const section = seatSlots[index];
      if (!section) {
        return;
      }
      section.classList.remove('hidden');
      section.classList.toggle('your-turn', !winnerId && seat.id === currentPlayerId);
      const nameEl = section.querySelector('.seat-name');
      const countEl = section.querySelector('.seat-count');
      const cardsEl = section.querySelector('.seat-cards');

      if (nameEl) {
        nameEl.textContent = ultra ? 'peer-' + (index + 1) : seat.name;
      }
      if (countEl) {
        countEl.textContent = ultra
          ? seat.cardCount + ' pending'
          : seat.cardCount + ' cards';
      }
      if (!cardsEl) {
        return;
      }
      cardsEl.innerHTML = '';
      if (ultra) {
        return;
      }
      var show = Math.min(seat.cardCount, 5);
      for (var i = 0; i < show; i++) {
        const card = document.createElement('div');
        card.className = 'card back sm';
        card.title = seat.name + ' · ' + seat.cardCount + ' cards';
        cardsEl.appendChild(card);
      }
    });
  }

  function renderDiscard(card, ultra) {
    discardEl.innerHTML = '';
    if (!card) {
      return;
    }
    discardEl.appendChild(createFaceCard(card, false, ultra));
  }

  function renderHand(hand, selectedId, ultra) {
    handEl.innerHTML = '';
    (hand || []).forEach(function (card) {
      const el = createFaceCard(card, true, ultra);
      if (card.id === selectedId) {
        el.classList.add('selected');
      }
      if (card.playable === false) {
        el.classList.add('unplayable');
      }
      el.addEventListener('click', function () {
        if (card.playable === false) {
          return;
        }
        vscode.postMessage({ type: 'select', cardId: card.id });
      });
      handEl.appendChild(el);
    });
  }

  function createFaceCard(card, isHand, ultra) {
    const el = document.createElement('div');
    const colorClass = !ultra && card.color ? ' ' + card.color : '';
    const wildClass = !ultra && !card.color ? ' wild' : '';
    el.className = 'card' + colorClass + wildClass + (isHand ? ' hand' : '');
    el.dataset.id = card.id;

    if (ultra) {
      el.classList.add('token');
      el.textContent = tokenFor(card);
      return el;
    }

    const color = document.createElement('span');
    color.className = 'color';
    color.textContent = card.color ? card.color.charAt(0) : 'W';

    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = shortValue(card.value);

    el.appendChild(color);
    el.appendChild(value);
    return el;
  }
})();
