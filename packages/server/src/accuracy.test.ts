import { describe, expect, it } from "vitest";
import { allTileIds, arrangeDeck } from "@uhoh/rules";
import { gradeAndStore } from "./accuracy.js";
import { Store } from "./db.js";
import { describePlayer } from "./ranking.js";

const NOW = new Date("2026-10-28T18:00:00.000Z");

function user(store: Store, name: string): string {
  const id = `u-${name}`;
  store.insertUser({
    id,
    display_name: name,
    avatar_id: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    is_guest: 1,
  });
  return id;
}

describe("saved play accuracy", () => {
  it("keeps a lifetime, a last-10 average, and the games counted", () => {
    const store = new Store(":memory:");
    const ada = user(store, "Ada");
    const hands = {
      a: ["0-0", "1-1", "2-2", "3-3", "4-4", "5-5", "6-6"],
      b: ["5-6", "4-6", "3-6", "0-1", "0-2", "1-2", "1-4"],
    };
    const used = new Set([...hands.a, ...hands.b]);
    const deck = arrangeDeck(
      ["a", "b"],
      hands,
      allTileIds().filter((id) => !used.has(id)),
    );
    const input = {
      roomId: "room",
      seriesId: "series",
      gameNumber: 1,
      players: [
        { id: "a", name: "Ada" },
        { id: "b", name: "Bones" },
      ],
      config: { boneyardMode: "draw_one" as const, seriesLength: 3 as const, targetScore: 150 },
      hands: [
        {
          deck,
          actions: [
            { playerId: "a", intent: { type: "play" as const, tileId: "6-6", endId: "lead" } },
            { playerId: "b", intent: { type: "play" as const, tileId: "5-6", endId: "east" } },
          ],
        },
      ],
      humans: [{ playerId: "a", userId: ada }],
      rulesVersion: 3,
      now: NOW.toISOString(),
    };
    const first = gradeAndStore(store, input);
    expect(first.get("a")).toEqual({ matched: 0, choices: 0, missTileId: null, missPoints: 0 });
    expect(first.has("b")).toBe(false);
    expect(describePlayer(store, ada, NOW)?.playAccuracy).toBeNull();
    expect(describePlayer(store, ada, NOW)?.playAccuracyGames).toBe(0);

    const withChoice = gradeAndStore(store, {
      ...input,
      seriesId: "series-2",
      humans: [{ playerId: "b", userId: ada }],
    });
    expect(withChoice.get("b")?.choices).toBe(1);
    expect(withChoice.get("b")?.matched).toBe(0);
    expect(withChoice.get("b")?.missPoints).toBe(15);
    const standing = describePlayer(store, ada, NOW);
    expect(standing?.playAccuracy).toBe(0);
    expect(standing?.playAccuracyRecent).toBe(0);
    expect(standing?.playAccuracyGames).toBe(1);

    gradeAndStore(store, {
      ...input,
      seriesId: "series-2",
      humans: [{ playerId: "b", userId: ada }],
    });
    expect(describePlayer(store, ada, NOW)?.playAccuracyGames).toBe(1);

    gradeAndStore(store, {
      ...input,
      seriesId: "series-3",
      hands: [
        {
          deck,
          actions: [
            { playerId: "a", intent: { type: "play" as const, tileId: "6-6", endId: "lead" } },
            { playerId: "b", intent: { type: "play" as const, tileId: "3-6", endId: "east" } },
          ],
        },
      ],
      humans: [{ playerId: "b", userId: ada }],
    });
    const later = describePlayer(store, ada, NOW);
    expect(later?.playAccuracy).toBe(50);
    expect(later?.playAccuracyRecent).toBe(50);
    expect(later?.playAccuracyGames).toBe(2);
  });
});
