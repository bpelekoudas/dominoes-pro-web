import { motionMs } from "../../rules/src/motion.js";
import { easeInOut, type Point } from "./win-plan.js";

/**
 * A hand or game win flashes the winner's character.
 * These lengths sit inside the pip tally the table already waits on.
 * They are not extra steps, so the continue clock and the next deal do not move.
 */
export const HAND_POP_IN_MS = motionMs(160);
export const HAND_POP_HOLD_MS = motionMs(420);
export const HAND_POP_OUT_MS = motionMs(280);
export const HAND_POP_MS = HAND_POP_IN_MS + HAND_POP_HOLD_MS + HAND_POP_OUT_MS;

export const GAME_POP_IN_MS = motionMs(180);
export const GAME_POP_HOLD_MS = motionMs(520);
export const GAME_POP_OUT_MS = motionMs(300);
export const GAME_POP_MS = GAME_POP_IN_MS + GAME_POP_HOLD_MS + GAME_POP_OUT_MS;

/** Reduced motion fades in place. It does not travel. */
export const REDUCED_POP_MS = 320;

export type PopKind = "hand" | "game";
export type SeatEdge = "left" | "top" | "right" | "bottom";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PopFrame {
  /** 0 at the seat, 1 at the hold, 2 back on the score chip. */
  along: number;
  scale: number;
  opacity: number;
}

export interface PopPlace {
  box: Box;
  withLine: boolean;
  seat: Point;
  rest: Point;
  score: Point;
}

export function popTiming(kind: PopKind): { inMs: number; holdMs: number; outMs: number; total: number } {
  if (kind === "game") {
    return { inMs: GAME_POP_IN_MS, holdMs: GAME_POP_HOLD_MS, outMs: GAME_POP_OUT_MS, total: GAME_POP_MS };
  }
  return { inMs: HAND_POP_IN_MS, holdMs: HAND_POP_HOLD_MS, outMs: HAND_POP_OUT_MS, total: HAND_POP_MS };
}

/** Game art is a step larger than a hand. A line, when it fits, adds one row. */
export function winnerPopSize(kind: PopKind, withLine: boolean): { width: number; height: number } {
  const art = kind === "game" ? { width: 84, height: 112 } : { width: 68, height: 92 };
  return { width: art.width, height: art.height + (withLine ? 16 : 0) };
}

export function overlaps(a: Box, b: Box, pad = 1): boolean {
  return a.left < b.right - pad && a.right > b.left + pad && a.top < b.bottom - pad && a.bottom > b.top + pad;
}

export function winnerPopFrame(kind: PopKind, elapsed: number, reduced: boolean): PopFrame {
  const t = Math.max(0, elapsed);
  if (reduced) {
    const total = REDUCED_POP_MS;
    const fade = 70;
    let opacity = 1;
    if (t <= 0) opacity = 0;
    else if (t < fade) opacity = t / fade;
    else if (t > total - fade) opacity = Math.max(0, (total - t) / fade);
    if (t >= total) opacity = 0;
    return { along: 1, scale: 1, opacity };
  }
  const { inMs, holdMs, outMs, total } = popTiming(kind);
  if (t >= total) return { along: 2, scale: 0.42, opacity: 0 };
  if (t < inMs) {
    const u = inMs === 0 ? 1 : t / inMs;
    const scale = u < 0.72 ? 0.4 + (1.12 - 0.4) * (u / 0.72) : 1.12 + (1 - 1.12) * ((u - 0.72) / 0.28);
    return { along: u, scale, opacity: Math.min(1, u / 0.3) };
  }
  if (t < inMs + holdMs) return { along: 1, scale: 1, opacity: 1 };
  const u = outMs === 0 ? 1 : (t - inMs - holdMs) / outMs;
  const opacity = u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45);
  return { along: 1 + u, scale: 1 + (0.42 - 1) * u, opacity };
}

export function winnerPopPoint(along: number, seat: Point, rest: Point, score: Point): Point {
  if (along <= 1) return mix(seat, rest, easeInOut(along));
  return mix(rest, score, easeInOut(along - 1));
}

