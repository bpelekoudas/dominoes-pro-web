import { FIT_MARGIN, TILE_LONG, TILE_SHORT, type LayoutBox } from "../../rules/src/layout.js";

/** Inset from the wooden rails. The turn banner does not change this. */
export const FELT_PAD_X = 22;
export const FELT_PAD_Y = 48;
export const PHONE_SCALE_CAP = 2.2;
export const DESK_SCALE_CAP = 2.4;

export interface FeltSize {
  w: number;
  h: number;
}

/** Tight box around played tiles only. End caps and drop previews are not part of it. */
export function chainBounds(tiles: readonly LayoutBox[], margin = FIT_MARGIN): LayoutBox {
  if (tiles.length === 0) return { x: -40, y: -40, w: 80, h: 80 };
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
  return {
    x: minX - margin,
    y: minY - margin,
    w: Math.max(1, maxX - minX + margin * 2),
    h: Math.max(1, maxY - minY + margin * 2),
  };
}

/** Fit the chain's own box into a felt rect. The felt size must not include turn chrome. */
export function fitScale(bounds: FeltSize, felt: FeltSize, cap: number): number {
  const roomW = Math.max(48, felt.w - FELT_PAD_X * 2);
  const roomH = Math.max(48, felt.h - FELT_PAD_Y * 2);
  return Math.min(roomW / Math.max(1, bounds.w), roomH / Math.max(1, bounds.h), cap);
}

export function scaleForTiles(tiles: readonly LayoutBox[], felt: FeltSize, cap: number): number {
  return fitScale(chainBounds(tiles), felt, cap);
}

/**
 * Within a hand the picture only shrinks, and only when the chain needs
 * more room. A new hand may grow again. Turn changes pass the same tiles
 * and the same felt, so they come back unchanged.
 */
export function nextBoardScale(previous: number | null, computed: number, newHand: boolean): number {
  if (newHand || previous == null || !Number.isFinite(previous)) return computed;
  return Math.min(previous, computed);
}

/** Opening tile width, as a fraction of the table's screen. Middle of 12–15%. */
export const OPEN_TILE_FRAC = 0.135;
/** Floor. The snake turns before the picture goes below this. About 4.5% of the screen. */
export const MIN_TILE_FRAC = 0.045;
/** Zoom out once the chain comes this close to the felt edge. */
export const CAMERA_DANGER = 28;
/** After a zoom, leave this much air so the next tile does not zoom again. */
export const CAMERA_COMFORT = 72;
/**
 * Hard inset. Clears the opponent slivers that peek in from the felt edge
 * (22px on the sides, 20px across the top) with a little air, even when a
 * long chain is at the floor.
 */
export const CAMERA_EDGE = 30;
/** Ease-out on the felt. No overshoot. */
export const CAMERA_EASE_MS = 240;

/** Air between a tile and a seat badge, rack, header, or the bottom bar. */
export const BADGE_GAP = 10;

export interface AxisInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSET: AxisInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Badge reach, and never less than the felt edge inset. */
export function clearanceInsets(reserve: AxisInsets, floor = CAMERA_EDGE): AxisInsets {
  return {
    top: Math.max(reserve.top, floor),
    right: Math.max(reserve.right, floor),
    bottom: Math.max(reserve.bottom, floor),
    left: Math.max(reserve.left, floor),
  };
}

/**
 * Short side of a tile, in screen pixels, once a chain no longer fits
 * at a comfortable size. Phone and Fold stay in this range so a long
 * snake is followed instead of watched from above.
 */
export const READABLE_PHONE_PX = 34;
export const READABLE_WIDE_PX = 44;

/** Move a felt-centered chain into an asymmetric safe rect. */
export function boardShift(insets: AxisInsets): { x: number; y: number } {
  return { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 };
}

export function scaleForAxis(bounds: FeltSize, felt: FeltSize, insets: AxisInsets): number {
  const roomW = Math.max(1, felt.w - insets.left - insets.right);
  const roomH = Math.max(1, felt.h - insets.top - insets.bottom);
  return Math.min(roomW / Math.max(1, bounds.w), roomH / Math.max(1, bounds.h));
}

export interface ZoneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far each overlay reaches into the felt. A badge on the top edge
 * reserves the top, a side rack reserves that side. The gap is extra air
 * so a tile does not sit against the badge.
 */
