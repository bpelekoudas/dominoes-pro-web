import type { ArmId, BoardState, CenterTile, OrientedTile } from "./board.js";
import { ARM_IDS, openEnds } from "./board.js";

/**
 * Phone-portrait layout for a straight-domino board.
 *
 * Coordinates are design pixels. The spinner sits at the origin. Every
 * client uses this same function, so a hand looks the same on every phone.
 * The view scales the picture into the felt.
 *
 * The felt is tall, matching the board area on a phone once the header is
 * slim. Left and right arms run out of horizontal room first and bend.
 * Up and down arms can travel a long way before they bend.
 * Width is 416 so the tile forced straight off an early double still
 * lands inside: spinner, one tile, a double, then a full tile.
 *
 * An arm leaves the spinner and stays in its own quadrant: east in the
 * bottom-right, south in the bottom-left, west in the top-left, north in
 * the top-right. It goes straight until the next tile would leave that
 * quadrant, then bends clockwise and snakes there. It does not cross the
 * spinner or run into another arm.
 *
 * A double sits crosswise to the chain. The next tile continues in the
 * same direction, its short end centred on the double's long side.
 * A bend is made on a normal tile, before a double, so nothing steps off
 * a double at an angle.
 */

export const TILE_SHORT = 36;
export const TILE_LONG = 72;
export const TILE_GAP = 2;
/** Clear space required between tiles that belong to different arms. */
export const ARM_GAP = TILE_SHORT / 2;
export const END_CAP = 44;
export const FIT_MARGIN = 14;

/**
 * Felt the bends try to stay inside. Tall, like the board on a 412×915
 * phone after the slim header and the hand.
 */
export const PHONE_WIDTH = 416;
export const PHONE_HEIGHT = 700;
/**
 * A double and the centred tile after it cannot turn, so a run of
 * double, tile, double, tile may pass the bend edge. It still has to
 * stay on the table. The view scales that wider picture down.
 */
export const HARD_WIDTH = 1440;
export const HARD_HEIGHT = 1440;

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
  arm: ArmId | null;
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

interface Occupant {
  box: LayoutBox;
  arm: ArmId | null;
}

interface Cursor {
  box: LayoutBox;
  dir: LayoutDir;
  prevDouble: boolean;
}

interface Step {
  box: LayoutBox;
  dir: LayoutDir;
  tile: OrientedTile;
}

export function layoutBoard(board: BoardState): BoardLayout {
  if (!board.center) {
    return { tiles: [], ends: [], fit: { x: -40, y: -40, w: 80, h: 80 } };
  }

  const center = centerBox(board.center);
  const tiles: PlacedTile[] = [centerTile(board.center, center)];
  const occupants: Occupant[] = [{ box: center, arm: null }];
  const centre = centreRegion(center);
  const cursors = new Map<ArmId, Cursor>();

  for (const arm of ARM_IDS) {
    const first = board.arms[arm][0];
    if (!first) continue;
    const box = straightBox(center, arm, first.low === first.high);
    const placed = toTile(first, box, arm, arm);
    tiles.push(placed);
    occupants.push({ box: placed, arm });
    cursors.set(arm, { box: placed, dir: arm, prevDouble: first.low === first.high });
  }

  for (const arm of ARM_IDS) {
    const cursor = cursors.get(arm);
    const chain = board.arms[arm];
    if (!cursor || chain.length < 2) continue;
    const steps: Step[] = [];
    const found = searchArm(chain.slice(1), cursor, arm, occupants, centre, steps, { left: 8000 });
    if (found) {
      let last = cursor;
      for (const step of steps) {
        tiles.push(toTile(step.tile, step.box, step.dir, arm));
        occupants.push({ box: step.box, arm });
        last = { box: step.box, dir: step.dir, prevDouble: step.tile.low === step.tile.high };
      }
      cursors.set(arm, last);
      continue;
    }
    let last = cursor;
    for (let i = 1; i < chain.length; i += 1) {
      const upcoming = chain.slice(i);
      const tile = upcoming[0]!;
      const choice = chooseStep(tile, upcoming, last, arm, occupants, centre);
      tiles.push(toTile(tile, choice.box, choice.dir, arm));
      occupants.push({ box: choice.box, arm });
      last = { box: choice.box, dir: choice.dir, prevDouble: tile.low === tile.high };
    }
    cursors.set(arm, last);
  }

  const ends: PlacedEnd[] = [];
  for (const end of openEnds(board)) {
    if (end.id !== "west" && end.id !== "east" && end.id !== "north" && end.id !== "south") continue;
    const cursor = cursors.get(end.id);
    const cap = cursor ? { ...cursor.box } : capOnCenter(center, end.id);
    ends.push({ ...cap, id: end.id, match: end.match, scorePips: end.scorePips });
  }

  return { tiles, ends, fit: fitAround([...tiles, ...ends]) };
}

