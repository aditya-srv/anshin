import { BluffPublicState } from '../bluff/types';
import { GameAction } from '../games/types';
import { LudoPublicState } from '../ludo/types';
import { LobbyPlayer } from '../room/protocol';
import { PersonalizedState } from '../uno/types';

export type GuiMode = 'ultra' | 'low' | 'high';

export type Screen = 'menu' | 'lobby' | 'game';

export interface UiState {
  screen: Screen;
  guiMode: GuiMode;
  status: string;
  joinUrl: string;
  joinUrls: string[];
  lobbyPlayers: LobbyPlayer[];
  canStart: boolean;
  youAreHost: boolean;
  yourPlayerId: string;
  yourName: string;
  selectedGame: string;
  gameId: string | null;
  game: PersonalizedState | LudoPublicState | BluffPublicState | null;
}

export type IncomingMessage =
  | { type: 'ready' }
  | { type: 'host'; name: string; remote?: boolean; serverUrl?: string }
  | { type: 'join'; name: string; url: string }
  | { type: 'setGame'; game: string }
  | {
      type: 'startGame';
      game?: string;
      guaranteeSpecial?: boolean;
      cardsPerPlayer?: number;
      deckCount?: number;
      stackDraws?: boolean;
      blockades?: boolean;
      claimMode?: 'same' | 'next';
    }
  | { type: 'leave' }
  | { type: 'action'; action: GameAction }
  | { type: 'copyJoinUrl' }
  | { type: 'setGuiMode'; mode: GuiMode };

export interface WebviewUiState {
  screen: Screen;
  guiMode: GuiMode;
  status: string;
  joinUrl: string;
  joinUrls: string[];
  lobbyPlayers: LobbyPlayer[];
  canStart: boolean;
  youAreHost: boolean;
  yourName: string;
  selectedGame: string;
  defaultServerUrl: string;
  /** Extension package version — joiners compare this when Bluff UI is missing. */
  extensionVersion: string;
  gameId: string | null;
  game: PersonalizedState | LudoPublicState | BluffPublicState | null;
}
