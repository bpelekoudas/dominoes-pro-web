import { describe, expect, it } from "vitest";
import { BIG_MOMENT_MS } from "../../rules/src/moment.js";
import { FX_LIST, createFxScene, normalizeFx, peakReach, videoFxAsset, videoFxSeconds } from "./fx.js";

describe("uh-oh effects", () => {
  it("lists eleven effects and falls back to the house shatter", () => {
    expect(FX_LIST).toHaveLength(11);
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
      "FX-011",
    ]);
    expect(normalizeFx("nope")).toBe("glass");
    expect(normalizeFx("fireworks")).toBe("fireworks");
    expect(normalizeFx("legend")).toBe("legend");
    expect(normalizeFx("explosion")).toBe("explosion");
    expect(FX_LIST.find((fx) => fx.id === "explosion")?.name).toBe("Mega explosion");
    expect(videoFxAsset("glass")).toEqual({ mp4: "/fx/FX-001-glass.mp4", webm: "/fx/FX-001-glass.webm" });
    expect(videoFxAsset("fire")).toEqual({ mp4: "/fx/FX-002-fire.mp4", webm: "/fx/FX-002-fire.webm" });
    expect(videoFxAsset("lightning")).toEqual({ mp4: "/fx/FX-003-lightning.mp4", webm: "/fx/FX-003-lightning.webm" });
    expect(videoFxAsset("money")).toEqual({ mp4: "/fx/FX-004-money.mp4", webm: "/fx/FX-004-money.webm" });
    expect(videoFxAsset("confetti")).toEqual({ mp4: "/fx/FX-005-confetti.mp4", webm: "/fx/FX-005-confetti.webm" });
    expect(videoFxAsset("tumble")).toEqual({ mp4: "/fx/FX-006-tumble.mp4", webm: "/fx/FX-006-tumble.webm" });
    expect(videoFxAsset("quake")).toEqual({ mp4: "/fx/FX-007-earthquake.mp4", webm: "/fx/FX-007-earthquake.webm" });
    expect(videoFxAsset("trophy")).toEqual({ mp4: "/fx/FX-008-trophy.mp4", webm: "/fx/FX-008-trophy.webm" });
    expect(videoFxAsset("fireworks")).toEqual({ mp4: "/fx/FX-009-fireworks.mp4", webm: "/fx/FX-009-fireworks.webm" });
    expect(videoFxAsset("legend")).toEqual({ mp4: "/fx/FX-010-legend.mp4", webm: "/fx/FX-010-legend.webm" });
    expect(videoFxSeconds("legend")).toBe(1.9);
    expect(videoFxSeconds("glass")).toBe(1.2);
    expect(BIG_MOMENT_MS).toBeGreaterThan(1900);
    expect(videoFxAsset("explosion")).toEqual({ mp4: "/fx/FX-011-explosion.mp4", webm: "/fx/FX-011-explosion.webm" });
    expect(videoFxAsset("nope" as never)).toBeNull();
  });

  it("starts on the placed tile and reaches most of the screen", () => {
    const origin = { x: 48, y: 610 };
    for (const fx of FX_LIST) {
      if (fx.id === "glass" || fx.id === "explosion") continue;
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
