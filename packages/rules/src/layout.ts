import type { ArmId, BoardState, CenterTile, OrientedTile } from "./board.js";
import { ARM_IDS, openEnds } from "./board.js";

/**
 * Phone-portrait layout for a straight-domino board.
 *
 * Coordinates are design pixels. The spinner sits at the origin. Every
 * client uses this same function, so a hand looks the same on every phone.
 * The view stays centred on the spinner. A hand opens close up and eases
 * outward as the chain grows. It does not pan, and it does not zoom back in.
 *
 * Each arm owns one region and snakes inside it, the way a domino table
 * does. West takes the left side and the top-left corner, north the top
 * and the top-right, east the right and the bottom-right, south the bottom
 * and the bottom-left. Those corners are split once and never shared.
 *
 * An arm runs straight out from the spinner. When the next tile would
 * leave its region it makes one corner, always turning the same way
 * (west turns up, north turns right, east turns down, south turns left),
 * then runs back parallel to the first row. The rows stay a tile apart.
 * A corner is one ordinary tile. A double stays on the straight run,
 * crosswise and centred, and the tiles on either side meet it at its middle.
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

export function layoutBoard(board: BoardState, limits?: LayoutLimits): BoardLayout {
  if (!limits || !Number.isFinite(limits.width) || !Number.isFinite(limits.height) || limits.width < 72 || limits.height < 72) {
    return withLimit(DEFAULT_LIMIT, () => layoutBoardNow(board));
  }
  // The caller's rectangle is the felt at the current tile size. Arms run
  // out to that edge. A layout that covers another tile falls back to the
  // phone picture.
  return withLimit(limits, () => layoutBoardNow(board));
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

/**
 * Centre-to-centre distance between parallel rows.
 * A corner off a double is a long tile and the row after next has to clear
 * it, so the rows sit one long side apart. Closer than that, a later double
 * lands on the corner.
 */
const ROW_PITCH = TILE_LONG + TILE_GAP;

interface SnakeCursor {
  box: LayoutBox;
  dir: LayoutDir;
  row: number;
  /** Across-axis centre of this row (y for west/east, x for north/south). */
  line: number;
  /** The tile just placed is the corner. The next tile opens the next row. */
  opening: boolean;
  /** A double was just centred on the corner's end. The next tile runs back from its middle. */
  fromDouble: boolean;
  /** The run is continuing off that double, perpendicular to the arm's rows. */
  column: boolean;
}

function shiftDir(arm: ArmId): LayoutDir {
  if (arm === "west") return "north";
  if (arm === "north") return "east";
  if (arm === "east") return "south";
  return "west";
}

function travelDir(arm: ArmId, row: number): LayoutDir {
  return row % 2 === 0 ? arm : opposite(arm);
}

function rowsHorizontal(arm: ArmId): boolean {
  return arm === "west" || arm === "east";
}

/** -1 steps west/south rows toward the corner they own. +1 steps the other two. */
function rowSign(arm: ArmId): number {
  return arm === "west" || arm === "south" ? -1 : 1;
}

function isDoubleTile(tile: OrientedTile): boolean {
  return tile.low === tile.high;
}

function overlapsPlaced(box: LayoutBox, placed: readonly LayoutBox[]): boolean {
  return placed.some((other) => boxesOverlap(box, other));
}

/**
 * West stays left of the spinner. Its return rows stay in the top-left.
 * North stays above, and its return rows stay in the top-right. East stays
 * right, returns in the bottom-right. South stays below, returns in the
 * bottom-left. The outward row may lie on the spinner's axis.
 */
function inArmRegion(box: LayoutBox, arm: ArmId, row: number, center: LayoutBox): boolean {
  const midX = center.x + center.w / 2;
  const midY = center.y + center.h / 2;
  if (arm === "west") {
    if (box.x + box.w > center.x - TILE_GAP + 0.5) return false;
    if (row > 0 && box.y + box.h > midY - TILE_SHORT / 2 + 0.5) return false;
    return true;
  }
  if (arm === "east") {
    if (box.x < center.x + center.w + TILE_GAP - 0.5) return false;
    if (row > 0 && box.y < midY + TILE_SHORT / 2 - 0.5) return false;
    return true;
  }
  if (arm === "north") {
    if (box.y + box.h > center.y - TILE_GAP + 0.5) return false;
    if (row > 0 && box.x < midX + TILE_SHORT / 2 - 0.5) return false;
    return true;
  }
  if (box.y < center.y + center.h + TILE_GAP - 0.5) return false;
  if (row > 0 && box.x + box.w > midX - TILE_SHORT / 2 + 0.5) return false;
  return true;
}

