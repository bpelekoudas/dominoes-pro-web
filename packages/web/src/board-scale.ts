import { FIT_MARGIN, TILE_SHORT, type LayoutBox } from "../../rules/src/layout.js";

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
 * Smallest short side of a tile, in screen pixels. The camera zooms out
 * until every open end fits, and it stops here. Phone and Fold stay
 * readable instead of rising above the table.
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
  /** "fit" shows the whole chain. "follow" frames the open ends and may crop the middle. */
  mode: "fit" | "follow";
  /** Inset the board clip must use so an on-frame end is not cut off. */
  clip: AxisInsets;
  off: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

export interface OpenEndBox extends LayoutBox {
  id?: string;
}

/** Air around an end tile so a pip is not clipped by the badge inset. */
const END_MARGIN = 6;

/**
 * Every open end, zoomed out until they fit, but never smaller than the
 * readable floor. Seat badges are real rectangles: an end beside a badge
 * stays in frame. When the ends cannot all fit on the felt at that floor,
 * keep the floor and frame the largest set that does, preferring ends the
 * active player can play on. Interior tiles may leave. Overview shows the
 * chain. Punch scales up briefly, then the caller drops it and this framing
 * returns.
 */
export function followCamera(input: {
  frame: LayoutBox;
  ends: readonly OpenEndBox[];
  /** End ids the player to move can legally play on. Used only in the fallback. */
  playableIds?: readonly string[];
  felt: FeltSize;
  screenWidth: number;
  reserve?: AxisInsets;
  /** Badge and rack rects in felt space. Empty keeps the rectangular gutter. */
  zones?: readonly ZoneRect[];
  overview?: boolean;
  punch?: number;
}): FollowResult {
  const reserve = input.reserve ?? NO_INSET;
  const badge = clearanceInsets(reserve);
  const pad: AxisInsets = { top: FELT_EDGE, right: FELT_EDGE, bottom: FELT_EDGE, left: FELT_EDGE };
  const screen = Math.max(1, input.screenWidth);
  const open = (OPEN_TILE_FRAC * screen) / TILE_SHORT;
  const readable = (screen >= 720 ? READABLE_WIDE_PX : READABLE_PHONE_PX) / TILE_SHORT;
  const ends = input.ends.length > 0 ? input.ends : [input.frame];
  const tight = chainBounds(ends, 0);
  const aired = chainBounds(ends, END_MARGIN);
  const zones = input.zones ?? [];
  const overview = input.overview === true;
  const feltFit = scaleForAxis(tight, input.felt, pad);
  let mode: "fit" | "follow" = "follow";
  let scale: number;
  let target: LayoutBox;
  let insets: AxisInsets;

  if (overview) {
    mode = "fit";
    scale = Math.min(open, scaleForAxis(input.frame, input.felt, badge));
    target = input.frame;
    insets = badge;
  } else {
    const clear = zones.length > 0
      ? fitEndsClear(ends, input.frame, input.felt, pad, zones, Math.min(open, feltFit), readable)
      : null;
    if (clear) {
      scale = clear.scale;
      target = tight;
      insets = endsInside(ends, input.frame, scale, clear.ox, clear.oy, input.felt, badge) ? badge : pad;
      mode = chainInside(input.frame, input.felt, insets, scale, clear.ox, clear.oy) ? "fit" : "follow";
      const punched = applyPunch(scale, open, input.punch, overview);
      if (punched === scale) return finish(input.frame, input.felt, scale, clear.ox, clear.oy, insets, mode);
      const zoomed = placeTarget(tight, input.frame, input.felt, insets, punched);
      return finish(input.frame, input.felt, punched, zoomed.ox, zoomed.oy, insets, mode);
    }
    const badgeFit = scaleForAxis(aired, input.felt, badge);
    if (zones.length === 0 && badgeFit >= readable * 0.98) {
      scale = Math.min(open, badgeFit);
      target = aired;
      insets = badge;
      mode = scaleForAxis(input.frame, input.felt, badge) >= readable * 0.98 ? "fit" : "follow";
    } else if (feltFit >= readable * 0.98) {
      scale = Math.min(open, feltFit);
      target = tight;
      insets = pad;
      mode = "follow";
    } else {
      scale = Math.min(open, readable);
      const safeW = input.felt.w - badge.left - badge.right;
      const safeH = input.felt.h - badge.top - badge.bottom;
      target = endSubset(ends, input.playableIds ?? [], scale, safeW, safeH);
      insets = badge;
      mode = "follow";
    }
  }

  scale = applyPunch(scale, open, input.punch, overview);
  const placed = placeTarget(target, input.frame, input.felt, insets, scale);
  if (!overview && mode === "fit") {
    const chain = placeTarget(input.frame, input.frame, input.felt, insets, scale);
    return finish(input.frame, input.felt, scale, chain.ox, chain.oy, insets, mode);
  }
  return finish(input.frame, input.felt, scale, placed.ox, placed.oy, insets, mode);
}

