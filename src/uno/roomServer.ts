import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  callUno,
  catchUno,
  chooseOpeningColor,
  createGame,
  drawCard,
  dropPlayer,
  personalize,
  playCard,
} from './engine';
import { formatJoinUrls, getLanIPv4s, DEFAULT_UNO_PORT } from './lan';
import { ClientMessage, LobbyPlayer, parseClientMessage, ServerMessage } from './protocol';
import { GameSnapshot, PersonalizedState, UnoColor } from './types';
import {
  appendRoomToken,
  extractRoomTokenFromUrl,
  generateRoomToken,
  tokensEqual,
} from './urlAuth';

interface Seat {
  id: string;
  name: string;
  isHost: boolean;
  ws: WebSocket | null;
  resumeToken: string;
  connected: boolean;
}

interface Waiter {
  name: string;
  ws: WebSocket;
}

type Phase = 'lobby' | 'playing' | 'finished' | 'closed';

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_SOCKETS = 8;
const IDLE_JOIN_MS = 5000;
const RATE_WINDOW_MS = 1000;
const RATE_MAX_MESSAGES = 20;
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_RETURN_TO_LOBBY_MS = 4000;
const DEFAULT_RECONNECT_MS = 20_000;
const DEFAULT_TURN_MS = 45_000;
const MAX_PLAYERS = 6;
const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_CAPACITY = 4002;
const CLOSE_IDLE = 4003;
const CLOSE_RATE = 4004;

export interface RoomServerOptions {
  port?: number;
  /** Interface to bind (default 0.0.0.0). */
  bindHost?: string;
  /**
   * When true, the host leaving the lobby promotes another seat and the process stays up.
   * A win returns to the lobby either way.
   */
  persistent?: boolean;
  /** Preferred host in join URLs (e.g. EC2 public IP / DNS). Sole advertised host when set. */
  publicHost?: string;
  /**
   * Full public join base (`ws://` or `wss://`, optional port and path).
   * When set, this is the only advertised URL and `publicHost` is ignored.
   */
  publicUrl?: string;
  /** Shared secret embedded as `?t=` on join URLs. Generated if omitted. */
  roomToken?: string;
  /** Ping interval. `0` disables. Dead sockets are terminated after a missed pong. */
  heartbeatMs?: number;
  /** How long the winner stays on screen before the same seats return to the lobby. */
  returnToLobbyMs?: number;
  /** How long a dropped seat is held. `0` removes it immediately. */
  reconnectMs?: number;
  /** How long the current player has before the server draws for them. `0` disables. */
  turnMs?: number;
  /** Inbound messages allowed per socket each second. `0` disables. */
  maxMessageRate?: number;
}

export class RoomServer {
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly seats = new Map<string, Seat>();
  private readonly bySocket = new Map<WebSocket, string>();
  private readonly waiting = new Map<WebSocket, Waiter>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly intentionalLeave = new WeakSet<WebSocket>();
  private readonly pending = new Set<WebSocket>();
  private readonly idleTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  private readonly rateBuckets = new Map<WebSocket, { count: number; windowStart: number }>();
  private readonly persistent: boolean;
  private readonly roomToken: string;
  private readonly heartbeatMs: number;
  private readonly returnToLobbyMs: number;
  private readonly reconnectMs: number;
  private readonly turnMs: number;
  private maxMessageRate = RATE_MAX_MESSAGES;
  private readonly alive = new WeakSet<WebSocket>();
  private phase: Phase = 'lobby';
  private game: GameSnapshot | null = null;
  private nextId = 1;
  private port = 0;
  private joinUrl = '';
  private joinUrls: string[] = [];
  private disposed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private returnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline: number | null = null;
  private turnToken = 0;

  private constructor(
    httpServer: http.Server,
    wss: WebSocketServer,
    persistent: boolean,
    roomToken: string,
    heartbeatMs: number,
    returnToLobbyMs: number,
    reconnectMs: number,
    turnMs: number
  ) {
    this.httpServer = httpServer;
    this.wss = wss;
    this.persistent = persistent;
    this.roomToken = roomToken;
    this.heartbeatMs = heartbeatMs;
    this.returnToLobbyMs = returnToLobbyMs;
    this.reconnectMs = reconnectMs;
    this.turnMs = turnMs;

    this.wss.on('connection', (ws, req) => {
      this.onConnection(ws, req);
    });
    this.startHeartbeat();
  }

