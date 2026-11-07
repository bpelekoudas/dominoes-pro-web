import { boardAward } from "./score.js";
import { isDouble, tileById, type Tile } from "./tiles.js";

export const ARM_IDS = ["west", "east", "north", "south"] as const;
export type ArmId = (typeof ARM_IDS)[number];

export interface OrientedTile {
  tileId: string;
  low: number;
  high: number;
  /** Pip touching the spinner, or the previous tile toward it. */
  inward: number;
  /** Pip facing away from the spinner. This is the match value when the tile is the tip. */
  outward: number;
}

export interface CenterTile {
  tileId: string;
  low: number;
  high: number;
  isSpinner: boolean;
  westValue: number;
  eastValue: number;
}

export interface BoardState {
  center: CenterTile | null;
  /**
   * Tiles grow away from the center. Index 0 touches the center.
   * The last tile is the open tip.
   */
  arms: Record<ArmId, OrientedTile[]>;
  /** True after both long sides of the spinner have a tile. */
  spinnerOpen: boolean;
}

export interface OpenEnd {
  id: string;
  /** Pip a tile must match. The opening lead uses -1 because any tile fits. */
  match: number;
  /** How many pips this end adds. A terminal double adds both halves. */
  scorePips: number;
}

export function emptyBoard(): BoardState {
  return {
    center: null,
    arms: { west: [], east: [], north: [], south: [] },
    spinnerOpen: false,
  };
}

function cloneBoard(board: BoardState): BoardState {
  return structuredClone(board);
}

/**
 * Open ends and what they contribute.
 *
 * A bare double scores both halves once (6–6 is 12, 5–5 is 10).
 * A double sitting at the outer end of an arm scores both halves.
 * A spinner that still has one long side empty is that kind of terminal
 * double, so the empty long side scores twice the face.
 * Once both long sides have a tile, only the outer ends of arms that
 * have been played count. An unplayed side of the spinner, including a
 * short side nobody has played on, adds nothing.
 */
export function openEnds(board: BoardState): OpenEnd[] {
  if (!board.center) return [{ id: "lead", match: -1, scorePips: 0 }];
  const directions: ArmId[] = board.spinnerOpen
    ? ["west", "east", "north", "south"]
    : ["west", "east"];
  return directions.map((direction) => endFor(board, direction));
}

function faceValue(board: BoardState, direction: ArmId): number {
  const center = board.center!;
  return direction === "west" || direction === "north" ? center.westValue : center.eastValue;
}

function emptySidePips(board: BoardState, direction: ArmId): number {
  const value = faceValue(board, direction);
  const center = board.center!;
  // Both long sides are filled. The spinner itself is no longer an end.
  if (center.isSpinner && board.spinnerOpen) return 0;
  if (!center.isSpinner) return value;
  const westEmpty = board.arms.west.length === 0;
  const eastEmpty = board.arms.east.length === 0;
  // Bare double: each face once. One long side still open: that side counts both halves.
  if (westEmpty && eastEmpty) return value;
  return value * 2;
}

/** Blank outer ends stay in the sum. Unplayed spinner sides, after the cross opens, do not. */
function countsTowardTotal(board: BoardState, end: OpenEnd): boolean {
  if (!board.center?.isSpinner || !board.spinnerOpen) return true;
  const arm = board.arms[end.id as ArmId];
  return !arm || arm.length > 0;
}

function endFor(board: BoardState, direction: ArmId): OpenEnd {
  const arm = board.arms[direction];
  if (arm.length === 0) {
    return {
      id: direction,
      match: faceValue(board, direction),
      scorePips: emptySidePips(board, direction),
    };
  }
  const tip = arm[arm.length - 1]!;
  const terminalDouble = tip.low === tip.high;
  return {
    id: direction,
    match: tip.outward,
    scorePips: terminalDouble ? tip.low * 2 : tip.outward,
  };
}

/**
 * The only scoring result for a board. The math line, the running total,
 * and the points a play awards all come from this object, so they cannot
 * disagree. A total of 5 awards nothing. Only a multiple of 5 that is
 * at least 10 awards, and it awards the whole total.
 */
export interface OpenScore {
  /** Counting ends, west to east to north to south. Unplayed spinner sides are left out. */
  parts: number[];
  total: number;
  awarded: number;
  equation: string | null;
}

export function openScore(board: BoardState): OpenScore {
  if (!board.center) return { parts: [], total: 0, awarded: 0, equation: null };
  const parts = openEnds(board)
    .filter((end) => countsTowardTotal(board, end))
    .map((end) => end.scorePips);
  const total = parts.reduce((sum, part) => sum + part, 0);
  const awarded = boardAward(total);
  const equation =
    parts.length === 0 ? "0" : parts.length === 1 ? String(total) : `${parts.join(" + ")} = ${total}`;
  return { parts, total, awarded, equation };
}

