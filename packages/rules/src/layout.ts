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
 * slim. Each arm keeps going straight until the tile it is placing would
 * leave the felt or cover another tile. That corner is one ordinary tile,
 * and the new line runs straight. A double is centred on the line,
 * crosswise, and never makes the turn. The tile before a double turns
 * when the double and the tile after it would not both fit centred.
 * Width is 416 so the tile forced straight off an early double still
 * lands inside: spinner, one tile, a double, then a full tile.
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
 * Longest straight run before the chain turns into open felt.
 * About the shorter phone side: 416 / (72 + 2) is a little over five tiles.
 */
export const STRAIGHT_CAP = 6;
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
  /**
   * Where the next ordinary tile on an open arm would sit.
   * Not part of the fit, so a ghost slot does not shrink the chain.
   */
  previews: Partial<Record<ArmId, LayoutBox>>;
}

interface Occupant {
  box: LayoutBox;
  arm: ArmId | null;
  /** Kept open for the tile that has to follow a double. */
  reserved?: boolean;
}

interface Cursor {
  box: LayoutBox;
  dir: LayoutDir;
  prevDouble: boolean;
  bends: number;
  /** Tiles already placed in `dir`, including this one. */
  run: number;
}

/**
 * Design-pixel box the chain should turn to stay inside.
 * Omit it and the chain uses the phone felt. A narrow table passes a
 * smaller box so arms fold into open felt before the picture has to shrink
 * past a readable tile.
 */
export interface LayoutLimits {
  width: number;
  height: number;
}

const DEFAULT_LIMIT: LayoutLimits = { width: PHONE_WIDTH, height: PHONE_HEIGHT };
let activeLimit: LayoutLimits = DEFAULT_LIMIT;

function insideActive(box: LayoutBox): boolean {
  return insideRect(box, activeLimit.width, activeLimit.height);
}

function withLimit<T>(limit: LayoutLimits, run: () => T): T {
  const previous = activeLimit;
  activeLimit = limit;
  try {
    return run();
  } finally {
    activeLimit = previous;
  }
}

function tileSpan(tiles: readonly LayoutBox[]): { w: number; h: number } {
  if (tiles.length === 0) return { w: 1, h: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const tile of tiles) {
    minX = Math.min(minX, tile.x);
    minY = Math.min(minY, tile.y);
    maxX = Math.max(maxX, tile.x + tile.w);
    maxY = Math.max(maxY, tile.y + tile.h);
  }
  return { w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function fitIn(span: { w: number; h: number }, limits: LayoutLimits): number {
  return Math.min(limits.width / span.w, limits.height / span.h);
}

export function layoutBoard(board: BoardState, limits?: LayoutLimits): BoardLayout {
  const phone = withLimit(DEFAULT_LIMIT, () => layoutBoardNow(board));
  if (!limits || !Number.isFinite(limits.width) || !Number.isFinite(limits.height) || limits.width < 72 || limits.height < 72) {
    return phone;
  }
  const phoneBox = tileSpan(phone.tiles);
  // Already readable on this table. Keep the phone picture.
  if (phoneBox.w <= limits.width + 1 && phoneBox.h <= limits.height + 1) return phone;
  const folded = withLimit(limits, () => layoutBoardNow(board));
  // A pile of covered tiles has a small box and would look "more readable".
  // That picture is never the one we show.
  if (layoutOverlaps(folded)) return phone;
  if (layoutOverlaps(phone)) return folded;
  // Fold only when it actually leaves a larger tile. A turn that grows the
  // other side is worse than shrinking the straight chain a little.
  return fitIn(tileSpan(folded.tiles), limits) > fitIn(phoneBox, limits) + 0.02 ? folded : phone;
}

/** True when two faces share area. Touching edges do not count. */
export function layoutOverlaps(layout: BoardLayout): boolean {
  const tiles = layout.tiles;
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      if (boxesOverlap(tiles[i]!, tiles[j]!)) return true;
    }
  }
  return false;
}

