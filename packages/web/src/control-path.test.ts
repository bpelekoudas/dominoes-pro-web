import { describe, expect, it } from "vitest";
import { motionMs } from "../../rules/src/motion.js";
import {
  boxesOverlap,
  controlBox,
  controlRoute,
  controlSlideMs,
  dominoTokenAction,
  parkOnBadge,
  pointAlong,
} from "./control-path.js";

describe("control token route", () => {
  it("slides straight when the felt between two seats is open", () => {
    const route = controlRoute({ x: 20, y: 40 }, { x: 20, y: 200 }, [], { width: 390, height: 844 });
    expect(route).toEqual([
      { x: 20, y: 40 },
      { x: 20, y: 200 },
    ]);
  });

  it("detours around a tile instead of crossing it", () => {
    const tile = { left: 80, top: 80, right: 160, bottom: 200 };
    const route = controlRoute({ x: 40, y: 140 }, { x: 240, y: 140 }, [tile], { width: 390, height: 400 });
    expect(route.length).toBeGreaterThan(2);
    for (let index = 1; index < route.length; index += 1) {
      const from = route[index - 1]!;
      const to = route[index]!;
      const steps = 12;
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const box = controlBox({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
        expect(boxesOverlap(box, tile)).toBe(false);
      }
    }
  });

  it("jumps when every lane is blocked", () => {
    const wall = { left: 0, top: 0, right: 390, bottom: 844 };
    const route = controlRoute({ x: 20, y: 20 }, { x: 200, y: 200 }, [wall], { width: 390, height: 844 });
    expect(route).toEqual([{ x: 200, y: 200 }]);
  });

  it("flies to a new domino, bumps a repeat, and holds on a lock", () => {
    expect(dominoTokenAction(null, null)).toBe("hide");
    expect(dominoTokenAction(null, { playerId: "a", key: "1:1" })).toBe("place");
    expect(dominoTokenAction({ playerId: "a", key: "1:1" }, { playerId: "b", key: "1:2" })).toBe("fly");
    expect(dominoTokenAction({ playerId: "a", key: "1:1" }, { playerId: "a", key: "1:3" })).toBe("bump");
    expect(dominoTokenAction({ playerId: "a", key: "1:3" }, { playerId: "a", key: "1:3" })).toBe("hold");
  });

  it("parks on the avatar side of the badge, clear of a talk line", () => {
    const badge = { left: 0, top: 100, right: 140, bottom: 132 };
    const park = parkOnBadge(badge);
    const token = controlBox(park);
    const talk = { left: badge.left + 30, top: badge.top + 8, right: badge.right - 4, bottom: badge.top + 26 };
    expect(token.right).toBeLessThanOrEqual(talk.left);
    expect(token.left).toBeGreaterThanOrEqual(badge.left);
    expect(pointAlong([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.5)).toEqual({ x: 50, y: 0 });
    expect(controlSlideMs(100)).toBe(motionMs(380));
    expect(controlSlideMs(4000)).toBe(motionMs(900));
  });
});