export function openTotal(board: BoardState): number {
  return openScore(board).total;
}

export function openEquation(board: BoardState): string | null {
  return openScore(board).equation;
}

export function tilesOnBoard(board: BoardState): string[] {
  const ids: string[] = [];
  if (board.center) ids.push(board.center.tileId);
  for (const direction of ARM_IDS) {
    for (const tile of board.arms[direction]) ids.push(tile.tileId);
  }
  return ids;
}

function attach(tile: Tile, openValue: number): OrientedTile {
  if (tile.low !== openValue && tile.high !== openValue) {
    throw new Error("That tile does not match.");
  }
  if (tile.low === tile.high) {
    return {
      tileId: tile.id,
      low: tile.low,
      high: tile.high,
      inward: tile.low,
      outward: tile.low,
    };
  }
  if (tile.low === openValue) {
    return {
      tileId: tile.id,
      low: tile.low,
      high: tile.high,
      inward: tile.low,
      outward: tile.high,
    };
  }
  return {
    tileId: tile.id,
    low: tile.low,
    high: tile.high,
    inward: tile.high,
    outward: tile.low,
  };
}

interface FlatTile {
  tileId: string;
  low: number;
  high: number;
  west: number;
  east: number;
}

/** West-to-east reading of a board that does not have a spinner yet. */
function flattenLine(board: BoardState): FlatTile[] {
  if (!board.center || board.center.isSpinner) {
    throw new Error("Only a line without a spinner can be promoted.");
  }
  const line: FlatTile[] = [];
  for (let i = board.arms.west.length - 1; i >= 0; i -= 1) {
    const tile = board.arms.west[i]!;
    line.push({
      tileId: tile.tileId,
      low: tile.low,
      high: tile.high,
      west: tile.outward,
      east: tile.inward,
    });
  }
  line.push({
    tileId: board.center.tileId,
    low: board.center.low,
    high: board.center.high,
    west: board.center.westValue,
    east: board.center.eastValue,
  });
  for (const tile of board.arms.east) {
    line.push({
      tileId: tile.tileId,
      low: tile.low,
      high: tile.high,
      west: tile.inward,
      east: tile.outward,
    });
  }
  return line;
}

/**
 * The first double becomes the spinner. Everything already on the line
 * shifts onto the opposite long side. The cross stays closed until the
 * other long side also receives a tile.
 */
function promoteToSpinner(board: BoardState, side: "west" | "east", tile: Tile): BoardState {
  const line = flattenLine(board);
  const next = emptyBoard();
  next.center = {
    tileId: tile.id,
    low: tile.low,
    high: tile.high,
    isSpinner: true,
    westValue: tile.low,
    eastValue: tile.high,
  };
  if (side === "east") {
    next.arms.west = [...line].reverse().map((item) => ({
      tileId: item.tileId,
      low: item.low,
      high: item.high,
      inward: item.east,
      outward: item.west,
    }));
  } else {
    next.arms.east = line.map((item) => ({
      tileId: item.tileId,
      low: item.low,
      high: item.high,
      inward: item.west,
      outward: item.east,
    }));
  }
  return next;
}

function openingBoard(tile: Tile): BoardState {
  const board = emptyBoard();
  if (tile.low === tile.high) {
    board.center = {
      tileId: tile.id,
      low: tile.low,
      high: tile.high,
      isSpinner: true,
      westValue: tile.low,
      eastValue: tile.high,
    };
    return board;
  }
  // Lower pip faces west. Both ends are open, so the direction is only visual.
  board.center = {
    tileId: tile.id,
    low: tile.low,
    high: tile.high,
    isSpinner: false,
    westValue: tile.low,
    eastValue: tile.high,
  };
  return board;
}

export function placeTile(board: BoardState, endId: string, tile: Tile): BoardState {
  if (!board.center) {
    if (endId !== "lead") throw new Error("The first tile opens the table.");
    return openingBoard(tile);
  }
  const ends = openEnds(board);
  const end = ends.find((candidate) => candidate.id === endId);
  if (!end) throw new Error("That end is not open.");
  if (tile.low !== end.match && tile.high !== end.match) {
    throw new Error("That tile does not match the end.");
  }
  if (isDouble(tile.id) && !board.center.isSpinner) {
    if (endId !== "west" && endId !== "east") {
      throw new Error("That end is not open.");
    }
    return promoteToSpinner(board, endId, tile);
  }
  const next = cloneBoard(board);
  const direction = endId as ArmId;
  next.arms[direction].push(attach(tile, end.match));
  if (
    next.center?.isSpinner &&
    !next.spinnerOpen &&
    next.arms.west.length > 0 &&
    next.arms.east.length > 0
  ) {
    next.spinnerOpen = true;
  }
  return next;
}

export function tileFits(tile: Tile, match: number): boolean {
  return tile.low === match || tile.high === match;
}

export { tileById };
