import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  callUno,
  catchUno,
  chooseOpeningColor,
  createGame,
  drawCard,
  personalize,
  playCard,
} from './engine';
import { formatJoinUrls, getLanIPv4s, DEFAULT_UNO_PORT } from './lan';
import { ClientMessage, LobbyPlayer, parseClientMessage, ServerMessage } from './protocol';
import { GameSnapshot, UnoColor } from './types';
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
  ws: WebSocket;
}

type Phase = 'lobby' | 'playing' | 'finished' | 'closed';

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_SOCKETS = 8;
const IDLE_JOIN_MS = 5000;
const RATE_WINDOW_MS = 1000;
const RATE_MAX_MESSAGES = 20;
const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_CAPACITY = 4002;
const CLOSE_IDLE = 4003;
const CLOSE_RATE = 4004;

export interface RoomServerOptions {
  port?: number;
  /** Interface to bind (default 0.0.0.0). */
  bindHost?: string;
  /** When true, reset to an empty lobby instead of closing the process forever. */
  persistent?: boolean;
  /** Preferred host in join URLs (e.g. EC2 public IP / DNS). */
  publicHost?: string;
  /** Shared secret embedded as `?t=` on join URLs. Generated if omitted. */
  roomToken?: string;
}

export class RoomServer {
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly seats = new Map<WebSocket, Seat>();
  private readonly pending = new Set<WebSocket>();
  private readonly idleTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  private readonly rateBuckets = new Map<WebSocket, { count: number; windowStart: number }>();
  private readonly persistent: boolean;
  private readonly roomToken: string;
  private phase: Phase = 'lobby';
  private game: GameSnapshot | null = null;
  private nextId = 1;
  private port = 0;
  private joinUrl = '';
  private joinUrls: string[] = [];
  private disposed = false;