/** Prefer a straight run. Backtrack when that run would trap the rest of the arm. */
function searchArm(
  rest: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: Occupant[],
  centre: LayoutBox,
  steps: Step[],
  budget: { left: number },
): boolean {
  if (rest.length === 0) return true;
  if (budget.left-- <= 0) return false;
  const tile = rest[0]!;
  for (const choice of optionsFor(tile, rest, cursor, home, occupants, centre)) {
    occupants.push({ box: choice.box, arm: home });
    steps.push({ box: choice.box, dir: choice.dir, tile });
    const next: Cursor = { box: choice.box, dir: choice.dir, prevDouble: tile.low === tile.high };
    if (searchArm(rest.slice(1), next, home, occupants, centre, steps, budget)) return true;
    steps.pop();
    occupants.pop();
  }
  return false;
}

function optionsFor(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): Array<{ box: LayoutBox; dir: LayoutDir }> {
  const isDouble = tile.low === tile.high;
  const lock = cursor.prevDouble || isDouble;
  const others = occupants.filter((item) => item.arm !== home);
  const straight = straightBox(cursor.box, cursor.dir, isDouble);
  const options: Array<{ box: LayoutBox; dir: LayoutDir }> = [];
  const consider = (box: LayoutBox, dir: LayoutDir, loose: boolean) => {
    if (!fits(box, home, occupants, others, centre, loose)) return;
    if (!loose && !roomForDouble(upcoming, dir, box, home, occupants, centre)) return;
    options.push({ box, dir });
  };
  consider(straight, cursor.dir, false);
  if (lock) {
    consider(straight, cursor.dir, true);
    return options;
  }
  for (const dir of [clockwise(cursor.dir), counter(cursor.dir)]) {
    for (const box of bendChoices(cursor.box, cursor.dir, dir, isDouble)) consider(box, dir, false);
  }
  return options;
}

function bendChoices(prev: LayoutBox, from: LayoutDir, to: LayoutDir, isDouble: boolean): LayoutBox[] {
  const all = bendCandidates(prev, from, to, isDouble);
  const picked = [all[0], all[Math.min(9, all.length - 1)], all[all.length - 1]];
  return picked.filter((box, index) => box && picked.findIndex((other) => other && other.x === box.x && other.y === box.y) === index) as LayoutBox[];
}

function chooseStep(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir } {
  const isDouble = tile.low === tile.high;
  const straight = straightBox(cursor.box, cursor.dir, isDouble);
  const others = occupants.filter((item) => item.arm !== home);
  // A double is crosswise, and the tile after it stays on that line.
  // Neither one is allowed to turn.
  const lock = cursor.prevDouble || isDouble;
  const rest = upcoming.slice(1);

  const straightOk = fits(straight, home, occupants, others, centre) && roomForDouble(upcoming, cursor.dir, straight, home, occupants, centre);
  if (lock) {
    // Stay on the bend line when the centred tile fits. A run of doubles
    // can be longer than the line; only then does it pass the edge.
    if (straightOk) return { box: straight, dir: cursor.dir };
    if (fits(straight, home, occupants, others, centre, true)) return { box: straight, dir: cursor.dir };
    return emergency(tile, cursor, home, occupants, others, centre, true);
  }

  if (straightOk && hasContinuation(straight, cursor.dir, isDouble, rest, home, occupants, centre)) {
    return { box: straight, dir: cursor.dir };
  }

  for (const dir of [clockwise(cursor.dir), counter(cursor.dir)]) {
    for (const box of bendCandidates(cursor.box, cursor.dir, dir, isDouble)) {
      if (!fits(box, home, occupants, others, centre)) continue;
      if (!roomForDouble(upcoming, dir, box, home, occupants, centre)) continue;
      if (!hasContinuation(box, dir, isDouble, rest, home, occupants, centre)) continue;
      return { box, dir };
    }
  }

  if (straightOk) return { box: straight, dir: cursor.dir };
  for (const dir of [clockwise(cursor.dir), counter(cursor.dir)]) {
    for (const box of bendCandidates(cursor.box, cursor.dir, dir, isDouble)) {
      if (!fits(box, home, occupants, others, centre)) continue;
      if (!roomForDouble(upcoming, dir, box, home, occupants, centre)) continue;
      return { box, dir };
    }
  }
  return emergency(tile, cursor, home, occupants, others, centre, false);
}

