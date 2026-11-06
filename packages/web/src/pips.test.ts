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
    expect(css).toMatch(/\.half i \{[^}]*width:\s*16cqmin;\s*height:\s*16cqmin;/);
    expect(css).not.toMatch(/\.hand-tile \.half i \{[^}]*var\(--hand-tile/);
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

  it("measures each pip of a 6 and a 3 as a fraction of the half", () => {
    // The old 0.22 pitch left a 6's outer pip at 0.28, a tight cluster in the middle.
    expect(0.5 - PIP_PITCH).toBeLessThan(0.22);
    for (const rotation of [0, 90] as const) {
      for (const value of [6, 3]) {
        const dots = pipCenters(value, rotation);
        expect(dots, `${value} @${rotation}`).toHaveLength(value);
        for (const dot of dots) {
          expect(dot.x, `${value} @${rotation} x`).toBeGreaterThan(0);
          expect(dot.x, `${value} @${rotation} x`).toBeLessThan(1);
          expect(dot.y, `${value} @${rotation} y`).toBeGreaterThan(0);
          expect(dot.y, `${value} @${rotation} y`).toBeLessThan(1);
          const onGrid = pipCenters(value, 0).some((upright) => {
            const turned = rotatePip(upright, rotation);
            return Math.abs(turned.x - dot.x) < 1e-6 && Math.abs(turned.y - dot.y) < 1e-6;
          });
          expect(onGrid, `${value} @${rotation} ${dot.x},${dot.y}`).toBe(true);
        }
        const span = Math.max(
          Math.max(...dots.map((dot) => dot.x)) - Math.min(...dots.map((dot) => dot.x)),
          Math.max(...dots.map((dot) => dot.y)) - Math.min(...dots.map((dot) => dot.y)),
        );
        const reach = value === 6 ? PIP_PITCH * 2 : PIP_PITCH;
        expect(span, `${value} @${rotation} span`).toBeCloseTo(reach, 5);
      }
    }
    const six = pipCenters(6, 0);
    const top = Math.min(...six.map((dot) => dot.y));
    const bottom = Math.max(...six.map((dot) => dot.y));
    expect(top).toBeCloseTo(0.5 - PIP_PITCH, 5);
    expect(bottom).toBeCloseTo(0.5 + PIP_PITCH, 5);
    expect(top).toBeLessThan(0.22);
    expect(1 - bottom).toBeLessThan(0.22);
  });
});
