import assert from 'assert';
import crypto from 'crypto';
import net from 'net';
import { describe, it } from 'node:test';
import WebSocket from 'ws';
import { canPlay } from './engine';
import { ServerMessage } from './protocol';
import { RoomServer } from './roomServer';
import { PersonalizedState } from './types';

const TOKEN = 'room-token-test';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

class Inbox {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<(msg: ServerMessage) => void> = [];

  constructor(ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async until(type: ServerMessage['type'], timeoutMs = 2000): Promise<ServerMessage> {
    const start = Date.now();
    for (;;) {
      const left = timeoutMs - (Date.now() - start);
      if (left <= 0) {
        throw new Error(`timeout waiting for ${type}`);
      }
      const msg = await this.next(left);
      if (msg.type === type) {
        return msg;
      }
    }
  }
}

async function started(options: {
  persistent?: boolean;
  publicHost?: string;
  publicUrl?: string;
  heartbeatMs?: number;
  returnToLobbyMs?: number;
  reconnectMs?: number;
  turnMs?: number;
  port?: number;
}): Promise<RoomServer> {
  return RoomServer.start({
    port: options.port ?? 0,
    bindHost: '127.0.0.1',
    roomToken: TOKEN,
    persistent: options.persistent,
    // Default the advertised host to loopback. The listener is 127.0.0.1, so a LAN URL would not connect.
    publicHost: options.publicHost ?? (options.publicUrl ? undefined : '127.0.0.1'),
    publicUrl: options.publicUrl,
    heartbeatMs: options.heartbeatMs ?? 0,
    returnToLobbyMs: options.returnToLobbyMs,
    reconnectMs: options.reconnectMs ?? 0,
    turnMs: options.turnMs ?? 0,
    // A scripted hand can send more than the human rate cap in one second.
    maxMessageRate: 0,
  });
}

function openSilentSocket(port: number, token: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write(
        `GET /?t=${token} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n` +
          `\r\n`
      );
    });
    const onData = (): void => {
      socket.off('data', onData);
      resolve(socket);
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

describe('RoomServer', () => {
  it('closes a wrong token with 4001', async () => {
    const server = await started({});
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.getPort()}/?t=wrong`);
      ws.on('error', () => undefined);
      const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.once('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });
      assert.strictEqual(closed.code, 4001);
      assert.strictEqual(closed.reason, 'Unauthorized');
    } finally {
      await server.dispose();
    }
  });

  it('rejects when the port is already in use', async () => {
    const first = await started({});
    try {
      await assert.rejects(
        () =>
          withTimeout(
            RoomServer.start({
              port: first.getPort(),
              bindHost: '127.0.0.1',
              roomToken: TOKEN,
              heartbeatMs: 0,
            }),
            2000
          ),
        (err: unknown) => {
          assert.strictEqual((err as NodeJS.ErrnoException).code, 'EADDRINUSE');
          return true;
        }
      );
    } finally {
      await first.dispose();
    }
  });

  it('dispose finishes while a socket has not joined', async () => {
    const server = await started({});
    const ws = await connect(server.getJoinUrl());
    ws.on('error', () => undefined);
    try {
      await withTimeout(server.dispose(), 2000);
      assert.notStrictEqual(ws.readyState, WebSocket.OPEN);
    } finally {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
  });

  it('advertises only the public host or public URL', async () => {
    const byHost = await started({ publicHost: '203.0.113.10' });
    try {
      const urls = byHost.getJoinUrls();
      assert.strictEqual(urls.length, 1);
      assert.match(urls[0], /^ws:\/\/203\.0\.113\.10:\d+\/\?t=room-token-test$/);
    } finally {
      await byHost.dispose();
    }

    const byUrl = await started({ publicUrl: 'wss://uno.example.com/room', publicHost: '203.0.113.10' });
    try {
      const urls = byUrl.getJoinUrls();
      assert.deepStrictEqual(urls, ['wss://uno.example.com/room?t=room-token-test']);
    } finally {
      await byUrl.dispose();
    }
  });

  it('terminates a socket that never answers a ping', async () => {
    const server = await started({ heartbeatMs: 40 });
    try {
      const socket = await openSilentSocket(server.getPort(), TOKEN);
      await withTimeout(
        new Promise<void>((resolve) => {
          socket.once('close', () => resolve());
          socket.once('error', () => resolve());
        }),
        2000
      );
    } finally {
      await server.dispose();
    }
  });

  it('promotes another seat when the persistent host leaves the lobby', async () => {
    const server = await started({ persistent: true });
    try {
      const host = await connect(server.getJoinUrl());
      const guest = await connect(server.getJoinUrl());
      const hostBox = new Inbox(host);
      const guestBox = new Inbox(guest);
      send(host, { type: 'join', name: 'Ada' });
      const first = await hostBox.until('lobby');
      assert.strictEqual(first.type, 'lobby');
      if (first.type === 'lobby') {
        assert.strictEqual(first.youAreHost, true);
      }
      send(guest, { type: 'join', name: 'Bea' });
      const both = await hostBox.until('lobby');
      assert.strictEqual(both.type, 'lobby');
      if (both.type === 'lobby') {
        assert.strictEqual(both.players.length, 2);
      }
      await guestBox.until('lobby');
      send(host, { type: 'leave' });
      const promoted = await guestBox.until('lobby');
      assert.strictEqual(promoted.type, 'lobby');
      if (promoted.type === 'lobby') {
        assert.strictEqual(promoted.youAreHost, true);
        assert.strictEqual(promoted.players.length, 1);
        assert.strictEqual(promoted.players[0].name, 'Bea');
      }
      guest.close();
    } finally {
      await server.dispose();
    }
  });

  it('shows the winner then returns the same seats to the persistent lobby', async () => {
    const server = await started({ persistent: true, returnToLobbyMs: 30 });
    let host: WebSocket | undefined;
    let guest: WebSocket | undefined;
    try {
      host = await connect(server.getJoinUrl());
      guest = await connect(server.getJoinUrl());
      host.on('error', () => undefined);
      guest.on('error', () => undefined);
      const hostBox = new Inbox(host);
      const guestBox = new Inbox(guest);
      send(host, { type: 'join', name: 'Ada' });
      await hostBox.until('lobby');
      send(guest, { type: 'join', name: 'Bea' });
      await hostBox.until('lobby');
      await guestBox.until('lobby');
      send(host, { type: 'start', guaranteeSpecial: false, cardsPerPlayer: 1 });

      let [left, right] = await Promise.all([hostBox.next(), guestBox.next()]);
      let winnerName = '';
      for (let step = 0; step < 400; step++) {
        if (left.type === 'gameOver' || right.type === 'gameOver') {
          const over = left.type === 'gameOver' ? left : right;
          assert.strictEqual(over.type, 'gameOver');
          if (over.type === 'gameOver') {
            winnerName = over.winnerName;
          }
          break;
        }
        if (left.type !== 'state' || right.type !== 'state') {
          const reason = left.type === 'error' ? left.reason : right.type === 'error' ? right.reason : left.type;
          throw new Error(`unexpected message: ${reason}`);
        }
        const state: PersonalizedState =
          left.state.currentPlayerId === left.state.yourPlayerId ? left.state : right.state;
        const ws = left.state.currentPlayerId === left.state.yourPlayerId ? host : guest;
        if (state.awaitingWildColor) {
          send(ws, { type: 'chooseColor', color: 'red' });
        } else {
          const card = state.hand.find((item) => canPlay(item, state.discard, state.currentColor));
          if (card && (card.value === 'wild' || card.value === 'wild4')) {
            send(ws, { type: 'play', cardId: card.id, wildColor: 'red' });
          } else if (card) {
            send(ws, { type: 'play', cardId: card.id });
          } else {
            send(ws, { type: 'draw' });
          }
        }
        [left, right] = await Promise.all([hostBox.next(), guestBox.next()]);
      }
      if (!winnerName && (left.type === 'gameOver' || right.type === 'gameOver')) {
        const over = left.type === 'gameOver' ? left : right;
        if (over.type === 'gameOver') {
          winnerName = over.winnerName;
        }
      }
      assert.ok(winnerName, 'game did not finish');

      const lobby = await hostBox.until('lobby', 2000);
      assert.strictEqual(lobby.type, 'lobby');
      if (lobby.type === 'lobby') {
        assert.strictEqual(lobby.players.length, 2);
      }
      assert.strictEqual(host.readyState, WebSocket.OPEN);
      assert.strictEqual(guest.readyState, WebSocket.OPEN);
    } finally {
      host?.close();
      guest?.close();
      await server.dispose();
    }
  });

  it('resumes the same player after a dropped socket', async () => {
    const server = await started({ persistent: true, reconnectMs: 400 });
    const host = await connect(server.getJoinUrl());
    const guest = await connect(server.getJoinUrl());
    try {
      const hostBox = new Inbox(host);
      const guestBox = new Inbox(guest);
      send(host, { type: 'join', name: 'Ada' });
      await hostBox.until('lobby');
      send(guest, { type: 'join', name: 'Bea' });
      const joined = await guestBox.until('lobby');
      assert.strictEqual(joined.type, 'lobby');
      const token = joined.type === 'lobby' ? joined.resumeToken ?? '' : '';
      const playerId = joined.type === 'lobby' ? joined.yourPlayerId : '';
      assert.ok(token);
      send(host, { type: 'start', guaranteeSpecial: false, cardsPerPlayer: 1 });
      await hostBox.until('state');
      const before = await guestBox.until('state');
      assert.strictEqual(before.type, 'state');
      const handIds = before.type === 'state' ? before.state.hand.map((card) => card.id) : [];
      guest.close();
      const away = await hostBox.until('state');
      assert.strictEqual(away.type, 'state');
      if (away.type === 'state') {
        assert.strictEqual(away.state.opponents[0]?.connected, false);
      }

      const again = await connect(server.getJoinUrl());
      const againBox = new Inbox(again);
      send(again, { type: 'resume', token });
      const restored = await againBox.until('state');
      assert.strictEqual(restored.type, 'state');
      if (restored.type === 'state') {
        assert.strictEqual(restored.state.yourPlayerId, playerId);
        assert.deepStrictEqual(restored.state.hand.map((card) => card.id), handIds);
      }
      again.close();
    } finally {
      host.close();
      guest.close();
      await server.dispose();
    }
  });

  it('drops a seat when the grace period ends and continues with two players', async () => {
    const server = await started({ persistent: true, reconnectMs: 40 });
    const sockets = await Promise.all([connect(server.getJoinUrl()), connect(server.getJoinUrl()), connect(server.getJoinUrl())]);
    try {
      const boxes = sockets.map((ws) => new Inbox(ws));
      send(sockets[0], { type: 'join', name: 'Ada' });
      await boxes[0].until('lobby');
      send(sockets[1], { type: 'join', name: 'Bea' });
      await boxes[0].until('lobby');
      send(sockets[2], { type: 'join', name: 'Cy' });
      await boxes[0].until('lobby');
      send(sockets[0], { type: 'start', guaranteeSpecial: false, cardsPerPlayer: 1 });
      await boxes[0].until('state');
      sockets[2].close();
      let players = 3;
      const deadline = Date.now() + 1000;
      while (players > 2 && Date.now() < deadline) {
        const msg = await boxes[0].until('state', 1000);
        if (msg.type === 'state') {
          players = msg.state.playerCount;
        }
      }
      assert.strictEqual(players, 2);
    } finally {
      for (const ws of sockets) {
        ws.close();
      }
      await server.dispose();
    }
  });

  it('awards the hand when grace leaves a single player', async () => {
    const server = await started({ persistent: true, reconnectMs: 40 });
    const host = await connect(server.getJoinUrl());
    const guest = await connect(server.getJoinUrl());
    try {
      const hostBox = new Inbox(host);
      const guestBox = new Inbox(guest);
      send(host, { type: 'join', name: 'Ada' });
      await hostBox.until('lobby');
      send(guest, { type: 'join', name: 'Bea' });
      await guestBox.until('lobby');
      send(host, { type: 'start', guaranteeSpecial: false, cardsPerPlayer: 1 });
      await hostBox.until('state');
      guest.close();
      const over = await hostBox.until('gameOver', 1000);
      assert.strictEqual(over.type, 'gameOver');
      if (over.type === 'gameOver') {
        assert.strictEqual(over.winnerName, 'Ada');
      }
    } finally {
      host.close();
      guest.close();
      await server.dispose();
    }
  });

  it('removes a seat immediately on leave', async () => {
    const server = await started({ persistent: true, reconnectMs: 500 });
    const host = await connect(server.getJoinUrl());
    const guest = await connect(server.getJoinUrl());
    try {
      const hostBox = new Inbox(host);
      const guestBox = new Inbox(guest);
      send(host, { type: 'join', name: 'Ada' });
      await hostBox.until('lobby');
      send(guest, { type: 'join', name: 'Bea' });
      await guestBox.until('lobby');
      const startedAt = Date.now();
      send(host, { type: 'leave' });
      const promoted = await guestBox.until('lobby');
      assert.ok(Date.now() - startedAt < 400);
      assert.strictEqual(promoted.type, 'lobby');
      if (promoted.type === 'lobby') {
        assert.strictEqual(promoted.youAreHost, true);
        assert.strictEqual(promoted.players.length, 1);
      }
    } finally {
      host.close();
      guest.close();
      await server.dispose();
    }
  });

  it('draws for a player when the turn clock expires', async () => {
    const server = await started({ persistent: true, turnMs: 40 });
    const host = await connect(server.getJoinUrl());
    const guest = await connect(server.getJoinUrl());
    try {
      const hostBox = new Inbox(host);
      const guestBox = new Inbox(guest);
      send(host, { type: 'join', name: 'Ada' });
      await hostBox.until('lobby');
      send(guest, { type: 'join', name: 'Bea' });
      await guestBox.until('lobby');
      send(host, { type: 'start', guaranteeSpecial: false, cardsPerPlayer: 1 });
      let timedOut = false;
      const deadline = Date.now() + 1000;
      while (!timedOut && Date.now() < deadline) {
        const msg = await hostBox.next(1000);
        if (msg.type === 'state' && msg.state.status.includes('timed out')) {
          timedOut = true;
        }
      }
      assert.strictEqual(timedOut, true);
    } finally {
      host.close();
      guest.close();
      await server.dispose();
    }
  });

  it('seats a mid-game join when the hand ends', async () => {
    const server = await started({ persistent: true, returnToLobbyMs: 30 });
    const host = await connect(server.getJoinUrl());
    const guest = await connect(server.getJoinUrl());
    const late = await connect(server.getJoinUrl());
    try {
      const hostBox = new Inbox(host);
      const guestBox = new Inbox(guest);
      const lateBox = new Inbox(late);
      send(host, { type: 'join', name: 'Ada' });
      await hostBox.until('lobby');
      send(guest, { type: 'join', name: 'Bea' });
      await hostBox.until('lobby');
      await guestBox.until('lobby');
      send(host, { type: 'start', guaranteeSpecial: false, cardsPerPlayer: 1 });
      let [left, right] = await Promise.all([hostBox.next(), guestBox.next()]);
      send(late, { type: 'join', name: 'Cy' });
      const waiting = await lateBox.until('waiting');
      assert.strictEqual(waiting.type, 'waiting');

      let finished = left.type === 'gameOver' || right.type === 'gameOver';
      for (let step = 0; step < 400 && !finished; step++) {
        if (left.type !== 'state' || right.type !== 'state') {
          throw new Error('unexpected message before the hand ended');
        }
        const state = left.state.currentPlayerId === left.state.yourPlayerId ? left.state : right.state;
        const ws = left.state.currentPlayerId === left.state.yourPlayerId ? host : guest;
        if (state.awaitingWildColor) {
          send(ws, { type: 'chooseColor', color: 'red' });
        } else {
          const card = state.hand.find((item) => canPlay(item, state.discard, state.currentColor));
          if (card && (card.value === 'wild' || card.value === 'wild4')) {
            send(ws, { type: 'play', cardId: card.id, wildColor: 'red' });
          } else if (card) {
            send(ws, { type: 'play', cardId: card.id });
          } else {
            send(ws, { type: 'draw' });
          }
        }
        [left, right] = await Promise.all([hostBox.next(), guestBox.next()]);
        finished = left.type === 'gameOver' || right.type === 'gameOver';
      }
      assert.strictEqual(finished, true);
      const seated = await lateBox.until('lobby', 2000);
      assert.strictEqual(seated.type, 'lobby');
      if (seated.type === 'lobby') {
        assert.strictEqual(seated.players.length, 3);
        assert.ok(seated.players.some((player) => player.name === 'Cy'));
      }
    } finally {
      host.close();
      guest.close();
      late.close();
      await server.dispose();
    }
  });

  it('returns a non-persistent room to the lobby and seats a late join', async () => {
    const server = await started({ persistent: false, returnToLobbyMs: 30 });
    const host = await connect(server.getJoinUrl());
    const guest = await connect(server.getJoinUrl());
    const late = await connect(server.getJoinUrl());
    try {
      const hostBox = new Inbox(host);
      const guestBox = new Inbox(guest);
      const lateBox = new Inbox(late);
      send(host, { type: 'join', name: 'Ada' });
      await hostBox.until('lobby');
      send(guest, { type: 'join', name: 'Bea' });
      await hostBox.until('lobby');
      await guestBox.until('lobby');
      send(host, { type: 'start', guaranteeSpecial: false, cardsPerPlayer: 1 });
      let [left, right] = await Promise.all([hostBox.next(), guestBox.next()]);
      send(late, { type: 'join', name: 'Cy' });
      const waiting = await lateBox.until('waiting');
      assert.strictEqual(waiting.type, 'waiting');

      let finished = left.type === 'gameOver' || right.type === 'gameOver';
      for (let step = 0; step < 400 && !finished; step++) {
        if (left.type !== 'state' || right.type !== 'state') {
          throw new Error('unexpected message before the hand ended');
        }
        const state = left.state.currentPlayerId === left.state.yourPlayerId ? left.state : right.state;
        const ws = left.state.currentPlayerId === left.state.yourPlayerId ? host : guest;
        if (state.awaitingWildColor) {
          send(ws, { type: 'chooseColor', color: 'red' });
        } else {
          const card = state.hand.find((item) => canPlay(item, state.discard, state.currentColor));
          if (card && (card.value === 'wild' || card.value === 'wild4')) {
            send(ws, { type: 'play', cardId: card.id, wildColor: 'red' });
          } else if (card) {
            send(ws, { type: 'play', cardId: card.id });
          } else {
            send(ws, { type: 'draw' });
          }
        }
        [left, right] = await Promise.all([hostBox.next(), guestBox.next()]);
        finished = left.type === 'gameOver' || right.type === 'gameOver';
      }
      assert.strictEqual(finished, true);
      const lobby = await hostBox.until('lobby', 2000);
      assert.strictEqual(lobby.type, 'lobby');
      if (lobby.type === 'lobby') {
        assert.deepStrictEqual(
          lobby.players.map((player) => player.name).sort(),
          ['Ada', 'Bea', 'Cy']
        );
      }
      assert.strictEqual(host.readyState, WebSocket.OPEN);
      assert.strictEqual(guest.readyState, WebSocket.OPEN);
    } finally {
      host.close();
      guest.close();
      late.close();
      await server.dispose();
    }
  });
});
