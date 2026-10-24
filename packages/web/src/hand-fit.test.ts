import { describe, expect, it } from "vitest";
import { handFit } from "./hand-fit.js";

describe("handFit", () => {
  it("keeps a short hand at the natural tile size", () => {
    const fit = handFit(316, 6, 44);
    expect(fit.scroll).toBe(false);
    expect(fit.tile).toBe(44);
    expect(fit.gap).toBe(8);
    expect(6 * fit.tile + 5 * fit.gap).toBeLessThanOrEqual(316);
  });

  it("shrinks a 7-tile hand so it stays clear of the boneyard on phone widths", () => {
    for (const width of [286, 316, 338]) {
      const fit = handFit(width, 7, 44);
      expect(fit.scroll).toBe(false);
      expect(fit.tile).toBeLessThanOrEqual(44);
      expect(fit.tile).toBeGreaterThan(30);
      expect(7 * fit.tile + 6 * fit.gap).toBeLessThanOrEqual(width + 0.01);
    }
  });

  it("fits 10 tiles without scrolling, then scrolls at the same size", () => {
    const ten = handFit(286, 10, 44);
    const eleven = handFit(286, 11, 44);
    expect(ten.scroll).toBe(false);
    expect(10 * ten.tile + 9 * ten.gap).toBeLessThanOrEqual(286 + 0.01);
    expect(eleven.scroll).toBe(true);
    expect(eleven.tile).toBeCloseTo(ten.tile, 5);
    expect(eleven.gap).toBe(ten.gap);
  });
});
