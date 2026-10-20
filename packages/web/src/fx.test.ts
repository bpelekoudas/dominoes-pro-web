import { describe, expect, it } from "vitest";
import { FX_LIST, createFxScene, normalizeFx } from "./fx.js";

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

  it("keeps each themed burst around the scoring tile", () => {
    for (const fx of FX_LIST) {
      if (fx.id === "glass") continue;
      const scene = createFxScene(fx.id, 390, 700, 180, 320, 25);
      expect(scene.id).toBe(fx.id);
      expect(scene.bits.length + scene.bolts.length).toBeGreaterThan(0);
      for (const bit of scene.bits) {
        expect(Math.hypot(bit.x - 180, bit.y - 320)).toBeLessThan(360);
      }
      for (const bolt of scene.bolts) {
        for (const [x, y] of bolt.pts) {
          expect(x).toBeGreaterThan(-20);
          expect(y).toBeGreaterThan(-20);
          expect(x).toBeLessThan(410);
          expect(y).toBeLessThan(720);
        }
      }
    }
  });
});