function layoutBoardNow(board: BoardState, pass: "route" | "clear" = "route"): BoardLayout {
  if (!board.center) {
    return { tiles: [], ends: [], fit: { x: -40, y: -40, w: 80, h: 80 }, previews: {} };
  }

  const center = centerBox(board.center);
  const tiles: PlacedTile[] = [centerTile(board.center, center)];
  const occupants: Occupant[] = [{ box: center, arm: null }];
  const centre = centreRegion(center);
  const cursors = new Map<ArmId, Cursor>();

  for (const arm of ARM_IDS) {
    const first = board.arms[arm][0];
    if (!first) continue;
    const doubled = first.low === first.high;
    let box = straightBox(center, arm, doubled);
    if (coversPlaced(box, occupants, center)) {
      const fixed = attachClear(center, doubled, arm, occupants);
      if (fixed) box = fixed.box;
    }
    const placed = toTile(first, box, arm, arm);
    tiles.push(placed);
    occupants.push({ box: placed, arm });
    cursors.set(arm, { box: placed, dir: arm, prevDouble: first.low === first.high, bends: 0, run: 1 });
  }

  // Grow the arms together. A finished arm must not cross a lane another
  // arm still has to walk, including the tile that follows a double.
  const nextIndex = new Map<ArmId, number>();
  for (const arm of ARM_IDS) {
    const cursor = cursors.get(arm);
    if (!cursor) continue;
    holdAhead(arm, cursor, occupants, board.arms[arm].slice(1));
    nextIndex.set(arm, 1);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const arm of ARM_IDS) {
      const index = nextIndex.get(arm);
      const chain = board.arms[arm];
      const cursor = cursors.get(arm);
      if (index === undefined || !cursor || index >= chain.length) continue;
      releaseHold(arm, occupants);
      const upcoming = chain.slice(index);
      const tile = upcoming[0]!;
      const choice = outwardStep(tile, cursor, occupants, upcoming, arm);
      let placedIndex = index;
      let cursorNow: Cursor = {
        box: toTile(tile, choice.box, choice.dir, arm),
        dir: choice.dir,
        prevDouble: tile.low === tile.high,
        bends: choice.bends,
        run: choice.dir === cursor.dir ? cursor.run + 1 : 1,
      };
      tiles.push(cursorNow.box as PlacedTile);
      occupants.push({ box: cursorNow.box, arm });
      // Lay a double, and the tile centred on it, before another arm can take that square.
      while (chain[placedIndex + 1]) {
        const nextTile = chain[placedIndex + 1]!;
        const locked = cursorNow.prevDouble || nextTile.low === nextTile.high;
        if (!locked) break;
        const box = straightBox(cursorNow.box, cursorNow.dir, nextTile.low === nextTile.high);
        const laid = toTile(nextTile, box, cursorNow.dir, arm);
        tiles.push(laid);
        occupants.push({ box: laid, arm });
        cursorNow = {
          box: laid,
          dir: cursorNow.dir,
          prevDouble: nextTile.low === nextTile.high,
          bends: cursorNow.bends,
          run: cursorNow.run + 1,
        };
        placedIndex += 1;
      }
      cursors.set(arm, cursorNow);
      nextIndex.set(arm, placedIndex + 1);
      holdAhead(arm, cursorNow, occupants, chain.slice(placedIndex + 1));
      grew = true;
    }
  }

  const ends: PlacedEnd[] = [];
  for (const end of openEnds(board)) {
    if (end.id !== "west" && end.id !== "east" && end.id !== "north" && end.id !== "south") continue;
    const cursor = cursors.get(end.id);
    const cap = cursor ? { ...cursor.box } : capOnCenter(center, end.id);
    ends.push({ ...cap, id: end.id, match: end.match, scorePips: end.scorePips });
  }

  const previews: Partial<Record<ArmId, LayoutBox>> = {};
  for (const end of ends) {
    const cursor = cursors.get(end.id);
    previews[end.id] = cursor
      ? outwardStep(PREVIEW_TILE, cursor, occupants, [PREVIEW_TILE], end.id).box
      : straightBox(center, end.id, false);
  }

  const built = { tiles, ends, fit: fitAround([...tiles, ...ends]), previews };
  if (pass === "route" && layoutOverlaps(built)) return layoutBoardNow(board, "clear");
  return built;
}

/** True when `box` covers a tile that is already on the table. The parent it grows from is ignored. */
function coversPlaced(box: LayoutBox, occupants: readonly Occupant[], ignore?: LayoutBox): boolean {
  return placedBoxes(occupants).some((other) => (!ignore || !sameBox(other, ignore)) && boxesOverlap(box, other));
}

/**
 * Every square that still touches `parent` on `dir`, closest to centre first.
 * The new tile meets the parent with the usual gap, so the chain stays joined.
 */
function sideAttachments(parent: LayoutBox, dir: LayoutDir, isDouble: boolean): LayoutBox[] {
  const { along, across } = extents(isDouble);
  const horizontal = dir === "east" || dir === "west";
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  const minShare = Math.min(TILE_SHORT * 0.5, parent.w, parent.h, w, h);
  const boxes: LayoutBox[] = [];
  if (dir === "east" || dir === "west") {
    const x = dir === "east" ? parent.x + parent.w + TILE_GAP : parent.x - TILE_GAP - w;
    const start = parent.y - h + minShare;
    const end = parent.y + parent.h - minShare;
    const centerY = parent.y + parent.h / 2 - h / 2;
    const ys: number[] = [];
    for (let y = start; y <= end + 0.1; y += 2) ys.push(y);
    ys.sort((a, b) => Math.abs(a - centerY) - Math.abs(b - centerY));
    for (const y of ys) boxes.push({ x, y, w, h });
  } else {
    const y = dir === "south" ? parent.y + parent.h + TILE_GAP : parent.y - TILE_GAP - h;
    const start = parent.x - w + minShare;
    const end = parent.x + parent.w - minShare;
    const centerX = parent.x + parent.w / 2 - w / 2;
    const xs: number[] = [];
    for (let x = start; x <= end + 0.1; x += 2) xs.push(x);
    xs.sort((a, b) => Math.abs(a - centerX) - Math.abs(b - centerX));
    for (const x of xs) boxes.push({ x, y, w, h });
  }
  return boxes;
}

/**
 * Go straight while the next tile still fits on the felt. A corner is one
 * ordinary tile. A double stays centred on that line and never makes the turn.
 */
