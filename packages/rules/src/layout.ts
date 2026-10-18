import type { ArmId, BoardState, CenterTile, OrientedTile } from "./board.js";
import { ARM_IDS, openEnds } from "./board.js";

/**
 * Phone-portrait layout for a straight-domino board.
 *
 * Coordinates are design pixels at the readable size. The spinner sits at
 * the origin. Every client uses this same function, so a hand looks the
 * same on every phone. The view scales the result to the screen.
 *
 * A tile's short side is 36 and its long side is 72. Neighbours sit 2px
 * apart. An arm that would leave the phone felt, or crowd another arm,
 * turns 90 degrees. The turn is chosen from the tiles already placed, in
 * a fixed order, so the picture is determined by the board alone.
 */

export const TILE_SHORT = 36;
export const TILE_LONG = 72;
export const TILE_GAP = 2;
export const END_CAP = 44;
export const FIT_MARGIN = 14;

/** Felt the bends try to stay inside, sized for a portrait phone. */
export const PHONE_WIDTH = 352;
export const PHONE_HEIGHT = 440;

const INNER_LEFT = -PHONE_WIDTH / 2 + 8;
const INNER_TOP = -PHONE_HEIGHT / 2 + 8;
const INNER_RIGHT = PHONE_WIDTH / 2 - 8;
const INNER_BOTTOM = PHONE_HEIGHT / 2 - 8;

const TURN_ROOM = TILE_LONG + TILE_GAP;
const MAX_VISITS = 120000;

export type LayoutDir = ArmId;

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedTile extends LayoutBox {
  tileId: string;
  orientation: "horizontal" | "vertical";
  /** Pip in the left half, or the top half when the tile is vertical. */
  a: number;
  b: number;
  spinner: boolean;
  direction: LayoutDir;
}

export interface PlacedEnd extends LayoutBox {
  id: ArmId;
  match: number;
  scorePips: number;
}

export interface BoardLayout {
  tiles: PlacedTile[];
  ends: PlacedEnd[];
  /** Box the view scales. Every tile and end cap sits inside it. */
  fit: LayoutBox;
}

export function layoutBoard(board: BoardState): BoardLayout {
  if (!board.center) {
    return { tiles: [], ends: [], fit: { x: -40, y: -40, w: 80, h: 80 } };
  }

  const center = centerBox(board.center);
  const tiles: PlacedTile[] = [centerTile(board.center, center)];
  const blocked: LayoutBox[] = [center];

  const tips = new Map<ArmId, { box: LayoutBox; dir: LayoutDir }>();
  const starters = new Map<ArmId, PlacedTile>();
  // Claim each open side before any arm snakes, so a long arm cannot sit on another arm's exit.
  for (const arm of ARM_IDS) {
    const first = board.arms[arm][0];
    if (!first) continue;
    const starter = placeStarter(first, arm, center, blocked);
    starters.set(arm, starter);
    tiles.push(starter);
    blocked.push(starter);
    tips.set(arm, { box: starter, dir: starter.direction });
  }

  // Arms take turns growing. Searching them together lets a long chain bend
  // away from a short one instead of sitting on its exit.
  const routed = routeArms(board, tips, blocked);
  if (routed) {
    tiles.push(...routed);
  } else {
    tiles.push(...greedyArms(board, tips, blocked));
  }

  const ends: PlacedEnd[] = [];
  for (const end of openEnds(board)) {
    if (end.id !== "west" && end.id !== "east" && end.id !== "north" && end.id !== "south") continue;
    const tip = tips.get(end.id);
    // A played arm already owns its tip tile. The button sits on that tile,
    // so it cannot collide with a neighbouring row.
    const cap = tip ? { ...tip.box } : capOnCenter(center, end.id);
    ends.push({ ...cap, id: end.id, match: end.match, scorePips: end.scorePips });
  }

  return { tiles, ends, fit: fitAround([...tiles, ...ends]) };
}

function placeStarter(tile: OrientedTile, arm: LayoutDir, center: LayoutBox, blocked: LayoutBox[]): PlacedTile {
  const choices = orderedDirs(arm, arm).map((dir) => ({
    dir,
    box: placeBox(center, arm, dir, tile.low === tile.high),
  }));
  const clear = choices.filter((choice) => !overlapsAny(choice.box, blocked));
  const insideClear = clear.find((choice) => inside(choice.box));
  const choice = insideClear ?? clear[0] ?? choices[0]!;
  return toTile(tile, choice.box, choice.dir);
}

interface Job {
  arm: ArmId;
  tile: OrientedTile;
}

function armJobs(board: BoardState, tips: Map<ArmId, { box: LayoutBox; dir: LayoutDir }>): Job[] {
  const jobs: Job[] = [];
  const index: Record<ArmId, number> = { west: 1, east: 1, north: 1, south: 1 };
  let more = true;
  while (more) {
    more = false;
    for (const arm of ARM_IDS) {
      const chain = board.arms[arm];
      if (!tips.has(arm) || index[arm] >= chain.length) continue;
      jobs.push({ arm, tile: chain[index[arm]]! });
      index[arm] += 1;
      more = true;
    }
  }
  return jobs;
}

