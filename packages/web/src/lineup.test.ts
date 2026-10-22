import { describe, expect, it } from "vitest";
import { lineupPoseFor } from "./lineup.js";

describe("lineup poses", () => {
  it("gives every shipped character a win pose and a lose pose", () => {
    for (const id of ["grungerocker", "surfer", "scarface", "gaperilla", "abuela", "2hot4tv"]) {
      expect(lineupPoseFor(id, "winner")).toBe("win");
      expect(lineupPoseFor(id, "loser")).toBe("lose");
    }
  });

  it("keeps the portrait for the house face and for anyone without a pose", () => {
    expect(lineupPoseFor("homescreen", "winner")).toBeNull();
    expect(lineupPoseFor("nobody", "winner")).toBeNull();
    expect(lineupPoseFor(null, "loser")).toBeNull();
  });
});
