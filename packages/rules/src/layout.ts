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
 * An arm leaves the spinner in its own quadrant. It runs straight, then
 * bends at the edge of the phone. The first bend prefers the clockwise
 * side (up turns right, right turns down, down turns left, left turns
 * up) unless the other side is clearly emptier. A second bend prefers
 * to keep going outward, but turns back across the open felt when that
 * uses the empty half of the table and still keeps a full tile of
 * clearance. The chain does not fold onto another arm or onto itself.
 * If neither bend fits, the arm stays straight and the felt zooms out.
 *
 * A double sits crosswise to the chain. The next tile continues in the
 * same direction, its short end centred on the double's long side.
 * A bend is made on a normal tile, before a double, so nothing steps off
 * a double at an angle.
 */

export const TILE_SHORT = 36;
export const TILE_LONG = 72;
export const TILE_GAP = 2;
/** Clear space between different chains, and between separate runs of one chain. */
export const ARM_GAP = TILE_SHORT;
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
export const HARD_WIDTH = 4000;
export const HARD_HEIGHT = 4000;

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
  bends: number;
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
    cursors.set(arm, { box: placed, dir: arm, prevDouble: first.low === first.high, bends: 0 });
  }

  for (const arm of ARM_IDS) {
    let cursor = cursors.get(arm);
    const chain = board.arms[arm];
    if (!cursor || chain.length < 2) continue;
    for (let index = 1; index < chain.length; index += 1) {
      const upcoming = chain.slice(index);
      const tile = upcoming[0]!;
      const choice = chooseStep(tile, upcoming, cursor, arm, occupants, centre);
      const placed = toTile(tile, choice.box, choice.dir, arm);
      tiles.push(placed);
      occupants.push({ box: placed, arm });
      cursor = {
        box: placed,
        dir: choice.dir,
        prevDouble: tile.low === tile.high,
        bends: choice.bends,
      };
    }
    cursors.set(arm, cursor);
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

/**
 * One tile of imbalance. The outward bend wins a tie. The other way
 * wins when it pulls the chain's box clearly closer to the spinner.
 */
const TURN_BIAS = 72;

/**
 * Go straight while the next tile fits on the phone. Bend when it would
 * leave the felt or crowd another run. The clockwise / outward turn is
 * preferred, and the other perpendicular is used when the rest of that
 * run would sit in the empty half of the table. A double, and the tile
 * centred on it, never bend.
 */
function chooseStep(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number } {
  const isDouble = tile.low === tile.high;
  const lock = cursor.prevDouble || isDouble;
  const straight = straightBox(cursor.box, cursor.dir, isDouble);
  const keep = { box: straight, dir: cursor.dir, bends: cursor.bends };

  if (lock) return keep;

  const straightOk = fits(straight, home, occupants, centre, true, cursor.box)
    && roomForDouble(upcoming, cursor.dir, straight, home, occupants, centre, true);
  if (straightOk) return keep;

  if (cursor.bends >= 2) return keep;
  // First bend: clockwise, or the other way when that side is open.
  // Second bend: further outward, or back across the empty felt.
  const preferred: LayoutDir = cursor.dir === home ? clockwise(home) : home;
  const alternate = opposite(preferred);
  const secondBend = cursor.bends >= 1;
  let best: { box: LayoutBox; dir: LayoutDir; score: number } | null = null;
  for (const turn of [preferred, alternate]) {
    const pinwheel = turn === preferred;
    const choices = bendChoices(cursor.box, cursor.dir, turn, isDouble);
    for (let slide = 0; slide < choices.length; slide += 1) {
      const box = choices[slide]!;
      // The outward turn stays in the arm's quadrant. The turn toward
      // open felt may cross the midline, but not another chain.
      if (!fits(box, home, occupants, centre, true, cursor.box, pinwheel)) continue;
      if (secondBend && pinwheel && !pointsAway(box, turn)) continue;
      if (secondBend && !laneFitsDouble(turn, box, home, occupants, centre, pinwheel)) continue;
      if (!roomForDouble(upcoming, turn, box, home, occupants, centre, false, pinwheel)) continue;
      const score = projectedImbalance(box, turn, upcoming, occupants, centre)
        - (pinwheel ? TURN_BIAS : 0)
        + slide * 4;
      if (!best || score < best.score) best = { box, dir: turn, score };
    }
  }
  if (!best) return keep;
  return { box: best.box, dir: best.dir, bends: cursor.bends + 1 };
}

/** How far the chain's box sits from the spinner after a short run this way. */
function projectedImbalance(
  start: LayoutBox,
  dir: LayoutDir,
  upcoming: readonly OrientedTile[],
  occupants: readonly Occupant[],
  centre: LayoutBox,
): number {
  const boxes: LayoutBox[] = occupants.map((item) => item.box);
  boxes.push(start);
  let prev = start;
  const limit = Math.min(upcoming.length, 7);
  for (let index = 1; index < limit; index += 1) {
    const nextTile = upcoming[index]!;
    const next = straightBox(prev, dir, nextTile.low === nextTile.high);
    if (!insidePhone(next) || overlapsAny(next, boxes) || intersectsBox(next, centre)) break;
    let crowded = false;
    for (const other of boxes) {
      if (sameBox(other, prev)) continue;
      if (boxGap(next, other) < ARM_GAP) {
        crowded = true;
        break;
      }
    }
    if (crowded) break;
    boxes.push(next);
    prev = next;
  }
  return bboxImbalance(boxes);
}

function bboxImbalance(boxes: readonly LayoutBox[]): number {
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
  return Math.abs((minX + maxX) / 2) + Math.abs((minY + maxY) / 2);
}

function bendChoices(prev: LayoutBox, from: LayoutDir, to: LayoutDir, isDouble: boolean): LayoutBox[] {
  const all = bendCandidates(prev, from, to, isDouble);
  const picked = [all[0], all[Math.min(9, all.length - 1)], all[all.length - 1]];
  return picked.filter((box, index): box is LayoutBox => Boolean(box) && picked.findIndex((other) => other && other.x === box.x && other.y === box.y) === index);
}

/** The direction moves away from the spinner, not back toward its row or column. */
function pointsAway(box: LayoutBox, dir: LayoutDir): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (dir === "east") return cx >= 0;
  if (dir === "west") return cx <= 0;
  if (dir === "north") return cy <= 0;
  return cy >= 0;
}

