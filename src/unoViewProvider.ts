import * as vscode from 'vscode';
import { DEFAULT_UNO_PORT } from './uno/lan';
import { LobbyPlayer, ServerMessage } from './uno/protocol';
import { RoomClient } from './uno/roomClient';
import { RoomServer } from './uno/roomServer';
import { PersonalizedState, UnoColor } from './uno/types';

export type GuiMode = 'ultra' | 'low' | 'high';

type Screen = 'menu' | 'lobby' | 'game';

interface UiState {
  screen: Screen;
  guiMode: GuiMode;
  status: string;
  joinUrl: string;
  lobbyPlayers: LobbyPlayer[];
  canStart: boolean;
  youAreHost: boolean;
  yourPlayerId: string;
  yourName: string;
  game: PersonalizedState | null;
  selectedId: string | null;
  pendingWildCardId: string | null;
}

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'host'; name: string }
  | { type: 'join'; name: string; url: string }
  | { type: 'startGame' }
  | { type: 'leave' }
  | { type: 'select'; cardId: string }
  | { type: 'play'; cardId: string; wildColor?: UnoColor }
  | { type: 'chooseWildColor'; color: UnoColor }
  | { type: 'cancelWild' }
  | { type: 'draw' }
  | { type: 'setGuiMode'; mode: GuiMode };

