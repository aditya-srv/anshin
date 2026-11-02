import WebSocket from 'ws';
import { ClientMessage, ServerMessage } from './protocol';
import { UnoColor } from './types';

export type RoomClientHandler = (message: ServerMessage) => void;

const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_CAPACITY = 4002;
const CLOSE_IDLE = 4003;
const CLOSE_RATE = 4004;

/** Text for a WebSocket close, preferring the server reason. */
export function describeSocketClose(code: number, reason: Buffer | string): string {
  const text = (typeof reason === 'string' ? reason : reason.toString('utf8')).trim();
  if (text) {
    return text;
  }
  switch (code) {
    case CLOSE_UNAUTHORIZED:
      return 'Unauthorized';
    case CLOSE_CAPACITY:
      return 'Room at capacity';
    case CLOSE_IDLE:
      return 'Join timed out';
    case CLOSE_RATE:
      return 'Too many messages.';
    default:
      return 'Connection closed.';
  }
}

function isRoomCloseCode(code: number): boolean {
  return code >= CLOSE_UNAUTHORIZED && code <= CLOSE_RATE;
}

export class RoomClient {
  private ws: WebSocket | null = null;
  private readonly onMessage: RoomClientHandler;
  private readonly onClosed: (reason: string) => void;

  constructor(onMessage: RoomClientHandler, onClosed: (reason: string) => void = () => undefined) {
    this.onMessage = onMessage;
    this.onClosed = onClosed;
  }

  connect(url: string, timeoutMs = 8000): Promise<void> {
    this.dispose();

    return new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      let connectError: Error | null = null;
      const ws = new WebSocket(url);
      this.ws = ws;

      const finish = (err?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      const timer = setTimeout(() => {
        connectError = new Error('Connection timed out.');
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish(connectError);
      }, timeoutMs);

      ws.on('open', () => {
        opened = true;
        finish();
      });

      ws.on('message', (data) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        let parsed: ServerMessage;
        try {
          parsed = JSON.parse(text) as ServerMessage;
        } catch {
          return;
        }
        this.onMessage(parsed);
        if (parsed.type === 'ended') {
          this.onClosed(parsed.reason);
        }
      });

      ws.on('error', (err) => {
        connectError = err instanceof Error ? err : new Error(String(err));
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish(connectError);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        const message = describeSocketClose(code, reason);
        const failure = isRoomCloseCode(code) ? new Error(message) : (connectError ?? new Error(message));
        if (!settled) {
          finish(failure);
        }
        if (this.ws !== ws) {
          return;
        }
        this.ws = null;
        if (opened) {
          this.onClosed(isRoomCloseCode(code) ? message : (connectError?.message ?? message));
        }
      });
    });
  }

  join(name: string): void {
    this.send({ type: 'join', name });
  }

  resume(token: string): void {
    this.send({ type: 'resume', token });
  }

  start(guaranteeSpecial = true, cardsPerPlayer = 7): void {
    this.send({ type: 'start', guaranteeSpecial, cardsPerPlayer });
  }

  play(cardId: string, wildColor?: UnoColor): void {
    this.send({ type: 'play', cardId, wildColor });
  }

  draw(): void {
    this.send({ type: 'draw' });
  }

  chooseColor(color: UnoColor): void {
    this.send({ type: 'chooseColor', color });
  }

  callUno(): void {
    this.send({ type: 'uno' });
  }

  catchUno(): void {
    this.send({ type: 'catch' });
  }

  leave(): void {
    this.send({ type: 'leave' });
    this.dispose();
  }

  dispose(): void {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