function outwardStep(
  tile: OrientedTile,
  cursor: Cursor,
  occupants: readonly Occupant[],
  upcoming: readonly OrientedTile[],
  arm: ArmId,
): { box: LayoutBox; dir: LayoutDir; bends: number } {
  const isDouble = tile.low === tile.high;
  const blocks = placedBoxes(occupants).filter((box) => !sameBox(box, cursor.box));
  const hits = (box: LayoutBox) => overlapsAny(box, blocks);
  const fits = (box: LayoutBox) => insideActive(box) && !hits(box);
  const straight = straightBox(cursor.box, cursor.dir, isDouble);
  // A double, and the tile centred on it, never slide and never turn.
  if (isDouble || cursor.prevDouble) {
    return { box: straight, dir: cursor.dir, bends: cursor.bends };
  }
  const runHits = committedHits(straight, cursor.dir, upcoming, hits, arm, occupants);
  // Stay straight while this tile and the doubles on its line fit on the felt.
  if (fits(straight) && !runHits && committedInside(straight, cursor.dir, upcoming)) {
    return { box: straight, dir: cursor.dir, bends: cursor.bends };
  }
  const turn = cleanCorner(cursor, upcoming, hits, arm, occupants, true);
  if (turn) return { box: turn.box, dir: turn.dir, bends: cursor.bends + 1 };
  // Past the edge, but the line does not cover a tile. Do not stair-step.
  if (!hits(straight) && !runHits) return { box: straight, dir: cursor.dir, bends: cursor.bends };
  const loose = cleanCorner(cursor, upcoming, hits, arm, occupants, false);
  if (loose) return { box: loose.box, dir: loose.dir, bends: cursor.bends + 1 };
  if (!hits(straight)) return { box: straight, dir: cursor.dir, bends: cursor.bends };
  const fallback = attachClear(cursor.box, false, cursor.dir, occupants);
  if (fallback && !hits(fallback.box)) {
    return {
      box: fallback.box,
      dir: fallback.dir,
      bends: fallback.dir === cursor.dir ? cursor.bends : cursor.bends + 1,
    };
  }
  return { box: straight, dir: cursor.dir, bends: cursor.bends };
}

/**
 * Doubles cannot turn, and the tile after a double has to stay centred.
 * A free tile turns only when that locked run would leave the felt or cover a tile.
 */
function cellOk(step: LayoutBox, hits: (box: LayoutBox) => boolean): boolean {
  return insideActive(step) && !hits(step);
}

function walkCommitted(
  box: LayoutBox,
  dir: LayoutDir,
  upcoming: readonly OrientedTile[],
  accept: (step: LayoutBox, doubled: boolean) => boolean,
): boolean {
  let prev = box;
  let locked = upcoming[0]!.low === upcoming[0]!.high;
  for (let index = 1; index < upcoming.length; index += 1) {
    const stepTile = upcoming[index]!;
    const doubled = stepTile.low === stepTile.high;
    if (!locked && !doubled) return true;
    const step = straightBox(prev, dir, doubled);
    if (!accept(step, doubled)) return false;
    locked = doubled;
    prev = step;
  }
  return true;
}

/** The new line would run into a tile that is already down before it leaves the felt. */
function crashesAhead(
  box: LayoutBox,
  dir: LayoutDir,
  upcoming: readonly OrientedTile[],
  hits: (box: LayoutBox) => boolean,
): boolean {
  let prev = box;
  const last = Math.min(upcoming.length - 1, 8);
  for (let index = 1; index <= last; index += 1) {
    const step = straightBox(prev, dir, upcoming[index]!.low === upcoming[index]!.high);
    if (hits(step)) return true;
    if (!insideActive(step)) return false;
    prev = step;
  }
  return false;
}

/** A crosswise double hangs off its line. Parallel lines have to leave room for that. */
function doubleTooClose(box: LayoutBox, arm: ArmId, occupants: readonly Occupant[]): boolean {
  for (const other of occupants) {
    if (other.reserved || other.arm === null || other.arm === arm) continue;
    const wide = other.box.w >= other.box.h;
    const expanded = wide
      ? { x: other.box.x, y: other.box.y + other.box.h / 2 - TILE_LONG / 2, w: other.box.w, h: TILE_LONG }
      : { x: other.box.x + other.box.w / 2 - TILE_LONG / 2, y: other.box.y, w: TILE_LONG, h: other.box.h };
    if (boxesOverlap(box, expanded)) return true;
  }
  return false;
}

/** A double on this line would cover a tile. */
function committedHits(
  box: LayoutBox,
  dir: LayoutDir,
  upcoming: readonly OrientedTile[],
  hits: (box: LayoutBox) => boolean,
  arm: ArmId,
  occupants: readonly Occupant[],
): boolean {
  return !walkCommitted(box, dir, upcoming, (step, doubled) => !hits(step) && (!doubled || !doubleTooClose(step, arm, occupants)));
}

/** A double on this line would leave the felt. */
function committedInside(box: LayoutBox, dir: LayoutDir, upcoming: readonly OrientedTile[]): boolean {
  return walkCommitted(box, dir, upcoming, (step) => insideActive(step));
}

/** Doubles, and the tile centred on a double, still fit straight ahead. A free tile can corner later. */
function committedFits(
  box: LayoutBox,
  dir: LayoutDir,
  upcoming: readonly OrientedTile[],
  hits: (box: LayoutBox) => boolean,
  arm: ArmId,
  occupants: readonly Occupant[],
): boolean {
  return walkCommitted(box, dir, upcoming, (step, doubled) => cellOk(step, hits) && (!doubled || !doubleTooClose(step, arm, occupants)));
}

/**
 * After a corner the next tiles run straight through the first double and
 * the tile centred on it. Otherwise the next tile corners again.
 */
