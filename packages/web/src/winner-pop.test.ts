import { describe, expect, it } from "vitest";
import { characterWinLine } from "./win-lines.js";
import { winPoseSrc } from "./lineup.js";
import {
  GAME_BANNER_MS,
  ZERO_HOLD_MS,
  celebrationTimeline,
  planWinPips,
} from "./win-plan.js";
import {
  GAME_POP_MS,
  HAND_POP_IN_MS,
  HAND_POP_MS,
  REDUCED_POP_MS,
  overlaps,
  placeWinnerPop,
  popTiming,
  winnerPopFrame,
  winnerPopPoint,
  winnerPopSize,
  type Box,
} from "./winner-pop.js";

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe("winner pop", () => {
  it("fits a hand and a game inside the tally the table already waits on", () => {
    expect(popTiming("hand")).toEqual({ inMs: 160, holdMs: 420, outMs: 280, total: 860 });
    expect(popTiming("game")).toEqual({ inMs: 180, holdMs: 520, outMs: 300, total: 1000 });
    expect(HAND_POP_MS).toBe(860);
    expect(GAME_POP_MS).toBe(1000);
    expect(HAND_POP_MS).toBeLessThan(ZERO_HOLD_MS);
    expect(GAME_POP_MS).toBeLessThan(ZERO_HOLD_MS);
    expect(GAME_POP_MS).toBeGreaterThan(HAND_POP_MS);
    expect(REDUCED_POP_MS).toBeLessThan(HAND_POP_MS);
    expect(winnerPopSize("game", false).width).toBeGreaterThan(winnerPopSize("hand", false).width);
    expect(winnerPopSize("game", false).height).toBeGreaterThan(winnerPopSize("hand", false).height);
    expect(winnerPopSize("hand", true).height).toBe(winnerPopSize("hand", false).height + 16);

    const quiet = planWinPips({ winner: 0 }, [{ playerId: "loser", tiles: [{ id: "0-1" }] }]);
    const hand = celebrationTimeline({
      reason: "score",
      awarded: 0,
      plan: quiet,
      gameWinner: false,
      seriesWinner: false,
      reduced: false,
    });
    const game = celebrationTimeline({
      reason: "score",
      awarded: 0,
      plan: quiet,
      gameWinner: true,
      seriesWinner: false,
      reduced: false,
    });
    const match = celebrationTimeline({
      reason: "score",
      awarded: 0,
      plan: quiet,
      gameWinner: true,
      seriesWinner: true,
      reduced: false,
    });
    expect(hand.steps.map((step) => step.stage)).toEqual(["reveal", "sheet"]);
    expect(hand.untilSheet).toBe(ZERO_HOLD_MS);
    expect(game.steps.map((step) => step.stage)).toEqual(["reveal", "banner", "sheet"]);
    expect(game.steps[1]).toMatchObject({ stage: "banner", banner: "game", ms: GAME_BANNER_MS });
    expect(game.untilSheet).toBe(ZERO_HOLD_MS + GAME_BANNER_MS);
    expect(match.steps.map((step) => step.stage)).toEqual(["reveal", "banner", "lineup", "sheet"]);
    expect(match.steps[2]).toEqual({ stage: "lineup", ms: 0 });
  });

  it("bounces out of the seat, holds, then flies back to the score chip", () => {
    const rising = winnerPopFrame("hand", HAND_POP_IN_MS * 0.72, false);
    expect(rising.scale).toBeCloseTo(1.12, 5);
    expect(rising.along).toBeCloseTo(0.72, 5);
    const hold = winnerPopFrame("hand", HAND_POP_IN_MS + 40, false);
    expect(hold).toMatchObject({ along: 1, scale: 1, opacity: 1 });
    const done = winnerPopFrame("game", GAME_POP_MS, false);
    expect(done).toMatchObject({ along: 2, scale: 0.42, opacity: 0 });
    for (const elapsed of [0, 40, 200, REDUCED_POP_MS]) {
      expect(winnerPopFrame("hand", elapsed, true).along).toBe(1);
      expect(winnerPopFrame("hand", elapsed, true).scale).toBe(1);
    }
    const seat = { x: 20, y: 700 };
    const rest = { x: 120, y: 400 };
    const score = { x: 48, y: 710 };
    expect(winnerPopPoint(0, seat, rest, score)).toEqual(seat);
    expect(winnerPopPoint(1, seat, rest, score)).toEqual(rest);
    expect(winnerPopPoint(2, seat, rest, score)).toEqual(score);
  });

  it("holds in a gap on a phone and skips a board with no gap", () => {
    const viewport = { width: 390, height: 844 };
    const tile = box(174, 360, 42, 84);
    const tray = box(0, 690, 390, 154);
    const rack = box(70, 752, 250, 78);
    const topBadge = box(140, 52, 110, 36);
    const leftBadge = box(0, 260, 78, 34);
    const rightBadge = box(312, 260, 78, 34);
    const obstacles = [box(0, 0, 390, 48), topBadge, leftBadge, rightBadge, tile, tray, rack, box(8, 698, 128, 42)];
    const placed = placeWinnerPop({
      kind: "hand",
      withLine: true,
      edge: "bottom",
      avatar: box(12, 702, 32, 32),
      score: box(50, 710, 28, 16),
      obstacles,
      viewport,
    });
    expect(placed).not.toBeNull();
    for (const obstacle of obstacles) {
      expect(overlaps(placed!.box, obstacle, 0)).toBe(false);
    }
    expect(placed!.box.bottom).toBeLessThan(tray.top);
    expect(placed!.box.top).toBeGreaterThan(48);

    const game = placeWinnerPop({
      kind: "game",
      withLine: true,
      edge: "top",
      avatar: box(168, 56, 26, 26),
      score: box(198, 62, 24, 16),
      obstacles,
      viewport,
    });
    expect(game).not.toBeNull();
    expect(game!.box.width).toBeGreaterThan(placed!.box.width);
    for (const obstacle of obstacles) expect(overlaps(game!.box, obstacle, 0)).toBe(false);

    expect(
      placeWinnerPop({
        kind: "game",
        withLine: false,
        edge: "bottom",
        avatar: box(12, 702, 32, 32),
        score: box(50, 710, 28, 16),
        obstacles: [box(0, 0, 390, 844)],
        viewport,
      }),
    ).toBeNull();
  });

  it("keeps 2 Hot 4 TV's win pose and his exact lines", () => {
    expect(winPoseSrc("2hot4tv")).toBe("/poses/2hot4tv-win.webp?v=1");
    expect(characterWinLine("2hot4tv", 0)).toBe("Uh-Oh, you KNOW!");
    expect(characterWinLine("2hot4tv", 1)).toBe("From Philly to Okinawa, I own all you!");
    expect(characterWinLine("homescreen", 0)).toBeNull();
  });
});