  private constructor(
    httpServer: http.Server,
    wss: WebSocketServer,
    persistent: boolean,
    roomToken: string
  ) {
    this.httpServer = httpServer;
    this.wss = wss;
    this.persistent = persistent;
    this.roomToken = roomToken;

    this.wss.on('connection', (ws, req) => {
      this.onConnection(ws, req);
    });
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

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => reject(err);
        httpServer.once('error', onError);
        httpServer.listen(port, bindHost, () => {
          httpServer.removeListener('error', onError);
          resolve();
        });
      });
    } catch (err) {
      wss.close();
      httpServer.close();
      throw err;
    }

    const room = new RoomServer(httpServer, wss, persistent, roomToken);
    const addr = httpServer.address();
    room.port = typeof addr === 'object' && addr ? addr.port : port;
    const lanHosts = getLanIPv4s();
    const publicHost = options.publicHost?.trim();
    const hosts = publicHost
      ? [publicHost, ...lanHosts.filter((h) => h !== publicHost)]
      : lanHosts;
    const bareUrls = formatJoinUrls(room.port, hosts);
    room.joinUrls = bareUrls.map((url) => appendRoomToken(url, roomToken));
    room.joinUrl = room.joinUrls[0] ?? appendRoomToken(`ws://127.0.0.1:${room.port}`, roomToken);
    return room;
  }

  getJoinUrl(): string {
    return this.joinUrl;
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

    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    this.rateBuckets.clear();
    this.pending.clear();

    const seats = [...this.seats.values()];
    this.seats.clear();
    for (const seat of seats) {
      this.send(seat.ws, { type: 'ended', reason: 'Host closed the room.' });
      seat.ws.close();
    }

    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private socketCount(): number {
    return this.seats.size + this.pending.size;
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

  private attachSocket(ws: WebSocket): void {
    ws.on('error', () => {
      // 'close' follows. An unhandled 'error' event would crash the extension host.
    });

    const idleTimer = setTimeout(() => {
      if (this.pending.has(ws) && !this.seats.has(ws)) {
        this.send(ws, { type: 'error', reason: 'Join timed out.' });
        ws.close(CLOSE_IDLE, 'Join timed out');
      }
    }, IDLE_JOIN_MS);
    this.idleTimers.set(ws, idleTimer);

    ws.on('message', (data) => {
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
    const now = Date.now();
    let bucket = this.rateBuckets.get(ws);
    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
      bucket = { count: 0, windowStart: now };
      this.rateBuckets.set(ws, bucket);
    }
    bucket.count += 1;
    return bucket.count <= RATE_MAX_MESSAGES;
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
        ws.close();
        break;
    }
  }

  private handleJoin(ws: WebSocket, name: string): void {
    if (this.phase === 'closed' || this.disposed) {
      this.send(ws, { type: 'error', reason: 'Room is closed.' });
      ws.close();
      return;
    }
    if (this.phase !== 'lobby') {
      this.send(ws, { type: 'error', reason: 'Game already started.' });
      ws.close();
      return;
    }
    if (this.seats.has(ws)) {
      this.send(ws, { type: 'error', reason: 'Already joined.' });
      return;
    }
    if (this.seats.size >= 6) {
      this.send(ws, { type: 'error', reason: 'Room is full (max 6).' });
      ws.close();
      return;
    }

    this.clearIdle(ws);
    this.pending.delete(ws);

    const id = `p${this.nextId++}`;
    const isHost = this.seats.size === 0;
    this.seats.set(ws, { id, name, isHost, ws });
    this.broadcastLobby();
  }

  private handleStart(
    ws: WebSocket,
    guaranteeSpecial = true,
    cardsPerPlayer = 7
  ): void {
    const seat = this.seats.get(ws);
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
    if (this.seats.size < 2) {
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
    const seat = this.seats.get(ws);
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
    if (this.game.winnerId) {
      this.phase = 'finished';
      this.broadcastGameOver();
      if (this.persistent) {
        this.resetToLobby('Game over. Room reset — join again to play.');
      }
      return;
    }
    this.broadcastGame();
  }

  private handleChooseColor(ws: WebSocket, color: UnoColor): void {
    const seat = this.seats.get(ws);
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
    const seat = this.seats.get(ws);
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
    const seat = this.seats.get(ws);
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
    const seat = this.seats.get(ws);
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
    const seat = this.seats.get(ws);
    if (!seat) {
      return;
    }
    this.seats.delete(ws);

    if (this.phase === 'lobby') {
      if (seat.isHost) {
        if (this.persistent && this.seats.size > 0) {
          this.promoteHost();
          this.broadcastLobby();
          return;
        }
        this.closeRoom('Host left the lobby.');
        return;
      }
      this.broadcastLobby();
      return;
    }

    if (this.phase === 'closed') {
      return;
    }

    // During game / finished: end room simply (reconnect is polish-later).
    this.closeRoom(`${seat.name} disconnected. Room closed.`);
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

  /** Kick remaining seats and return to an empty lobby (HTTP/WS stay up). */
  private resetToLobby(reason: string): void {
    this.game = null;
    this.phase = 'lobby';
    const others = [...this.seats.values()];
    this.seats.clear();
    for (const other of others) {
      this.send(other.ws, { type: 'ended', reason });
      other.ws.close();
    }
  }

  private closeRoom(reason: string): void {
    if (this.persistent) {
      this.resetToLobby(reason);
      return;
    }
    this.phase = 'closed';
    this.game = null;
    const others = [...this.seats.values()];
    this.seats.clear();
    for (const other of others) {
      this.send(other.ws, { type: 'ended', reason });
      other.ws.close();
    }
  }

  private broadcastLobby(): void {
    const players: LobbyPlayer[] = [...this.seats.values()].map((s) => ({
      id: s.id,
      name: s.name,
      isHost: s.isHost,
    }));
    const canStart = this.seats.size >= 2 && this.seats.size <= 6;

    for (const seat of this.seats.values()) {
      const msg: ServerMessage = {
        type: 'lobby',
        players,
        joinUrl: this.joinUrl,
        joinUrls: this.joinUrls,
        canStart,
        youAreHost: seat.isHost,
        yourPlayerId: seat.id,
      };
      this.send(seat.ws, msg);
    }
  }

  private broadcastGame(): void {
    if (!this.game) {
      return;
    }
    for (const seat of this.seats.values()) {
      const state = personalize(this.game, seat.id);
      this.send(seat.ws, { type: 'state', state });
    }
  }

  private broadcastGameOver(): void {
    if (!this.game || !this.game.winnerId) {
      return;
    }
    const winner = this.game.players.find((p) => p.id === this.game!.winnerId);
    for (const seat of this.seats.values()) {
      const state = personalize(this.game, seat.id);
      this.send(seat.ws, {
        type: 'gameOver',
        state,
        winnerId: this.game.winnerId,
        winnerName: winner?.name ?? 'Someone',
      });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
