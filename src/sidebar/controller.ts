import { DEFAULT_ROOM_PORT } from '../room/lan';
import { ServerMessage } from '../room/protocol';
import { RoomServer } from '../room/roomServer';
import { isValidJoinUrl } from '../room/urlAuth';
import { RoomSession } from './session';
import { applyServerMessage, createMenuState, toWebviewState } from './state';
import { IncomingMessage, UiState } from './types';

export interface ControllerOptions {
  /** Sends a message to the UI (the VS Code webview). */
  send: (message: unknown) => void;
  version: string;
  getDefaultServerUrl: () => string;
  copyText: (text: string) => Promise<void>;
}

/** Owns the UI state machine for the sidebar: menu, lobby, and game. No VS Code APIs. */
export class AnshinController {
  private state: UiState = createMenuState();
  private busy = false;
  private shutdownPromise: Promise<void> | null = null;
  private readonly session: RoomSession;

  constructor(private readonly options: ControllerOptions) {
    this.session = new RoomSession(
      (msg) => this.onServerMessage(msg),
      (reason) => this.resetToMenu(reason),
      (status) => {
        this.state = { ...this.state, status };
        this.postUi();
      }
    );
  }

  /** Re-send the current UI, e.g. when the sidebar becomes visible again. */
  refresh(): void {
    this.postUi();
  }

  async handle(message: IncomingMessage): Promise<void> {
    if (!message || typeof message !== 'object') {
      return;
    }

    switch (message.type) {
      case 'ready':
        this.postUi();
        break;
      case 'setGuiMode':
        if (message.mode === 'ultra' || message.mode === 'low' || message.mode === 'high') {
          this.state = { ...this.state, guiMode: message.mode };
          this.postUi();
        }
        break;
      case 'host':
        await this.hostRoom(message.name, {
          remote: message.remote === true,
          serverUrl: typeof message.serverUrl === 'string' ? message.serverUrl : '',
        });
        break;
      case 'join':
        await this.joinRoom(message.name, message.url);
        break;
      case 'setGame':
        if (typeof message.game === 'string' && message.game) {
          // Optimistic — remote lobby echoes can lag; keep the host pick from snapping back to Uno.
          this.state = { ...this.state, selectedGame: message.game };
          this.session.setGame(message.game);
          this.postUi();
        }
        break;
      case 'startGame': {
        const cards =
          typeof message.cardsPerPlayer === 'number' && Number.isInteger(message.cardsPerPlayer)
            ? message.cardsPerPlayer
            : 7;
        const deckCount =
          typeof message.deckCount === 'number' && Number.isInteger(message.deckCount)
            ? message.deckCount
            : 1;
        const game =
          typeof message.game === 'string' && message.game.trim() ? message.game.trim() : undefined;
        if (game) {
          this.state = { ...this.state, selectedGame: game };
          this.session.setGame(game);
        }
        this.session.start({
          ...(game ? { game } : {}),
          guaranteeSpecial: message.guaranteeSpecial !== false,
          cardsPerPlayer: cards,
          deckCount,
          stackDraws: message.stackDraws === true,
          blockades: message.blockades === true,
          claimMode: message.claimMode === 'next' ? 'next' : 'same',
        });
        break;
      }
      case 'action':
        this.session.action(message.action);
        break;
      case 'leave':
        this.session.leaveSocket();
        await this.runExclusive(() => this.resetToMenu('Left the room.'));
        break;
      case 'copyJoinUrl':
        await this.copyJoinUrl();
        break;
    }
  }

