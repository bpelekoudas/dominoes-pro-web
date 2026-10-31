import { describe, expect, it } from "vitest";
import { motionMs } from "../../rules/src/motion.js";
import {
  boxesOverlap,
  controlBox,
  controlRoute,
  controlSlideMs,
  dominoTokenAction,
  parkInSlot,
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

  it("rests in a slot that stays off the tiles and the badge", () => {
    const seats = [
      {
        name: "left",
        slot: { left: 0, top: 180, right: 20, bottom: 210 },
        badge: { left: 24, top: 178, right: 130, bottom: 212 },
        tiles: Array.from({ length: 8 }, (_, index) => ({
          left: 0,
          top: 216 + index * 26,
          right: 22,
          bottom: 240 + index * 26,
        })),
      },
      {
        name: "right",
        slot: { left: 370, top: 180, right: 390, bottom: 210 },
        badge: { left: 250, top: 178, right: 366, bottom: 212 },
        tiles: Array.from({ length: 8 }, (_, index) => ({
          left: 368,
          top: 216 + index * 26,
          right: 390,
          bottom: 240 + index * 26,
        })),
      },
      {
        name: "top",
        slot: { left: 150, top: 28, right: 170, bottom: 58 },
        badge: { left: 174, top: 26, right: 280, bottom: 60 },
        tiles: Array.from({ length: 8 }, (_, index) => ({
          left: 40 + index * 28,
          top: 0,
          right: 66 + index * 28,
          bottom: 22,
        })),
      },
      {
        name: "bottom",
        slot: { left: 4, top: 690, right: 24, bottom: 720 },
        badge: { left: 28, top: 692, right: 140, bottom: 724 },
        tiles: Array.from({ length: 8 }, (_, index) => ({
          left: 8 + index * 46,
          top: 740,
          right: 48 + index * 46,
          bottom: 828,
        })),
      },
    ];
    for (const seat of seats) {
      const token = controlBox(parkInSlot(seat.slot));
      expect(boxesOverlap(token, seat.badge), seat.name).toBe(false);
      for (const tile of seat.tiles) expect(boxesOverlap(token, tile), seat.name).toBe(false);
    }
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