/** The tile we are about to commit still leaves a legal spot for the one after it. */
function hasContinuation(
  box: LayoutBox,
  dir: LayoutDir,
  placedIsDouble: boolean,
  rest: readonly OrientedTile[],
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): boolean {
  const next = rest[0];
  if (!next) return true;
  const nextDouble = next.low === next.high;
  const owned: Occupant[] = [...occupants, { box, arm: home }];
  const others = owned.filter((item) => item.arm !== home);
  const straight = straightBox(box, dir, nextDouble);
  if (placedIsDouble || nextDouble) return fits(straight, home, owned, others, centre);
  if (fits(straight, home, owned, others, centre) && roomForDouble(rest, dir, straight, home, owned, centre)) return true;
  for (const turn of [clockwise(dir), counter(dir)]) {
    for (const bent of bendCandidates(box, dir, turn, nextDouble)) {
      if (!fits(bent, home, owned, others, centre)) continue;
      if (!roomForDouble(rest, turn, bent, home, owned, centre)) continue;
      return true;
    }
  }
  return false;
}

function roomForDouble(
  upcoming: readonly OrientedTile[],
  dir: LayoutDir,
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): boolean {
  const next = upcoming[1];
  if (!next || next.low !== next.high) return true;
  const owned: Occupant[] = [...occupants, { box, arm: home }];
  const doubleBox = straightBox(box, dir, true);
  const others = owned.filter((item) => item.arm !== home);
  if (!fits(doubleBox, home, owned, others, centre)) return false;
  const after = upcoming[2];
  if (!after) return true;
  const afterBox = straightBox(doubleBox, dir, after.low === after.high);
  const withDouble: Occupant[] = [...owned, { box: doubleBox, arm: home }];
  return fits(afterBox, home, withDouble, withDouble.filter((item) => item.arm !== home), centre);
}

function emergency(
  tile: OrientedTile,
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  others: readonly Occupant[],
  centre: LayoutBox,
  lockStraight: boolean,
): { box: LayoutBox; dir: LayoutDir } {
  const isDouble = tile.low === tile.high;
  const options: Array<{ box: LayoutBox; dir: LayoutDir }> = [
    { box: straightBox(cursor.box, cursor.dir, isDouble), dir: cursor.dir },
  ];
  if (!lockStraight) {
    for (const dir of [clockwise(cursor.dir), counter(cursor.dir)]) {
      for (const box of bendCandidates(cursor.box, cursor.dir, dir, isDouble)) options.push({ box, dir });
    }
  }
  const inside = options.find((option) => fits(option.box, home, occupants, others, centre, lockStraight));
  if (inside) return inside;
  return options[0]!;
}

/** Tuck against the leading corner, then slide inward along that tile so a wider double still fits. */
function bendCandidates(prev: LayoutBox, from: LayoutDir, to: LayoutDir, isDouble: boolean): LayoutBox[] {
  const base = bendBox(prev, from, to, isDouble);
  const { along, across } = extents(isDouble);
  const horizontal = to === "east" || to === "west";
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  const boxes = [base];
  const alongEdge = from === "east" || from === "west";
  const max = Math.max(0, (alongEdge ? prev.w : prev.h) - (alongEdge ? w : h));
  const step = inwardStep(from);
  for (let slide = 2; slide <= max; slide += 2) {
    boxes.push({ x: base.x + step.x * slide, y: base.y + step.y * slide, w, h });
  }
  return boxes;
}