/** How close an open end may sit to the felt edge when it has to leave the badge gutter. */
const FELT_EDGE = 4;

function applyPunch(scale: number, open: number, punch: number | undefined, overview: boolean): number {
  const factor = punch ?? 1;
  if (overview || factor <= 1) return scale;
  return Math.min(open * 1.15, scale * factor);
}

function placeTarget(
  target: LayoutBox,
  frame: LayoutBox,
  felt: FeltSize,
  insets: AxisInsets,
  scale: number,
): { ox: number; oy: number } {
  const safeW = felt.w - insets.left - insets.right;
  const safeH = felt.h - insets.top - insets.bottom;
  const chainW = frame.w * scale;
  const chainH = frame.h * scale;
  if (chainW <= safeW + 0.5 && chainH <= safeH + 0.5) {
    return {
      ox: insets.left + (safeW - chainW) / 2,
      oy: insets.top + (safeH - chainH) / 2,
    };
  }
  const safeCx = insets.left + safeW / 2;
  const safeCy = insets.top + safeH / 2;
  const focusCx = target.x + target.w / 2;
  const focusCy = target.y + target.h / 2;
  let ox = safeCx - (focusCx - frame.x) * scale;
  let oy = safeCy - (focusCy - frame.y) * scale;
  const boxLeft = ox + (target.x - frame.x) * scale;
  const boxTop = oy + (target.y - frame.y) * scale;
  const boxRight = boxLeft + target.w * scale;
  const boxBottom = boxTop + target.h * scale;
  if (target.w * scale <= safeW + 0.5) {
    if (boxLeft < insets.left) ox += insets.left - boxLeft;
    if (boxRight > felt.w - insets.right) ox -= boxRight - (felt.w - insets.right);
  }
  if (target.h * scale <= safeH + 0.5) {
    if (boxTop < insets.top) oy += insets.top - boxTop;
    if (boxBottom > felt.h - insets.bottom) oy -= boxBottom - (felt.h - insets.bottom);
  }
  return { ox, oy };
}

function finish(
  frame: LayoutBox,
  felt: FeltSize,
  scale: number,
  ox: number,
  oy: number,
  clip: AxisInsets,
  mode: "fit" | "follow",
): FollowResult {
  const chainW = frame.w * scale;
  const chainH = frame.h * scale;
  return {
    scale,
    shiftX: ox - (felt.w - chainW) / 2,
    shiftY: oy - (felt.h - chainH) / 2,
    mode,
    clip,
    off: {
      left: ox < clip.left - 1,
      right: ox + chainW > felt.w - clip.right + 1,
      top: oy < clip.top - 1,
      bottom: oy + chainH > felt.h - clip.bottom + 1,
    },
  };
}

function chainInside(frame: LayoutBox, felt: FeltSize, insets: AxisInsets, scale: number, ox: number, oy: number): boolean {
  const right = ox + frame.w * scale;
  const bottom = oy + frame.h * scale;
  return ox >= insets.left - 1 && oy >= insets.top - 1 && right <= felt.w - insets.right + 1 && bottom <= felt.h - insets.bottom + 1;
}

function endsInside(
  ends: readonly OpenEndBox[],
  frame: LayoutBox,
  scale: number,
  ox: number,
  oy: number,
  felt: FeltSize,
  insets: AxisInsets,
): boolean {
  return endRects(ends, frame, scale, ox, oy).every(
    (rect) => rect.left >= insets.left - 0.5 && rect.top >= insets.top - 0.5 && rect.right <= felt.w - insets.right + 0.5 && rect.bottom <= felt.h - insets.bottom + 0.5,
  );
}

/**
 * Largest scale at or above the floor where every end sits on the felt
 * and clear of the seat rectangles. Null when the ends cannot all fit
 * even at the floor, ignoring seats.
 */
function fitEndsClear(
  ends: readonly OpenEndBox[],
  frame: LayoutBox,
  felt: FeltSize,
  pad: AxisInsets,
  zones: readonly ZoneRect[],
  maxScale: number,
  minScale: number,
): { scale: number; ox: number; oy: number } | null {
  if (!(maxScale >= minScale * 0.98)) return null;
  const top = Math.max(minScale, maxScale);
  for (let scale = top; scale >= minScale - 1e-6; scale -= 0.01) {
    const pan = panClear(ends, frame, felt, pad, zones, Math.max(scale, minScale), 1) ?? panClear(ends, frame, felt, pad, zones, Math.max(scale, minScale), 0);
    if (pan) return { scale: Math.max(scale, minScale), ...pan };
    if (scale <= minScale) break;
  }
  return null;
}

function endRects(
  ends: readonly LayoutBox[],
  frame: LayoutBox,
  scale: number,
  ox: number,
  oy: number,
): Array<{ left: number; top: number; right: number; bottom: number }> {
  return ends.map((end) => {
    const left = ox + (end.x - frame.x) * scale;
    const top = oy + (end.y - frame.y) * scale;
    return { left, top, right: left + end.w * scale, bottom: top + end.h * scale };
  });
}

