import type { ArmId, BoardState, OrientedTile } from "./board.js";
import { openEnds } from "./board.js";
import {
  TILE_LONG,
  boxGap,
  type BoardLayout,
  type LayoutBox,
  type LayoutDir,
  type PlacedEnd,
  type PlacedTile,
} from "./layout.js";

/** One long side. Every pinwheel measurement is a multiple of this. */
export const L = TILE_LONG;
/** Joined faces sit this far apart. 0.04 of the long side. */
export const JOIN_GAP = 0.04 * L;
/** Centre-to-centre of two ordinary tiles on a straight run. */
export const PITCH = 1.04 * L;
/** Tiles in a straight run before the next one turns. */
export const ROW_CAP = 3;
/** How far a corner steps outward, and along the new direction. */
export const CORNER_OUT = 0.25 * L;
export const CORNER_ALONG = 0.79 * L;

const STEP: Record<LayoutDir, { x: number; y: number }> = {
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
  south: { x: 0, y: 1 },
  north: { x: 0, y: -1 },
};

function clockwise(dir: LayoutDir): LayoutDir {
  if (dir === "east") return "south";
  if (dir === "south") return "west";
  if (dir === "west") return "north";
  return "east";
}

function counterClockwise(dir: LayoutDir): LayoutDir {
  return clockwise(clockwise(clockwise(dir)));
}

/**
 * One rotational sense for every arm: west drops, east rises, north turns
 * left, south turns to screen-right. The two spinner arms leave on opposite
 * sides, so a long hand stays a pinwheel instead of two arms sharing a lane.
 */
export function pinwheelTurn(_arm: ArmId, dir: LayoutDir): LayoutDir {
  return counterClockwise(dir);
}

function isDouble(tile: OrientedTile): boolean {
  return tile.low === tile.high;
}

/** Size of a tile traveling `dir`. A double lies crosswise, centred on the axis. */
export function tileSize(dir: LayoutDir, double: boolean): { w: number; h: number } {
  const along = double ? L / 2 : L;
  const across = double ? L : L / 2;
  if (dir === "east" || dir === "west") return { w: along, h: across };
  return { w: across, h: along };
}

function halfAlong(double: boolean): number {
  return double ? L / 4 : L / 2;
}

function halfAcross(double: boolean): number {
  return double ? L / 2 : L / 4;
}

export function boxFromCenter(center: { x: number; y: number }, dir: LayoutDir, double: boolean): LayoutBox {
  const size = tileSize(dir, double);
  return { x: center.x - size.w / 2, y: center.y - size.h / 2, w: size.w, h: size.h };
}

function centerOf(box: LayoutBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** First tile on an arm, gap 0.04 L off the spinner. */
export function firstCenter(spinner: LayoutBox, arm: ArmId, double: boolean): { x: number; y: number } {
  const hub = centerOf(spinner);
  const spinnerHalf = arm === "east" || arm === "west" ? spinner.w / 2 : spinner.h / 2;
  const dist = spinnerHalf + JOIN_GAP + halfAlong(double);
  const step = STEP[arm];
  return { x: hub.x + step.x * dist, y: hub.y + step.y * dist };
}

export function straightCenter(
  prev: { x: number; y: number },
  dir: LayoutDir,
  prevDouble: boolean,
  nextDouble: boolean,
): { x: number; y: number } {
  const dist = halfAlong(prevDouble) + JOIN_GAP + halfAlong(nextDouble);
  const step = STEP[dir];
  return { x: prev.x + step.x * dist, y: prev.y + step.y * dist };
}

/**
 * The corner sits flush with the outer end of the previous tile and
 * meets its side with the same joined gap. West's first corner is
 * (−2.87 L, 0) → (−3.12 L, +0.79 L), within 0.01 L of the measured hook.
 */
export function cornerCenter(
  prev: { x: number; y: number },
  travel: LayoutDir,
  turn: LayoutDir,
  prevDouble: boolean,
  nextDouble: boolean,
): { x: number; y: number } {
  const outward = STEP[travel];
  const along = STEP[turn];
  // Flush with the outer end. The new tile's end meets that end; it is not
  // slid sideways along the previous tile.
  const outShift = halfAlong(prevDouble) - halfAcross(nextDouble);
  const turnShift = halfAcross(prevDouble) + JOIN_GAP + halfAlong(nextDouble);
  return {
    x: prev.x + outward.x * outShift + along.x * turnShift,
    y: prev.y + outward.y * outShift + along.y * turnShift,
  };
}

function toTile(tile: OrientedTile, box: LayoutBox, direction: LayoutDir, arm: ArmId): PlacedTile {
  const halves = direction === "east" || direction === "south"
    ? { a: tile.inward, b: tile.outward }
    : { a: tile.outward, b: tile.inward };
  return {
    ...box,
    tileId: tile.tileId,
    orientation: box.w >= box.h ? "horizontal" : "vertical",
    a: halves.a,
    b: halves.b,
    spinner: false,
    direction,
    arm,
  };
}

interface Cursor {
  center: { x: number; y: number };
  dir: LayoutDir;
  run: number;
  double: boolean;
}

/** The 90° turn whose step points away from the spinner. */
function turnOutward(dir: LayoutDir, center: { x: number; y: number }): LayoutDir {
  const options = [counterClockwise(dir), clockwise(dir)];
  let best = options[0];
  let bestDot = -Infinity;
  for (const option of options) {
    const step = STEP[option];
    const dot = step.x * center.x + step.y * center.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = option;
    }
  }
  return best;
}