function inwardStep(from: LayoutDir): { x: number; y: number } {
  if (from === "east") return { x: -1, y: 0 };
  if (from === "west") return { x: 1, y: 0 };
  if (from === "south") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function fits(
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  others: readonly Occupant[],
  centre: LayoutBox,
  loose = false,
): boolean {
  if (!(loose ? insideHard(box) : insidePhone(box)) || !inQuadrant(box, home)) return false;
  if (overlapsAny(box, occupants.map((item) => item.box))) return false;
  if (intersectsBox(box, centre)) return false;
  for (const other of others) {
    if (other.arm === null) continue;
    if (boxGap(box, other.box) < ARM_GAP) return false;
  }
  return true;
}

function extents(isDouble: boolean): { along: number; across: number } {
  return isDouble
    ? { along: TILE_SHORT, across: TILE_LONG }
    : { along: TILE_LONG, across: TILE_SHORT };
}

/** Continue in `dir`, centred on the previous tile. */
export function straightBox(prev: LayoutBox, dir: LayoutDir, isDouble: boolean): LayoutBox {
  const { along, across } = extents(isDouble);
  const cx = prev.x + prev.w / 2;
  const cy = prev.y + prev.h / 2;
  if (dir === "east") return { x: prev.x + prev.w + TILE_GAP, y: cy - across / 2, w: along, h: across };
  if (dir === "west") return { x: prev.x - TILE_GAP - along, y: cy - across / 2, w: along, h: across };
  if (dir === "south") return { x: cx - across / 2, y: prev.y + prev.h + TILE_GAP, w: across, h: along };
  return { x: cx - across / 2, y: prev.y - TILE_GAP - along, w: across, h: along };
}

/**
 * Turn onto `to`. The new tile stays against the leading end of the
 * previous tile and extends in the new direction, so a normal corner
 * does not step past the edge the chain just hit.
 */
export function bendBox(prev: LayoutBox, from: LayoutDir, to: LayoutDir, isDouble: boolean): LayoutBox {
  const { along, across } = extents(isDouble);
  const horizontal = to === "east" || to === "west";
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  if (from === "east" && to === "south") return { x: prev.x + prev.w - w, y: prev.y + prev.h + TILE_GAP, w, h };
  if (from === "east" && to === "north") return { x: prev.x + prev.w - w, y: prev.y - TILE_GAP - h, w, h };
  if (from === "west" && to === "north") return { x: prev.x, y: prev.y - TILE_GAP - h, w, h };
  if (from === "west" && to === "south") return { x: prev.x, y: prev.y + prev.h + TILE_GAP, w, h };
  if (from === "south" && to === "west") return { x: prev.x - TILE_GAP - w, y: prev.y + prev.h - h, w, h };
  if (from === "south" && to === "east") return { x: prev.x + prev.w + TILE_GAP, y: prev.y + prev.h - h, w, h };
  if (from === "north" && to === "east") return { x: prev.x + prev.w + TILE_GAP, y: prev.y, w, h };
  if (from === "north" && to === "west") return { x: prev.x - TILE_GAP - w, y: prev.y, w, h };
  return straightBox(prev, to, isDouble);
}

/**
 * Clockwise corner for each arm, including the outgoing axis.
 * East keeps the bottom-right, south the bottom-left, west the top-left,
 * north the top-right. The four regions meet only on the axes.
 */
function inQuadrant(box: LayoutBox, home: ArmId): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (home === "east") return cx > 0 && cy >= 0;
  if (home === "south") return cx <= 0 && cy > 0;
  if (home === "west") return cx < 0 && cy <= 0;
  return cx >= 0 && cy < 0;
}

function centreRegion(center: LayoutBox): LayoutBox {
  const pad = TILE_SHORT;
  return { x: center.x - pad, y: center.y - pad, w: center.w + pad * 2, h: center.h + pad * 2 };
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
    arm: null,
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

export function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5;
}

export function intersectsBox(a: LayoutBox, b: LayoutBox): boolean {
  return boxesOverlap(a, b);
}

/** Distance between two boxes. Zero when they overlap. Diagonal when they only meet at a corner. */
export function boxGap(a: LayoutBox, b: LayoutBox): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  if (dx === 0 && dy === 0) return 0;
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  return Math.hypot(dx, dy);
}

function overlapsAny(box: LayoutBox, others: readonly LayoutBox[]): boolean {
  return others.some((other) => boxesOverlap(box, other));
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
  return insideRect(box, PHONE_WIDTH, PHONE_HEIGHT);
}

export function insideHard(box: LayoutBox): boolean {
  return insideRect(box, HARD_WIDTH, HARD_HEIGHT);
}

function insideRect(box: LayoutBox, width: number, height: number): boolean {
  return (
    box.x >= -width / 2 &&
    box.y >= -height / 2 &&
    box.x + box.w <= width / 2 &&
    box.y + box.h <= height / 2
  );
}