function mix(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export interface PlaceInput {
  kind: PopKind;
  withLine: boolean;
  edge: SeatEdge;
  avatar: Box;
  score: Box;
  obstacles: readonly Box[];
  viewport: { width: number; height: number };
}

/**
 * Hold the full-size character in a gap that misses tiles, the rack, and badges.
 * The flight back to the score chip may cross the winner's own badge. It may not
 * cross a tile or anyone else's badge.
 */
export function placeWinnerPop(input: PlaceInput): PopPlace | null {
  const seat = centerOf(input.avatar);
  const score = centerOf(input.score);
  const sizes = [winnerPopSize(input.kind, input.withLine)];
  if (input.withLine) sizes.push(winnerPopSize(input.kind, false));
  const linedHeight = winnerPopSize(input.kind, true).height;
  for (const size of sizes) {
    for (const rest of candidateCenters(input, size, seat)) {
      const placed = makeBox(rest.x - size.width / 2, rest.y - size.height / 2, size.width, size.height);
      if (!inside(placed, input.viewport, 4)) continue;
      // The frame ring paints about 14% past the portrait. Keep that ring off the tiles.
      if (input.obstacles.some((item) => overlaps(inflate(placed, 16), item, 0))) continue;
      if (!flightClear(seat, rest, score, size, input.obstacles, seat)) continue;
      return {
        box: placed,
        withLine: input.withLine && size.height === linedHeight,
        seat,
        rest,
        score,
      };
    }
  }
  return null;
}

function centerOf(box: Box): Point {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function makeBox(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function inflate(box: Box, gap: number): Box {
  return makeBox(box.left - gap, box.top - gap, box.width + gap * 2, box.height + gap * 2);
}

function inside(box: Box, viewport: { width: number; height: number }, margin: number): boolean {
  return box.left >= margin && box.top >= margin && box.right <= viewport.width - margin && box.bottom <= viewport.height - margin;
}

function containsPoint(box: Box, point: Point): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

function inScale(u: number): number {
  if (u < 0.72) return 0.4 + (1.12 - 0.4) * (u / 0.72);
  return 1.12 + (1 - 1.12) * ((u - 0.72) / 0.28);
}

function flightClear(
  seat: Point,
  rest: Point,
  score: Point,
  size: { width: number; height: number },
  obstacles: readonly Box[],
  own: Point,
): boolean {
  const samples: Array<{ at: Point; scale: number }> = [
    { at: mix(seat, rest, 0.55), scale: inScale(0.55) },
    { at: mix(seat, rest, 0.82), scale: inScale(0.82) },
    { at: mix(rest, score, 0.28), scale: 1 + (0.42 - 1) * 0.28 },
  ];
  for (const sample of samples) {
    const width = size.width * sample.scale;
    const height = size.height * sample.scale;
    const box = makeBox(sample.at.x - width / 2, sample.at.y - height / 2, width, height);
    for (const obstacle of obstacles) {
      if (containsPoint(obstacle, own)) continue;
      if (overlaps(box, obstacle)) return false;
    }
  }
  return true;
}

function candidateCenters(input: PlaceInput, size: { width: number; height: number }, seat: Point): Point[] {
  const cx = input.viewport.width / 2;
  const cy = input.viewport.height / 2;
  const dx = seat.x - cx;
  const dy = seat.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  const outward = { x: dx / len, y: dy / len };
  const side = { x: -outward.y, y: outward.x };
  const dirs = [
    outward,
    side,
    { x: -side.x, y: -side.y },
    { x: outward.x + side.x, y: outward.y + side.y },
    { x: outward.x - side.x, y: outward.y - side.y },
    { x: -outward.x, y: -outward.y },
  ];
  const spots: Point[] = [];
  for (const dist of [size.width, size.height, size.width + 48, 160]) {
    for (const dir of dirs) {
      const dirLen = Math.hypot(dir.x, dir.y) || 1;
      spots.push({ x: seat.x + (dir.x / dirLen) * dist, y: seat.y + (dir.y / dirLen) * dist });
    }
  }
  const margin = 6;
  const width = input.viewport.width;
  const height = input.viewport.height;
  const corner = (x: number, y: number) => spots.push({ x, y });
  if (input.edge === "top" || input.edge === "left") {
    corner(margin + size.width / 2, margin + size.height / 2);
  }
  if (input.edge === "top" || input.edge === "right") {
    corner(width - margin - size.width / 2, margin + size.height / 2);
  }
  if (input.edge === "bottom" || input.edge === "left") {
    corner(margin + size.width / 2, height - margin - size.height / 2);
  }
  if (input.edge === "bottom" || input.edge === "right") {
    corner(width - margin - size.width / 2, height - margin - size.height / 2);
  }
  const grid: Point[] = [];
  for (let top = 8; top <= height - size.height - 8; top += 28) {
    for (let left = 8; left <= width - size.width - 8; left += 28) {
      grid.push({ x: left + size.width / 2, y: top + size.height / 2 });
    }
  }
  grid.sort((a, b) => (a.x - seat.x) ** 2 + (a.y - seat.y) ** 2 - ((b.x - seat.x) ** 2 + (b.y - seat.y) ** 2));
  return spots.concat(grid);
}
