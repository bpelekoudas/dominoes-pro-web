import { motionMs } from "../../rules/src/motion.js";

/** One domino, a step larger than the score pips, still clear of the talk line. */
export const CONTROL_W = 20;
export const CONTROL_H = 30;

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function controlBox(center: Point, w = CONTROL_W, h = CONTROL_H): Box {
  return {
    left: center.x - w / 2,
    top: center.y - h / 2,
    right: center.x + w / 2,
    bottom: center.y + h / 2,
  };
}

export function boxesOverlap(a: Box, b: Box, pad = 0.6): boolean {
  return a.left < b.right - pad && a.right > b.left + pad && a.top < b.bottom - pad && a.bottom > b.top + pad;
}

/** Rest the token on the avatar, clear of the talk line that starts 30px in. */
export function parkOnBadge(badge: Box): Point {
  const height = Math.max(1, badge.bottom - badge.top);
  return {
    x: Math.round(badge.left + 15),
    y: Math.round(badge.top + height / 2),
  };
}

function segmentClear(a: Point, b: Point, obstacles: readonly Box[]): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / 8));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const box = controlBox({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (obstacles.some((obstacle) => boxesOverlap(box, obstacle))) return false;
  }
  return true;
}

function pathClear(points: readonly Point[], obstacles: readonly Box[]): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (!segmentClear(points[index - 1]!, points[index]!, obstacles)) return false;
  }
  return true;
}

function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  }
  return total;
}

/**
 * A route from one seat to the next that does not cross a tile.
 * One point means jump: no clear slide was found.
 */
export function controlRoute(
  from: Point,
  to: Point,
  obstacles: readonly Box[],
  viewport: { width: number; height: number },
): Point[] {
  const direct = [from, to];
  if (pathClear(direct, obstacles)) return direct;
  const inset = 10;
  const corners: Point[] = [
    { x: inset + CONTROL_W / 2, y: inset + CONTROL_H / 2 },
    { x: viewport.width - inset - CONTROL_W / 2, y: inset + CONTROL_H / 2 },
    { x: viewport.width - inset - CONTROL_W / 2, y: viewport.height - inset - CONTROL_H / 2 },
    { x: inset + CONTROL_W / 2, y: viewport.height - inset - CONTROL_H / 2 },
  ];
  const candidates: Point[][] = [];
  for (const corner of corners) candidates.push([from, corner, to]);
  for (let index = 0; index < corners.length; index += 1) {
    const next = corners[(index + 1) % corners.length]!;
    const prev = corners[(index + corners.length - 1) % corners.length]!;
    candidates.push([from, corners[index]!, next, to]);
    candidates.push([from, corners[index]!, prev, to]);
  }
  candidates.push([from, ...corners, to]);
  candidates.push([from, ...[...corners].reverse(), to]);
  let best: Point[] | null = null;
  let bestLength = Infinity;
  for (const candidate of candidates) {
    if (!pathClear(candidate, obstacles)) continue;
    const length = pathLength(candidate);
    if (length < bestLength) {
      best = candidate;
      bestLength = length;
    }
  }
  return best ?? [to];
}

/** Slide time from the shared pace. A longer detour takes longer, up to a cap. */
export function controlSlideMs(distance: number): number {
  const base = Math.min(900, Math.max(380, distance * 0.45));
  return motionMs(base);
}

export function pointAlong(points: readonly Point[], u: number): Point {
  const last = points[points.length - 1];
  const first = points[0];
  if (!first || !last) return { x: 0, y: 0 };
  if (points.length === 1 || u <= 0) return first;
  if (u >= 1) return last;
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
    lengths.push(length);
    total += length;
  }
  let remain = Math.max(0, Math.min(1, u)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (remain <= length || index === lengths.length - 1) {
      const t = length === 0 ? 1 : remain / length;
      const start = points[index]!;
      const end = points[index + 1]!;
      return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    }
    remain -= length;
  }
  return last;
}
