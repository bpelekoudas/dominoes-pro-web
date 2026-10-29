import { describe, expect, it } from "vitest";
import { BIG_MOMENT_MS } from "../../rules/src/moment.js";
import { motionMs } from "../../rules/src/motion.js";
import { scoreDomino, scoreLocked } from "../../rules/src/score.js";
import {
  GAME_BANNER_MS,
  HAND_CALL_AFTER_UHOH_MS,
  MATCH_BANNER_MS,
  PIP_BEND,
  PIP_FLIGHT_MS,
  PIP_LAND_BY_MS,
  PIP_START_MS,
  ZERO_HOLD_MS,
  bannerMotion,
  celebrationTimeline,
  confettiAt,
  lastLandMs,
  pipPosition,
  planWinPips,
  revealOrigin,
  scoreAt,
  uhOhWaitMs,
  winBannerCopy,
} from "./win-plan.js";

function sumFor(plan: ReturnType<typeof planWinPips>, winnerId: string): number {
  return plan.pips.filter((pip) => pip.winnerId === winnerId).reduce((sum, pip) => sum + pip.value, 0);
}

describe("hand win pips", () => {
  it("turns a 12 and a 7 into 5 points and the dots add up to that 5", () => {
    const awards = scoreDomino({ winner: 12, loser: 7 }, "winner");
    expect(awards.winner).toBe(5);
    expect(awards.winner! % 5).toBe(0);
    const plan = planWinPips(awards, [{ playerId: "loser", tiles: [{ id: "2-5" }, { id: "6-6" }] }]);
    expect(sumFor(plan, "winner")).toBe(5);
    expect(plan.pips.every((pip) => pip.sourcePlayerId === "loser")).toBe(true);
    expect(plan.pips.some((pip) => pip.sourceTileId === "6-6")).toBe(true);
    expect(plan.jump).toBe(false);
    expect(plan.holdMs).toBeGreaterThanOrEqual(motionMs(2400));
    expect(plan.holdMs).toBeLessThanOrEqual(motionMs(3000));
    expect(lastLandMs(plan)).toBeLessThanOrEqual(PIP_LAND_BY_MS);
    expect(plan.pips[0]?.startMs).toBeGreaterThanOrEqual(PIP_START_MS);
    expect(plan.pips.every((pip) => pip.flightMs === PIP_FLIGHT_MS)).toBe(true);
  });

  it("splits a locked tie and each winner's dots add up to that share", () => {
    const locked = scoreLocked({
      a: ["1-2"],
      b: ["0-3"],
      c: ["5-5", "6-6"],
    });
    expect(locked.winnerIds.slice().sort()).toEqual(["a", "b"]);
    expect(locked.awards).toEqual({ a: 10, b: 10, c: 0 });
    for (const award of Object.values(locked.awards)) expect(award % 5).toBe(0);
    const plan = planWinPips(locked.awards, [
      { playerId: "b", tiles: [{ id: "0-3" }] },
      { playerId: "c", tiles: [{ id: "6-6" }, { id: "5-5" }] },
      { playerId: "a", tiles: [{ id: "1-2" }] },
    ]);
    expect(sumFor(plan, "a")).toBe(10);
    expect(sumFor(plan, "b")).toBe(10);
    expect(plan.pips.every((pip) => pip.sourcePlayerId === "c")).toBe(true);
    expect(new Set(plan.pips.map((pip) => pip.sourceTileId))).toEqual(new Set(["5-5", "6-6"]));
  });

  it("skips the flight when the leftovers round to nothing", () => {
    const awards = scoreDomino({ winner: 2, loser: 2 }, "winner");
    expect(awards).toEqual({ winner: 0, loser: 0 });
    const plan = planWinPips(awards, [{ playerId: "loser", tiles: [{ id: "0-4" }] }]);
    expect(plan.pips).toEqual([]);
    expect(plan.jump).toBe(false);
    expect(plan.holdMs).toBe(ZERO_HOLD_MS);
    expect(scoreAt({ winner: 20, loser: 0 }, plan, 1500, false).winner).toBe(20);
  });

  it("jumps the score when points are owed and no other tiles remain", () => {
    const plan = planWinPips({ winner: 10, other: 0 }, []);
    expect(plan.pips).toEqual([]);
    expect(plan.jump).toBe(true);
    expect(scoreAt({ winner: 40 }, plan, 100, false).winner).toBe(40);
    expect(scoreAt({ winner: 40 }, plan, plan.holdMs, false).winner).toBe(50);
  });

  it("is the same plan every time and never pulls a pip from a winner", () => {
    const remaining = [
      { playerId: "you", tiles: [{ id: "0-1" }] },
      { playerId: "m", tiles: [{ id: "4-6" }, { id: "2-2" }] },
    ];
    const awards = { you: 100, m: 0 };
    const first = planWinPips(awards, remaining);
    const second = planWinPips(awards, remaining);
    expect(second).toEqual(first);
    expect(sumFor(first, "you")).toBe(100);
    expect(first.pips).toHaveLength(12);
    expect(first.pips.every((pip) => pip.sourcePlayerId === "m")).toBe(true);
    const partial = scoreAt({ you: 10, m: 0 }, first, first.pips[0]!.startMs + PIP_FLIGHT_MS, false);
    expect(partial.you).toBe(10 + first.pips[0]!.value);
    expect(scoreAt({ you: 10 }, first, 99999, false).you).toBe(110);
  });

  it("bends the flight off the straight line", () => {
    const start = pipPosition(0, { x: 0, y: 0 }, { x: 100, y: 0 }, 1);
    const end = pipPosition(1, { x: 0, y: 0 }, { x: 100, y: 0 }, 1);
    const mid = pipPosition(0.5, { x: 0, y: 0 }, { x: 100, y: 0 }, 1);
    expect(start).toEqual({ x: 0, y: 0 });
    expect(end).toEqual({ x: 100, y: 0 });
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(PIP_BEND / 2);
  });
});

