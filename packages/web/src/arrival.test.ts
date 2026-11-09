import { describe, expect, it } from "vitest";
import { cameraBlockedByFlight, departureBox, shouldFlyOpponentTile } from "./arrival";

const watching = {
  playerId: "west",
  yourId: "you",
  seq: 4,
  joinedSeq: 1,
  bigMoment: false,
  reducedMotion: false,
};

describe("opponent tile flight", () => {
  it("animates an opponent play from that seat's last face-down tile", () => {
    expect(shouldFlyOpponentTile(watching)).toBe(true);
    const hands = new Map([
      ["west", { left: 0, top: 220, width: 16, height: 28 }],
      ["north", { left: 180, top: 0, width: 26, height: 20 }],
    ]);
    expect(departureBox(hands, "west")).toEqual({ left: 0, top: 220, width: 16, height: 28 });
    expect(departureBox(hands, "east")).toBeNull();
  });

  it("does not replay tiles that were already down, or the player's own play", () => {
    expect(shouldFlyOpponentTile({ ...watching, joinedSeq: null })).toBe(false);
    expect(shouldFlyOpponentTile({ ...watching, seq: 1, joinedSeq: 1 })).toBe(false);
    expect(shouldFlyOpponentTile({ ...watching, playerId: "you" })).toBe(false);
    expect(shouldFlyOpponentTile({ ...watching, bigMoment: true })).toBe(false);
    expect(shouldFlyOpponentTile({ ...watching, reducedMotion: true })).toBe(false);
  });

  it("holds the camera until the opponent tile has landed", () => {
    const hold = { seq: 4 };
    expect(cameraBlockedByFlight(hold, 4)).toBe(true);
    expect(cameraBlockedByFlight(null, 4)).toBe(false);
    expect(cameraBlockedByFlight(hold, 5)).toBe(false);
  });
});