  /** Leaves any room. The UI stays alive. */
  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.resetToMenu('Session closed.');
    }
    return this.shutdownPromise;
  }

  private hostRoom(name: string, options: { remote: boolean; serverUrl: string }): Promise<void> {
    return this.runExclusive(async () => {
      const trimmed = name.trim().slice(0, 24);
      if (!trimmed) {
        this.state = { ...this.state, status: 'Enter a display name.' };
        this.postUi();
        return;
      }

      const configured = this.options.getDefaultServerUrl().trim();
      const remoteUrl = (options.serverUrl.trim() || configured).trim();

      await this.session.teardown();
      const gen = this.session.generationId;

      if (options.remote) {
        if (!isValidJoinUrl(remoteUrl)) {
          this.state = createMenuState(
            'Remote host needs a ws:// or wss:// Join URL with ?t= token',
            this.state.guiMode
          );
          this.postUi();
          return;
        }

        this.state = {
          ...this.state,
          yourName: trimmed,
          youAreHost: true,
          joinUrl: remoteUrl,
          status: 'Connecting to room server…',
        };
        this.postUi();

        try {
          await this.session.connect(remoteUrl, trimmed);
        } catch (err) {
          if (!this.session.isCurrent(gen)) {
            return;
          }
          const reason = err instanceof Error ? err.message : String(err);
          await this.resetToMenu(`Host failed: ${reason}`);
        }
        return;
      }

      let server: RoomServer;
      try {
        server = await this.session.startLocalServer();
      } catch (err) {
        if (!this.session.isCurrent(gen)) {
          return;
        }
        const reason = err instanceof Error ? err.message : String(err);
        this.state = createMenuState(
          `Could not bind port ${DEFAULT_ROOM_PORT}: ${reason}`,
          this.state.guiMode
        );
        this.postUi();
        return;
      }

      if (!this.session.isCurrent(gen)) {
        await this.session.discardServer();
        return;
      }

      this.state = {
        ...this.state,
        yourName: trimmed,
        youAreHost: true,
        joinUrl: server.getJoinUrl(),
        status: 'Hosting… share the join URL.',
      };
      this.postUi();

      try {
        await this.session.connect(this.session.localClientUrl(server), trimmed);
      } catch (err) {
        if (!this.session.isCurrent(gen)) {
          return;
        }
        const reason = err instanceof Error ? err.message : String(err);
        await this.resetToMenu(`Host client failed: ${reason}`);
      }
    });
  }

  private joinRoom(name: string, url: string): Promise<void> {
    return this.runExclusive(async () => {
      const trimmed = name.trim().slice(0, 24);
      const joinUrl = url.trim();
      if (!trimmed) {
        this.state = { ...this.state, status: 'Enter a display name.' };
        this.postUi();
        return;
      }
      if (!isValidJoinUrl(joinUrl)) {
        this.state = {
          ...this.state,
          status: 'URL must be ws:// or wss:// with a host (include ?t= from the host)',
        };
        this.postUi();
        return;
      }

      await this.session.teardown();
      const gen = this.session.generationId;
      this.state = {
        ...this.state,
        yourName: trimmed,
        youAreHost: false,
        joinUrl,
        status: 'Connecting…',
      };
      this.postUi();

      try {
        await this.session.connect(joinUrl, trimmed);
      } catch (err) {
        if (!this.session.isCurrent(gen)) {
          return;
        }
        const reason = err instanceof Error ? err.message : String(err);
        await this.resetToMenu(`Join failed: ${reason}`);
      }
    });
  }

  private async copyJoinUrl(): Promise<void> {
    const url = this.state.joinUrl;
    if (!url) {
      return;
    }
    await this.options.copyText(url);
    this.state = { ...this.state, status: 'Join URL copied.' };
    this.postUi();
  }

  private onServerMessage(msg: ServerMessage): void {
    const applied = applyServerMessage(this.state, msg);
    if (msg.type === 'lobby' || msg.type === 'state' || msg.type === 'gameOver') {
      this.session.noteResumeToken(applied.resumeToken);
      this.session.markResumeSucceeded();
    }
    if (applied.ended) {
      this.session.disableRetry();
      return;
    }
    this.state = applied.state;
    this.postUi();
  }

  private async resetToMenu(status?: string): Promise<void> {
    const guiMode = this.state.guiMode;
    await this.session.teardown();
    this.state = createMenuState(status ?? this.state.status, guiMode);
    this.postUi();
  }

  private async runExclusive(task: () => Promise<void>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      await task();
    } finally {
      this.busy = false;
    }
  }

  private postUi(): void {
    this.options.send({
      type: 'ui',
      state: toWebviewState(this.state, this.options.getDefaultServerUrl(), this.options.version),
    });
  }
}
