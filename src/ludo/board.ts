import { LudoColor } from './types';

/** Clockwise main track. Index 0 is red's start. [row, col], origin top-left. */
export const TRACK: ReadonlyArray<readonly [number, number]> = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];

export const TRACK_LENGTH = TRACK.length;

export const START_INDEX: Record<LudoColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

export const STAR_INDEXES: readonly number[] = [8, 21, 34, 47];

const SAFE = new Set<number>([
  START_INDEX.red,
  START_INDEX.green,
  START_INDEX.yellow,
  START_INDEX.blue,
  ...STAR_INDEXES,
]);

export function isSafeTrack(trackIndex: number): boolean {
  return SAFE.has(trackIndex);
}

export function trackIndexFor(color: LudoColor, progress: number): number {
  return (START_INDEX[color] + progress) % TRACK_LENGTH;
}

/** Five home squares, outer to inner, then the center is progress 56. */
export const HOME: Record<LudoColor, ReadonlyArray<readonly [number, number]>> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

/**
 * Logical yard slots inside each 6×6 corner (1-cell color ring + 4×4 white nest).
 * GUI ignores these cell centers and places tokens on a virtual 5×5 over the nest.
 */
export const YARD_SLOTS: Record<LudoColor, ReadonlyArray<readonly [number, number]>> = {
  red: [[2, 2], [2, 4], [4, 2], [4, 4]],
  green: [[2, 11], [2, 13], [4, 11], [4, 13]],
  yellow: [[11, 11], [11, 13], [13, 11], [13, 13]],
  blue: [[11, 2], [11, 4], [13, 2], [13, 4]],
};

export interface BoardCell {
  row: number;
  col: number;
  kind: 'track' | 'home' | 'yard' | 'center';
  trackIndex?: number;
  color?: LudoColor;
  homeStep?: number;
  yardSlot?: number;
  star?: boolean;
  start?: boolean;
}

const CORNERS: ReadonlyArray<{ color: LudoColor; row: number; col: number }> = [
  { color: 'red', row: 0, col: 0 },
  { color: 'green', row: 0, col: 9 },
  { color: 'yellow', row: 9, col: 9 },
  { color: 'blue', row: 9, col: 0 },
];

/** Last progress still on the main track before the home column. */
export const LAST_TRACK = 50;

/** Progress value for a finished token. */
export const DONE_PROGRESS = 56;

export interface BoardPayload {
  cells: BoardCell[];
  startIndex: Record<LudoColor, number>;
  trackLength: number;
  lastTrack: number;
  done: number;
  yardCorners: Record<LudoColor, readonly [number, number]>;
}

/** Full board description for the webview (cells + layout constants). */
export function boardPayload(): BoardPayload {
  const yardCorners = {} as Record<LudoColor, readonly [number, number]>;
  for (const corner of CORNERS) {
    yardCorners[corner.color] = [corner.row, corner.col];
  }
  return {
    cells: boardCells(),
    startIndex: { ...START_INDEX },
    trackLength: TRACK_LENGTH,
    lastTrack: LAST_TRACK,
    done: DONE_PROGRESS,
    yardCorners,
  };
}

export function boardCells(): BoardCell[] {
  const cells: BoardCell[] = [];
  const slotKey = new Map<string, { color: LudoColor; yardSlot: number }>();
  (Object.keys(YARD_SLOTS) as LudoColor[]).forEach((color) => {
    YARD_SLOTS[color].forEach(([row, col], yardSlot) => {
      slotKey.set(`${row},${col}`, { color, yardSlot });
    });
  });

  for (const corner of CORNERS) {
    for (let row = corner.row; row < corner.row + 6; row++) {
      for (let col = corner.col; col < corner.col + 6; col++) {
        const slot = slotKey.get(`${row},${col}`);
        cells.push({
          row,
          col,
          kind: 'yard',
          color: corner.color,
          yardSlot: slot?.yardSlot,
        });
      }
    }
  }

  for (let row = 6; row <= 8; row++) {
    for (let col = 6; col <= 8; col++) {
      cells.push({ row, col, kind: 'center' });
    }
  }

  (Object.keys(HOME) as LudoColor[]).forEach((color) => {
    HOME[color].forEach(([row, col], homeStep) => {
      cells.push({ row, col, kind: 'home', color, homeStep });
    });
  });

  TRACK.forEach(([row, col], trackIndex) => {
    const startColor = (Object.keys(START_INDEX) as LudoColor[]).find(
      (color) => START_INDEX[color] === trackIndex
    );
    cells.push({
      row,
      col,
      kind: 'track',
      trackIndex,
      color: startColor,
      star: STAR_INDEXES.includes(trackIndex),
      start: startColor !== undefined,
    });
  });

  return cells;
}