function roomForDouble(
  upcoming: readonly OrientedTile[],
  dir: LayoutDir,
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  phone: boolean,
  quadrant = true,
): boolean {
  const next = upcoming[1];
  if (!next || next.low !== next.high) return true;
  const owned: Occupant[] = [...occupants, { box, arm: home }];
  const doubleBox = straightBox(box, dir, true);
  if (!fits(doubleBox, home, owned, centre, phone, box, quadrant)) return false;
  const after = upcoming[2];
  if (!after) return true;
  const afterBox = straightBox(doubleBox, dir, after.low === after.high);
  const withDouble: Occupant[] = [...owned, { box: doubleBox, arm: home }];
  return fits(afterBox, home, withDouble, centre, phone, doubleBox, quadrant);
}

/**
 * A double centred on the line that leaves `box` must keep a full tile
 * of clearance. Used before a second bend, which runs parallel to the
 * arm's first leg.
 */
function laneFitsDouble(
  dir: LayoutDir,
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  quadrant = true,
): boolean {
  const doubleBox = straightBox(box, dir, true);
  if ((quadrant && !inQuadrant(doubleBox, home)) || !insideHard(doubleBox)) return false;
  if (overlapsAny(doubleBox, occupants.map((item) => item.box))) return false;
  if (intersectsBox(doubleBox, centre)) return false;
  for (const other of occupants) {
    if (other.arm === null || sameBox(other.box, box)) continue;
    if (boxGap(doubleBox, other.box) < ARM_GAP) return false;
  }
  return true;
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
  centre: LayoutBox,
  phone: boolean,
  prev: LayoutBox,
  quadrant = true,
): boolean {
  if (!insideHard(box) || (quadrant && !inQuadrant(box, home))) return false;
  if (phone && !insidePhone(box)) return false;
  if (overlapsAny(box, occupants.map((item) => item.box))) return false;
  if (intersectsBox(box, centre)) return false;
  for (const other of occupants) {
    if (other.arm === null || sameBox(other.box, prev)) continue;
    if (boxGap(box, other.box) < ARM_GAP) return false;
  }
  return true;
}

function sameBox(a: LayoutBox, b: LayoutBox): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
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

function opposite(dir: LayoutDir): LayoutDir {
  if (dir === "east") return "west";
  if (dir === "west") return "east";
  if (dir === "north") return "south";
  return "north";
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
