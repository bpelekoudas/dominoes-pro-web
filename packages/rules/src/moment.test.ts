import { describe, expect, it } from "vitest";
import { BIG_MOMENT_MS, BIG_MOMENT_SCORE, bigMomentLevel, turnHoldMs } from "./moment.js";

describe("UH-OH moment", () => {
  it("fires for 20, 25, and 30 or more, and stays quiet for 5 through 15", () => {
    for (const awarded of [0, 5, 10, 15, 19]) {
      expect(bigMomentLevel(awarded)).toBeNull();
      expect(turnHoldMs(awarded)).toBe(0);
    }
    expect(bigMomentLevel(20)).toBe("small");
    expect(bigMomentLevel(25)).toBe("medium");
    expect(bigMomentLevel(30)).toBe("medium");
    expect(bigMomentLevel(35)).toBe("big");
    expect(bigMomentLevel(40)).toBe("big");
    expect(bigMomentLevel(50)).toBe("big");
    expect(turnHoldMs(20)).toBe(BIG_MOMENT_MS);
    expect(turnHoldMs(25)).toBe(BIG_MOMENT_MS);
    expect(turnHoldMs(30)).toBe(BIG_MOMENT_MS);
    expect(turnHoldMs(35)).toBe(BIG_MOMENT_MS);
    expect(BIG_MOMENT_SCORE).toBe(20);
    expect(BIG_MOMENT_MS).toBeGreaterThanOrEqual(1500);
    expect(BIG_MOMENT_MS).toBeLessThanOrEqual(2000);
  });
});