/**
 * Where the long axis of a corner sits so it meets both row ends.
 * The corner is centred on the two ends, so each keeps most of its face.
 */
function cornerSpan(line0: number, line1: number): number {
  const half = TILE_SHORT / 2;
  const lo = Math.min(line0, line1) - half;
  const hi = Math.max(line0, line1) + half;
  return (lo + hi) / 2 - TILE_LONG / 2;
}

/** One ordinary tile, turned into the arm's corner and clear of the row it leaves. */
function placeCorner(prev: LayoutBox, arm: ArmId, row: number, line: number): LayoutBox {
  const from = travelDir(arm, row);
  const line1 = line + rowSign(arm) * ROW_PITCH;
  const horizontal = from === "east" || from === "west";
  if (horizontal) {
    const y = cornerSpan(line, line1);
    const x = from === "west" ? prev.x - TILE_GAP - TILE_SHORT : prev.x + prev.w + TILE_GAP;
    return { x, y, w: TILE_SHORT, h: TILE_LONG };
  }
  const x = cornerSpan(line, line1);
  const y = from === "north" ? prev.y - TILE_GAP - TILE_SHORT : prev.y + prev.h + TILE_GAP;
  return { x, y, w: TILE_LONG, h: TILE_SHORT };
}

function acrossCenter(box: LayoutBox, arm: ArmId): number {
  return rowsHorizontal(arm) ? box.y + box.h / 2 : box.x + box.w / 2;
}

/** First tile of a row, centred on that row and butted against the corner. */
function placeOnRow(corner: LayoutBox, arm: ArmId, row: number, isDouble: boolean, line: number): LayoutBox {
  const dir = travelDir(arm, row);
  const { along, across } = extents(isDouble);
  const horizontal = dir === "east" || dir === "west";
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  if (dir === "east") return { x: corner.x + corner.w + TILE_GAP, y: line - h / 2, w, h };
  if (dir === "west") return { x: corner.x - TILE_GAP - w, y: line - h / 2, w, h };
  if (dir === "south") return { x: line - w / 2, y: corner.y + corner.h + TILE_GAP, w, h };
  return { x: line - w / 2, y: corner.y - TILE_GAP - h, w, h };
}

/**
 * The arm's half of the table. The outward row may touch the spinner.
 * Later rows and the corners that start them stay clear of a crosswise
 * double on the neighbouring arm, which reaches half a long side past centre.
 */
function staysOnSide(box: LayoutBox, arm: ArmId, center: LayoutBox, tight: boolean): boolean {
  const spine = TILE_LONG / 2 + TILE_GAP;
  if (arm === "west") {
    const edge = tight ? -spine : center.x - TILE_GAP;
    return box.x + box.w <= edge + 0.5;
  }
  if (arm === "east") {
    const edge = tight ? spine : center.x + center.w + TILE_GAP;
    return box.x >= edge - 0.5;
  }
  if (arm === "north") {
    const edge = tight ? -spine : center.y - TILE_GAP;
    return box.y + box.h <= edge + 0.5;
  }
  const edge = tight ? spine : center.y + center.h + TILE_GAP;
  return box.y >= edge - 0.5;
}

function runInside(box: LayoutBox, _dir: LayoutDir): boolean {
  return insideActive(box);
}

function straightFits(
  prev: LayoutBox,
  dir: LayoutDir,
  isDouble: boolean,
  upcoming: readonly OrientedTile[],
  arm: ArmId,
  row: number,
  line: number,
  center: LayoutBox,
  placed: readonly LayoutBox[],
): boolean {
  const box = straightBox(prev, dir, isDouble);
  const tight = row > 0;
  if (!staysOnSide(box, arm, center, tight) || overlapsPlaced(box, placed) || !runInside(box, dir)) return false;
  if (!isDouble && !inArmRegion(box, arm, row, center)) return false;
  const next = upcoming[1];
  if (!isDouble && next && isDoubleTile(next)) {
    const doubled = straightBox(box, dir, true);
    if (!staysOnSide(doubled, arm, center, tight) || overlapsPlaced(doubled, placed) || boxesOverlap(doubled, box) || !runInside(doubled, dir)) {
      return false;
    }
  }
  if (!isDouble) {
    const corner = placeCorner(box, arm, row, line);
    if (!staysOnSide(corner, arm, center, true) || overlapsPlaced(corner, placed) || boxesOverlap(corner, box)) return false;
  }
  return true;
}

interface StepResult {
  box: LayoutBox;
  dir: LayoutDir;
  row: number;
  line: number;
  opening: boolean;
  fromDouble: boolean;
  column: boolean;
}

