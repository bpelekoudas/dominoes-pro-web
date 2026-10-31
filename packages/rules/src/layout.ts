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
 * slim. An arm leaves the spinner straight, in its own quadrant. It keeps
 * that direction for a short run, then turns while there is still open
 * felt beside it. A straight run is capped at about six tiles, which is
 * the shorter side of the phone in tile-lengths. The turn goes to the
 * side whose snake keeps the board's box smaller, so the view can stay
 * zoomed in. A side that only ties on scale stays in the arm's quadrant.
 * Width is 416 so the tile forced straight off an early double still
 * lands inside: spinner, one tile, a double, then a full tile.
 *
 * The first bend at the edge of the phone still prefers the clockwise
 * side (up turns right, right turns down, down turns left, left turns
 * up) unless the other side is clearly emptier. The chain does not fold
 * onto another arm or onto itself. When the next straight step would
 * overlap another arm or the spinner row, the chain bends again and
 * wraps away. A double, and the tile centred on it, never bend.
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

function layoutBoardNow(board: BoardState): BoardLayout {
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
    const box = straightBox(center, arm, first.low === first.high);
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
    holdAhead(arm, cursor, occupants, centre);
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
      const choice = chooseStep(tile, upcoming, cursor, arm, occupants, centre);
      const placed = toTile(tile, choice.box, choice.dir, arm);
      tiles.push(placed);
      occupants.push({ box: placed, arm });
      const nextCursor: Cursor = {
        box: placed,
        dir: choice.dir,
        prevDouble: tile.low === tile.high,
        bends: choice.bends,
        run: choice.dir === cursor.dir ? cursor.run + 1 : 1,
      };
      cursors.set(arm, nextCursor);
      nextIndex.set(arm, index + 1);
      holdAhead(arm, nextCursor, occupants, centre);
      grew = true;
    }
  }

  // A step that still landed on another face is walked into open felt.
  // The hand keeps going, and no tile is covered.
  for (let i = 1; i < tiles.length; i += 1) {
    const tile = tiles[i]!;
    const earlier = tiles.slice(0, i);
    if (!earlier.some((other) => boxesOverlap(tile, other))) continue;
    const parked = nudgeClear(
      tile,
      tile.direction,
      earlier.map((other) => ({ box: other, arm: other.arm })),
      centre,
      earlier[earlier.length - 1]!,
    );
    tile.x = parked.x;
    tile.y = parked.y;
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
      ? chooseStep(PREVIEW_TILE, [PREVIEW_TILE], cursor, end.id, occupants, centre).box
      : straightBox(center, end.id, false);
  }

  return { tiles, ends, fit: fitAround([...tiles, ...ends]), previews };
}

/**
 * One tile of imbalance. The outward bend wins a tie. The other way
 * wins when it pulls the chain's box clearly closer to the spinner.
 */
const TURN_BIAS = 72;

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

  if (lock) return keep;

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
  const parked = nudgeClear(straight, cursor.dir, occupants, centre, cursor.box);
  return { box: parked, dir: cursor.dir, bends: cursor.bends };
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
  const step = TILE_SHORT + TILE_GAP;
  const ways: LayoutDir[] = [dir, ...sideTurns(dir), opposite(dir)];
  for (let distance = 1; distance <= 60; distance += 1) {
    for (const way of ways) {
      const moved = shiftBox(box, way, distance * step);
      if (isClear(moved, occupants, centre, prev)) return moved;
    }
  }
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

function holdAhead(arm: ArmId, cursor: Cursor, occupants: Occupant[], centre: LayoutBox): void {
  releaseHold(arm, occupants);
  if (cursor.prevDouble) {
    const follower = straightBox(cursor.box, cursor.dir, false);
    if (!isClear(follower, occupants, centre, cursor.box)) return;
    occupants.push({ box: follower, arm, reserved: true });
    const beyond: Cursor = { box: follower, dir: cursor.dir, prevDouble: false, bends: cursor.bends, run: cursor.run + 1 };
    const exit = chooseStep(PREVIEW_TILE, [PREVIEW_TILE], beyond, arm, occupants, centre).box;
    if (isClear(exit, occupants, centre, follower)) occupants.push({ box: exit, arm, reserved: true });
    return;
  }
  const exit = chooseStep(PREVIEW_TILE, [PREVIEW_TILE], cursor, arm, occupants, centre).box;
  if (isClear(exit, occupants, centre, cursor.box)) occupants.push({ box: exit, arm, reserved: true });
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
