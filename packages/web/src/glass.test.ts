import { describe, expect, it } from "vitest";
import { buildGlass } from "./glass.js";

describe("glass pane", () => {
  it("covers the table with angular shards and a spiderweb of cracks", () => {
    for (const [width, height, ox, oy] of [
      [390, 700, 180, 320],
      [412, 820, 210, 360],
      [360, 640, 40, 80],
    ] as const) {
      const scene = buildGlass(width, height, ox, oy, 25);
      expect(scene.shards.length).toBeGreaterThan(40);
      expect(scene.shards.length).toBeLessThan(160);
      expect(scene.cracks.length).toBeGreaterThan(40);
      expect(scene.shards.some((shard) => shard.local.length === 3)).toBe(true);
      expect(scene.shards.some((shard) => shard.local.length >= 4)).toBe(true);
      const nearest = Math.min(...scene.cracks.map((crack) => crack.dist));
      expect(nearest).toBeLessThan(80);
      expect(scene.cracks.some((crack) => crack.dist > Math.min(width, height) * 0.45)).toBe(true);

      let hit = 0;
      let samples = 0;
      for (let y = 8; y < height - 8; y += 16) {
        for (let x = 8; x < width - 8; x += 16) {
          samples += 1;
          if (covered(scene.shards, x, y)) hit += 1;
        }
      }
      expect(hit / samples).toBeGreaterThan(0.92);
    }
  });
});

function covered(
  shards: Array<{ local: Array<{ x: number; y: number }>; cx: number; cy: number }>,
  x: number,
  y: number,
): boolean {
  for (const shard of shards) {
    if (pointInPoly(x - shard.cx, y - shard.cy, shard.local)) return true;
  }
  return false;
}

function pointInPoly(x: number, y: number, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    const crosses = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
