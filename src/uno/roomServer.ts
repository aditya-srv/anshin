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
import { formatJoinUrls, DEFAULT_UNO_PORT } from './lan';
import { ClientMessage, LobbyPlayer, parseClientMessage, ServerMessage } from './protocol';
import { GameSnapshot, UnoColor } from './types';

interface Seat {
  id: string;
  name: string;
  isHost: boolean;
  ws: WebSocket;
}

type Phase = 'lobby' | 'playing' | 'finished' | 'closed';

const MAX_MESSAGE_BYTES = 64 * 1024;

export interface RoomServerOptions {
  port?: number;
}

export class RoomServer {
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly seats = new Map<WebSocket, Seat>();
  private phase: Phase = 'lobby';
  private game: GameSnapshot | null = null;
  private nextId = 1;
  private port = 0;
  private joinUrl = '';
  private joinUrls: string[] = [];
  private disposed = false;

  private constructor(httpServer: http.Server, wss: WebSocketServer) {
    this.httpServer = httpServer;
    this.wss = wss;

    this.wss.on('connection', (ws) => {
      this.attachSocket(ws);
    });
  }

  static async start(options: RoomServerOptions = {}): Promise<RoomServer> {
    const port = options.port ?? DEFAULT_UNO_PORT;
    const httpServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Anshin UNO room');
    });

    const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => reject(err);
        httpServer.once('error', onError);
        httpServer.listen(port, '0.0.0.0', () => {
          httpServer.removeListener('error', onError);
          resolve();
        });
      });
    } catch (err) {
      wss.close();
      httpServer.close();
      throw err;
    }

    const room = new RoomServer(httpServer, wss);
    const addr = httpServer.address();
    room.port = typeof addr === 'object' && addr ? addr.port : port;
    room.joinUrls = formatJoinUrls(room.port);
    room.joinUrl = room.joinUrls[0] ?? `ws://127.0.0.1:${room.port}`;
    return room;
  }

  getJoinUrl(): string {
    return this.joinUrl;
  }

  getPort(): number {
    return this.port;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.phase = 'closed';
    this.game = null;

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

  private attachSocket(ws: WebSocket): void {
    ws.on('error', () => {
      // 'close' follows. An unhandled 'error' event would crash the extension host.
    });

    ws.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const msg = parseClientMessage(text);
      if (!msg) {
        this.send(ws, { type: 'error', reason: 'Invalid message.' });
        return;
      }
      try {
        this.handleMessage(ws, msg);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Room error.';
        this.send(ws, { type: 'error', reason });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });
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

  private closeRoom(reason: string): void {
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