function routeArms(
  board: BoardState,
  tips: Map<ArmId, { box: LayoutBox; dir: LayoutDir }>,
  blocked: LayoutBox[],
): PlacedTile[] | null {
  const jobs = armJobs(board, tips);
  if (jobs.length === 0) return [];
  const chosen: PlacedTile[] = new Array(jobs.length);
  let visits = 0;

  const go = (step: number): boolean => {
    if (step >= jobs.length) return true;
    if (++visits > MAX_VISITS) return false;
    const job = jobs[step]!;
    const cursor = tips.get(job.arm)!;
    for (const option of candidates(job.tile, cursor.dir, cursor.box, job.arm, blocked)) {
      const placed = toTile(job.tile, option.box, option.dir);
      blocked.push(placed);
      tips.set(job.arm, { box: placed, dir: placed.direction });
      chosen[step] = placed;
      if (go(step + 1)) return true;
      blocked.pop();
      tips.set(job.arm, cursor);
    }
    return false;
  };

  return go(0) ? chosen : null;
}

function candidates(
  tile: OrientedTile,
  from: LayoutDir,
  prev: LayoutBox,
  home: LayoutDir,
  blocked: LayoutBox[],
): Array<{ dir: LayoutDir; box: LayoutBox }> {
  const isDouble = tile.low === tile.high;
  const options: Array<{ dir: LayoutDir; box: LayoutBox; score: number }> = [];
  for (const dir of orderedDirs(from, home)) {
    const base = placeBox(prev, from, dir, isDouble);
    for (let shift = 0; shift <= 2; shift += 1) {
      const box = moveBox(base, dir, shift * (TILE_SHORT + TILE_GAP));
      if (!insidePhone(box) || overlapsAny(box, blocked)) continue;
      const cramped = dir === from && slack(box, dir) < TURN_ROOM;
      const score = overflow(box) + (leavesHome(box, home) ? 12 : 0) + (cramped ? 4 : 0) + shift * 8;
      options.push({ dir, box, score });
    }
  }
  options.sort((a, b) => a.score - b.score);
  return options;
}

function greedyArms(
  board: BoardState,
  tips: Map<ArmId, { box: LayoutBox; dir: LayoutDir }>,
  blocked: LayoutBox[],
): PlacedTile[] {
  const placed: PlacedTile[] = [];
  for (const job of armJobs(board, tips)) {
    const cursor = tips.get(job.arm)!;
    const options = candidates(job.tile, cursor.dir, cursor.box, job.arm, blocked);
    const choice = options[0] ?? fallbackStep(job.tile, cursor.dir, cursor.box, blocked);
    const tile = toTile(job.tile, choice.box, choice.dir);
    placed.push(tile);
    blocked.push(tile);
    tips.set(job.arm, { box: tile, dir: tile.direction });
  }
  return placed;
}

function fallbackStep(
  tile: OrientedTile,
  from: LayoutDir,
  prev: LayoutBox,
  blocked: LayoutBox[],
): { dir: LayoutDir; box: LayoutBox } {
  const isDouble = tile.low === tile.high;
  return orderedDirs(from, from)
    .map((dir) => ({ dir, box: placeBox(prev, from, dir, isDouble) }))
    .sort((a, b) => overlapAmount(a.box, blocked) - overlapAmount(b.box, blocked))[0]!;
}

function moveBox(box: LayoutBox, dir: LayoutDir, amount: number): LayoutBox {
  if (amount === 0) return box;
  if (dir === "east") return { ...box, x: box.x + amount };
  if (dir === "west") return { ...box, x: box.x - amount };
  if (dir === "south") return { ...box, y: box.y + amount };
  return { ...box, y: box.y - amount };
}

function orderedDirs(from: LayoutDir, home: LayoutDir): LayoutDir[] {
  const preferred = preferredTurn(from, home);
  const other = preferred === clockwise(from) ? counter(from) : clockwise(from);
  return [from, preferred, other];
}

function preferredTurn(from: LayoutDir, home: LayoutDir): LayoutDir {
  // Opposite arms curl opposite ways, so their first bends leave the middle.
  const clock = home === "east" || home === "south";
  return clock ? clockwise(from) : counter(from);
}

function placeBox(prev: LayoutBox, from: LayoutDir, to: LayoutDir, isDouble: boolean): LayoutBox {
  const along = isDouble ? TILE_SHORT : TILE_LONG;
  const across = isDouble ? TILE_LONG : TILE_SHORT;
  if (from === to) {
    const horizontal = to === "east" || to === "west";
    return straightBox(prev, to, horizontal ? along : across, horizontal ? across : along);
  }
  const midX = prev.x + prev.w / 2;
  const midY = prev.y + prev.h / 2;
  const band = TILE_SHORT;
  if (from === "east" || from === "west") {
    const x = from === "east" ? prev.x + prev.w + TILE_GAP : prev.x - TILE_GAP - across;
    const y = to === "south" ? midY - band / 2 : midY + band / 2 - along;
    return { x, y, w: across, h: along };
  }
  const y = from === "south" ? prev.y + prev.h + TILE_GAP : prev.y - TILE_GAP - across;
  const x = to === "east" ? midX - band / 2 : midX + band / 2 - along;
  return { x, y, w: along, h: across };
}