function cornerRunFits(
  box: LayoutBox,
  dir: LayoutDir,
  upcoming: readonly OrientedTile[],
  hits: (box: LayoutBox) => boolean,
  arm: ArmId,
  occupants: readonly Occupant[],
): boolean {
  let prev = box;
  let sawFree = false;
  for (let index = 1; index < upcoming.length; index += 1) {
    const stepTile = upcoming[index]!;
    const doubled = stepTile.low === stepTile.high;
    const step = straightBox(prev, dir, doubled);
    if (!cellOk(step, hits) || (doubled && doubleTooClose(step, arm, occupants))) return false;
    const previous = upcoming[index - 1]!;
    const previousDoubled = previous.low === previous.high;
    if (!doubled && previousDoubled) return true;
    if (!doubled && !previousDoubled && sawFree) {
      const after = upcoming[index + 1];
      if (!after || after.low !== after.high) return true;
    }
    if (!doubled && !previousDoubled) sawFree = true;
    prev = step;
  }
  return true;
}

/** One 90 degree corner. The new line is the side that can keep running straight. */
function cleanCorner(
  cursor: Cursor,
  upcoming: readonly OrientedTile[],
  hits: (box: LayoutBox) => boolean,
  arm: ArmId,
  occupants: readonly Occupant[],
  requireRun: boolean,
): { box: LayoutBox; dir: LayoutDir } | null {
  let best: { box: LayoutBox; dir: LayoutDir; score: number } | null = null;
  for (const dir of sideTurns(cursor.dir)) {
    const candidates = bendCandidates(cursor.box, cursor.dir, dir, false);
    for (let index = 0; index < candidates.length; index += 1) {
      const corner = candidates[index]!;
      if (!insideActive(corner) || hits(corner)) continue;
      if (index === 0 && headsIn(cursor.box, corner) && !nearActiveEdge(cursor.box) && !nearActiveEdge(corner)) continue;
      if (requireRun && !cornerRunFits(corner, dir, upcoming, hits, arm, occupants)) continue;
      if (!requireRun && committedHits(corner, dir, upcoming, hits, arm, occupants)) continue;
      if (crashesAhead(corner, dir, upcoming, hits)) continue;
      const score = openAhead(corner, dir, hits) * 1000 - index;
      if (!best || score > best.score) best = { box: corner, dir, score };
    }
  }
  return best;
}

function nearActiveEdge(box: LayoutBox): boolean {
  const margin = TILE_LONG + TILE_GAP;
  const halfW = activeLimit.width / 2;
  const halfH = activeLimit.height / 2;
  return box.x <= -halfW + margin
    || box.y <= -halfH + margin
    || box.x + box.w >= halfW - margin
    || box.y + box.h >= halfH - margin;
}

/** The step moved back toward the spinner, not out into open felt. */
function headsIn(parent: LayoutBox, child: LayoutBox): boolean {
  const parentDistance = Math.hypot(parent.x + parent.w / 2, parent.y + parent.h / 2);
  const childDistance = Math.hypot(child.x + child.w / 2, child.y + child.h / 2);
  return childDistance + TILE_SHORT * 0.5 < parentDistance;
}

/** How many clear tiles fit straight ahead inside the felt. Farther from the spinner wins a tie. */
function openAhead(box: LayoutBox, dir: LayoutDir, hits: (box: LayoutBox) => boolean): number {
  let prev = box;
  let steps = 0;
  for (let index = 0; index < 6; index += 1) {
    const next = straightBox(prev, dir, false);
    if (!insideActive(next) || hits(next)) break;
    steps += 1;
    prev = next;
  }
  return steps * 1000 + Math.hypot(box.x + box.w / 2, box.y + box.h / 2);
}

/** Straight ahead, then either turn, then back. Never a square that covers a tile. */
function attachClear(
  parent: LayoutBox,
  isDouble: boolean,
  prefer: LayoutDir,
  occupants: readonly Occupant[],
): { box: LayoutBox; dir: LayoutDir } | null {
  const blocks = occupants.filter((item) => !sameBox(item.box, parent)).map((item) => item.box);
  const order: LayoutDir[] = [prefer, ...sideTurns(prefer), opposite(prefer)];
  const roomy = (box: LayoutBox) => blocks.every((other) => boxGap(box, other) >= ARM_GAP);
  for (const needRoom of [true, false]) {
    for (const doubled of [isDouble, !isDouble]) {
      for (const dir of order) {
        for (const box of sideAttachments(parent, dir, doubled)) {
          if (!insideHard(box)) continue;
          if (overlapsAny(box, blocks)) continue;
          if (needRoom && !roomy(box)) continue;
          return { box, dir };
        }
      }
    }
  }
  return null;
}

function clearStep(tile: OrientedTile, cursor: Cursor, occupants: Occupant[]): { box: LayoutBox; dir: LayoutDir; bends: number } {
  const placed = attachClear(cursor.box, tile.low === tile.high, cursor.dir, occupants);
  if (!placed) {
    return { box: straightBox(cursor.box, cursor.dir, tile.low === tile.high), dir: cursor.dir, bends: cursor.bends };
  }
  return {
    box: placed.box,
    dir: placed.dir,
    bends: placed.dir === cursor.dir ? cursor.bends : cursor.bends + 1,
  };
}

/**
 * One tile of imbalance. The outward bend wins a tie. The other way
 * wins when it pulls the chain's box clearly closer to the spinner.
 */
const TURN_BIAS = 72;

/** The passed felt is smaller than the reference phone on at least one side. */
function isTightLimit(): boolean {
  return activeLimit.width < PHONE_WIDTH - 1 || activeLimit.height < PHONE_HEIGHT - 1;
}

