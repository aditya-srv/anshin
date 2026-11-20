import * as vscode from 'vscode';
import { listGames } from '../games/registry';
import { boardPayload } from '../ludo/board';

/** Bust webview script/style caches when the extension version changes. */
function mediaUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  file: string,
  version: string
): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file)).with({
    query: `v=${encodeURIComponent(version)}`,
  });
}

export function buildSidebarHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  version = '0'
): string {
  const styleUri = mediaUri(webview, extensionUri, 'uno.css', version);
  const ludoStyleUri = mediaUri(webview, extensionUri, 'ludo.css', version);
  const bluffStyleUri = mediaUri(webview, extensionUri, 'bluff.css', version);
  const scriptUri = mediaUri(webview, extensionUri, 'uno.js', version);
  const ludoScriptUri = mediaUri(webview, extensionUri, 'ludo.js', version);
  const bluffScriptUri = mediaUri(webview, extensionUri, 'bluff.js', version);
  const nonce = getNonce();
  const boardJson = JSON.stringify(boardPayload()).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <link href="${ludoStyleUri}" rel="stylesheet" />
  <link href="${bluffStyleUri}" rel="stylesheet" />
  <title>Anshin</title>
</head>
<body class="gui-low">
  <header class="topbar">
    <div class="title" id="appTitle">Anshin</div>
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
    <div class="host-mode" role="group" aria-label="Host mode">
      <button type="button" id="hostLocalBtn" class="mode-btn active" data-mode="local">Local</button>
      <button type="button" id="hostRemoteBtn" class="mode-btn" data-mode="remote">Remote</button>
    </div>
    <label id="serverUrlField" class="field hidden">
      <span>Server Join URL</span>
      <input id="serverUrlInput" type="text" placeholder="ws://host:3847/?t=…" />
    </label>
    <div class="row-actions">
      <button id="hostBtn" type="button">Host room</button>
    </div>
    <label class="field">
      <span>Join URL</span>
      <input id="urlInput" type="text" placeholder="ws://192.168.x.x:3847/?t=…" />
    </label>
    <div class="row-actions">
      <button id="joinBtn" type="button">Join room</button>
    </div>
    <p id="menuStatus" class="status"></p>
  </section>

  <section id="lobbyScreen" class="screen hidden">
    <p class="join-url-label">Share this address</p>
    <code id="joinUrlDisplay" class="join-url"></code>
    <ul id="joinUrlList" class="join-url-list"></ul>
    <button id="copyUrlBtn" type="button" class="secondary">Copy URL</button>
    <h2 class="lobby-heading">Players</h2>
    <ul id="lobbyList" class="lobby-list"></ul>
    <p id="chosenGame" class="chosen-game hidden"></p>
    <div id="hostOpts" class="host-only hidden">
      ${hostOptionsHtml()}
    </div>
    <div class="row-actions">
      <button id="leaveLobbyBtn" type="button" class="secondary">Leave</button>
    </div>
    <p id="lobbyStatus" class="status"></p>
  </section>

  <section id="gameScreen" class="screen hidden">
    <div class="game-scroll">
      <div class="table">
        <div class="table-top">
          <section class="seat seat-top hidden" data-seat-slot="0">
            <div class="seat-label"><span class="seat-name"></span><span class="seat-count"></span></div>
            <div class="seat-cards row center"></div>
          </section>
          <section class="seat seat-top hidden" data-seat-slot="1">
            <div class="seat-label"><span class="seat-name"></span><span class="seat-count"></span></div>
            <div class="seat-cards row center"></div>
          </section>
          <section class="seat seat-top hidden" data-seat-slot="2">
            <div class="seat-label"><span class="seat-name"></span><span class="seat-count"></span></div>
            <div class="seat-cards row center"></div>
          </section>
        </div>

        <div class="table-mid">
          <section class="seat seat-left hidden" data-seat-slot="3">
            <div class="seat-label"><span class="seat-name"></span><span class="seat-count"></span></div>
            <div class="seat-cards row"></div>
          </section>

          <section class="section discard-section">
            <h2 id="discardLabel">Discard</h2>
            <div id="discard" class="row center"></div>
            <p id="unoSaidLine" class="uno-said hidden"></p>
            <p id="colorLine" class="color-line"></p>
          </section>

          <section class="seat seat-right hidden" data-seat-slot="4">
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
    </div>

    <div class="uno-dock-bar hidden">
      <button id="unoBtn" type="button" class="uno-dock">UNO</button>
      <button id="catchBtn" type="button" class="catch-dock">Catch</button>
    </div>
  </section>

  <section id="ludoScreen" class="screen hidden">
    <p id="ludoDice" class="ludo-dice"></p>
    <div id="ludoBoard" class="ludo-board"></div>
    <p id="ludoStatus" class="status"></p>
    <div class="row-actions">
      <button id="ludoRoll" type="button">Roll</button>
      <button id="ludoLeave" type="button" class="secondary">Leave</button>
    </div>
  </section>

  <section id="bluffScreen" class="screen hidden">
    <div class="bluff-scroll">
      <div id="bluffOpponents" class="bluff-opponents"></div>
      <section class="bluff-table">
        <div id="bluffPile" class="bluff-pile"></div>
        <p id="bluffClaim" class="bluff-claim"></p>
        <p id="bluffTableStatus" class="status"></p>
      </section>
      <section class="bluff-hand-section">
        <div class="seat-label"><span id="bluffYouLabel">You</span><span id="bluffYouCount" class="seat-count"></span></div>
        <div id="bluffRanks" class="bluff-ranks" role="group" aria-label="Declare rank"></div>
        <div id="bluffHand" class="bluff-hand row wrap"></div>
        <p id="bluffSelected" class="bluff-selected"></p>
      </section>
      <section id="bluffControls" class="bluff-controls">
        <div class="row-actions">
          <button id="bluffPlay" type="button">Play cards</button>
          <button id="bluffPass" type="button" class="secondary">Pass</button>
          <button id="bluffChallenge" type="button" class="bluff-challenge">Call bluff!</button>
          <button id="bluffLeave" type="button" class="secondary">Leave</button>
        </div>
      </section>
      <p id="bluffStatus" class="status"></p>
    </div>
    <div id="bluffReveal" class="bluff-reveal hidden" role="dialog" aria-modal="true">
      <div class="bluff-reveal-card">
        <h2 id="bluffRevealTitle">Challenge</h2>
        <p id="bluffRevealMsg" class="status"></p>
        <div id="bluffRevealCards" class="bluff-reveal-cards row center"></div>
        <button id="bluffRevealClose" type="button">Continue</button>
      </div>
    </div>
  </section>

  <script nonce="${nonce}" id="ludo-board" type="application/json">${boardJson}</script>
  <script nonce="${nonce}" src="${ludoScriptUri}"></script>
  <script nonce="${nonce}" src="${bluffScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function hostOptionsHtml(): string {
  const options = listGames()
    .map((game) => `<option value="${game.id}">${game.label}</option>`)
    .join('');
  const settings = listGames()
    .map((game) => {
      const hidden = game.id === 'uno' ? '' : ' hidden';
      let body = '';
      if (game.id === 'uno') {
        body = unoSettingsHtml();
      } else if (game.id === 'bluff') {
        body = bluffSettingsHtml();
      }
      return `<div id="settings-${game.id}" class="game-settings${hidden}">${body}</div>`;
    })
    .join('');
  return `<label class="field">
        <span>Game</span>
        <select id="gameSelect">${options}</select>
      </label>
      ${settings}
      <div class="row-actions">
        <button id="startBtn" type="button">Start game</button>
      </div>`;
}

function unoSettingsHtml(): string {
  return `<label class="field">
        <span>Cards each</span>
        <input id="cardsPerPlayerInput" type="number" min="1" max="15" value="7" />
      </label>
      <label class="field">
        <span class="check-row">
          <input id="guaranteeSpecialInput" type="checkbox" checked />
          1 special card each
        </span>
      </label>`;
}

function bluffSettingsHtml(): string {
  return `<p class="game-blurb">Trust nobody. Challenge everyone. · 2–4 players</p>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
