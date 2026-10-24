import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOUND_FILES, cuesForPlay, cuesForTurn } from "./cues.js";

const ids = (cues: Array<{ id: string }>) => cues.map((cue) => cue.id);

describe("game sounds", () => {
  it("clacks a tile, cha-chings a score, and saves the glass for 20 or more", () => {
    expect(ids(cuesForPlay(0, "3-5"))).toEqual(["clack"]);
    expect(ids(cuesForPlay(0, "6-6"))).toEqual(["clack-heavy"]);
    expect(ids(cuesForPlay(10, "2-4"))).toEqual(["clack", "ching"]);
    expect(ids(cuesForPlay(15, "5-5"))).toEqual(["clack-heavy", "ching"]);
    for (const awarded of [20, 25, 30, 35]) {
      expect(ids(cuesForPlay(awarded, "1-3"))).toEqual(["clack-heavy", "glass", "ching"]);
    }
    expect(ids(cuesForPlay(25, "4-4"))).toEqual(["clack-heavy", "glass", "ching"]);
  });

  it("uses a different sound for your turn than for a score", () => {
    expect(ids(cuesForTurn())).toEqual(["buzz"]);
    expect(ids(cuesForPlay(10, "1-2"))).not.toContain("buzz");
    expect(ids(cuesForTurn())).not.toContain("ching");
    expect(ids(cuesForPlay(0, "0-1"))).not.toContain("ching");
    expect(ids(cuesForPlay(0, "0-1"))).not.toContain("glass");
  });

  it("waits to break the glass until the tile lands", () => {
    const moment = cuesForPlay(25, "2-6");
    const glass = moment.find((cue) => cue.id === "glass");
    const ching = moment.find((cue) => cue.id === "ching");
    const slam = moment.find((cue) => cue.id === "clack-heavy");
    expect(glass).toBeDefined();
    expect(ching).toBeDefined();
    expect(slam?.delay).toBe(glass?.delay);
    expect(glass?.delay).toBeGreaterThanOrEqual(0.2);
    expect(ching?.delay).toBeGreaterThanOrEqual(glass?.delay ?? 0);
  });

  it("keeps the recordings small enough for a phone", () => {
    let total = 0;
    for (const file of Object.values(SOUND_FILES)) {
      const size = statSync(new URL(`../public/sounds/${file}`, import.meta.url)).size;
      expect(size).toBeGreaterThan(500);
      total += size;
    }
    expect(total).toBeLessThan(500_000);
  });
});