function panClear(
  ends: readonly OpenEndBox[],
  frame: LayoutBox,
  felt: FeltSize,
  pad: AxisInsets,
  zones: readonly ZoneRect[],
  scale: number,
  gap: number,
): { ox: number; oy: number } | null {
  const box = chainBounds(ends, 0);
  const minOx = pad.left - (box.x - frame.x) * scale;
  const maxOx = felt.w - pad.right - (box.x + box.w - frame.x) * scale;
  const minOy = pad.top - (box.y - frame.y) * scale;
  const maxOy = felt.h - pad.bottom - (box.y + box.h - frame.y) * scale;
  if (maxOx < minOx - 0.5 || maxOy < minOy - 0.5) return null;
  const step = 3;
  const best = { ox: 0, oy: 0, dist: Number.POSITIVE_INFINITY, hit: false };
  const cx = (minOx + maxOx) / 2;
  const cy = (minOy + maxOy) / 2;
  const consider = (ox: number, oy: number) => {
    if (ox < minOx - 0.5 || ox > maxOx + 0.5 || oy < minOy - 0.5 || oy > maxOy + 0.5) return;
    const rects = endRects(ends, frame, scale, ox, oy);
    const onFelt = rects.every(
      (rect) => rect.left >= pad.left - 0.5 && rect.top >= pad.top - 0.5 && rect.right <= felt.w - pad.right + 0.5 && rect.bottom <= felt.h - pad.bottom + 0.5,
    );
    if (!onFelt) return;
    const blocked = rects.some((rect) => zones.some((zone) => rect.right > zone.left + gap && rect.left < zone.right - gap && rect.bottom > zone.top + gap && rect.top < zone.bottom - gap));
    if (blocked) return;
    const dist = Math.hypot(ox - cx, oy - cy);
    if (dist < best.dist) {
      best.ox = ox;
      best.oy = oy;
      best.dist = dist;
      best.hit = true;
    }
  };
  consider(cx, cy);
  if (best.hit && best.dist < 0.5) return { ox: best.ox, oy: best.oy };
  for (let ox = minOx; ox <= maxOx + 0.1; ox += step) {
    for (let oy = minOy; oy <= maxOy + 0.1; oy += step) consider(ox, oy);
  }
  consider(minOx, minOy);
  consider(maxOx, maxOy);
  consider(minOx, maxOy);
  consider(maxOx, minOy);
  return best.hit ? { ox: best.ox, oy: best.oy } : null;
}

/** Where a chain-space box lands in the felt after the camera settles. */
export function screenBox(
  felt: FeltSize,
  frame: LayoutBox,
  scale: number,
  shiftX: number,
  shiftY: number,
  box: LayoutBox,
): { left: number; top: number; right: number; bottom: number } {
  const ox = (felt.w - frame.w * scale) / 2 + shiftX;
  const oy = (felt.h - frame.h * scale) / 2 + shiftY;
  const left = ox + (box.x - frame.x) * scale;
  const top = oy + (box.y - frame.y) * scale;
  return { left, top, right: left + box.w * scale, bottom: top + box.h * scale };
}

/**
 * Largest set of open ends that fits at `scale`. Playable ends win ties
 * against a larger group that the player cannot use.
 */
function endSubset(
  ends: readonly OpenEndBox[],
  playableIds: readonly string[],
  scale: number,
  safeW: number,
  safeH: number,
): LayoutBox {
  const playable = new Set(playableIds);
  const prefer = ends.filter((end) => end.id != null && playable.has(end.id));
  const anchor = chainBounds(prefer.length > 0 ? prefer : ends, 0);
  const ax = anchor.x + anchor.w / 2;
  const ay = anchor.y + anchor.h / 2;
  let best: { box: LayoutBox; play: number; count: number; dist: number } | null = null;
  const limit = 1 << ends.length;
  for (let mask = 1; mask < limit; mask += 1) {
    const picked: OpenEndBox[] = [];
    let play = 0;
    for (let index = 0; index < ends.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const end = ends[index]!;
      picked.push(end);
      if (end.id != null && playable.has(end.id)) play += 1;
    }
    const box = chainBounds(picked, END_MARGIN);
    if (box.w * scale > safeW + 0.5 || box.h * scale > safeH + 0.5) continue;
    const dist = Math.hypot(box.x + box.w / 2 - ax, box.y + box.h / 2 - ay);
    const better =
      best == null ||
      play > best.play ||
      (play === best.play && picked.length > best.count) ||
      (play === best.play && picked.length === best.count && dist < best.dist);
    if (better) best = { box, play, count: picked.length, dist };
  }
  return best?.box ?? chainBounds([ends[0]!], END_MARGIN);
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