function snakeStep(
  tile: OrientedTile,
  cursor: SnakeCursor,
  arm: ArmId,
  center: LayoutBox,
  upcoming: readonly OrientedTile[],
  placed: readonly LayoutBox[],
  fromCenter: boolean,
): StepResult {
  const double = isDoubleTile(tile);
  const clear = (box: LayoutBox, dir: LayoutDir, tight: boolean) =>
    !overlapsPlaced(box, placed)
    && !boxesOverlap(box, cursor.box)
    && staysOnSide(box, arm, center, tight)
    && runInside(box, dir)
    && (double || inArmRegion(box, arm, cursor.row, center));
  if (fromCenter) {
    const box = straightBox(cursor.box, arm, double);
    return { box, dir: arm, row: 0, line: acrossCenter(box, arm), opening: false, fromDouble: false, column: false };
  }
  if (cursor.column) {
    const ahead = straightBox(cursor.box, cursor.dir, double);
    if (clear(ahead, cursor.dir, true)) {
      return { box: ahead, dir: cursor.dir, row: cursor.row, line: acrossCenter(ahead, arm), opening: false, fromDouble: false, column: false };
    }
    const back = travelDir(arm, cursor.row);
    const home = bendBox(cursor.box, cursor.dir, back, false);
    const awayDir = opposite(back);
    const away = bendBox(cursor.box, cursor.dir, awayDir, false);
    const turned = clear(home, back, true) ? { box: home, dir: back } : clear(away, awayDir, true) ? { box: away, dir: awayDir } : null;
    if (turned) {
      const row = turned.dir === arm ? cursor.row - (cursor.row % 2) : cursor.row + (cursor.row % 2 === 0 ? 1 : 0);
      return {
        box: turned.box,
        dir: turned.dir,
        row,
        line: acrossCenter(turned.box, arm),
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
    // The column has met the felt. Step back onto the row when that stays in this arm.
    const along = straightBox(cursor.box, back, double);
    if (staysOnSide(along, arm, center, true) && !overlapsPlaced(along, placed) && !boxesOverlap(along, cursor.box)) {
      return { box: along, dir: back, row: cursor.row, line: acrossCenter(along, arm), opening: false, fromDouble: false, column: false };
    }
    return { box: ahead, dir: cursor.dir, row: cursor.row, line: acrossCenter(ahead, arm), opening: false, fromDouble: false, column: false };
  }
  if (cursor.fromDouble) {
    const back = travelDir(arm, cursor.row);
    const along = straightBox(cursor.box, back, double);
    // Run back on the new row when that stays in this arm. Otherwise keep
    // going off the double's far end so the tile does not cross the spine.
    if (clear(along, back, true)) {
      return { box: along, dir: back, row: cursor.row, line: cursor.line, opening: false, fromDouble: false, column: false };
    }
    const onward = straightBox(cursor.box, cursor.dir, double);
    if (clear(onward, cursor.dir, true)) {
      return {
        box: onward,
        dir: cursor.dir,
        row: cursor.row,
        line: acrossCenter(onward, arm),
        opening: false,
        fromDouble: false,
        column: true,
      };
    }
    // The way back would cross the spinner into another arm. Keep this arm's side.
    if (staysOnSide(onward, arm, center, true) && !overlapsPlaced(onward, placed)) {
      return {
        box: onward,
        dir: cursor.dir,
        row: cursor.row,
        line: acrossCenter(onward, arm),
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
    return { box: along, dir: back, row: cursor.row, line: cursor.line, opening: false, fromDouble: false, column: false };
  }
  if (cursor.opening && double) {
    // Crosswise, centred on the corner's end. The column meets the middle of the double.
    const box = straightBox(cursor.box, cursor.dir, true);
    return {
      box,
      dir: cursor.dir,
      row: cursor.row,
      line: acrossCenter(box, arm),
      opening: false,
      fromDouble: true,
      column: false,
    };
  }
  if (cursor.opening) {
    const dir = travelDir(arm, cursor.row);
    const box = placeOnRow(cursor.box, arm, cursor.row, false, cursor.line);
    if (staysOnSide(box, arm, center, true) && !overlapsPlaced(box, placed)) {
      return { box, dir, row: cursor.row, line: cursor.line, opening: false, fromDouble: false, column: false };
    }
    const onward = straightBox(cursor.box, cursor.dir, false);
    return {
      box: onward,
      dir: cursor.dir,
      row: cursor.row,
      line: acrossCenter(onward, arm),
      opening: false,
      fromDouble: false,
      column: false,
    };
  }
  const dir = cursor.dir;
  // A double never makes the corner. It stays crosswise on this row.
  if (straightFits(cursor.box, dir, double, upcoming, arm, cursor.row, cursor.line, center, placed)) {
    const box = straightBox(cursor.box, dir, double);
    // A run in the turn direction moves the row. Keep the line on the tile just placed.
    const line = dir === shiftDir(arm) ? acrossCenter(box, arm) : cursor.line;
    return { box, dir, row: cursor.row, line, opening: false, fromDouble: false, column: false };
  }
  if (double) {
    // Still on this line, centred on the tile it follows. Never parked on its side.
    const box = straightBox(cursor.box, dir, true);
    const onSide = (candidate: LayoutBox, tight: boolean) =>
      staysOnSide(candidate, arm, center, tight) && !overlapsPlaced(candidate, placed) && !boxesOverlap(candidate, cursor.box);
    if (onSide(box, cursor.row > 0)) {
      const line = dir === shiftDir(arm) ? acrossCenter(box, arm) : cursor.line;
      return { box, dir, row: cursor.row, line, opening: false, fromDouble: false, column: false };
    }
    const cap = straightBox(cursor.box, shiftDir(arm), true);
    if (onSide(cap, true) || staysOnSide(cap, arm, center, true)) {
      return {
        box: cap,
        dir: shiftDir(arm),
        row: cursor.row,
        line: acrossCenter(cap, arm),
        opening: false,
        fromDouble: true,
        column: false,
      };
    }
    return { box, dir, row: cursor.row, line: cursor.line, opening: false, fromDouble: false, column: false };
  }
  if (dir !== travelDir(arm, cursor.row)) {
    // Already on the turn. Another corner here would sit against the long side.
    const stuck = straightBox(cursor.box, dir, false);
    return { box: stuck, dir, row: cursor.row, line: acrossCenter(stuck, arm), opening: false, fromDouble: false, column: false };
  }
  const onDouble = (dir === "east" || dir === "west") ? cursor.box.h > cursor.box.w : cursor.box.w > cursor.box.h;
  const centered = straightBox(cursor.box, shiftDir(arm), false);
  const ended = placeCorner(cursor.box, arm, cursor.row, cursor.line);
  const legal = (box: LayoutBox) => staysOnSide(box, arm, center, true) && !overlapsPlaced(box, placed);
  // Off a double, leave from its middle when that stays in the arm's side.
  const box = onDouble && legal(centered) ? centered : legal(ended) ? ended : centered;
  return {
    box,
    dir: shiftDir(arm),
    row: cursor.row + 1,
    line: cursor.line + rowSign(arm) * ROW_PITCH,
    opening: true,
    fromDouble: false,
    column: false,
  };
}

function layoutBoardNow(board: BoardState): BoardLayout {
  if (!board.center) {
    return { tiles: [], ends: [], fit: { x: -40, y: -40, w: 80, h: 80 }, previews: {} };
  }

  const center = centerBox(board.center);
  const tiles: PlacedTile[] = [centerTile(board.center, center)];
  const placed: LayoutBox[] = [center];
  const cursors = new Map<ArmId, SnakeCursor>();

  for (const arm of ARM_IDS) {
    const chain = board.arms[arm];
    const first = chain[0];
    if (!first) continue;
    const opening = snakeStep(
      first,
      { box: center, dir: arm, row: 0, line: 0, opening: false, fromDouble: false, column: false },
      arm,
      center,
      chain,
      placed,
      true,
    );
    const laid = toTile(first, opening.box, opening.dir, arm);
    tiles.push(laid);
    placed.push(laid);
    let cursor: SnakeCursor = {
      box: laid,
      dir: opening.dir,
      row: opening.row,
      line: opening.line,
      opening: opening.opening,
      fromDouble: opening.fromDouble,
      column: opening.column,
    };
    for (let index = 1; index < chain.length; index += 1) {
      const tile = chain[index]!;
      const choice = snakeStep(tile, cursor, arm, center, chain.slice(index), placed, false);
      const next = toTile(tile, choice.box, choice.dir, arm);
      tiles.push(next);
      placed.push(next);
      cursor = {
        box: next,
        dir: choice.dir,
        row: choice.row,
        line: choice.line,
        opening: choice.opening,
        fromDouble: choice.fromDouble,
        column: choice.column,
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

  const previews: Partial<Record<ArmId, LayoutBox>> = {};
  for (const end of ends) {
    const cursor = cursors.get(end.id);
    previews[end.id] = cursor
      ? snakeStep(PREVIEW_TILE, cursor, end.id, center, [PREVIEW_TILE], placed, false).box
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