  static async start(options: RoomServerOptions = {}): Promise<RoomServer> {
    const port = options.port ?? DEFAULT_UNO_PORT;
    const bindHost = options.bindHost?.trim() || '0.0.0.0';
    const persistent = options.persistent === true;
    const roomToken = options.roomToken?.trim() || generateRoomToken();

    const httpServer = http.createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });
    // `ws` re-emits HTTP server errors here. Without a listener that emit throws
    // before the listen() rejection runs, and start() never settles.
    wss.on('error', () => undefined);

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => {
          httpServer.removeListener('error', onError);
          reject(err);
        };
        httpServer.once('error', onError);
        httpServer.listen(port, bindHost, () => {
          httpServer.removeListener('error', onError);
          resolve();
        });
      });
    } catch (err) {
      await closeListeners(wss, httpServer);
      throw err;
    }

    const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const returnToLobbyMs = options.returnToLobbyMs ?? DEFAULT_RETURN_TO_LOBBY_MS;
    const reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
    const turnMs = options.turnMs ?? DEFAULT_TURN_MS;
    const room = new RoomServer(
      httpServer,
      wss,
      persistent,
      roomToken,
      heartbeatMs,
      returnToLobbyMs,
      reconnectMs,
      turnMs
    );
    room.maxMessageRate = options.maxMessageRate ?? RATE_MAX_MESSAGES;
    const addr = httpServer.address();
    room.port = typeof addr === 'object' && addr ? addr.port : port;
    room.joinUrls = advertiseJoinUrls(room.port, roomToken, options.publicUrl, options.publicHost);
    room.joinUrl = room.joinUrls[0] ?? appendRoomToken(`ws://127.0.0.1:${room.port}`, roomToken);
    return room;
  }

  getJoinUrl(): string {
    return this.joinUrl;
  }

  getJoinUrls(): string[] {
    return this.joinUrls.slice();
  }

  getPort(): number {
    return this.port;
  }

  getRoomToken(): string {
    return this.roomToken;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.phase = 'closed';
    this.game = null;

    this.clearReturnTimer();
    this.clearTurnClock();
    this.clearAllGrace();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    this.rateBuckets.clear();

    const seats = [...this.seats.values()];
    const pending = [...this.pending];
    const waiting = [...this.waiting.keys()];
    this.seats.clear();
    this.bySocket.clear();
    this.pending.clear();
    this.waiting.clear();
    for (const seat of seats) {
      this.send(seat.ws, { type: 'ended', reason: 'Host closed the room.' });
    }
    for (const ws of waiting) {
      this.send(ws, { type: 'ended', reason: 'Host closed the room.' });
    }
    const openSockets = new Set<WebSocket>([
      ...seats.flatMap((seat) => (seat.ws ? [seat.ws] : [])),
      ...pending,
      ...waiting,
      ...this.wss.clients,
    ]);
    for (const ws of openSockets) {
      ws.terminate();
    }

    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });
    if (this.httpServer.listening) {
      await new Promise<void>((resolve) => {
        this.httpServer.close(() => resolve());
        this.httpServer.closeAllConnections();
      });
    }
  }

  private socketCount(): number {
    let count = this.pending.size + this.waiting.size;
    for (const seat of this.seats.values()) {
      if (seat.ws) {
        count += 1;
      }
    }
    return count;
  }

  private seatFor(ws: WebSocket): Seat | undefined {
    const id = this.bySocket.get(ws);
    if (!id) {
      return undefined;
    }
    return this.seats.get(id);
  }

  private onConnection(ws: WebSocket, req: http.IncomingMessage): void {
    if (this.disposed || this.phase === 'closed') {
      ws.close(CLOSE_UNAUTHORIZED, 'Room closed');
      return;
    }

    const provided = extractRoomTokenFromUrl(req.url ?? '/');
    if (!tokensEqual(this.roomToken, provided)) {
      ws.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
      return;
    }

    if (this.socketCount() >= MAX_SOCKETS) {
      ws.close(CLOSE_CAPACITY, 'Room at capacity');
      return;
    }

    this.pending.add(ws);
    this.attachSocket(ws);
  }

  private clearIdle(ws: WebSocket): void {
    const timer = this.idleTimers.get(ws);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(ws);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatMs <= 0) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (ws.readyState !== WebSocket.OPEN) {
          continue;
        }
        if (!this.alive.has(ws)) {
          ws.terminate();
          continue;
        }
        this.alive.delete(ws);
        ws.ping();
      }
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  private markAlive(ws: WebSocket): void {
    this.alive.add(ws);
  }

  private clearReturnTimer(): void {
    if (this.returnTimer) {
      clearTimeout(this.returnTimer);
      this.returnTimer = null;
    }
  }

  private attachSocket(ws: WebSocket): void {
    this.markAlive(ws);
    ws.on('pong', () => {
      this.markAlive(ws);
    });
    ws.on('error', () => {
      // 'close' follows. An unhandled 'error' event would crash the extension host.
    });

    const idleTimer = setTimeout(() => {
      if (this.pending.has(ws) && !this.bySocket.has(ws) && !this.waiting.has(ws)) {
        this.send(ws, { type: 'error', reason: 'Join timed out.' });
        ws.close(CLOSE_IDLE, 'Join timed out');
      }
    }, IDLE_JOIN_MS);
    this.idleTimers.set(ws, idleTimer);

    ws.on('message', (data) => {
      this.markAlive(ws);
      if (!this.allowMessage(ws)) {
        this.send(ws, { type: 'error', reason: 'Too many messages.' });
        ws.close(CLOSE_RATE, 'Rate limited');
        return;
      }
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const msg = parseClientMessage(text);
      if (!msg) {
        this.send(ws, { type: 'error', reason: 'Invalid message.' });
        return;
      }
      try {
        this.handleMessage(ws, msg);
      } catch {
        this.send(ws, { type: 'error', reason: 'Room error.' });
      }
    });

    ws.on('close', () => {
      this.clearIdle(ws);
      this.pending.delete(ws);
      this.rateBuckets.delete(ws);
      this.handleDisconnect(ws);
    });
  }

  private allowMessage(ws: WebSocket): boolean {
    if (this.maxMessageRate <= 0) {
      return true;
    }
    const now = Date.now();
    let bucket = this.rateBuckets.get(ws);
    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
      bucket = { count: 0, windowStart: now };
      this.rateBuckets.set(ws, bucket);
    }
    bucket.count += 1;
    return bucket.count <= this.maxMessageRate;
  }

  private handleMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, msg.name);
        break;
      case 'start':
        this.handleStart(ws, msg.guaranteeSpecial, msg.cardsPerPlayer);
        break;
      case 'play':
        this.handlePlay(ws, msg.cardId, msg.wildColor);
        break;
      case 'draw':
        this.handleDraw(ws);
        break;
      case 'chooseColor':
        this.handleChooseColor(ws, msg.color);
        break;
      case 'uno':
        this.handleUno(ws);
        break;
      case 'catch':
        this.handleCatch(ws);
        break;
      case 'leave':
        this.intentionalLeave.add(ws);
        ws.close();
        break;
      case 'resume':
        this.handleResume(ws, msg.token);
        break;
    }
  }

  private handleJoin(ws: WebSocket, name: string): void {
    if (this.phase === 'closed' || this.disposed) {
      this.send(ws, { type: 'error', reason: 'Room is closed.' });
      ws.close();
      return;
    }
    if (this.seatFor(ws) || this.waiting.has(ws)) {
      this.send(ws, { type: 'error', reason: 'Already joined.' });
      return;
    }
    if (this.phase !== 'lobby') {
      this.enqueueWaiter(ws, name);
      return;
    }
    if (this.seats.size >= MAX_PLAYERS) {
      this.send(ws, { type: 'error', reason: 'Room is full (max 6).' });
      ws.close();
      return;
    }

    this.clearIdle(ws);
    this.pending.delete(ws);
    this.addSeat(ws, name);
    this.broadcastLobby();
  }

  private enqueueWaiter(ws: WebSocket, name: string): void {
    if (this.seats.size + this.waiting.size >= MAX_PLAYERS) {
      this.send(ws, { type: 'error', reason: 'Room is full (max 6).' });
      ws.close();
      return;
    }
    this.clearIdle(ws);
    this.pending.delete(ws);
    this.waiting.set(ws, { name, ws });
    this.send(ws, { type: 'waiting', status: "You'll join when this hand ends." });
  }

  private handleResume(ws: WebSocket, token: string): void {
    const seat = [...this.seats.values()].find((item) => tokensEqual(item.resumeToken, token));
    if (!seat || seat.connected) {
      this.send(ws, { type: 'error', reason: seat ? 'Already connected.' : 'Resume expired.' });
      ws.close();
      return;
    }

    this.clearIdle(ws);
    this.pending.delete(ws);
    this.clearGrace(seat.id);
    const previous = seat.ws;
    if (previous && previous !== ws) {
      this.bySocket.delete(previous);
    }
    seat.ws = ws;
    seat.connected = true;
    this.bySocket.set(ws, seat.id);
    if (previous && previous !== ws) {
      previous.close();
    }

    if (this.phase === 'lobby') {
      this.broadcastLobby();
      return;
    }
    if (this.phase === 'playing' && this.game) {
      this.game.status = `${seat.name} reconnected.`;
      this.broadcastGame();
      return;
    }
    if (this.phase === 'finished') {
      this.broadcastGameOver();
    }
  }

  private addSeat(ws: WebSocket, name: string): Seat {
    const seat: Seat = {
      id: `p${this.nextId++}`,
      name,
      isHost: this.seats.size === 0,
      ws,
      resumeToken: generateRoomToken(),
      connected: true,
    };
    this.seats.set(seat.id, seat);
    this.bySocket.set(ws, seat.id);
    return seat;
  }

  private handleStart(
    ws: WebSocket,
    guaranteeSpecial = true,
    cardsPerPlayer = 7
  ): void {
    const seat = this.seatFor(ws);
    if (!seat) {
      this.send(ws, { type: 'error', reason: 'Join first.' });
      return;
    }
    if (!seat.isHost) {
      this.send(ws, { type: 'error', reason: 'Only the host can start.' });
      return;
    }
    if (this.phase !== 'lobby') {
      this.send(ws, { type: 'error', reason: 'Game already started.' });
      return;
    }
    const connected = [...this.seats.values()].filter((item) => item.connected);
    if (connected.length < 2) {
      this.send(ws, { type: 'error', reason: 'Need at least 2 players.' });
      return;
    }

    const players = [...this.seats.values()].map((s) => ({ id: s.id, name: s.name }));
    this.game = createGame(
      players,
      Math.random,
      undefined,
      guaranteeSpecial,
      cardsPerPlayer
    );
    this.phase = 'playing';
    this.broadcastGame();
  }

  private handlePlay(ws: WebSocket, cardId: string, wildColor?: 'red' | 'yellow' | 'green' | 'blue'): void {
    const seat = this.seatFor(ws);
    if (!seat || !this.game || this.phase !== 'playing') {
      this.send(ws, { type: 'error', reason: 'No active game.' });
      return;
    }

    const result = playCard(this.game, seat.id, cardId, wildColor);
    if (!result.ok) {
      this.send(ws, { type: 'error', reason: result.reason });
      return;
    }
    this.game = result.game;
    if (this.finishIfWon()) {
      return;
    }
    this.broadcastGame();
  }

  private handleChooseColor(ws: WebSocket, color: UnoColor): void {
    const seat = this.seatFor(ws);
    if (!seat || !this.game || this.phase !== 'playing') {
      this.send(ws, { type: 'error', reason: 'No active game.' });
      return;
    }

    const result = chooseOpeningColor(this.game, seat.id, color);
    if (!result.ok) {
      this.send(ws, { type: 'error', reason: result.reason });
      return;
    }
    this.game = result.game;
    this.broadcastGame();
  }

  private handleUno(ws: WebSocket): void {
    const seat = this.seatFor(ws);
    if (!seat || !this.game || this.phase !== 'playing') {
      this.send(ws, { type: 'error', reason: 'No active game.' });
      return;
    }

    const result = callUno(this.game, seat.id);
    if (!result.ok) {
      this.send(ws, { type: 'error', reason: result.reason });
      return;
    }
    this.game = result.game;
    this.broadcastGame();
  }

  private handleCatch(ws: WebSocket): void {
    const seat = this.seatFor(ws);
    if (!seat || !this.game || this.phase !== 'playing') {
      this.send(ws, { type: 'error', reason: 'No active game.' });
      return;
    }

    const result = catchUno(this.game, seat.id);
    if (!result.ok) {
      this.send(ws, { type: 'error', reason: result.reason });
      return;
    }
    this.game = result.game;
    this.broadcastGame();
  }

  private handleDraw(ws: WebSocket): void {
    const seat = this.seatFor(ws);
    if (!seat || !this.game || this.phase !== 'playing') {
      this.send(ws, { type: 'error', reason: 'No active game.' });
      return;
    }

    const result = drawCard(this.game, seat.id);
    if (!result.ok) {
      this.send(ws, { type: 'error', reason: result.reason });
      return;
    }
    this.game = result.game;
    this.broadcastGame();
  }

  private handleDisconnect(ws: WebSocket): void {
    if (this.waiting.delete(ws)) {
      return;
    }
    if (this.disposed || this.phase === 'closed') {
      this.bySocket.delete(ws);
      return;
    }
    const seat = this.seatFor(ws);
    this.bySocket.delete(ws);
    if (!seat || seat.ws !== ws) {
      return;
    }
    seat.ws = null;
    if (!this.intentionalLeave.has(ws) && this.reconnectMs > 0) {
      seat.connected = false;
      this.armGrace(seat);
      this.announceDisconnect(seat);
      return;
    }
    this.removeSeat(seat, this.intentionalLeave.has(ws));
  }

  private announceDisconnect(seat: Seat): void {
    const text = `${seat.name} disconnected. Reconnecting…`;
    if (this.phase === 'lobby') {
      this.broadcastLobby();
      return;
    }
    if (this.game) {
      this.game.status = text;
    }
    if (this.phase === 'playing') {
      this.broadcastGame();
      return;
    }
    if (this.phase === 'finished') {
      this.broadcastGameOver();
    }
  }

  private armGrace(seat: Seat): void {
    this.clearGrace(seat.id);
    const timer = setTimeout(() => {
      this.graceTimers.delete(seat.id);
      const current = this.seats.get(seat.id);
      if (!current || current.connected) {
        return;
      }
      this.removeSeat(current, false);
    }, this.reconnectMs);
    timer.unref?.();
    this.graceTimers.set(seat.id, timer);
  }

  private clearGrace(id: string): void {
    const timer = this.graceTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(id);
    }
  }

  private clearAllGrace(): void {
    for (const timer of this.graceTimers.values()) {
      clearTimeout(timer);
    }
    this.graceTimers.clear();
  }

  private removeSeat(seat: Seat, intentional: boolean): void {
    this.clearGrace(seat.id);
    if (seat.ws) {
      this.bySocket.delete(seat.ws);
    }
    this.seats.delete(seat.id);

    if (this.phase === 'lobby') {
      if (seat.isHost && intentional && !this.persistent) {
        this.closeRoom('Host left the lobby.');
        return;
      }
      if (seat.isHost) {
        this.promoteHost();
      }
      this.seatWaiters();
      this.ensureHost();
      if (this.seats.size > 0) {
        this.broadcastLobby();
      }
      return;
    }

    if (this.phase === 'finished') {
      if (this.seats.size === 0) {
        this.clearReturnTimer();
        this.game = null;
        this.phase = 'lobby';
        this.seatWaiters();
        this.ensureHost();
        if (this.seats.size > 0) {
          this.broadcastLobby();
        }
      }
      return;
    }

    if (!this.game) {
      return;
    }
    this.game = dropPlayer(this.game, seat.id);
    if (this.game.players.length === 0) {
      this.game = null;
      this.clearTurnClock();
      this.phase = 'lobby';
      this.seatWaiters();
      this.ensureHost();
      if (this.seats.size > 0) {
        this.broadcastLobby();
      }
      return;
    }
    if (this.finishIfWon()) {
      return;
    }
    this.broadcastGame();
  }

  private finishIfWon(): boolean {
    if (!this.game?.winnerId) {
      return false;
    }
    this.clearTurnClock();
    this.phase = 'finished';
    this.broadcastGameOver();
    this.scheduleReturnToLobby();
    return true;
  }

  private seatWaiters(): void {
    while (this.waiting.size > 0 && this.seats.size < MAX_PLAYERS) {
      const next = this.waiting.entries().next().value as [WebSocket, Waiter] | undefined;
      if (!next) {
        return;
      }
      const [ws, waiter] = next;
      this.waiting.delete(ws);
      this.addSeat(ws, waiter.name);
    }
  }

  private ensureHost(): void {
    if ([...this.seats.values()].some((seat) => seat.isHost)) {
      return;
    }
    this.promoteHost();
  }

  private clearTurnClock(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnToken += 1;
    this.turnDeadline = null;
  }

  private armTurnClock(): void {
    this.clearTurnClock();
    if (!this.game || this.phase !== 'playing' || this.game.winnerId || this.turnMs <= 0) {
      return;
    }
    const current = this.game.players[this.game.currentPlayerIndex];
    const seat = current ? this.seats.get(current.id) : undefined;
    if (!seat?.connected) {
      return;
    }
    this.turnDeadline = Date.now() + this.turnMs;
    const token = this.turnToken;
    const playerId = current.id;
    const timer = setTimeout(() => {
      if (token !== this.turnToken) {
        return;
      }
      this.onTurnTimeout(playerId);
    }, this.turnMs);
    timer.unref?.();
    this.turnTimer = timer;
  }

  private onTurnTimeout(playerId: string): void {
    if (!this.game || this.phase !== 'playing' || this.game.winnerId) {
      return;
    }
    const current = this.game.players[this.game.currentPlayerIndex];
    if (!current || current.id !== playerId) {
      return;
    }
    const seat = this.seats.get(playerId);
    if (!seat?.connected) {
      return;
    }
    if (this.game.awaitingWildColor) {
      const chosen = chooseOpeningColor(this.game, playerId, 'red');
      if (!chosen.ok) {
        return;
      }
      this.game = chosen.game;
      this.game.status = `${seat.name} timed out. Color set to red.`;
      this.broadcastGame();
      return;
    }
    const drawn = drawCard(this.game, playerId);
    if (!drawn.ok) {
      this.send(seat.ws, { type: 'error', reason: drawn.reason });
      this.armTurnClock();
      return;
    }
    this.game = drawn.game;
    const turnName = this.game.players[this.game.currentPlayerIndex]?.name ?? 'Next';
    if (!this.game.winnerId) {
      this.game.status = `${seat.name} timed out and drew a card. ${turnName}'s turn.`;
    }
    if (this.finishIfWon()) {
      return;
    }
    this.broadcastGame();
  }

  private promoteHost(): void {
    let promoted: Seat | undefined;
    for (const seat of this.seats.values()) {
      if (!promoted) {
        promoted = seat;
        seat.isHost = true;
      } else {
        seat.isHost = false;
      }
    }
  }

  /** After a win, keep the same seats and show the lobby again. */
  private scheduleReturnToLobby(): void {
    this.clearReturnTimer();
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      if (this.disposed || this.phase !== 'finished') {
        return;
      }
      this.returnSeatsToLobby();
    }, this.returnToLobbyMs);
  }

  private returnSeatsToLobby(): void {
    this.clearTurnClock();
    this.game = null;
    this.phase = 'lobby';
    this.seatWaiters();
    this.ensureHost();
    if (this.seats.size > 0) {
      this.broadcastLobby();
    }
  }

  /** Kick remaining seats and return to an empty lobby (HTTP/WS stay up). */
  private resetToLobby(reason: string): void {
    this.clearReturnTimer();
    this.clearTurnClock();
    this.clearAllGrace();
    this.game = null;
    this.phase = 'lobby';
    this.endSockets(reason);
    this.seatWaiters();
    this.ensureHost();
    if (this.seats.size > 0) {
      this.broadcastLobby();
    }
  }

  private closeRoom(reason: string): void {
    if (this.persistent) {
      this.resetToLobby(reason);
      return;
    }
    this.clearReturnTimer();
    this.clearTurnClock();
    this.clearAllGrace();
    this.phase = 'closed';
    this.game = null;
    this.endSockets(reason);
  }

  private endSockets(reason: string): void {
    const seats = [...this.seats.values()];
    const waiting = [...this.waiting.keys()];
    this.seats.clear();
    this.bySocket.clear();
    this.waiting.clear();
    for (const seat of seats) {
      this.send(seat.ws, { type: 'ended', reason });
      seat.ws?.close();
    }
    for (const ws of waiting) {
      this.send(ws, { type: 'ended', reason });
      ws.close();
    }
  }

  private broadcastLobby(): void {
    const connected = [...this.seats.values()].filter((seat) => seat.connected).length;
    const players: LobbyPlayer[] = [...this.seats.values()].map((s) => ({
      id: s.id,
      name: s.name,
      isHost: s.isHost,
      connected: s.connected,
    }));
    const canStart = connected >= 2 && this.seats.size <= MAX_PLAYERS;

    for (const seat of this.seats.values()) {
      const msg: ServerMessage = {
        type: 'lobby',
        players,
        joinUrl: this.joinUrl,
        joinUrls: this.joinUrls,
        canStart,
        youAreHost: seat.isHost,
        yourPlayerId: seat.id,
        resumeToken: seat.resumeToken,
      };
      this.send(seat.ws, msg);
    }
  }

  private broadcastGame(): void {
    if (!this.game) {
      return;
    }
    this.armTurnClock();
    for (const seat of this.seats.values()) {
      if (!this.game.players.some((player) => player.id === seat.id)) {
        continue;
      }
      const state = this.decorate(personalize(this.game, seat.id));
      this.send(seat.ws, { type: 'state', state, resumeToken: seat.resumeToken });
    }
  }

  private broadcastGameOver(): void {
    if (!this.game || !this.game.winnerId) {
      return;
    }
    const winner = this.game.players.find((p) => p.id === this.game!.winnerId);
    for (const seat of this.seats.values()) {
      if (!this.game.players.some((player) => player.id === seat.id)) {
        continue;
      }
      const state = this.decorate(personalize(this.game, seat.id));
      this.send(seat.ws, {
        type: 'gameOver',
        state,
        winnerId: this.game.winnerId,
        winnerName: winner?.name ?? 'Someone',
        resumeToken: seat.resumeToken,
      });
    }
  }

  private decorate(state: PersonalizedState): PersonalizedState {
    return {
      ...state,
      turnDeadline: this.turnDeadline,
      opponents: state.opponents.map((opponent) => ({
        ...opponent,
        connected: this.seats.get(opponent.id)?.connected !== false,
      })),
    };
  }

  private send(ws: WebSocket | null, msg: ServerMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}

function advertiseJoinUrls(
  port: number,
  roomToken: string,
  publicUrl: string | undefined,
  publicHost: string | undefined
): string[] {
  const explicit = publicUrl?.trim();
  if (explicit) {
    return [appendRoomToken(explicit, roomToken)];
  }
  const host = publicHost?.trim();
  if (host) {
    return [appendRoomToken(`ws://${host}:${port}`, roomToken)];
  }
  return formatJoinUrls(port, getLanIPv4s()).map((url) => appendRoomToken(url, roomToken));
}

async function closeListeners(wss: WebSocketServer, httpServer: http.Server): Promise<void> {
  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
  if (!httpServer.listening) {
    return;
  }
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
}