/**
 * How many tiles may stay straight on this axis.
 * The short side of a tall phone fits one tile beside the spinner, so an
 * east or west arm turns up or down instead of making a wide cross.
 * The long side keeps the normal cap and uses the empty felt.
 */
function runCap(dir: LayoutDir): number {
  const horizontal = dir === "east" || dir === "west";
  const span = horizontal ? activeLimit.width : activeLimit.height;
  const other = horizontal ? activeLimit.height : activeLimit.width;
  if (span >= other - 1) return STRAIGHT_CAP;
  const phoneSpan = horizontal ? PHONE_WIDTH : PHONE_HEIGHT;
  if (span >= phoneSpan - 1) return STRAIGHT_CAP;
  const reach = Math.max(TILE_LONG, span / 2 - TILE_SHORT / 2 - TILE_GAP);
  const fit = Math.max(1, Math.floor(reach / (TILE_LONG + TILE_GAP)));
  return Math.min(STRAIGHT_CAP, fit);
}

/**
 * A turn that stays on the felt. The arm may leave its quadrant when that
 * is the side with room. Overlapping another chain is still refused.
 */
function bestInsideTurn(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number } | null {
  const isDouble = tile.low === tile.high;
  const collect = (reserveDouble: boolean) => {
    const options: Array<{ box: LayoutBox; dir: LayoutDir; scale: number }> = [];
    for (const turn of sideTurns(cursor.dir)) {
      for (const box of bendCandidates(cursor.box, cursor.dir, turn, isDouble)) {
        if (!insideActive(box) || !isClear(box, occupants, centre, cursor.box)) continue;
        if (reserveDouble && !roomForDouble(upcoming, turn, box, home, occupants, centre, false, false)) continue;
        options.push({
          box,
          dir: turn,
          scale: snakeScale(box, turn, 1, upcoming, occupants, centre, home),
        });
        break;
      }
    }
    return options;
  };
  const options = collect(true);
  const pickedFrom = options.length > 0 ? options : collect(false);
  if (pickedFrom.length > 0) {
    let picked = pickedFrom[0]!;
    for (const option of pickedFrom) {
      if (option.scale > picked.scale + 1e-6) picked = option;
    }
    return { box: picked.box, dir: picked.dir, bends: cursor.bends + 1 };
  }
  // Already past the edge. Turn back toward the felt when that sticks out less
  // than another straight step. Later tiles can fold into the open side.
  const straight = straightBox(cursor.box, cursor.dir, isDouble);
  const straightOut = overflowAmount(straight);
  if (straightOut <= 0) return null;
  let recovered: { box: LayoutBox; dir: LayoutDir; out: number; scale: number } | null = null;
  for (const turn of sideTurns(cursor.dir)) {
    for (const box of bendCandidates(cursor.box, cursor.dir, turn, isDouble)) {
      if (!isClear(box, occupants, centre, cursor.box)) continue;
      const out = overflowAmount(box);
      if (out >= straightOut - 0.5) continue;
      const scale = snakeScale(box, turn, 1, upcoming, occupants, centre, home);
      if (!recovered || out < recovered.out - 0.5 || (Math.abs(out - recovered.out) <= 0.5 && scale > recovered.scale)) {
        recovered = { box, dir: turn, out, scale };
      }
    }
  }
  if (!recovered) return null;
  return { box: recovered.box, dir: recovered.dir, bends: cursor.bends + 1 };
}

function overflowAmount(box: LayoutBox): number {
  const halfW = activeLimit.width / 2;
  const halfH = activeLimit.height / 2;
  const dx = Math.max(0, -halfW - box.x, box.x + box.w - halfW);
  const dy = Math.max(0, -halfH - box.y, box.y + box.h - halfH);
  return dx + dy;
}

