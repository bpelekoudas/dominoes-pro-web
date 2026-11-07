import { describe, expect, it } from "vitest";
import { planWinPips } from "../win-plan";
import { chipScore, scoreChaseFrames, scoreChaseKey, scoreDeltaLabel, scorePopupForPlay, scorePopupText } from "./score-delta";

describe("score delta", () => {
  it("shows the award itself and never a stand-in 20", () => {
    expect(scoreDeltaLabel(0)).toBeNull();
    expect(scoreDeltaLabel(5)).toBeNull();
    expect(scoreDeltaLabel(15)).toBe(15);
    expect(scoreDeltaLabel(20)).toBe(20);
    expect(scoreDeltaLabel(25)).toBe(25);
    expect(scoreDeltaLabel(Number.NaN)).toBeNull();
  });

  it("drops the count when the play scored nothing or the hand is over", () => {
    const live = { gameNumber: 1, handNumber: 1, seq: 4, awarded: 25, betweenHands: false, phase: "play" };
    expect(scoreChaseKey(live)).toBe("1:1:4:25");
    expect(scoreChaseKey({ ...live, awarded: 0 })).toBe("");
    expect(scoreChaseKey({ ...live, awarded: 15 })).toBe("1:1:4:15");
    expect(scoreChaseKey({ ...live, betweenHands: true })).toBe("");
    expect(scoreChaseKey({ ...live, phase: "between" })).toBe("");
    expect(scoreChaseKey({ ...live, phase: "over" })).toBe("");
    expect(scoreChaseKey({ ...live, handNumber: 2 })).toBe("1:2:4:25");
  });

  it("counts a 25 through 20 and lands on 25, and a 15 never shows 20", () => {
    expect(scoreChaseFrames(50, 75, 25)).toEqual([50, 55, 60, 65, 70, 75]);
    expect(scoreChaseFrames(50, 65, 15)).toEqual([50, 55, 60, 65]);
    expect(scoreChaseFrames(50, 70, 20)).toEqual([50, 55, 60, 65, 70]);
    expect(scoreChaseFrames(50, 50, 0)).toEqual([]);
    expect(scoreChaseFrames(50, 65, 15)).not.toContain(70);
  });

  it("ignores a count that belongs to an earlier play", () => {
    const stuck = chipScore({
      score: 75,
      chaseKey: "",
      chase: { key: "1:1:4:25", shown: 70, pulse: true },
      celebration: null,
    });
    expect(stuck.score).toBe(75);
    expect(stuck.pulse).toBe(false);

    const live = chipScore({
      score: 75,
      chaseKey: "1:1:4:25",
      chase: { key: "1:1:4:25", shown: 70, pulse: true },
      celebration: null,
    });
    expect(live.score).toBe(70);

    const celebrating = chipScore({
      score: 75,
      chaseKey: "",
      chase: { key: "1:1:4:25", shown: 70, pulse: true },
      celebration: { score: 65, pulse: true, hot: true },
    });
    expect(celebrating.score).toBe(65);
  });

  it("pops the server award and never a manufactured 20", () => {
    expect(scorePopupText(0)).toBeNull();
    expect(scorePopupText(5)).toBeNull();
    expect(scorePopupText(15)).toBe("+15");
    expect(scorePopupText(25)).toBe("+25");
    expect(scorePopupText(20)).toBe("+20");
    const passingTwenty = scoreChaseFrames(50, 75, 25);
    expect(passingTwenty).toContain(70);
    expect(scorePopupForPlay({ seq: 8, awarded: 0 }, { seq: 8, awarded: passingTwenty[4]! - passingTwenty[0]! })).toBeNull();
    expect(scorePopupForPlay({ seq: 8, awarded: 0 }, { seq: 7, awarded: 25 })).toBeNull();
    expect(scorePopupForPlay({ seq: 8, awarded: 0 }, { seq: 7, awarded: 20 })).toBeNull();
    expect(scorePopupForPlay({ seq: 8, awarded: 0 }, { seq: 8, awarded: 20 })).toBeNull();
    expect(scorePopupForPlay({ seq: 3, awarded: 20 }, { seq: 3, awarded: 20 })?.text).toBe("+20");
    expect(scorePopupForPlay({ seq: 4, awarded: 15 }, { seq: 4, awarded: 15 })?.text).toBe("+15");
    expect(scorePopupForPlay({ seq: 4, awarded: 25 }, { seq: 4, awarded: 25 })?.text).toBe("+25");
  });

  it("splits a 25 leftover into pips that add up to 25", () => {
    const plan = planWinPips(
      { h: 25 },
      [{ playerId: "c", tiles: [{ id: "5-5" }, { id: "4-4" }, { id: "2-5" }] }],
    );
    expect(plan.pips.reduce((sum, pip) => sum + pip.value, 0)).toBe(25);
    expect(plan.pips.some((pip) => pip.value === 20)).toBe(false);
  });
});
