(function () {
  const vscode = acquireVsCodeApi();

  const menuScreen = document.getElementById('menuScreen');
  const lobbyScreen = document.getElementById('lobbyScreen');
  const gameScreen = document.getElementById('gameScreen');
  const nameInput = document.getElementById('nameInput');
  const urlInput = document.getElementById('urlInput');
  const hostBtn = document.getElementById('hostBtn');
  const hostLocalBtn = document.getElementById('hostLocalBtn');
  const hostRemoteBtn = document.getElementById('hostRemoteBtn');
  const serverUrlField = document.getElementById('serverUrlField');
  const serverUrlInput = document.getElementById('serverUrlInput');
  const joinBtn = document.getElementById('joinBtn');
  const menuStatus = document.getElementById('menuStatus');
  let hostMode = 'local';
  let serverUrlTouched = false;
  const joinUrlDisplay = document.getElementById('joinUrlDisplay');
  const joinUrlList = document.getElementById('joinUrlList');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const lobbyList = document.getElementById('lobbyList');
  const startBtn = document.getElementById('startBtn');
  const hostOpts = document.getElementById('hostOpts');
  const cardsPerPlayerInput = document.getElementById('cardsPerPlayerInput');
  const guaranteeSpecialInput = document.getElementById('guaranteeSpecialInput');
  const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
  const lobbyStatus = document.getElementById('lobbyStatus');
  const discardEl = document.getElementById('discard');
  const handEl = document.getElementById('hand');
  const statusEl = document.getElementById('status');
  const youCountEl = document.getElementById('youCount');
  const youLabelEl = document.getElementById('youLabel');
  const discardLabelEl = document.getElementById('discardLabel');
  const colorLineEl = document.getElementById('colorLine');
  const unoSaidLineEl = document.getElementById('unoSaidLine');
  const appTitleEl = document.getElementById('appTitle');
  const unoBtn = document.getElementById('unoBtn');
  const catchBtn = document.getElementById('catchBtn');
  const unoDockBar = document.querySelector('.uno-dock-bar');
  const drawBtn = document.getElementById('drawBtn');
  const leaveGameBtn = document.getElementById('leaveGameBtn');
  const wildPicker = document.getElementById('wildPicker');
  const cancelWildBtn = document.getElementById('cancelWildBtn');
  const guiUltraBtn = document.getElementById('guiUltraBtn');
  const guiLowBtn = document.getElementById('guiLowBtn');
  const guiHighBtn = document.getElementById('guiHighBtn');
  const seatSlots = Array.prototype.slice
    .call(document.querySelectorAll('[data-seat-slot]'))
    .sort(function (a, b) {
      return (
        Number(a.getAttribute('data-seat-slot')) -
        Number(b.getAttribute('data-seat-slot'))
      );
    });

  function setHostMode(mode) {
    hostMode = mode === 'remote' ? 'remote' : 'local';
    if (hostLocalBtn) {
      hostLocalBtn.classList.toggle('active', hostMode === 'local');
    }
    if (hostRemoteBtn) {
      hostRemoteBtn.classList.toggle('active', hostMode === 'remote');
    }
    if (serverUrlField) {
      serverUrlField.classList.toggle('hidden', hostMode !== 'remote');
    }
  }

  if (hostLocalBtn) {
    hostLocalBtn.addEventListener('click', function () {
      setHostMode('local');
    });
  }
  if (hostRemoteBtn) {
    hostRemoteBtn.addEventListener('click', function () {
      setHostMode('remote');
    });
  }
  if (serverUrlInput) {
    serverUrlInput.addEventListener('input', function () {
      serverUrlTouched = true;
    });
  }

  hostBtn.addEventListener('click', function () {
    vscode.postMessage({
      type: 'host',
      name: nameInput.value,
      remote: hostMode === 'remote',
      serverUrl: serverUrlInput ? serverUrlInput.value : '',
    });
  });

  joinBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'join', name: nameInput.value, url: urlInput.value });
  });

  startBtn.addEventListener('click', function () {
    var cards = 7;
    if (cardsPerPlayerInput) {
      var parsed = parseInt(cardsPerPlayerInput.value, 10);
      if (!isNaN(parsed)) {
        cards = Math.min(15, Math.max(1, parsed));
      }
      cardsPerPlayerInput.value = String(cards);
    }
    vscode.postMessage({
      type: 'startGame',
      guaranteeSpecial: !!(guaranteeSpecialInput && guaranteeSpecialInput.checked),
      cardsPerPlayer: cards,
    });
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
    vscode.postMessage({ type: 'callUno' });
  });

  catchBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'catchUno' });
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

    if (unoDockBar) {
      unoDockBar.classList.toggle('hidden', state.screen !== 'game');
    }

    if (state.screen === 'menu') {
      appTitleEl.textContent = ultra ? 'Anshin' : 'Anshin · UNO';
      menuStatus.textContent = state.status || '';
      if (
        serverUrlInput &&
        !serverUrlTouched &&
        typeof state.defaultServerUrl === 'string' &&
        state.defaultServerUrl &&
        !serverUrlInput.value
      ) {
        serverUrlInput.value = state.defaultServerUrl;
      }
      setHostMode(hostMode);
      renderUnoSaid(null, ultra);
      return;
    }

    if (state.screen === 'lobby') {
      appTitleEl.textContent = ultra ? 'Anshin · lobby' : 'Anshin · UNO · Lobby';
      joinUrlDisplay.textContent = state.joinUrl || '';
      renderJoinUrls(state.joinUrls, state.joinUrl);
      lobbyStatus.textContent = state.status || '';
      renderUnoSaid(null, ultra);
      startBtn.disabled = !state.youAreHost || !state.canStart;
      startBtn.classList.toggle('hidden', !state.youAreHost);
      if (hostOpts) {
        hostOpts.classList.toggle('hidden', !state.youAreHost);
      }
      renderLobby(state.lobbyPlayers || []);
      return;
    }

    const game = state.game;
    if (!game) {
      return;
    }

    const n = game.playerCount || 2;
    const myTurn = game.currentPlayerId === game.yourPlayerId && !game.winnerId;
    appTitleEl.textContent = ultra ? 'Anshin' : 'Anshin · UNO · ' + n + 'P';
    discardLabelEl.textContent = ultra ? 'Active' : 'Discard';
    if (ultra) {
      youLabelEl.textContent = myTurn ? 'local · turn' : 'local';
    } else {
      youLabelEl.textContent = 'You';
    }
    renderOpponents(game.opponents || [], ultra, game.currentPlayerId, game.winnerId);
    renderTurnLine(game, ultra, state.yourName);
    renderDiscard(game.discard, ultra);
    renderHand(game.hand, state.selectedId, ultra);

    const handCount = (game.hand || []).length;
    youCountEl.textContent = ultra ? handCount + ' items' : handCount + ' cards';
    const yourSeat = youLabelEl.closest('.seat-you');
    if (yourSeat) {
      yourSeat.classList.toggle('your-turn', myTurn);
    }

    statusEl.textContent = state.status || game.status || '';

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

    unoBtn.textContent = ultra ? 'Mark' : 'UNO';
    catchBtn.textContent = ultra ? 'Flag' : 'Catch';
    renderUnoSaid(game.unoSaid, ultra);

    const choosingOpening = !!game.awaitingWildColor && game.currentPlayerId === game.yourPlayerId;
    wildPicker.classList.toggle('hidden', !state.pendingWildCardId && !choosingOpening);
    if (cancelWildBtn) {
      cancelWildBtn.classList.toggle('hidden', choosingOpening);
    }
  }

  function renderUnoSaid(unoSaid, ultra) {
    if (!unoSaidLineEl) {
      return;
    }
    if (!unoSaid) {
      unoSaidLineEl.textContent = '';
      unoSaidLineEl.classList.add('hidden');
      return;
    }
    unoSaidLineEl.classList.remove('hidden');
    unoSaidLineEl.textContent = ultra
      ? 'mark · ' + (unoSaid.playerName || '')
      : (unoSaid.playerName ? unoSaid.playerName + ' · ' : '') + 'UNO';
  }

  function renderTurnLine(game, ultra, yourName) {
    if (!colorLineEl) {
      return;
    }
    if (game.winnerId) {
      colorLineEl.textContent = '';
      colorLineEl.classList.add('hidden');
      return;
    }
    var label = turnLabel(game, yourName);
    colorLineEl.classList.remove('hidden');
    colorLineEl.textContent = ultra ? 'next · ' + label : 'Turn: ' + label;
  }

  function turnLabel(game, yourName) {
    if (game.currentPlayerId === game.yourPlayerId) {
      return yourName || 'You';
    }
    var opponents = game.opponents || [];
    for (var i = 0; i < opponents.length; i++) {
      if (opponents[i].id === game.currentPlayerId) {
        return opponents[i].name || '…';
      }
    }
    return '…';
  }

  function renderJoinUrls(joinUrls, primary) {
    if (!joinUrlList) {
      return;
    }
    joinUrlList.innerHTML = '';
    const extras = (joinUrls || []).filter(function (url) {
      return url && url !== primary;
    });
    extras.forEach(function (url) {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.className = 'join-url';
      code.textContent = url;
      li.appendChild(code);
      joinUrlList.appendChild(li);
    });
    joinUrlList.classList.toggle('hidden', extras.length === 0);
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
