import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allTiles } from "../../rules/src/tiles.js";
import { PIP_DIAMETER, PIP_PITCH, PIP_RADIUS, pipCenters, rotatePip, type PipPoint, type PipRotation } from "./pips.js";

const ROTATIONS: PipRotation[] = [0, 90, 180, 270];
/** The face radius is 7px on a half about one short side (36px) across. */
const FACE_RADIUS = 7 / 36;

function circleOnFace(point: PipPoint, radius: number): boolean {
  if (point.x - radius < -1e-6 || point.y - radius < -1e-6) return false;
  if (point.x + radius > 1 + 1e-6 || point.y + radius > 1 + 1e-6) return false;
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const;
  for (const [cx, cy] of corners) {
    const axisX = cx === 0 ? point.x : 1 - point.x;
    const axisY = cy === 0 ? point.y : 1 - point.y;
    if (axisX >= FACE_RADIUS || axisY >= FACE_RADIUS) continue;
    const arcX = cx === 0 ? FACE_RADIUS : 1 - FACE_RADIUS;
    const arcY = cy === 0 ? FACE_RADIUS : 1 - FACE_RADIUS;
    if (Math.hypot(point.x - arcX, point.y - arcY) + radius > FACE_RADIUS + 1e-6) return false;
  }
  return true;
}

function pairDistances(dots: readonly PipPoint[]): number[] {
  const distances: number[] = [];
  for (let i = 0; i < dots.length; i += 1) {
    for (let j = i + 1; j < dots.length; j += 1) {
      distances.push(Math.hypot(dots[i]!.x - dots[j]!.x, dots[i]!.y - dots[j]!.y));
    }
  }
  return distances.sort((a, b) => a - b);
}

describe("pip positions", () => {
  it("places every tile's pips at all four orientations, round and evenly spaced", () => {
    expect(allTiles()).toHaveLength(28);
    expect(PIP_DIAMETER).toBe(PIP_RADIUS * 2);
    expect(PIP_DIAMETER).toBeLessThan(PIP_PITCH);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.half i \{[^}]*width:\s*14cqmin;\s*height:\s*14cqmin;/);
    let checked = 0;
    for (const tile of allTiles()) {
      for (const rotation of ROTATIONS) {
        for (const value of [tile.low, tile.high]) {
          const dots = pipCenters(value, rotation);
          expect(dots, `${tile.id} ${value} @${rotation}`).toHaveLength(value);
          if (value > 0) {
            const cx = dots.reduce((sum, dot) => sum + dot.x, 0) / dots.length;
            const cy = dots.reduce((sum, dot) => sum + dot.y, 0) / dots.length;
            expect(cx, `${tile.id} ${value} @${rotation} x`).toBeCloseTo(0.5, 5);
            expect(cy, `${tile.id} ${value} @${rotation} y`).toBeCloseTo(0.5, 5);
          }
          expect(dots).toEqual(pipCenters(value, 0).map((dot) => rotatePip(dot, rotation)));
          for (let i = 0; i < dots.length; i += 1) {
            expect(circleOnFace(dots[i]!, PIP_RADIUS), `${tile.id} ${value} @${rotation}`).toBe(true);
          }
          const distances = pairDistances(dots);
          for (const distance of distances) {
            expect(distance, `${tile.id} ${value} @${rotation} overlap`).toBeGreaterThan(PIP_DIAMETER - 1e-6);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(28 * 4 * 2);

    for (const rotation of ROTATIONS) {
      const six = pipCenters(6, rotation);
      const distances = pairDistances(six);
      const neighbours = distances.filter((distance) => Math.abs(distance - PIP_PITCH) < 1e-6);
      // Three rows of one horizontal gap, and two columns of two vertical gaps.
      expect(neighbours, `six @${rotation}`).toHaveLength(7);
      const spanX = Math.max(...six.map((dot) => dot.x)) - Math.min(...six.map((dot) => dot.x));
      const spanY = Math.max(...six.map((dot) => dot.y)) - Math.min(...six.map((dot) => dot.y));
      const wide = Math.max(spanX, spanY);
      const narrow = Math.min(spanX, spanY);
      expect(wide).toBeCloseTo(PIP_PITCH * 2, 5);
      expect(narrow).toBeCloseTo(PIP_PITCH, 5);
    }
  });
});
