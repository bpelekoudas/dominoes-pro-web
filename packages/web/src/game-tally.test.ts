import { describe, expect, it } from "vitest";
import { gameCountLabel, gameTallyText } from "./game-tally.js";

describe("game tally", () => {
  it("labels each seat with games won out of first-to-N", () => {
    expect(gameCountLabel(0, 2)).toBe("0/2");
    expect(gameCountLabel(1, 2)).toBe("1/2");
    expect(gameCountLabel(2, 2)).toBe("2/2");
    expect(gameCountLabel(3, 4)).toBe("3/4");
    expect(gameCountLabel(9, 4)).toBe("4/4");
    expect(gameCountLabel(0, 3)).toBe("0/3");
  });

  it("prints the chip counts in seat order", () => {
    expect(gameTallyText([1, 0, 0])).toBe("1-0-0");
    expect(gameTallyText([2, 1])).toBe("2-1");
    expect(gameTallyText([0, 0, 1, 0])).toBe("0-0-1-0");
  });
});