export function zoneInsets(felt: ZoneRect, zones: readonly ZoneRect[]): AxisInsets {
  const insets: AxisInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const width = Math.max(1, felt.right - felt.left);
  const height = Math.max(1, felt.bottom - felt.top);
  for (const zone of zones) {
    const left = Math.max(zone.left, felt.left);
    const right = Math.min(zone.right, felt.right);
    const top = Math.max(zone.top, felt.top);
    const bottom = Math.min(zone.bottom, felt.bottom);
    if (right - left < 1 || bottom - top < 1) continue;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const dLeft = cx - felt.left;
    const dRight = felt.right - cx;
    const dTop = cy - felt.top;
    const dBottom = felt.bottom - cy;
    const nearest = Math.min(dLeft, dRight, dTop, dBottom);
    if (nearest === dTop) insets.top = Math.max(insets.top, bottom - felt.top + BADGE_GAP);
    else if (nearest === dBottom) insets.bottom = Math.max(insets.bottom, felt.bottom - top + BADGE_GAP);
    else if (nearest === dLeft) insets.left = Math.max(insets.left, right - felt.left + BADGE_GAP);
    else insets.right = Math.max(insets.right, felt.right - left + BADGE_GAP);
  }
  const capX = width * 0.42;
  const capY = height * 0.42;
  return {
    top: Math.min(insets.top, capY),
    right: Math.min(insets.right, capX),
    bottom: Math.min(insets.bottom, capY),
    left: Math.min(insets.left, capX),
  };
}

/**
 * Screen center of a tile after the board has finished zooming and panning.
 * `shiftX` / `shiftY` are the settled translate, including the hand-over lift.
 * The in-flight CSS transition is ignored on purpose: the crack and the +N
 * belong on the tile's landing spot.
 */
export function landedTileBox(
  felt: { left: number; top: number; width: number; height: number },
  frame: { x: number; y: number; w: number; h: number },
  scale: number,
  shiftX: number,
  shiftY: number,
  tile: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const scalerW = frame.w * scale;
  const scalerH = frame.h * scale;
  const left = felt.left + (felt.width - scalerW) / 2 + shiftX + (tile.x - frame.x) * scale;
  const top = felt.top + (felt.height - scalerH) / 2 + shiftY + (tile.y - frame.y) * scale;
  const w = tile.w * scale;
  const h = tile.h * scale;
  return { x: left + w / 2, y: top + h / 2, w, h };
}

export interface CameraInput {
  bounds: FeltSize;
  felt: FeltSize;
  /** Width of the table column. Opening size and the floor are fractions of this. */
  screenWidth: number;
  previous: number | null;
  newHand: boolean;
  /**
   * Seat badges, opponent racks, the header, and the bottom bar, measured
   * into the felt. The chain fits in what's left and is shifted to match.
   */
  reserve?: AxisInsets;
}

/**
 * Start with a large tile. Hold that size until a tile would sit inside the
 * danger margin, then ease out to the comfort margin. Never zoom back in
 * during a hand. A new hand starts large again. The picture stays on the felt,
 * and it stays at least the minimum size whenever that still fits.
 */
export function cameraScale(input: CameraInput): number {
  const screen = Math.max(1, input.screenWidth);
  // Opening size is the ceiling. The old phone and desk caps sat under
  // 12–15% of a wide screen, so a Fold opened smaller than the reference.
  const open = (OPEN_TILE_FRAC * screen) / TILE_SHORT;
  const floor = Math.min(open, (MIN_TILE_FRAC * screen) / TILE_SHORT);
  const cap = open;
  const short = Math.max(1, Math.min(input.felt.w, input.felt.h));
  // Narrow felts (a phone with players on both sides) cannot spare 72px a side.
  const dangerInset = Math.max(10, Math.min(CAMERA_DANGER, short * 0.08));
  const comfortInset = Math.max(dangerInset + 16, Math.min(CAMERA_COMFORT, short * 0.16));
  const reserve = input.reserve ?? NO_INSET;
  const comfortFit = scaleForAxis(input.bounds, input.felt, clearanceInsets(reserve, comfortInset));
  const dangerFit = scaleForAxis(input.bounds, input.felt, clearanceInsets(reserve, dangerInset));
  const edgeFit = scaleForAxis(input.bounds, input.felt, clearanceInsets(reserve, CAMERA_EDGE));
  // Comfort air when it still clears the floor. Otherwise the danger air.
  // The floor is a minimum, not a place to slam a short chain.
  let target = comfortFit;
  if (comfortFit < floor) target = dangerFit >= floor ? dangerFit : floor;
  target = Math.min(cap, target, edgeFit);
  if (target < floor && floor <= edgeFit) target = Math.min(floor, edgeFit);
  if (edgeFit < floor) target = Math.min(cap, edgeFit);

  if (input.newHand || input.previous == null || !Number.isFinite(input.previous)) {
    return Math.min(open, target);
  }

  const previous = Math.min(input.previous, cap);
  // Still clear of the edge. Hold, including after the felt grows.
  if (previous <= dangerFit + 1e-6) return Math.min(previous, edgeFit);
  return Math.min(previous, target);
}