function straightBox(prev: LayoutBox, dir: LayoutDir, w: number, h: number): LayoutBox {
  if (dir === "east") return { x: prev.x + prev.w + TILE_GAP, y: prev.y + prev.h / 2 - h / 2, w, h };
  if (dir === "west") return { x: prev.x - TILE_GAP - w, y: prev.y + prev.h / 2 - h / 2, w, h };
  if (dir === "south") return { x: prev.x + prev.w / 2 - w / 2, y: prev.y + prev.h + TILE_GAP, w, h };
  return { x: prev.x + prev.w / 2 - w / 2, y: prev.y - TILE_GAP - h, w, h };
}

function capOnCenter(center: LayoutBox, dir: LayoutDir): LayoutBox {
  if (dir === "west") return { x: center.x, y: center.y, w: center.w / 2, h: center.h };
  if (dir === "east") return { x: center.x + center.w / 2, y: center.y, w: center.w / 2, h: center.h };
  if (dir === "north") return { x: center.x, y: center.y, w: center.w, h: center.h / 2 };
  return { x: center.x, y: center.y + center.h / 2, w: center.w, h: center.h / 2 };
}

function centerBox(center: CenterTile): LayoutBox {
  const spinner = center.low === center.high;
  const w = spinner ? TILE_SHORT : TILE_LONG;
  const h = spinner ? TILE_LONG : TILE_SHORT;
  return { x: -w / 2, y: -h / 2, w, h };
}

function centerTile(center: CenterTile, box: LayoutBox): PlacedTile {
  const spinner = center.low === center.high;
  return {
    ...box,
    tileId: center.tileId,
    orientation: spinner ? "vertical" : "horizontal",
    a: center.westValue,
    b: center.eastValue,
    spinner: center.isSpinner,
    direction: "east",
  };
}

function toTile(tile: OrientedTile, box: LayoutBox, direction: LayoutDir): PlacedTile {
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
  };
}

function clockwise(dir: LayoutDir): LayoutDir {
  if (dir === "east") return "south";
  if (dir === "south") return "west";
  if (dir === "west") return "north";
  return "east";
}

function counter(dir: LayoutDir): LayoutDir {
  if (dir === "east") return "north";
  if (dir === "north") return "west";
  if (dir === "west") return "south";
  return "east";
}

function leavesHome(box: LayoutBox, home: LayoutDir): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (home === "west") return cx > 1;
  if (home === "east") return cx < -1;
  if (home === "north") return cy > 1;
  return cy < -1;
}

function inside(box: LayoutBox): boolean {
  return box.x >= INNER_LEFT && box.y >= INNER_TOP && box.x + box.w <= INNER_RIGHT && box.y + box.h <= INNER_BOTTOM;
}

function slack(box: LayoutBox, dir: LayoutDir): number {
  if (dir === "east") return INNER_RIGHT - (box.x + box.w);
  if (dir === "west") return box.x - INNER_LEFT;
  if (dir === "south") return INNER_BOTTOM - (box.y + box.h);
  return box.y - INNER_TOP;
}

function overflow(box: LayoutBox): number {
  const left = Math.max(0, INNER_LEFT - box.x);
  const top = Math.max(0, INNER_TOP - box.y);
  const right = Math.max(0, box.x + box.w - INNER_RIGHT);
  const bottom = Math.max(0, box.y + box.h - INNER_BOTTOM);
  return left + top + right + bottom;
}

export function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5;
}

function overlapsAny(box: LayoutBox, others: LayoutBox[]): boolean {
  return others.some((other) => boxesOverlap(box, other));
}

function overlapAmount(box: LayoutBox, others: LayoutBox[]): number {
  let area = 0;
  for (const other of others) {
    const w = Math.min(box.x + box.w, other.x + other.w) - Math.max(box.x, other.x);
    const h = Math.min(box.y + box.h, other.y + other.h) - Math.max(box.y, other.y);
    if (w > 0 && h > 0) area += w * h;
  }
  return area;
}

function fitAround(boxes: LayoutBox[]): LayoutBox {
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
  return {
    x: minX - FIT_MARGIN,
    y: minY - FIT_MARGIN,
    w: maxX - minX + FIT_MARGIN * 2,
    h: maxY - minY + FIT_MARGIN * 2,
  };
}

export function insidePhone(box: LayoutBox): boolean {
  return (
    box.x >= -PHONE_WIDTH / 2 &&
    box.y >= -PHONE_HEIGHT / 2 &&
    box.x + box.w <= PHONE_WIDTH / 2 &&
    box.y + box.h <= PHONE_HEIGHT / 2
  );
}