/**
 * Go straight while the run is short and the next tile fits on the phone.
 * At the straight-run cap, or once the straight step leaves the felt, turn
 * into the side whose snake keeps the board larger on screen. A double,
 * and the tile centred on it, never bend.
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

  if (lock) {
    // A double stays crosswise. The tile after it may turn when going
    // straight would cover another tile or leave a short phone table.
    // That turn sits on the end of the double.
    const follower = cursor.prevDouble && !isDouble;
    const covered = overlapsAny(straight, placedBoxes(occupants)) || intersectsBox(straight, centre);
    if (follower && (covered || (isTightLimit() && !insideActive(straight)))) {
      const turned = bestInsideTurn(tile, upcoming, cursor, home, occupants, centre)
        ?? openTurn(tile, upcoming, cursor, home, occupants, centre);
      if (turned) return turned;
    }
    return keep;
  }

  // A short phone table. Turn into the tall felt before the arm runs off
  // the side and the whole picture has to shrink.
  if (isTightLimit()) {
    const cap = runCap(cursor.dir);
    // Stay on a short run that still fits. A following double may stick out
    // a little; turning away from that would run the arm back across the table.
    const straightInside = insideActive(straight) && fits(straight, home, occupants, centre, true, cursor.box);
    if (straightInside && cursor.run < cap && lockedRunClear(upcoming, cursor.dir, straight, occupants, centre)) return keep;
    const turned = bestInsideTurn(tile, upcoming, cursor, home, occupants, centre);
    if (turned) return turned;
  }

  const mustTurn = cursor.run >= STRAIGHT_CAP;
  const straightOk = fits(straight, home, occupants, centre, true, cursor.box)
    && roomForDouble(upcoming, cursor.dir, straight, home, occupants, centre, true);
  if (straightOk && !mustTurn) return keep;

  // The straight run has hit the cap. Turn into open felt, picking the
  // side whose snake leaves the bigger tile on screen. A blocked side
  // stays straight and the edge bend below can still fire.
  if (mustTurn) {
    const turned = bestOpenTurn(tile, upcoming, cursor, home, occupants, centre);
    if (turned) return { box: turned.box, dir: turned.dir, bends: turned.bends };
  }

  // First bend: clockwise, or the other way when that side is open.
  // Second bend: further outward, or back across the empty felt.
  // A third bend is not chosen here. The two-bend search assumes the
  // arm is still on its first corner, and a later turn is handled below.
  if (cursor.bends < 2) {
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
    if (best) return { box: best.box, dir: best.dir, bends: cursor.bends + 1 };
  }

  // No open side. A clear straight step is allowed to leave the phone,
  // and the view scales down. Wrapping is only for a real collision.
  if (isClear(straight, occupants, centre, cursor.box) && runFits(upcoming, cursor.dir, straight, home, occupants, centre)) {
    return keep;
  }

  const escaped = escapeStep(tile, upcoming, cursor, home, occupants, centre);
  if (escaped) return escaped;
  // The rest of the arm may not fit, but this tile still needs an open square.
  // Dropping it on another face is what made a crowded hand look broken.
  const loose = looseStep(tile, cursor, home, occupants, centre);
  if (loose) return loose;
  const opened = openTurn(tile, upcoming, cursor, home, occupants, centre);
  if (opened) return opened;
  const parked = nudgeClear(straight, cursor.dir, occupants, centre, cursor.box);
  if (!overlapsAny(parked, placedBoxes(occupants))) return { box: parked, dir: cursor.dir, bends: cursor.bends };
  return keep;
}

/**
 * A corner that does not cover another tile. The gap to a neighbour may be
 * tight. Covering a face is not allowed, and the new tile still meets its parent.
 */
function openTurn(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number } | null {
  if (tile.low === tile.high) return null;
  const order = [...sideTurns(cursor.dir), opposite(cursor.dir)];
  let best: { box: LayoutBox; dir: LayoutDir; score: number } | null = null;
  for (const turn of order) {
    for (const box of bendCandidates(cursor.box, cursor.dir, turn, false)) {
      if (!insideHard(box) || intersectsBox(box, centre)) continue;
      if (overlapsAny(box, placedBoxes(occupants))) continue;
      if (!lockedRunClear(upcoming, turn, box, occupants, centre)) continue;
      const score = (insideActive(box) ? 0 : 500)
        + (turn === sideTurns(cursor.dir)[0] ? 0 : 20)
        + projectedImbalance(box, turn, upcoming, occupants, centre) / 1000;
      if (!best || score < best.score) best = { box, dir: turn, score };
      break;
    }
  }
  if (!best) return null;
  return { box: best.box, dir: best.dir, bends: cursor.bends + 1 };
}

/** The double, and the tile that has to follow it, must not cover a face. */
function lockedRunClear(
  upcoming: readonly OrientedTile[],
  dir: LayoutDir,
  box: LayoutBox,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): boolean {
  const owned = placedBoxes(occupants);
  owned.push(box);
  let prev = box;
  let prevDouble = upcoming[0]!.low === upcoming[0]!.high;
  for (let index = 1; index < upcoming.length; index += 1) {
    const next = upcoming[index]!;
    const nextDouble = next.low === next.high;
    if (!prevDouble && !nextDouble) return true;
    const nextBox = straightBox(prev, dir, nextDouble);
    if (overlapsAny(nextBox, owned) || intersectsBox(nextBox, centre) || !insideHard(nextBox)) return false;
    owned.push(nextBox);
    prev = nextBox;
    prevDouble = nextDouble;
  }
  return true;
}

/**
 * Any clear corner, without reserving the rest of the arm.
 * Used only after the planned bends have nowhere to go.
 */
function looseStep(
  tile: OrientedTile,
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number } | null {
  const isDouble = tile.low === tile.high;
  const turns = [...sideTurns(cursor.dir), opposite(cursor.dir)];
  for (const turn of turns) {
    const choices = bendCandidates(cursor.box, cursor.dir, turn, isDouble);
    for (const box of choices) {
      if (!isClear(box, occupants, centre, cursor.box)) continue;
      return { box, dir: turn, bends: cursor.bends + 1 };
    }
  }
  return null;
}

/** Walk the tile out along the open directions until it misses every face. */
function nudgeClear(
  box: LayoutBox,
  dir: LayoutDir,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  prev: LayoutBox,
): LayoutBox {
  if (isClear(box, occupants, centre, prev)) return box;
  // Pixel steps first, so a tile that barely crosses another stays on its parent.
  const ways: LayoutDir[] = [dir, ...sideTurns(dir), opposite(dir)];
  for (let distance = 1; distance <= 12; distance += 1) {
    for (const way of ways) {
      const moved = shiftBox(box, way, distance * 2);
      if (isClear(moved, occupants, centre, prev)) return moved;
    }
  }
  // Stay on the parent. A jump of a whole tile reads as a domino floating on its own.
  return box;
}

function shiftBox(box: LayoutBox, dir: LayoutDir, distance: number): LayoutBox {
  if (dir === "east") return { ...box, x: box.x + distance };
  if (dir === "west") return { ...box, x: box.x - distance };
  if (dir === "south") return { ...box, y: box.y + distance };
  return { ...box, y: box.y - distance };
}

