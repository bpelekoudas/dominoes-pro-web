import { describe, expect, it } from "vitest";
import {
  accuracyMissSentence,
  accuracyPercent,
  gradeChoice,
  gradeLoggedGame,
  parseAccuracyRecent,
  recentAccuracyPercent,
} from "./accuracy.js";
import { rankExpertPlays } from "./bot.js";
import { applyIntent, arrangeDeck, beginHand, createMatch, currentPlayerId, legalIntents } from "./engine.js";
import { allTileIds } from "./tiles.js";

const players = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bones" },
];

function afterLead() {
  const hands = {
    a: ["0-0", "1-1", "2-2", "3-3", "4-4", "5-5", "6-6"],
    b: ["5-6", "4-6", "3-6", "0-1", "0-2", "1-2", "1-4"],
  };
  const used = new Set([...hands.a, ...hands.b]);
  const boneyard = allTileIds().filter((id) => !used.has(id));
  const deck = arrangeDeck(["a", "b"], hands, boneyard);
  let match = createMatch(players, { boneyardMode: "draw_one", seriesLength: 3, targetScore: 150 });
  match = beginHand(match, deck);
  const lead = applyIntent(match, "a", { type: "play", tileId: "6-6", endId: "lead" });
  if (!lead.ok) throw new Error(lead.error ?? "lead");
  return { match: lead.match, deck, hands };
}

describe("play accuracy", () => {
  it("ignores a forced lead and counts a real choice", () => {
    const { match } = afterLead();
    const opening = createMatch(players, { boneyardMode: "draw_one", seriesLength: 3, targetScore: 150 });
    const dealt = beginHand(opening, afterLead().deck);
    expect(legalIntents(dealt, "a")).toHaveLength(1);
    expect(gradeChoice(dealt, "a", { tileId: "6-6", endId: "lead" })).toBeNull();

    const best = gradeChoice(match, "b", { type: "play", tileId: "3-6", endId: "east" });
    expect(best?.matched).toBe(true);
    expect(best?.pointGap).toBe(0);

    const miss = gradeChoice(match, "b", { tileId: "5-6", endId: "east" });
    expect(miss?.matched).toBe(false);
    expect(miss?.pointGap).toBe(15);
    expect(accuracyMissSentence("5-6", 15)).toBe("The 6–5 cost you ~15 points.");
  });

  it("does not change the grade when hidden tiles are swapped", () => {
    const { match } = afterLead();
    const before = gradeChoice(match, "b", { tileId: "5-6", endId: "east" });
    const rankedBefore = rankExpertPlays(match, "b");
    const swapped = structuredClone(match);
    const bag = [...(swapped.hand?.hands.a ?? []), ...(swapped.hand?.boneyard ?? [])];
    bag.reverse();
    const handSize = swapped.hand?.hands.a?.length ?? 0;
    swapped.hand!.hands.a = bag.slice(0, handSize);
    swapped.hand!.boneyard = bag.slice(handSize);
    expect(gradeChoice(swapped, "b", { tileId: "5-6", endId: "east" })).toEqual(before);
    expect(rankExpertPlays(swapped, "b")).toEqual(rankedBefore);
    expect(JSON.stringify(rankExpertPlays(swapped, "b"))).not.toContain(swapped.hand?.hands.a[0]);
  });

  it("grades only the named seats, and only when they had a choice", () => {
    const { deck } = afterLead();
    const hands = [
      {
        deck,
        actions: [
          { playerId: "a", intent: { type: "play" as const, tileId: "6-6", endId: "lead" } },
          { playerId: "b", intent: { type: "play" as const, tileId: "5-6", endId: "east" } },
        ],
      },
    ];
    const graded = gradeLoggedGame(
      players,
      { boneyardMode: "draw_one", seriesLength: 3, targetScore: 150 },
      hands,
      new Set(["b"]),
    );
    expect(graded.has("a")).toBe(false);
    expect(graded.get("b")).toEqual({ matched: 0, choices: 1, miss: { tileId: "5-6", points: 15 } });

    const matched = gradeLoggedGame(
      players,
      { boneyardMode: "draw_one", seriesLength: 3, targetScore: 150 },
      [
        {
          deck,
          actions: [
            { playerId: "a", intent: { type: "play", tileId: "6-6", endId: "lead" } },
            { playerId: "b", intent: { type: "play", tileId: "3-6", endId: "east" } },
          ],
        },
      ],
      new Set(["a", "b"]),
    );
    expect(matched.get("a")).toEqual({ matched: 0, choices: 0, miss: null });
    expect(matched.get("b")?.matched).toBe(1);
    expect(matched.get("b")?.choices).toBe(1);
    expect(matched.get("b")?.miss).toBeNull();
    expect(currentPlayerId(afterLead().match)).toBe("b");

    const botPlay = gradeLoggedGame(
      players,
      { boneyardMode: "draw_one", seriesLength: 3, targetScore: 150 },
      [
        {
          deck,
          actions: [
            { playerId: "a", intent: { type: "play", tileId: "6-6", endId: "lead" } },
            { playerId: "b", intent: { type: "play", tileId: "5-6", endId: "east", bot: true } as never },
          ],
        },
      ],
      new Set(["b"]),
    );
    expect(botPlay.get("b")).toEqual({ matched: 0, choices: 0, miss: null });
  });

  it("weights a lifetime by decisions and a recent run by games", () => {
    expect(accuracyPercent(0, 0)).toBeNull();
    expect(accuracyPercent(3, 4)).toBe(75);
    expect(recentAccuracyPercent([])).toBeNull();
    expect(
      recentAccuracyPercent([
        { matched: 1, choices: 1 },
        { matched: 1, choices: 2 },
      ]),
    ).toBe(75);
    expect(parseAccuracyRecent("nope")).toEqual([]);
    expect(parseAccuracyRecent(JSON.stringify([{ matched: 2, choices: 4 }, { matched: 1, choices: 0 }]))).toEqual([
      { matched: 2, choices: 4 },
    ]);
  });
});