describe("win banners", () => {
  it("names the winner, and the local player reads You", () => {
    expect(winBannerCopy("game", "Rio", true)).toBe("YOU WIN");
    expect(winBannerCopy("game", "Rio", false)).toBe("GAME WON");
    expect(winBannerCopy("match", "Rio", true)).toBe("You Win the Match!");
    expect(winBannerCopy("match", "Rio", false)).toBe("Rio Wins the Match!");
  });

  it("overshoots, then settles, and a match is larger", () => {
    const game = bannerMotion("game", motionMs(360), false);
    const match = bannerMotion("match", motionMs(520), false);
    expect(game.scale).toBeGreaterThan(1);
    expect(match.scale).toBeGreaterThan(game.scale);
    expect(bannerMotion("game", motionMs(640), false).scale).toBe(1);
    expect(bannerMotion("match", motionMs(980), false).scale).toBe(1);
    expect(bannerMotion("match", 280, true).scale).toBe(1);
    expect(confettiAt("match", 280, false).length).toBeGreaterThan(confettiAt("game", 280, false).length);
    expect(confettiAt("game", 280, true)).toEqual([]);
  });

  it("waits out a winning UH-OH, then the sheet, inside the continue clock", () => {
    const awards = scoreDomino({ winner: 0, loser: 19 }, "winner");
    const plan = planWinPips(awards, [{ playerId: "loser", tiles: [{ id: "6-6" }, { id: "3-4" }] }]);
    expect(uhOhWaitMs("domino", 25, false)).toBe(BIG_MOMENT_MS);
    expect(uhOhWaitMs("domino", 25, true)).toBe(900);
    expect(uhOhWaitMs("domino", 15, false)).toBe(0);
    expect(uhOhWaitMs("locked", 40, false)).toBe(0);
    expect(uhOhWaitMs("score", 0, false)).toBe(0);

    const worst = celebrationTimeline({
      reason: "domino",
      awarded: 35,
      plan,
      gameWinner: true,
      seriesWinner: true,
      reduced: false,
    });
    expect(worst.steps.map((step) => step.stage)).toEqual(["uhoh", "call", "reveal", "banner", "lineup", "sheet"]);
    expect(worst.steps[1]).toMatchObject({ stage: "call", call: "domino", ms: HAND_CALL_AFTER_UHOH_MS });
    expect(worst.steps[3]?.banner).toBe("match");
    expect(worst.steps[3]?.ms).toBe(MATCH_BANNER_MS);
    expect(worst.steps[4]).toEqual({ stage: "lineup", ms: 0 });
    expect(worst.untilSheet).toBeLessThan(motionMs(9000));

    const game = celebrationTimeline({
      reason: "locked",
      awarded: null,
      plan,
      gameWinner: true,
      seriesWinner: false,
      reduced: false,
    });
    expect(game.steps.map((step) => step.banner ?? step.call ?? step.stage)).toEqual(["lock", "reveal", "game", "sheet"]);
    expect(game.steps[2]?.ms).toBe(GAME_BANNER_MS);
    expect(game.steps.some((step) => step.stage === "lineup")).toBe(false);

    const quiet = celebrationTimeline({
      reason: "score",
      awarded: 0,
      plan: planWinPips({ winner: 0 }, [{ playerId: "loser", tiles: [{ id: "0-1" }] }]),
      gameWinner: false,
      seriesWinner: false,
      reduced: false,
    });
    expect(quiet.steps).toEqual([
      { stage: "reveal", ms: ZERO_HOLD_MS },
      { stage: "sheet", ms: 0 },
    ]);
  });

  it("keeps a side hand on the felt, beside the rail", () => {
    const spot = revealOrigin(
      "right",
      { left: 340, top: 80, right: 386, bottom: 700, width: 46, height: 620 },
      { width: 100, height: 64 },
      { width: 390, height: 844 },
    );
    expect(spot.left).toBe(232);
    expect(spot.top).toBeGreaterThan(80);
    const top = revealOrigin(
      "top",
      { left: 12, top: 8, right: 200, bottom: 56, width: 188, height: 48 },
      { width: 110, height: 64 },
      { width: 390, height: 844 },
    );
    expect(top.top).toBe(62);
    expect(top.left).toBe(12);
  });
});
