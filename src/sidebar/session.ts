import { GameAction, GameOptions } from '../games/types';
import { DEFAULT_ROOM_PORT } from '../room/lan';
import { ServerMessage } from '../room/protocol';
import { RoomClient } from '../room/roomClient';
import { RoomServer } from '../room/roomServer';
import { appendRoomToken } from '../room/urlAuth';

export type SessionClosedHandler = (reason: string) => void;
export type SessionMessageHandler = (message: ServerMessage) => void;
export type SessionStatusHandler = (status: string) => void;

/**
 * Owns the local room server (if any) and the websocket client.
 * UI state stays outside; this only moves packets and connection lifecycle.
 */
export class RoomSession {
  private server: RoomServer | null = null;
  private client: RoomClient | null = null;
  private resumeToken = '';
  private connectedUrl = '';
  private allowRetry = false;
  private retrying = false;
  private localCloseReason: string | null = null;
  private resumeAttempt: ((ok: boolean) => void) | null = null;
  private generation = 0;

  constructor(
    private readonly onMessage: SessionMessageHandler,
    private readonly onClosed: SessionClosedHandler,
    private readonly onStatus: SessionStatusHandler = () => undefined
  ) {}

  get generationId(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  async startLocalServer(): Promise<RoomServer> {
    this.server = await RoomServer.start({ port: DEFAULT_ROOM_PORT });
    return this.server;
  }

  localClientUrl(server: RoomServer): string {
    return appendRoomToken(`ws://127.0.0.1:${server.getPort()}`, server.getRoomToken());
  }

  async connect(url: string, name: string): Promise<void> {
    this.connectedUrl = url;
    const client = this.openClient();
    this.client = client;
    await client.connect(url);
    client.join(name);
  }

  setGame(game: string): void {
    this.client?.setGame(game);
  }

  start(options: GameOptions): void {
    this.client?.start(options);
  }

  action(action: GameAction): void {
    this.client?.action(action);
  }

  leaveSocket(): void {
    this.allowRetry = false;
    this.localCloseReason = 'Left the room.';
    this.resumeAttempt?.(false);
    this.resumeAttempt = null;
    this.client?.leave();
  }

  noteResumeToken(token: string | undefined): void {
    if (!token) {
      return;
    }
    this.resumeToken = token;
    this.allowRetry = true;
  }

  markResumeSucceeded(): void {
    this.resumeAttempt?.(true);
    this.resumeAttempt = null;
  }

  disableRetry(): void {
    this.allowRetry = false;
    this.resumeAttempt?.(false);
    this.resumeAttempt = null;
  }

  async teardown(): Promise<void> {
    this.allowRetry = false;
    this.resumeToken = '';
    this.connectedUrl = '';
    this.resumeAttempt?.(false);
    this.resumeAttempt = null;
    this.generation += 1;

    const client = this.client;
    this.client = null;
    client?.dispose();
    await this.discardServer();
  }

  async discardServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }
    try {
      await server.dispose();
    } catch {
      // ignore
    }
  }

  private openClient(): RoomClient {
    return new RoomClient(
      (msg) => this.onMessage(msg),
      (reason) => this.handleClientClosed(reason)
    );
  }

  private handleClientClosed(reason: string): void {
    const status = this.localCloseReason ?? reason;
    this.localCloseReason = null;
    if (this.retrying) {
      this.resumeAttempt?.(false);
      this.resumeAttempt = null;
      return;
    }
    if (this.allowRetry && this.resumeToken && this.connectedUrl) {
      void this.retryResume();
      return;
    }
    void this.teardown().then(() => this.onClosed(status));
  }

  private async retryResume(): Promise<void> {
    if (this.retrying) {
      return;
    }
    this.retrying = true;
    const token = this.resumeToken;
    const url = this.connectedUrl;
    const deadline = Date.now() + 20_000;
    this.onStatus('Reconnecting…');
    try {
      while (this.allowRetry && Date.now() < deadline) {
        const previous = this.client;
        this.client = null;
        previous?.dispose();
        const ok = await this.connectForResume(url, token);
        if (ok) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      this.retrying = false;
    }
    if (this.allowRetry) {
      await this.teardown();
      this.onClosed('Could not reconnect.');
    }
  }

  private connectForResume(url: string, token: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (ok: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const client = this.openClient();
      this.client = client;
      timer = setTimeout(() => finish(false), 3000);
      const original = client;
      this.resumeAttempt = (ok: boolean): void => {
        clearTimeout(timer);
        finish(ok);
      };
      void client.connect(url).then(
        () => {
          if (this.client !== original) {
            finish(false);
            return;
          }
          client.resume(token);
        },
        () => finish(false)
      );
    });
  }
}