export interface FollowResult {
  scale: number;
  shiftX: number;
  shiftY: number;
  /** "fit" shows the whole chain. "follow" keeps the action large and pans. */
  mode: "fit" | "follow";
  off: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

/** Tiles and open ends clustered around the play. The rest can leave the frame. */
export function actionFocus(
  tiles: readonly { x: number; y: number; w: number; h: number; tileId?: string }[],
  ends: readonly { x: number; y: number; w: number; h: number }[],
  lastTileId: string | null,
): { x: number; y: number; w: number; h: number } {
  if (tiles.length === 0) return { x: -40, y: -40, w: 80, h: 80 };
  const last = tiles.find((tile) => tile.tileId === lastTileId) ?? tiles[tiles.length - 1]!;
  const cx = last.x + last.w / 2;
  const cy = last.y + last.h / 2;
  // A tight cluster. A wider net made the play shrink so the whole neighborhood fit.
  const reach = TILE_LONG * 1.8;
  const near = tiles.filter((tile) => Math.hypot(tile.x + tile.w / 2 - cx, tile.y + tile.h / 2 - cy) <= reach);
  const nearEnds = ends.filter((end) => Math.hypot(end.x + end.w / 2 - cx, end.y + end.h / 2 - cy) <= reach + TILE_LONG);
  return chainBounds(nearEnds.length > 0 ? [...near, ...nearEnds] : near, 8);
}

/**
 * Keep the action large. When the whole chain still fits at a readable
 * size, show it. Otherwise hold that size and pan so the last play and
 * the nearby open ends sit in the safe rect (felt minus seat badges).
 * Overview pulls back to the whole chain. Punch scales up slightly.
 */
export function followCamera(input: {
  frame: { x: number; y: number; w: number; h: number };
  focus: { x: number; y: number; w: number; h: number };
  felt: FeltSize;
  screenWidth: number;
  reserve?: AxisInsets;
  overview?: boolean;
  punch?: number;
  /** Screen-space point, in chain coordinates, that follow mode keeps in frame. */
  anchor?: { x: number; y: number };
}): FollowResult {
  const reserve = input.reserve ?? NO_INSET;
  const insets = clearanceInsets(reserve);
  const screen = Math.max(1, input.screenWidth);
  const open = (OPEN_TILE_FRAC * screen) / TILE_SHORT;
  const readable = (screen >= 720 ? READABLE_WIDE_PX : READABLE_PHONE_PX) / TILE_SHORT;
  const full = scaleForAxis(input.frame, input.felt, insets);
  const focusFit = scaleForAxis(input.focus, input.felt, insets);
  const overview = input.overview === true;
  let mode: "fit" | "follow" = "follow";
  let scale: number;
  if (overview || full >= readable * 0.98) {
    mode = "fit";
    scale = Math.min(open, full);
  } else {
    // Hold a readable tile. If the cluster cannot fit at that size, the
    // extra tiles leave the frame instead of shrinking the play.
    scale = Math.min(open, Math.max(readable, Math.min(focusFit, open)));
  }
  const punch = input.punch ?? 1;
  if (!overview && punch > 1) scale = Math.min(open * 1.15, scale * punch);

  const focusBox = mode === "fit" ? input.frame : input.focus;
  const focusCx = mode === "follow" && input.anchor ? input.anchor.x : focusBox.x + focusBox.w / 2;
  const focusCy = mode === "follow" && input.anchor ? input.anchor.y : focusBox.y + focusBox.h / 2;
  const chainW = input.frame.w * scale;
  const chainH = input.frame.h * scale;
  const safeCx = insets.left + (input.felt.w - insets.left - insets.right) / 2;
  const safeCy = insets.top + (input.felt.h - insets.top - insets.bottom) / 2;
  let ox = safeCx - (focusCx - input.frame.x) * scale;
  let oy = safeCy - (focusCy - input.frame.y) * scale;
  const safeW = input.felt.w - insets.left - insets.right;
  const safeH = input.felt.h - insets.top - insets.bottom;
  if (chainW <= safeW) ox = safeCx - chainW / 2;
  else ox = Math.min(insets.left, Math.max(input.felt.w - insets.right - chainW, ox));
  if (chainH <= safeH) oy = safeCy - chainH / 2;
  else oy = Math.min(insets.top, Math.max(input.felt.h - insets.bottom - chainH, oy));
  const seenX = ox + (focusCx - input.frame.x) * scale;
  const seenY = oy + (focusCy - input.frame.y) * scale;
  const margin = 8;
  if (seenX < insets.left + margin) ox += insets.left + margin - seenX;
  if (seenX > input.felt.w - insets.right - margin) ox -= seenX - (input.felt.w - insets.right - margin);
  if (seenY < insets.top + margin) oy += insets.top + margin - seenY;
  if (seenY > input.felt.h - insets.bottom - margin) oy -= seenY - (input.felt.h - insets.bottom - margin);
  return {
    scale,
    shiftX: ox - (input.felt.w - chainW) / 2,
    shiftY: oy - (input.felt.h - chainH) / 2,
    mode,
    off: {
      left: ox < insets.left - 1,
      right: ox + chainW > input.felt.w - insets.right + 1,
      top: oy < insets.top - 1,
      bottom: oy + chainH > input.felt.h - insets.bottom + 1,
    },
  };
}

/** Gold ring clearance between the last tile and the hand-over sheet. */
export const HAND_OVER_BAND_GAP = 28;

export interface HandOverShiftInput {
  /** Felt top, in the same coordinate space as `sheetTop`. */
  feltTop: number;
  feltHeight: number;
  /**
   * Top of the hand-over sheet at its normal height. Null when that sheet
   * is not on screen. Pass that unconstrained top, not one already pushed down.
   */
  sheetTop: number | null;
  /** Visual height of the chain box. Scale is not changed to produce this. */
  chainHeight: number;
  /** Last tile's top and height inside the chain, in visual pixels. */
  lastTile: { top: number; height: number } | null;
}

export interface HandOverPlacement {
  /** translateY from the felt-centered position. */
  lift: number;
  /**
   * Screen Y the sheet must sit at or below so the last tile stays visible.
   * Null when the normal sheet already clears the tile.
   */
  sheetTop: number | null;
}

/**
 * Shift the frozen chain just enough for the last tile to clear the sheet.
 * The chain stays inside the felt: its top never crosses the rail inset.
 * When the tile still would not fit, `sheetTop` says how far down the sheet
 * has to start. Pass the natural centered position, not one that already
 * includes this shift.
 */
export function handOverPlacement(input: HandOverShiftInput): HandOverPlacement {
  const feltBottom = input.feltTop + input.feltHeight;
  const minTop = input.feltTop + FELT_PAD_Y;
  const room = input.feltHeight - FELT_PAD_Y * 2;
  const maxTop = room >= input.chainHeight ? feltBottom - FELT_PAD_Y - input.chainHeight : minTop;
  const naturalTop = input.feltTop + (input.feltHeight - input.chainHeight) / 2;
  const tile = input.lastTile ?? {
    top: Math.max(0, input.chainHeight - Math.min(72, input.chainHeight)),
    height: Math.min(72, input.chainHeight),
  };
  const tileEnd = tile.top + tile.height;
  const clamp = (top: number) => (maxTop <= minTop ? minTop : Math.min(maxTop, Math.max(minTop, top)));

  if (input.sheetTop == null || input.sheetTop >= feltBottom - 4) {
    return { lift: clamp(naturalTop) - naturalTop, sheetTop: null };
  }

  const neededTop = input.sheetTop - HAND_OVER_BAND_GAP - tileEnd;
  const chainTop = clamp(Math.min(naturalTop, neededTop));
  const tileBottom = chainTop + tileEnd;
  const sheetTop = tileBottom + HAND_OVER_BAND_GAP > input.sheetTop + 0.5 ? tileBottom + HAND_OVER_BAND_GAP : null;
  return { lift: chainTop - naturalTop, sheetTop };
}