function crowded(box: LayoutBox, own: readonly LayoutBox[], parent: LayoutBox | null): boolean {
  return own.some((other) => {
    if (parent && Math.abs(other.x - parent.x) < 0.2 && Math.abs(other.y - parent.y) < 0.2
      && Math.abs(other.w - parent.w) < 0.2 && Math.abs(other.h - parent.h) < 0.2) return false;
    return boxGap(box, other) < 0.5 * L - 0.5;
  });
}

function placeChain(arm: ArmId, chain: readonly OrientedTile[], spinner: LayoutBox): PlacedTile[] {
  const out: PlacedTile[] = [];
  let cursor: Cursor | null = null;
  let segment = 0;
  for (const tile of chain) {
    const double = isDouble(tile);
    let dir: LayoutDir = arm;
    let run = 0;
    if (cursor) {
      dir = cursor.dir;
      run = cursor.run;
    }
    let center: { x: number; y: number };
    if (!cursor) {
      dir = arm;
      center = firstCenter(spinner, arm, double);
      run = 1;
    } else if (run >= ROW_CAP && !double) {
      // The opening turn is the measured pinwheel. Every later turn steps
      // further from the spinner. A double stays on the arm it is already on,
      // crosswise, so a corner is always a flush end-to-end join.
      const turn: LayoutDir = segment === 0 ? pinwheelTurn(arm, dir) : turnOutward(dir, cursor.center);
      const corner = cornerCenter(cursor.center, dir, turn, cursor.double, double);
      const parent = boxFromCenter(cursor.center, cursor.dir, cursor.double);
      const own = out.map((laid) => ({ x: laid.x, y: laid.y, w: laid.w, h: laid.h }));
      if (crowded(boxFromCenter(corner, turn, double), own, parent)) {
        center = straightCenter(cursor.center, dir, cursor.double, double);
        run += 1;
      } else {
        center = corner;
        dir = turn;
        run = 1;
        segment += 1;
      }
    } else {
      center = straightCenter(cursor.center, dir, cursor.double, double);
      run += 1;
    }
    out.push(toTile(tile, boxFromCenter(center, dir, double), dir, arm));
    cursor = { center, dir, run, double };
  }
  return out;
}

function centerTile(board: BoardState): PlacedTile {
  const center = board.center!;
  const spinner = center.low === center.high;
  const w = spinner ? L / 2 : L;
  const h = spinner ? L : L / 2;
  return {
    x: -w / 2,
    y: -h / 2,
    w,
    h,
    tileId: center.tileId,
    orientation: spinner ? "vertical" : "horizontal",
    a: center.westValue,
    b: center.eastValue,
    spinner: center.isSpinner,
    direction: "east",
    arm: null,
  };
}

function fitOf(boxes: readonly LayoutBox[]): LayoutBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  if (!Number.isFinite(minX)) return { x: -L, y: -L, w: 2 * L, h: 2 * L };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/** The chain PlayDrift draws: a centred spinner and a pinwheel on fixed lanes. */
export function layoutPinwheel(board: BoardState): BoardLayout {
  if (!board.center) {
    return { tiles: [], ends: [], fit: { x: -L, y: -L, w: 2 * L, h: 2 * L }, previews: {} };
  }
  const hub = centerTile(board);
  const tiles: PlacedTile[] = [hub];
  for (const arm of ["west", "east", "north", "south"] as const) {
    for (const laid of placeChain(arm, board.arms[arm], hub)) tiles.push(laid);
  }
  const ends: PlacedEnd[] = [];
  const previews: BoardLayout["previews"] = {};
  for (const end of openEnds(board)) {
    if (end.id !== "west" && end.id !== "east" && end.id !== "north" && end.id !== "south") continue;
    const arm = end.id;
    const chain = board.arms[arm];
    if (chain.length === 0) {
      const slot = boxFromCenter(firstCenter(hub, arm, false), arm, false);
      ends.push({ ...slot, id: arm, match: end.match, scorePips: end.scorePips });
      previews[arm] = slot;
      continue;
    }
    const last = [...tiles].reverse().find((tile) => tile.arm === arm);
    if (!last) continue;
    ends.push({ x: last.x, y: last.y, w: last.w, h: last.h, id: arm, match: end.match, scorePips: end.scorePips });
    const ghost = placeChain(arm, [...chain, { tileId: "ghost", low: 0, high: 1, inward: 0, outward: 1 }], hub);
    const next = ghost[ghost.length - 1];
    if (next) previews[arm] = { x: next.x, y: next.y, w: next.w, h: next.h };
  }
  return { tiles, ends, fit: fitOf(tiles), previews };
}
