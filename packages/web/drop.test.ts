import { describe, expect, it } from "vitest";
import { chooseDropEnd, DROP_SLOP, ghostAimPoint, ghostTopLeft, GHOST_HEIGHT, GHOST_LIFT } from "./src/drop.js";

const west = { id: "west", left: 40, top: 200, width: 70, height: 36 };
const east = { id: "east", left: 200, top: 200, width: 70, height: 36 };

describe("drop target", () => {
  it("picks the end the tile is on", () => {
    expect(chooseDropEnd(70, 218, [west, east])).toBe("west");
    expect(chooseDropEnd(230, 210, [west, east])).toBe("east");
  });

  it("picks the nearer end when the drop covers both", () => {
    const leftHalf = { id: "west", left: 100, top: 100, width: 40, height: 80 };
    const rightHalf = { id: "east", left: 140, top: 100, width: 40, height: 80 };
    expect(chooseDropEnd(130, 140, [leftHalf, rightHalf], 20)).toBe("west");
    expect(chooseDropEnd(150, 140, [leftHalf, rightHalf], 20)).toBe("east");
  });

  it("misses when the drop is not on an open end", () => {
    expect(chooseDropEnd(70, 40, [west, east])).toBeNull();
    expect(chooseDropEnd(400, 400, [west, east])).toBeNull();
    expect(chooseDropEnd(70, 218, [])).toBeNull();
  });

  it("still hits an end within the slop, and misses just past it", () => {
    const above = west.top - DROP_SLOP + 4;
    const past = west.top - DROP_SLOP - 4;
    expect(chooseDropEnd(west.left + 10, above, [west])).toBe("west");
    expect(chooseDropEnd(west.left + 10, past, [west])).toBeNull();
  });

  it("aims with the tile above the finger, not the fingertip", () => {
    const finger = { x: 75, y: west.top + west.height + GHOST_LIFT + GHOST_HEIGHT / 2 };
    const aim = ghostAimPoint(finger.x, finger.y);
    expect(aim.y).toBeLessThan(finger.y);
    expect(chooseDropEnd(finger.x, finger.y, [west])).toBeNull();
    expect(chooseDropEnd(aim.x, aim.y, [west])).toBe("west");
    const parked = ghostTopLeft(finger.x, finger.y);
    expect(parked.top + GHOST_HEIGHT).toBeLessThan(finger.y);
  });
});
