import { describe, expect, it } from "vitest";
import { showScoreNumbers } from "./score-hints.js";

describe("score numbers", () => {
  it("shows them for the first two easy games, then only when asked", () => {
    expect(showScoreNumbers(true, 0, "auto")).toBe(true);
    expect(showScoreNumbers(true, 1, "auto")).toBe(true);
    expect(showScoreNumbers(true, 2, "auto")).toBe(false);
    expect(showScoreNumbers(true, 4, "on")).toBe(true);
    expect(showScoreNumbers(true, 0, "off")).toBe(false);
  });

  it("hides them on every table that is not an easy practice game", () => {
    expect(showScoreNumbers(false, 0, "auto")).toBe(false);
    expect(showScoreNumbers(false, 0, "on")).toBe(false);
  });
});
