/*
 * Standalone join page (dist/anshin-join.html). No server is needed: this script
 * opens the room's WebSocket directly. It stands in for the VS Code webview API and
 * keeps the same UI state as src/sidebar/state.ts, so uno.js, ludo.js and bluff.js
 * render it unchanged. Join only: hosting stays in VS Code.
 */
(function () {
  var DEFAULT_GAME = 'uno';
  var CONNECT_TIMEOUT_MS = 8000;
  var MENU_STATUS = 'Paste the Join URL from the host, enter your name, then Join room.';

  var socket = null;
  var connectTimer = null;
  var state = createMenuState();

  function createMenuState(status, guiMode) {
    return {
      screen: 'menu',
      guiMode: guiMode || 'low',
      status: status || MENU_STATUS,
      joinUrl: '',
      joinUrls: [],
      lobbyPlayers: [],
      canStart: false,
      youAreHost: false,
      yourPlayerId: '',
      yourName: '',
      selectedGame: DEFAULT_GAME,
      gameId: null,
      game: null,
    };
  }

  function publish() {
    window.postMessage(
      {
        type: 'ui',
        state: Object.assign({}, state, { defaultServerUrl: '', extensionVersion: '' }),
      },
      '*'
    );
  }

  function setStatus(status) {
    state = Object.assign({}, state, { status: status });
    publish();
  }

  function resetMenu(status) {
    state = createMenuState(status, state.guiMode);
    publish();
  }

  function statusOf(value) {
    return value && typeof value === 'object' && typeof value.status === 'string' ? value.status : '';
  }

  function lobbyStatus(youAreHost, joinUrl, joinUrls) {
    if (!youAreHost) {
      return 'Waiting for host to start…';
    }
    if (/127\.0\.0\.1|localhost/i.test(joinUrl)) {
      return 'Lobby · only this machine can join (' + joinUrl + ')';
    }
    if (joinUrls.length > 1) {
      return 'Lobby · share ' + joinUrl + '. If someone cannot connect, try the next address.';
    }
    return 'Lobby · share ' + joinUrl;
  }

  function isJoinUrl(raw) {
    try {
      var parsed = new URL(raw);
      var token = parsed.searchParams.get('t');
      return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') &&
        parsed.hostname.length > 0 &&
        Boolean(token && token.trim());
    } catch (err) {
      return false;
    }
  }

  /** Mirrors applyServerMessage() in src/sidebar/state.ts. */
  function onRoomMessage(msg) {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    switch (msg.type) {
      case 'lobby': {
        var joinUrls = msg.joinUrls && msg.joinUrls.length > 0 ? msg.joinUrls : [msg.joinUrl];
        var away = (msg.players || [])
          .filter(function (player) { return !player.connected; })
          .map(function (player) { return player.name; });
        state = Object.assign({}, state, {
          screen: 'lobby',
          lobbyPlayers: msg.players || [],
          joinUrl: msg.joinUrl,
          joinUrls: joinUrls,
          canStart: msg.canStart,
          youAreHost: msg.youAreHost,
          yourPlayerId: msg.yourPlayerId,
          selectedGame: msg.game || DEFAULT_GAME,
          gameId: null,
          game: null,
          status: away.length
            ? away.join(', ') + ' disconnected.'
            : lobbyStatus(msg.youAreHost, msg.joinUrl, joinUrls),
        });
        break;
      }
      case 'state':
        state = Object.assign({}, state, {
          screen: 'game',
          gameId: msg.game,
          game: msg.state,
          status: statusOf(msg.state),
        });
        break;
      case 'gameOver': {
        var game = msg.state;
        var loserId = game && typeof game === 'object' && 'loserId' in game ? game.loserId : null;
        var overStatus = loserId && statusOf(game) ? statusOf(game) : msg.winnerName + ' wins!';
        state = Object.assign({}, state, {
          screen: 'game',
          gameId: msg.game,
          game: game,
          status: overStatus,
        });
        break;
      }
      case 'waiting':
        state = Object.assign({}, state, {
          screen: 'lobby',
          lobbyPlayers: [],
          canStart: false,
          youAreHost: false,
          gameId: null,
          game: null,
          status: msg.status,
        });
        break;
      case 'error':
        state = Object.assign({}, state, { status: msg.reason });
        break;
      case 'ended':
        closeSocket();
        resetMenu(msg.reason || 'The room ended.');
        return;
      default:
        return;
    }
    publish();
  }

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function closeSocket() {
    clearTimeout(connectTimer);
    var ws = socket;
    socket = null;
    if (ws) {
      try {
        ws.close();
      } catch (err) {
        // ignore
      }
    }
  }

  function failJoin(text, ws) {
    if (ws && socket === ws) {
      closeSocket();
    }
    resetMenu(text);
  }

  function join(name, url) {
    var trimmed = String(name || '').trim().slice(0, 24);
    var joinUrl = String(url || '').trim();
    if (!trimmed) {
      setStatus('Enter a display name.');
      return;
    }
    if (!isJoinUrl(joinUrl)) {
      setStatus('URL must be ws:// or wss:// with a host (include ?t= from the host)');
      return;
    }

    closeSocket();
    state = Object.assign({}, state, {
      yourName: trimmed,
      youAreHost: false,
      joinUrl: joinUrl,
      status: 'Connecting…',
    });
    publish();

    var ws;
    try {
      ws = new WebSocket(joinUrl);
    } catch (err) {
      failJoin('Join failed: ' + (err && err.message ? err.message : 'bad URL'));
      return;
    }
    socket = ws;

    var opened = false;
    connectTimer = setTimeout(function () {
      if (!opened) {
        failJoin('Join failed: connection timed out.', ws);
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = function () {
      if (socket !== ws) {
        return;
      }
      opened = true;
      clearTimeout(connectTimer);
      send({ type: 'join', name: trimmed });
    };

    ws.onmessage = function (event) {
      if (socket !== ws) {
        return;
      }
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      onRoomMessage(msg);
    };

    ws.onerror = function () {
      // onclose reports the failure
    };

    ws.onclose = function (event) {
      clearTimeout(connectTimer);
      if (socket !== ws) {
        return;
      }
      socket = null;
      if (!opened) {
        resetMenu('Join failed: could not reach the room. Check the URL and that the host is online.');
        return;
      }
      resetMenu('Disconnected' + (event && event.reason ? ': ' + event.reason : '.'));
    };
  }

  /** Messages posted by the UI (uno.js, ludo.js, bluff.js). */
  function onUiMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }
    switch (message.type) {
      case 'ready':
        publish();
        break;
      case 'setGuiMode':
        if (message.mode === 'ultra' || message.mode === 'low' || message.mode === 'high') {
          state = Object.assign({}, state, { guiMode: message.mode });
          publish();
        }
        break;
      case 'host':
        setStatus('This page can only join. Host the room from the Anshin sidebar in VS Code.');
        break;
      case 'join':
        join(message.name, message.url);
        break;
      case 'action':
        send({ type: 'action', action: message.action });
        break;
      case 'leave':
        closeSocket();
        resetMenu('Left the room.');
        break;
      default:
        // setGame, startGame and copyJoinUrl are host-only or handled by the page.
        break;
    }
  }

  window.acquireVsCodeApi = function () {
    return {
      postMessage: onUiMessage,
      getState: function () {
        return undefined;
      },
      setState: function () {},
    };
  };
})();
