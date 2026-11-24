import { BluffPublicState } from '../bluff/types';
import { DEFAULT_GAME_ID } from '../games/registry';
import { LudoPublicState } from '../ludo/types';
import { ServerMessage } from '../room/protocol';
import { PersonalizedState } from '../uno/types';
import { GuiMode, UiState, WebviewUiState } from './types';

type GameView = PersonalizedState | LudoPublicState | BluffPublicState;

const MENU_STATUS = 'Host locally, or toggle Remote and paste a server Join URL.';

export function createMenuState(status = MENU_STATUS, guiMode: GuiMode = 'low'): UiState {
  return {
    screen: 'menu',
    guiMode,
    status,
    joinUrl: '',
    joinUrls: [],
    lobbyPlayers: [],
    canStart: false,
    youAreHost: false,
    yourPlayerId: '',
    yourName: '',
    selectedGame: DEFAULT_GAME_ID,
    gameId: null,
    game: null,
  };
}

export function statusOf(value: unknown): string {
  if (value && typeof value === 'object' && 'status' in value && typeof value.status === 'string') {
    return value.status;
  }
  return '';
}

export function lobbyStatus(youAreHost: boolean, joinUrl: string, joinUrls: string[] = []): string {
  if (!youAreHost) {
    return 'Waiting for host to start…';
  }
  if (/127\.0\.0\.1|localhost/i.test(joinUrl)) {
    return `Lobby · only this machine can join (${joinUrl})`;
  }
  if (joinUrls.length > 1) {
    return `Lobby · share ${joinUrl}. If someone cannot connect, try the next address.`;
  }
  return `Lobby · share ${joinUrl}`;
}

export function toWebviewState(
  state: UiState,
  defaultServerUrl: string,
  extensionVersion = 'dev'
): WebviewUiState {
  return {
    screen: state.screen,
    guiMode: state.guiMode,
    status: state.status,
    joinUrl: state.joinUrl,
    joinUrls: state.joinUrls,
    lobbyPlayers: state.lobbyPlayers,
    canStart: state.canStart,
    youAreHost: state.youAreHost,
    yourName: state.yourName,
    selectedGame: state.selectedGame,
    defaultServerUrl,
    extensionVersion,
    gameId: state.gameId,
    game: state.game,
  };
}

/** Apply a room message onto UI state. */
export function applyServerMessage(
  state: UiState,
  msg: ServerMessage
): { state: UiState; resumeToken?: string; ended?: boolean } {
  switch (msg.type) {
    case 'lobby': {
      const joinUrls = msg.joinUrls && msg.joinUrls.length > 0 ? msg.joinUrls : [msg.joinUrl];
      const away = msg.players.filter((player) => !player.connected).map((player) => player.name);
      return {
        state: {
          ...state,
          screen: 'lobby',
          lobbyPlayers: msg.players,
          joinUrl: msg.joinUrl,
          joinUrls,
          canStart: msg.canStart,
          youAreHost: msg.youAreHost,
          yourPlayerId: msg.yourPlayerId,
          selectedGame: msg.game || DEFAULT_GAME_ID,
          gameId: null,
          game: null,
          status: away.length
            ? `${away.join(', ')} disconnected. Reconnecting…`
            : lobbyStatus(msg.youAreHost, msg.joinUrl, joinUrls),
        },
        resumeToken: msg.resumeToken,
      };
    }
    case 'state':
      return {
        state: {
          ...state,
          screen: 'game',
          gameId: msg.game,
          game: msg.state as GameView,
          status: statusOf(msg.state),
        },
        resumeToken: msg.resumeToken,
      };
    case 'gameOver': {
      const game = msg.state as GameView;
      const loserId =
        game && typeof game === 'object' && 'loserId' in game
          ? (game as BluffPublicState).loserId
          : null;
      // Bluff elimination ends with a loser; prefer the engine status over "X wins!".
      const overStatus =
        loserId && statusOf(game)
          ? statusOf(game)
          : `${msg.winnerName} wins!`;
      return {
        state: {
          ...state,
          screen: 'game',
          gameId: msg.game,
          game,
          status: overStatus,
        },
        resumeToken: msg.resumeToken,
      };
    }
    case 'waiting':
      return {
        state: {
          ...state,
          screen: 'lobby',
          lobbyPlayers: [],
          canStart: false,
          youAreHost: false,
          gameId: null,
          game: null,
          status: msg.status,
        },
      };
    case 'error':
      return { state: { ...state, status: msg.reason } };
    case 'ended':
      return { state, ended: true };
  }
}
