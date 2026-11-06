import { describe, expect, it } from "vitest";
import { allTiles } from "../../rules/src/tiles.js";
import { PIP_INSET, PIP_RADIUS, pipCenters, rotatePip, type PipRotation } from "./pips.js";

const ROTATIONS: PipRotation[] = [0, 90, 180, 270];
/** The face radius is 7px on a half about one short side (36px) across. */
const FACE_RADIUS = 7 / 36;

/**
 * The whole pip circle has to sit on the flat part of the rounded half.
 * A dot in the corner square of the radius paints on the tile edge.
 */
function circleOnFace(point: { x: number; y: number }, radius: number): boolean {
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

describe("pip positions", () => {
  it("places every tile's pips at all four orientations, centred and inside the face", () => {
    expect(allTiles()).toHaveLength(28);
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
          const upright = pipCenters(value, 0).map((dot) => rotatePip(dot, rotation));
          expect(dots).toEqual(upright);
          for (let i = 0; i < dots.length; i += 1) {
            const dot = dots[i]!;
            expect(circleOnFace(dot, PIP_RADIUS), `${tile.id} ${value} @${rotation} ${i}`).toBe(true);
            for (let j = i + 1; j < dots.length; j += 1) {
              const other = dots[j]!;
              expect(Math.hypot(dot.x - other.x, dot.y - other.y)).toBeGreaterThan(PIP_RADIUS * 2);
            }
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(28 * 4 * 2);
    // The old 3×3 cell sat near 0.20, inside the corner radius. These do not.
    expect(PIP_INSET - PIP_RADIUS).toBeGreaterThan(FACE_RADIUS);
    const six = pipCenters(6, 0);
    expect(six).toContainEqual({ x: PIP_INSET, y: PIP_INSET });
    expect(six).toContainEqual({ x: 1 - PIP_INSET, y: 0.5 });
    expect(six.some((dot) => dot.x === 0.5 && dot.y === 0.5)).toBe(false);
    const three = pipCenters(3, 90);
    expect(three).toContainEqual({ x: 0.5, y: 0.5 });
    expect(three).toContainEqual(rotatePip({ x: PIP_INSET, y: PIP_INSET }, 90));
  });
});
