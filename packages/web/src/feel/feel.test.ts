import { describe, expect, it } from "vitest";
import { detectContext, WIRED_CONTEXT, type FeelSnap } from "./context.js";
import { direct } from "./director.js";
import { FEEL_TIERS, ROUTINE_TURN_MS, scoreTier, specFor, tierRank } from "./ladder.js";
import { handTally } from "./tally.js";
import { knockStreakOf } from "../../../rules/src/view.js";

function snap(patch: Partial<FeelSnap> = {}): FeelSnap {
  return {
    seats: [
      { id: "a", score: 40 },
      { id: "b", score: 20 },
    ],
    target: 100,
    awarded: 0,
    tileId: "1-2",
    boardTiles: 6,
    knockStreak: 0,
    reason: "play",
    actorId: "b",
    winnerIds: [],
    pipCounts: null,
    ...patch,
  };
}

describe("feel ladder", () => {
  it("climbs in order and leaves a routine turn unblocked", () => {
    for (let index = 1; index < FEEL_TIERS.length; index += 1) {
      expect(tierRank(FEEL_TIERS[index]!)).toBeGreaterThan(tierRank(FEEL_TIERS[index - 1]!));
    }
    expect(scoreTier(0)).toBe("play");
    expect(scoreTier(10)).toBe("score");
    expect(scoreTier(15)).toBe("score-strong");
    expect(scoreTier(20)).toBe("score-strong");
    expect(scoreTier(25)).toBe("score-rare");
    expect(specFor("play", false).blockMs).toBe(0);
    expect(specFor("score", false).blockMs).toBe(0);
    expect(specFor("knock", false, 3).dim).toBeGreaterThan(specFor("knock", false, 1).dim);
    expect(specFor("game", false).impactMs).toBeGreaterThan(specFor("hand", false).impactMs);
    expect(specFor("match", false).impactMs).toBeGreaterThan(specFor("game", false).impactMs);
    expect(ROUTINE_TURN_MS.after.blocked).toBe(0);
    expect(ROUTINE_TURN_MS.after.opponentArrive).toBe(ROUTINE_TURN_MS.before.opponentArrive);
    expect(ROUTINE_TURN_MS.after.scoreHide).toBeLessThanOrEqual(ROUTINE_TURN_MS.before.scoreHide);
  });
});

describe("feel context", () => {
  it("detects a lead change, a close game, and a near target, and keeps the other hooks quiet", () => {
    const events = detectContext(
      snap({ seats: [{ id: "a", score: 80 }, { id: "b", score: 70 }] }),
      snap({
        seats: [{ id: "a", score: 80 }, { id: "b", score: 90 }],
        actorId: "b",
        awarded: 20,
        target: 100,
      }),
    );
    expect(events).toContain("lead-change");
    expect(events).toContain("takes-lead");
    expect(events).toContain("near-target");
    expect(events).toContain("close-game");
    expect(WIRED_CONTEXT).toEqual(["close-game", "lead-change", "near-target"]);
    const reaction = direct({ tier: "score-strong", local: true, reduced: false, contexts: events });
    expect(reaction.cues).toEqual(["lead-change", "near-target", "close-game"]);
    expect(reaction.cues).not.toContain("takes-lead");
    expect(reaction.cry).toBe(false);
  });

  it("saves UH OH for a lock and a comeback, not a plain rare score", () => {
    expect(direct({ tier: "score-rare", local: true, reduced: false }).cry).toBe(false);
    expect(direct({ tier: "score-rare", local: true, reduced: false, comeback: true }).cry).toBe(true);
    expect(direct({ tier: "locked", local: false, reduced: false }).word).toBe("UH OH.");
    expect(direct({ tier: "domino", local: true, reduced: false }).word).toBe("DOMINO!");
    expect(direct({ tier: "hand", local: true, reduced: false }).word).toBe("HAND WON");
    expect(direct({ tier: "game", local: true, reduced: false }).word).toBe("YOU WIN");
    expect(direct({ tier: "game", local: false, reduced: false }).word).toBe("GAME WON");
    expect(direct({ tier: "score", local: false, reduced: false }).haptic).toEqual([]);
    expect(direct({ tier: "locked", local: false, reduced: false }).haptic.length).toBeGreaterThan(0);
  });

  it("shows the rounded pot and a low hand", () => {
    const domino = handTally({
      reason: "domino",
      pipCounts: { you: 0, rio: 12, sam: 9, jordan: 6 },
      winnerIds: ["you"],
      awards: { you: 25, rio: 0, sam: 0, jordan: 0 },
    });
    expect(domino.equation).toBe("6 + 9 + 12");
    expect(domino.raw).toBe(27);
    expect(domino.awarded).toBe(25);
    expect(domino.lines).toEqual(["6 + 9 + 12", "27", "25"]);

    const locked = handTally({
      reason: "locked",
      pipCounts: { a: 18, b: 11, c: 7 },
      winnerIds: ["c"],
      awards: { a: 0, b: 0, c: 25 },
    });
    expect(locked.low).toBe(7);
    expect(locked.lines[1]).toBe("7 LOW HAND");
    expect(locked.raw).toBe(29);
    expect(locked.lines.at(-1)).toBe("25");
    expect(knockStreakOf([{ kind: "play" }, { kind: "knock" }, { kind: "knock" }, { kind: "knock" }])).toBe(3);
    expect(knockStreakOf([{ kind: "knock" }, { kind: "play" }])).toBe(0);
  });
});
