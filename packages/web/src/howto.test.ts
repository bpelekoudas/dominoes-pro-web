import { describe, expect, it } from "vitest";
import { HOWTO_BEAT_MS, HOWTO_STEPS, howToLengthMs } from "./howto.js";

describe("how to play", () => {
  it("stays under 30 seconds and can be skipped", () => {
    expect(HOWTO_STEPS).toHaveLength(3);
    expect(HOWTO_BEAT_MS).toBe(8_000);
    expect(howToLengthMs()).toBe(24_000);
    expect(howToLengthMs()).toBeLessThan(30_000);
    expect(HOWTO_STEPS.map((step) => step.title)).toEqual(["Match the ends", "Draw, or knock", "Race to 150"]);
  });
});