import { ludoModule } from '../ludo/module';
import { unoModule } from '../uno/module';
import { GameModule } from './types';

export const DEFAULT_GAME_ID = 'uno';

const MODULES: readonly GameModule[] = [unoModule, ludoModule];

export function listGames(): GameModule[] {
  return [...MODULES];
}

export function getGame(id: string): GameModule | undefined {
  return MODULES.find((game) => game.id === id);
}

/** Hard ceiling for seats in a room (largest published game max). */
export function roomSeatCap(): number {
  return MODULES.reduce((max, game) => Math.max(max, game.maxPlayers), 2);
}
