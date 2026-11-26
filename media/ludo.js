(function () {
  var post = function () {
    return undefined;
  };
  var built = false;
  var prevById = {};
  var animating = {};
  var pendingGame = null;

  var STEP_MS = 160;

  /** High: virtual 5×5 spots inside the nest — (2,2), (2,4), (4,2), (4,4). */
  var YARD_SPOTS_HIGH = [
    { left: '30%', top: '30%' },
    { left: '70%', top: '30%' },
    { left: '30%', top: '70%' },
    { left: '70%', top: '70%' },
  ];

  /** Low stealth: one centered row of four dots. */
  var YARD_SPOTS_LOW = [
    { left: '20%', top: '50%' },
    { left: '40%', top: '50%' },
    { left: '60%', top: '50%' },
    { left: '80%', top: '50%' },
  ];

  var boardMeta = null;

  function isHighGui() {
    return document.body.classList.contains('gui-high');
  }

  function yardSpots() {
    return isHighGui() ? YARD_SPOTS_HIGH : YARD_SPOTS_LOW;
  }

  function layout() {
    if (!boardMeta) {
      boardMeta = boardData();
    }
    if (!boardMeta) {
      throw new Error('Ludo board payload missing');
    }
    return boardMeta;
  }

  function bind(send) {
    post = send;
    var roll = document.getElementById('ludoRoll');
    var leave = document.getElementById('ludoLeave');
    if (roll && !roll.dataset.bound) {
      roll.dataset.bound = '1';
      roll.addEventListener('click', function () {
        post({ type: 'action', action: { type: 'roll' } });
      });
    }
    if (leave && !leave.dataset.bound) {
      leave.dataset.bound = '1';
      leave.addEventListener('click', function () {
        post({ type: 'leave' });
      });
    }
  }

  function boardData() {
    var node = document.getElementById('ludo-board');
    if (!node || !node.textContent) {
      return null;
    }
    try {
      var parsed = JSON.parse(node.textContent);
      if (parsed && Array.isArray(parsed.cells) && parsed.startIndex && parsed.yardCorners) {
        return parsed;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  function isYardNest(cell) {
    var corners = layout().yardCorners;
    if (cell.kind !== 'yard' || !cell.color || !corners[cell.color]) {
      return false;
    }
    var corner = corners[cell.color];
    var localRow = cell.row - corner[0];
    var localCol = cell.col - corner[1];
    return localRow >= 1 && localRow <= 4 && localCol >= 1 && localCol <= 4;
  }

  function samePlace(a, b) {
    return a && b && a.zone === b.zone && a.index === b.index && a.color === b.color;
  }

  function progressOf(token) {
    var meta = layout();
    if (token.zone === 'yard') {
      return -1;
    }
    if (token.zone === 'track') {
      return (token.index - meta.startIndex[token.color] + meta.trackLength) % meta.trackLength;
    }
    if (token.zone === 'home') {
      return 51 + token.index;
    }
    return meta.done;
  }

  function viewAt(color, progress) {
    var meta = layout();
    if (progress < 0) {
      return { zone: 'yard', index: 0, color: color };
    }
    if (progress <= meta.lastTrack) {
      return {
        zone: 'track',
        index: (meta.startIndex[color] + progress) % meta.trackLength,
        color: color,
      };
    }
    if (progress < meta.done) {
      return { zone: 'home', index: progress - 51, color: color };
    }
    return { zone: 'done', index: null, color: color };
  }

  /** Intermediate board views from previous progress to next (inclusive of destination). */
  function pathViews(fromToken, toToken) {
    var from = progressOf(fromToken);
    var to = progressOf(toToken);
    var color = toToken.color;
    var steps = [];

    if (from < 0 && to >= 0) {
      steps.push(viewAt(color, 0));
      return steps;
    }

    /* Capture / sent home: fly back without stepping the whole track. */
    if (to < 0 && from >= 0) {
      steps.push({
        zone: 'yard',
        index: toToken.index,
        color: color,
      });
      return steps;
    }

    if (to === from) {
      return steps;
    }

    var dir = to > from ? 1 : -1;
    for (var p = from + dir; dir > 0 ? p <= to : p >= to; p += dir) {
      steps.push(viewAt(color, p));
    }
    return steps;
  }

  function ensureBoard() {
    var board = document.getElementById('ludoBoard');
    if (!board || built) {
      return board;
    }
    var meta = layout();
    meta.cells.forEach(function (cell) {
      var el = document.createElement('div');
      el.className = 'ludo-cell ' + cell.kind;
      if (cell.color) {
        el.classList.add(cell.color);
      }
      if (cell.star) {
        el.classList.add('star');
      }
      if (cell.start) {
        el.classList.add('start');
      }
      if (isYardNest(cell)) {
        el.classList.add('nest');
      }
      el.style.gridRow = String(cell.row + 1);
      el.style.gridColumn = String(cell.col + 1);
      el.dataset.kind = cell.kind;
      if (cell.trackIndex !== undefined) {
        el.dataset.track = String(cell.trackIndex);
      }
      if (cell.homeStep !== undefined) {
        el.dataset.home = String(cell.homeStep);
      }
      if (cell.yardSlot !== undefined) {
        el.dataset.slot = String(cell.yardSlot);
      }
      if (cell.color) {
        el.dataset.color = cell.color;
      }
      board.appendChild(el);
    });
    Object.keys(meta.yardCorners).forEach(function (color) {
      var corner = meta.yardCorners[color];
      var nest = document.createElement('div');
      nest.className = 'ludo-yard-nest ' + color;
      nest.dataset.color = color;
      nest.setAttribute('aria-hidden', 'true');
      nest.style.gridRow = corner[0] + 2 + ' / span 4';
      nest.style.gridColumn = corner[1] + 2 + ' / span 4';
      YARD_SPOTS_HIGH.forEach(function (spot, slot) {
        var pad = document.createElement('div');
        pad.className = 'ludo-yard-pad';
        pad.dataset.slot = String(slot);
        pad.style.left = spot.left;
        pad.style.top = spot.top;
        nest.appendChild(pad);
      });
      board.appendChild(nest);
    });
    var homeTri = document.createElement('div');
    homeTri.className = 'ludo-home-tri';
    homeTri.setAttribute('aria-hidden', 'true');
    board.appendChild(homeTri);
    built = true;
    return board;
  }

  function findCell(board, token) {
    var cells = board.querySelectorAll('.ludo-cell');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      if (
        token.zone === 'done' &&
        cell.dataset.kind === 'center' &&
        cell.style.gridRow === '8' &&
        cell.style.gridColumn === '8'
      ) {
        return cell;
      }
      if (token.zone === 'track' && cell.dataset.kind === 'track' && cell.dataset.track === String(token.index)) {
        return cell;
      }
      if (
        token.zone === 'home' &&
        cell.dataset.kind === 'home' &&
        cell.dataset.color === token.color &&
        cell.dataset.home === String(token.index)
      ) {
        return cell;
      }
      if (
        token.zone === 'yard' &&
        cell.dataset.kind === 'yard' &&
        cell.dataset.color === token.color &&
        cell.dataset.slot === String(token.index)
      ) {
        return cell;
      }
    }
    return null;
  }

  function findYardNest(board, color) {
    return board.querySelector('.ludo-yard-nest.' + color);
  }

  /**
   * Absolute tokens are positioned against the board's padding box.
   * Use clientWidth/Height (not getBoundingClientRect) so a thick board
   * border does not shift the path off the grid cells.
   */
  function cellSize(board) {
    return {
      w: board.clientWidth / 15,
      h: board.clientHeight / 15,
    };
  }

  function cellCenter(board, row, col) {
    var size = cellSize(board);
    return {
      x: (col + 0.5) * size.w,
      y: (row + 0.5) * size.h,
      row: row,
      col: col,
    };
  }

  function gridPosForView(board, token) {
    if (token.zone === 'yard') {
      return null;
    }
    var cell = findCell(board, token);
    if (!cell) {
      return null;
    }
    return {
      row: parseInt(cell.style.gridRow, 10) - 1,
      col: parseInt(cell.style.gridColumn, 10) - 1,
    };
  }

  function boardPoint(board, token) {
    if (token.zone === 'yard') {
      var spot = yardSpots()[token.index];
      var corner = layout().yardCorners[token.color];
      if (!spot || !corner) {
        return null;
      }
      var size = cellSize(board);
      /* Nest covers local 1–4 of the 6×6 yard. */
      var nestLeft = (corner[1] + 1) * size.w;
      var nestTop = (corner[0] + 1) * size.h;
      var nestW = 4 * size.w;
      var nestH = 4 * size.h;
      return {
        x: nestLeft + nestW * (parseFloat(spot.left) / 100),
        y: nestTop + nestH * (parseFloat(spot.top) / 100),
        row: null,
        col: null,
      };
    }
    var grid = gridPosForView(board, token);
    if (!grid) {
      return null;
    }
    return cellCenter(board, grid.row, grid.col);
  }

  /**
   * Track corners are diagonally adjacent cells. Straight lerps cut through
   * yards/center — insert the shared grid-line corner so motion is axis-aligned.
   */
  function withCornerKnees(board, points) {
    var size = cellSize(board);
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var cur = points[i];
      if (!cur) {
        continue;
      }
      if (out.length) {
        var prev = out[out.length - 1];
        if (
          prev.row != null &&
          cur.row != null &&
          prev.row !== cur.row &&
          prev.col !== cur.col
        ) {
          out.push({
            x: Math.max(prev.col, cur.col) * size.w,
            y: Math.max(prev.row, cur.row) * size.h,
            row: null,
            col: null,
          });
        }
      }
      out.push(cur);
    }
    return out;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function pointOnPath(points, t) {
    if (points.length === 1) {
      return points[0];
    }
    var segs = [];
    var total = 0;
    for (var i = 0; i < points.length - 1; i++) {
      var dx = points[i + 1].x - points[i].x;
      var dy = points[i + 1].y - points[i].y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      segs.push({ len: len, from: points[i], to: points[i + 1] });
      total += len;
    }
    var dist = Math.max(0, Math.min(1, t)) * total;
    for (var s = 0; s < segs.length; s++) {
      if (dist <= segs[s].len || s === segs.length - 1) {
        var u = segs[s].len ? dist / segs[s].len : 1;
        return {
          x: segs[s].from.x + (segs[s].to.x - segs[s].from.x) * u,
          y: segs[s].from.y + (segs[s].to.y - segs[s].from.y) * u,
        };
      }
      dist -= segs[s].len;
    }
    return points[points.length - 1];
  }

  function cancelAnimation(id) {
    var entry = animating[id];
    if (!entry) {
      return;
    }
    if (entry.el && entry.el.parentNode) {
      entry.el.remove();
    }
    delete animating[id];
  }

  function cancelAnimations(ids) {
    (ids || []).forEach(function (id) {
      cancelAnimation(id);
    });
  }

  function animateToken(board, token, fromToken, onDone) {
    var startPt = boardPoint(board, fromToken);
    var views = pathViews(fromToken, token);
    var raw = [startPt];
    views.forEach(function (step) {
      var view = step.zone === 'yard' ? { zone: 'yard', index: token.index, color: token.color } : step;
      raw.push(boardPoint(board, view));
    });
    var points = withCornerKnees(board, raw.filter(Boolean));
    if (points.length < 2) {
      onDone();
      return;
    }

    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'ludo-token moving ' + token.color;
    el.disabled = true;
    var size = cellSize(board);
    el.style.width = size.w * 0.58 + 'px';
    el.style.height = size.h * 0.58 + 'px';
    el.style.left = points[0].x + 'px';
    el.style.top = points[0].y + 'px';
    el.style.transform = 'translate(-50%, -50%)';
    board.appendChild(el);

    var duration = Math.max(STEP_MS, (points.length - 1) * STEP_MS);
    var t0 = performance.now();
    animating[token.id] = { el: el };

    function frame(now) {
      if (!animating[token.id] || animating[token.id].el !== el) {
        return;
      }
      var t = Math.min(1, (now - t0) / duration);
      var pos = pointOnPath(points, easeInOutCubic(t));
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }
      el.remove();
      delete animating[token.id];
      onDone();
    }
    requestAnimationFrame(frame);
  }

  function placeToken(parent, token, legal, spot) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'ludo-token ' + token.color;
    el.dataset.tokenId = token.id;
    if (spot) {
      el.classList.add('yard-spot');
      el.style.left = spot.left;
      el.style.top = spot.top;
      el.style.transform = 'translate(-50%, -50%)';
    } else {
      var count = parent.querySelectorAll('.ludo-token:not(.moving)').length;
      el.style.transform = 'translate(calc(-50% + ' + count * 4 + 'px), calc(-50% + ' + count * 3 + 'px))';
    }
    if (legal[token.id]) {
      el.classList.add('legal');
      el.addEventListener('click', function () {
        post({ type: 'action', action: { type: 'move', tokenId: token.id } });
      });
    } else {
      el.disabled = true;
    }
    parent.appendChild(el);
  }

  function paintStatic(board, game, legal, skipIds) {
    skipIds = skipIds || {};
    board.querySelectorAll('.ludo-token:not(.moving)').forEach(function (token) {
      token.remove();
    });
    (game.tokens || []).forEach(function (token) {
      if (animating[token.id] || skipIds[token.id]) {
        return;
      }
      if (token.zone === 'yard') {
        var nest = findYardNest(board, token.color);
        var spot = yardSpots()[token.index];
        if (!nest || !spot) {
          return;
        }
        placeToken(nest, token, legal, spot);
        return;
      }
      var cell = findCell(board, token);
      if (!cell) {
        return;
      }
      placeToken(cell, token, legal, null);
    });
  }

  function updateChrome(game) {
    var dice = document.getElementById('ludoDice');
    var status = document.getElementById('ludoStatus');
    var roll = document.getElementById('ludoRoll');
    var mine = game.currentPlayerId === game.yourPlayerId && !game.winnerId;
    if (roll) {
      /* Server phase alone gates Roll — token flight is cosmetic. Locking on
         animating left bonus rolls (home / capture / 6) unusable if the
         animation was cancelled without onDone. */
      roll.disabled = !mine || game.awaiting !== 'roll';
    }
    if (dice) {
      dice.textContent = game.dice ? 'Dice ' + game.dice : 'Dice';
    }
    if (status) {
      var line = game.status || '';
      if (game.turnDeadline && !game.winnerId) {
        var left = Math.max(0, Math.ceil((game.turnDeadline - Date.now()) / 1000));
        line += (line ? ' · ' : '') + left + 's';
      }
      status.textContent = line;
    }
  }

  function snapshot(token) {
    return {
      id: token.id,
      playerId: token.playerId,
      color: token.color,
      zone: token.zone,
      index: token.index,
    };
  }

  function paintBlockades(board, game) {
    var blocked = {};
    (game.blockedTrackIndexes || []).forEach(function (index) {
      blocked[String(index)] = true;
    });
    board.querySelectorAll('.ludo-cell.track').forEach(function (cell) {
      cell.classList.toggle('blockade', !!blocked[cell.dataset.track]);
    });
  }

  function render(game) {
    var board = ensureBoard();
    if (!board || !game) {
      return;
    }
    pendingGame = game;
    var legalIds = game.legalTokenIds || [];
    var legal = {};
    legalIds.forEach(function (id) {
      legal[id] = true;
    });
    paintBlockades(board, game);

    /* Move phase needs clickable tokens — cancel ghosts that would hide them. */
    if (game.awaiting === 'move' && legalIds.length) {
      cancelAnimations(legalIds);
    }

    var nextById = {};
    (game.tokens || []).forEach(function (token) {
      nextById[token.id] = snapshot(token);
    });

    var movers = [];
    Object.keys(nextById).forEach(function (id) {
      var next = nextById[id];
      var prev = prevById[id];
      if (prev && !samePlace(prev, next) && !animating[id]) {
        movers.push({ from: prev, to: next });
      }
    });

    /* Animating ids skipped as movers: snap them to the latest server place. */
    Object.keys(animating).forEach(function (id) {
      var next = nextById[id];
      var prev = prevById[id];
      if (!next) {
        cancelAnimation(id);
        return;
      }
      if (prev && !samePlace(prev, next) && !movers.some(function (move) {
        return move.to.id === id;
      })) {
        cancelAnimation(id);
      }
    });

    if (movers.length) {
      var skipIds = {};
      movers.forEach(function (move) {
        skipIds[move.to.id] = true;
      });
      paintStatic(board, game, legal, skipIds);
      updateChrome(game);
      var remaining = movers.length;
      movers.forEach(function (move) {
        animateToken(board, move.to, move.from, function () {
          remaining -= 1;
          if (remaining <= 0 && pendingGame) {
            paintStatic(board, pendingGame, legalFrom(pendingGame));
            updateChrome(pendingGame);
          }
        });
      });
      prevById = nextById;
      return;
    }

    prevById = nextById;
    paintStatic(board, game, legal);
    updateChrome(game);
  }

  function legalFrom(game) {
    var legal = {};
    (game.legalTokenIds || []).forEach(function (id) {
      legal[id] = true;
    });
    return legal;
  }

  window.AnshinLudo = {
    bind: bind,
    render: render,
  };
})();