export class UnoViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'anshin.unoView';

  private _view?: vscode.WebviewView;
  private _server: RoomServer | null = null;
  private _client: RoomClient | null = null;
  private _state: UiState;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._state = this.createMenuState();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: IncomingMessage) => {
      void this.handleMessage(message);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postUi();
      }
    });
  }

  public dispose(): void {
    void this.teardownSession('Session closed.');
  }

  private createMenuState(status = 'Host a room or join with a pasted ws:// address.'): UiState {
    return {
      screen: 'menu',
      guiMode: 'low',
      status,
      joinUrl: '',
      lobbyPlayers: [],
      canStart: false,
      youAreHost: false,
      yourPlayerId: '',
      yourName: '',
      game: null,
      selectedId: null,
      pendingWildCardId: null,
    };
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postUi();
        break;
      case 'setGuiMode':
        if (message.mode === 'ultra' || message.mode === 'low' || message.mode === 'high') {
          this._state.guiMode = message.mode;
          this.postUi();
        }
        break;
      case 'host':
        await this.hostRoom(message.name);
        break;
      case 'join':
        await this.joinRoom(message.name, message.url);
        break;
      case 'startGame':
        this._client?.start();
        break;
      case 'leave':
        await this.teardownSession('Left the room.');
        break;
      case 'select':
        this.handleSelect(message.cardId);
        break;
      case 'play':
        this._client?.play(message.cardId, message.wildColor);
        this._state.selectedId = null;
        this._state.pendingWildCardId = null;
        break;
      case 'chooseWildColor':
        if (this._state.pendingWildCardId) {
          this._client?.play(this._state.pendingWildCardId, message.color);
          this._state.selectedId = null;
          this._state.pendingWildCardId = null;
          this.postUi();
        }
        break;
      case 'cancelWild':
        this._state.pendingWildCardId = null;
        this.postUi();
        break;
      case 'draw':
        this._client?.draw();
        this._state.selectedId = null;
        this._state.pendingWildCardId = null;
        break;
    }
  }

  private handleSelect(cardId: string): void {
    const game = this._state.game;
    if (!game || game.winnerId) {
      return;
    }
    if (game.currentPlayerId !== game.yourPlayerId) {
      this._state.status = 'Not your turn.';
      this.postUi();
      return;
    }

    const card = game.hand.find((c) => c.id === cardId);
    if (!card) {
      return;
    }

    if (this._state.selectedId === cardId) {
      if (card.value === 'wild' || card.value === 'wild4') {
        this._state.pendingWildCardId = cardId;
        this._state.status = 'Choose a color.';
        this.postUi();
        return;
      }
      this._client?.play(cardId);
      this._state.selectedId = null;
      return;
    }

    this._state.selectedId = cardId;
    this._state.pendingWildCardId = null;
    this._state.status = `Selected ${formatCard(card)}. Click again to play.`;
    this.postUi();
  }

  private async hostRoom(name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) {
      this._state.status = 'Enter a display name.';
      this.postUi();
      return;
    }

    await this.teardownSession();

    try {
      this._server = await RoomServer.start({ port: DEFAULT_UNO_PORT });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this._state = this.createMenuState(`Could not bind port ${DEFAULT_UNO_PORT}: ${reason}`);
      this.postUi();
      return;
    }

    this._state.yourName = trimmed;
    this._state.youAreHost = true;
    this._state.joinUrl = this._server.getJoinUrl();
    this._state.status = 'Hosting… share the join URL.';

    // Connect locally via loopback; share LAN URL with joiners.
    const localUrl = `ws://127.0.0.1:${this._server.getPort()}`;
    try {
      await this.connectClient(localUrl, trimmed);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.teardownSession(`Host client failed: ${reason}`);
    }
  }

  private async joinRoom(name: string, url: string): Promise<void> {
    const trimmed = name.trim().slice(0, 24);
    const joinUrl = url.trim();
    if (!trimmed) {
      this._state.status = 'Enter a display name.';
      this.postUi();
      return;
    }
    if (!/^wss?:\/\//i.test(joinUrl)) {
      this._state.status = 'URL must start with ws:// or wss://';
      this.postUi();
      return;
    }

    await this.teardownSession();
    this._state.yourName = trimmed;
    this._state.youAreHost = false;
    this._state.joinUrl = joinUrl;
    this._state.status = 'Connecting…';
    this.postUi();

    try {
      await this.connectClient(joinUrl, trimmed);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this._state = this.createMenuState(`Join failed: ${reason}`);
      this.postUi();
    }
  }

  private async connectClient(url: string, name: string): Promise<void> {
    const client = new RoomClient(
      (msg) => this.onServerMessage(msg),
      (reason) => {
        if (this._state.screen !== 'menu') {
          void this.teardownSession(reason);
        }
      }
    );
    this._client = client;
    await client.connect(url);
    client.join(name);
  }

  private onServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'lobby':
        this._state.screen = 'lobby';
        this._state.lobbyPlayers = msg.players;
        this._state.joinUrl = msg.joinUrl;
        this._state.canStart = msg.canStart;
        this._state.youAreHost = msg.youAreHost;
        this._state.yourPlayerId = msg.yourPlayerId;
        this._state.game = null;
        this._state.status = msg.youAreHost
          ? `Lobby · share ${msg.joinUrl}`
          : 'Waiting for host to start…';
        this.postUi();
        break;
      case 'state':
        this._state.screen = 'game';
        this._state.game = msg.state;
        this._state.status = msg.state.status;
        this._state.selectedId = null;
        this._state.pendingWildCardId = null;
        this.postUi();
        break;
      case 'gameOver':
        this._state.screen = 'game';
        this._state.game = msg.state;
        this._state.status = `${msg.winnerName} wins!`;
        this._state.selectedId = null;
        this._state.pendingWildCardId = null;
        this.postUi();
        break;
      case 'error':
        this._state.status = msg.reason;
        this.postUi();
        break;
      case 'ended':
        void this.teardownSession(msg.reason);
        break;
    }
  }

  private async teardownSession(status?: string): Promise<void> {
    const client = this._client;
    this._client = null;
    client?.dispose();

    const server = this._server;
    this._server = null;
    if (server) {
      try {
        await server.dispose();
      } catch {
        // ignore
      }
    }

    const guiMode = this._state.guiMode;
    this._state = this.createMenuState(status ?? this._state.status);
    this._state.guiMode = guiMode;
    this.postUi();
  }

  private postUi(): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: 'ui',
      state: {
        screen: this._state.screen,
        guiMode: this._state.guiMode,
        status: this._state.status,
        joinUrl: this._state.joinUrl,
        lobbyPlayers: this._state.lobbyPlayers,
        canStart: this._state.canStart,
        youAreHost: this._state.youAreHost,
        yourName: this._state.yourName,
        selectedId: this._state.selectedId,
        pendingWildCardId: this._state.pendingWildCardId,
        game: this._state.game
          ? {
              opponents: this._state.game.opponents,
              discard: this._state.game.discard,
              hand: this._state.game.hand,
              drawRemaining: this._state.game.drawRemaining,
              currentPlayerId: this._state.game.currentPlayerId,
              yourPlayerId: this._state.game.yourPlayerId,
              currentColor: this._state.game.currentColor,
              direction: this._state.game.direction,
              status: this._state.game.status,
              winnerId: this._state.game.winnerId,
              playerCount: this._state.game.playerCount,
            }
          : null,
      },
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'uno.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'uno.js')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Anshin UNO</title>
</head>
<body class="gui-low">
  <header class="topbar">
    <div class="title" id="appTitle">Anshin · UNO</div>
    <div class="gui-toggle" role="group" aria-label="GUI density">
      <button type="button" id="guiUltraBtn" class="gui-btn" data-mode="ultra">Ultra</button>
      <button type="button" id="guiLowBtn" class="gui-btn" data-mode="low">Low</button>
      <button type="button" id="guiHighBtn" class="gui-btn" data-mode="high">High</button>
    </div>
  </header>

  <section id="menuScreen" class="screen">
    <label class="field">
      <span>Display name</span>
      <input id="nameInput" type="text" maxlength="24" placeholder="Your name" />
    </label>
    <div class="row-actions">
      <button id="hostBtn" type="button">Host room</button>
    </div>
    <label class="field">
      <span>Join URL</span>
      <input id="urlInput" type="text" placeholder="ws://192.168.x.x:3847" />
    </label>
    <div class="row-actions">
      <button id="joinBtn" type="button">Join room</button>
    </div>
    <p id="menuStatus" class="status"></p>
  </section>

  <section id="lobbyScreen" class="screen hidden">
    <p class="join-url-label">Share this address</p>
    <code id="joinUrlDisplay" class="join-url"></code>
    <button id="copyUrlBtn" type="button" class="secondary">Copy URL</button>
    <h2 class="lobby-heading">Players</h2>
    <ul id="lobbyList" class="lobby-list"></ul>
    <div class="row-actions">
      <button id="startBtn" type="button">Start game</button>
      <button id="leaveLobbyBtn" type="button" class="secondary">Leave</button>
    </div>
    <p id="lobbyStatus" class="status"></p>
  </section>

  <section id="gameScreen" class="screen hidden">
    <div class="table">
      <section class="seat seat-top hidden" data-seat-slot="0">
        <div class="seat-label"><span class="seat-name"></span><span class="seat-count"></span></div>
        <div class="seat-cards row center"></div>
      </section>

      <div class="table-mid">
        <section class="seat seat-left hidden" data-seat-slot="1">
          <div class="seat-label"><span class="seat-name"></span><span class="seat-count"></span></div>
          <div class="seat-cards row"></div>
        </section>

        <section class="section discard-section">
          <h2 id="discardLabel">Discard</h2>
          <div id="discard" class="row center"></div>
          <p id="colorLine" class="color-line"></p>
        </section>

        <section class="seat seat-right hidden" data-seat-slot="2">
          <div class="seat-label"><span class="seat-name"></span><span class="seat-count"></span></div>
          <div class="seat-cards row"></div>
        </section>
      </div>

      <section class="seat seat-you">
        <div class="seat-label"><span class="seat-name" id="youLabel">You</span><span id="youCount" class="seat-count"></span></div>
        <div id="hand" class="row wrap"></div>
      </section>
    </div>

    <div id="wildPicker" class="wild-picker hidden">
      <span>Choose color</span>
      <button type="button" class="wild-color red" data-color="red">R</button>
      <button type="button" class="wild-color yellow" data-color="yellow">Y</button>
      <button type="button" class="wild-color green" data-color="green">G</button>
      <button type="button" class="wild-color blue" data-color="blue">B</button>
      <button type="button" id="cancelWildBtn" class="secondary">Cancel</button>
    </div>

    <section class="section actions">
      <button id="drawBtn" type="button">Draw</button>
      <button id="leaveGameBtn" type="button" class="secondary">Leave</button>
      <p id="status" class="status"></p>
    </section>
  </section>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function formatCard(card: { color: string | null; value: string }): string {
  if (card.value === 'wild' || card.value === 'wild4') {
    return card.value === 'wild4' ? 'Wild Draw Four' : 'Wild';
  }
  const color = card.color ? capitalize(card.color) : '';
  return `${color} ${card.value}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
