import { describe, expect, it } from "vitest";
import { FX_LIST, createFxScene, normalizeFx, peakReach } from "./fx.js";

describe("uh-oh effects", () => {
  it("lists ten effects and falls back to the house shatter", () => {
    expect(FX_LIST).toHaveLength(10);
    expect(FX_LIST.map((fx) => fx.code)).toEqual([
      "FX-001",
      "FX-002",
      "FX-003",
      "FX-004",
      "FX-005",
      "FX-006",
      "FX-007",
      "FX-008",
      "FX-009",
      "FX-010",
    ]);
    expect(normalizeFx("nope")).toBe("glass");
    expect(normalizeFx("fireworks")).toBe("fireworks");
    expect(normalizeFx("legend")).toBe("legend");
  });

  it("starts on the placed tile and reaches most of the screen", () => {
    const origin = { x: 48, y: 610 };
    for (const fx of FX_LIST) {
      if (fx.id === "glass") continue;
      const scene = createFxScene(fx.id, 390, 844, origin.x, origin.y, 25);
      expect(scene.hitX).toBe(origin.x);
      expect(scene.hitY).toBe(origin.y);
      expect(scene.peak).toBeCloseTo(peakReach(390, 844, origin.x, origin.y), 4);
      expect(scene.peak).toBeGreaterThan(390);
      const travel = [
        ...scene.bits.map((bit) => bit.far),
        ...scene.bolts.map((bolt) => bolt.far),
      ];
      expect(travel.length).toBeGreaterThan(0);
      expect(Math.max(...travel)).toBeGreaterThan(0.72);
      for (const bolt of scene.bolts) {
        expect(bolt.pts[0]).toEqual([origin.x, origin.y]);
      }
    }
  });
});