/**
 * Both perpendiculars, scored by the scale of the snake that would follow.
 * A near tie stays in the arm's quadrant so a short arm does not fold back
 * across a neighbour.
 */
function bestOpenTurn(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number; scale: number } | null {
  const isDouble = tile.low === tile.high;
  const options: Array<{ box: LayoutBox; dir: LayoutDir; scale: number; quadrant: boolean }> = [];
  for (const turn of sideTurns(cursor.dir)) {
    for (const box of bendChoices(cursor.box, cursor.dir, turn, isDouble)) {
      if (!isClear(box, occupants, centre, cursor.box)) continue;
      if (!roomForDouble(upcoming, turn, box, home, occupants, centre, false, false)) continue;
      options.push({
        box,
        dir: turn,
        scale: snakeScale(box, turn, 1, upcoming, occupants, centre, home),
        quadrant: inQuadrant(box, home),
      });
      break;
    }
  }
  if (options.length === 0) return null;
  let picked = options[0]!;
  for (const option of options) {
    if (option.scale > picked.scale + 1e-6) picked = option;
  }
  const homeSide = options.find((option) => option.quadrant);
  if (homeSide && homeSide !== picked && homeSide.scale >= picked.scale * 0.96) picked = homeSide;
  return { box: picked.box, dir: picked.dir, bends: cursor.bends + 1, scale: picked.scale };
}

/** Scale of the board if the rest of the arm snakes from this tile, turning at the cap. */
function snakeScale(
  start: LayoutBox,
  dir: LayoutDir,
  initialRun: number,
  upcoming: readonly OrientedTile[],
  occupants: readonly Occupant[],
  centre: LayoutBox,
  home: ArmId,
): number {
  const owned: Occupant[] = occupants.map((item) => ({ ...item }));
  owned.push({ box: start, arm: home });
  let prev = start;
  let dirNow = dir;
  let run = initialRun;
  let prevDouble = upcoming[0]!.low === upcoming[0]!.high;
  for (let index = 1; index < upcoming.length; index += 1) {
    const nextTile = upcoming[index]!;
    const nextDouble = nextTile.low === nextTile.high;
    const locked = prevDouble || nextDouble;
    let nextDir = dirNow;
    if (!locked && run >= STRAIGHT_CAP) nextDir = towardCenter(prev, dirNow);
    let box = nextDir === dirNow
      ? straightBox(prev, dirNow, nextDouble)
      : bendBox(prev, dirNow, nextDir, nextDouble);
    if (!isClear(box, owned, centre, prev)) {
      if (nextDir === dirNow) break;
      box = straightBox(prev, dirNow, nextDouble);
      nextDir = dirNow;
      if (!isClear(box, owned, centre, prev)) break;
    }
    owned.push({ box, arm: home });
    prev = box;
    run = nextDir === dirNow ? run + 1 : 1;
    dirNow = nextDir;
    prevDouble = nextDouble;
  }
  return layoutScale(owned.map((item) => item.box));
}

/** Perpendicular that heads back toward the spinner. */
function towardCenter(box: LayoutBox, dir: LayoutDir): LayoutDir {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const [clockwiseTurn, other] = sideTurns(dir);
  const pull = (turn: LayoutDir) => {
    if (turn === "west") return cx;
    if (turn === "east") return -cx;
    if (turn === "north") return cy;
    return -cy;
  };
  const clockwisePull = pull(clockwiseTurn);
  const otherPull = pull(other);
  if (otherPull > clockwisePull) return other;
  return clockwiseTurn;
}

function layoutScale(boxes: readonly LayoutBox[]): number {
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
  return Math.min(activeLimit.width / Math.max(1, maxX - minX), activeLimit.height / Math.max(1, maxY - minY));
}

/**
 * The straight step would land on another arm. Turn to either side,
 * including a third bend, and take the first clear spot. Leaving the
 * phone is cheaper than crossing a chain: the felt zooms out.
 */
function escapeStep(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number } | null {
  const isDouble = tile.low === tile.high;
  const turns = sideTurns(cursor.dir);
  let best: { box: LayoutBox; dir: LayoutDir; score: number } | null = null;
  for (const turn of turns) {
    const choices = bendCandidates(cursor.box, cursor.dir, turn, isDouble);
    for (let slide = 0; slide < choices.length; slide += 1) {
      const box = choices[slide]!;
      if (!isClear(box, occupants, centre, cursor.box)) continue;
      if (!runFits(upcoming, turn, box, home, occupants, centre)) continue;
      const score = (insideActive(box) ? 0 : 80_000)
        + (inQuadrant(box, home) ? 0 : 8_000)
        + (pointsAway(box, turn) ? 0 : 2_000)
        + (turn === turns[0] ? 0 : 400)
        + slide * 4
        + projectedImbalance(box, turn, upcoming, occupants, centre);
      if (!best || score < best.score) best = { box, dir: turn, score };
    }
  }
  if (!best) return null;
  return { box: best.box, dir: best.dir, bends: cursor.bends + 1 };
}

/** A placement that touches its parent and misses every other tile. */
function isClear(
  box: LayoutBox,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  prev: LayoutBox,
): boolean {
  if (!insideHard(box)) return false;
  if (overlapsAny(box, placedBoxes(occupants))) return false;
  if (hitsHold(box, occupants)) return false;
  if (intersectsBox(box, centre)) return false;
  for (const other of occupants) {
    if (other.reserved || other.arm === null || sameBox(other.box, prev)) continue;
    if (boxGap(box, other.box) < ARM_GAP) return false;
  }
  return true;
}

