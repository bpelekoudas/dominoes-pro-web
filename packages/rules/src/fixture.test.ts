import { describe, expect, it } from "vitest";
import { chooseBotIntent } from "./bot.js";
import { applyIntent, legalIntents } from "./engine.js";
import { emptyBoneyardKnock, fixtureMatch, playScoreReel, scoreReel } from "./fixture.js";

describe("soak fixtures", () => {
  it("puts the human on an empty-boneyard knock the computer can answer", () => {
    const match = emptyBoneyardKnock(fixtureMatch(["Ada", "Bones"]));
    const human = match.players[0]!.id;
    const computer = match.players[1]!.id;
    expect(legalIntents(match, human)).toEqual([{ type: "knock" }]);
    expect(match.hand?.boneyard).toEqual([]);
    expect(match.hand?.phase).toBe("await_knock");
    const knocked = applyIntent(match, human, { type: "knock" });
    expect(knocked.ok).toBe(true);
    if (!knocked.ok) return;
    expect(chooseBotIntent(knocked.match, computer, "easy", () => 0)?.type).toBe("play");
  });

  it("scores 15, then 0 on 2 + 12, then 25 leftovers, and never awards 20", () => {
    const { scored, quiet, ended } = playScoreReel(scoreReel(fixtureMatch(["Ada", "Bones"])));
    expect(scored.lastPlay).toMatchObject({ tileId: "1-3", total: 15, awarded: 15 });
    expect(quiet.lastPlay).toMatchObject({ tileId: "2-3", total: 14, awarded: 0 });
    expect(ended.hand?.phase).toBe("complete");
    expect(ended.lastHand?.leftoverAwards[ended.players[0]!.id]).toBe(25);
    expect(ended.lastPlay?.awarded).toBe(0);
    expect([scored.lastPlay?.awarded, quiet.lastPlay?.awarded, ended.lastPlay?.awarded]).not.toContain(20);
  });
});