const PREVIEW_TILE: OrientedTile = { tileId: "preview", low: 0, high: 1, inward: 0, outward: 1 };

function holdAhead(arm: ArmId, cursor: Cursor, occupants: Occupant[], upcoming: readonly OrientedTile[]): void {
  releaseHold(arm, occupants);
  // The straight squares a double is committed to. Another arm must not take them.
  let prev = cursor.box;
  let locked = cursor.prevDouble;
  for (const tile of upcoming) {
    const doubled = tile.low === tile.high;
    if (!locked && !doubled) break;
    const step = straightBox(prev, cursor.dir, doubled);
    if (!coversPlaced(step, occupants, cursor.box)) occupants.push({ box: step, arm, reserved: true });
    locked = doubled;
    prev = step;
  }
}

function releaseHold(arm: ArmId, occupants: Occupant[]): void {
  for (let index = occupants.length - 1; index >= 0; index -= 1) {
    const item = occupants[index]!;
    if (item.reserved && item.arm === arm) occupants.splice(index, 1);
  }
}

/**
 * Tiles that cannot turn (a double, and the tile centred on it) have to
 * fit straight ahead. A normal tile after that run can bend later.
 */
function runFits(
  upcoming: readonly OrientedTile[],
  dir: LayoutDir,
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): boolean {
  const owned: Occupant[] = [...occupants, { box, arm: home }];
  let prev = box;
  let prevDouble = upcoming[0]!.low === upcoming[0]!.high;
  for (let index = 1; index < upcoming.length; index += 1) {
    const next = upcoming[index]!;
    const nextDouble = next.low === next.high;
    if (!prevDouble && !nextDouble) return true;
    const nextBox = straightBox(prev, dir, nextDouble);
    if (!isClear(nextBox, owned, centre, prev)) return false;
    owned.push({ box: nextBox, arm: home });
    prev = nextBox;
    prevDouble = nextDouble;
  }
  if (prevDouble) {
    const follower = straightBox(prev, dir, false);
    if (!isClear(follower, owned, centre, prev)) return false;
    owned.push({ box: follower, arm: home });
    prev = follower;
  }
  if (upcoming[0]?.tileId === "preview") return true;
  return hasExit(prev, dir, owned, centre);
}

function sideTurns(dir: LayoutDir): [LayoutDir, LayoutDir] {
  const clock = clockwise(dir);
  return [clock, opposite(clock)];
}

/** The tile just placed still has a clear next step, straight or around a corner. */
function hasExit(box: LayoutBox, dir: LayoutDir, occupants: readonly Occupant[], centre: LayoutBox): boolean {
  const straight = straightBox(box, dir, false);
  if (isClear(straight, occupants, centre, box)) return true;
  for (const turn of sideTurns(dir)) {
    for (const candidate of bendCandidates(box, dir, turn, false)) {
      if (isClear(candidate, occupants, centre, box)) return true;
    }
  }
  return false;
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
    if (!insideActive(next) || overlapsAny(next, boxes) || intersectsBox(next, centre)) break;
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
  const owned: Occupant[] = [...occupants, { box, arm: home }];
  let prev = box;
  let prevDouble = upcoming[0]!.low === upcoming[0]!.high;
  for (let index = 1; index < upcoming.length; index += 1) {
    const next = upcoming[index]!;
    const nextDouble = next.low === next.high;
    if (!prevDouble && !nextDouble) return true;
    const nextBox = straightBox(prev, dir, nextDouble);
    if (!fits(nextBox, home, owned, centre, phone, prev, quadrant)) return false;
    owned.push({ box: nextBox, arm: home });
    prev = nextBox;
    prevDouble = nextDouble;
  }
  if (prevDouble) {
    const follower = straightBox(prev, dir, false);
    if (!fits(follower, home, owned, centre, phone, prev, quadrant)) return false;
    owned.push({ box: follower, arm: home });
    prev = follower;
  }
  if (upcoming[0]?.tileId === "preview") return true;
  return hasExit(prev, dir, owned, centre);
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
  if (overlapsAny(doubleBox, placedBoxes(occupants))) return false;
  if (hitsHold(doubleBox, occupants)) return false;
  if (intersectsBox(doubleBox, centre)) return false;
  for (const other of occupants) {
    if (other.reserved || other.arm === null || sameBox(other.box, box)) continue;
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
  if (phone && !insideActive(box)) return false;
  if (overlapsAny(box, placedBoxes(occupants))) return false;
  if (hitsHold(box, occupants)) return false;
  if (intersectsBox(box, centre)) return false;
  for (const other of occupants) {
    if (other.reserved || other.arm === null || sameBox(other.box, prev)) continue;
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

function placedBoxes(occupants: readonly Occupant[]): LayoutBox[] {
  return occupants.filter((item) => !item.reserved).map((item) => item.box);
}

/** A held follower cell may be taken only by that exact follower. */
function hitsHold(box: LayoutBox, occupants: readonly Occupant[]): boolean {
  for (const other of occupants) {
    if (!other.reserved || sameBox(other.box, box)) continue;
    if (boxesOverlap(box, other.box) || boxGap(box, other.box) < ARM_GAP) return true;
  }
  return false;
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
