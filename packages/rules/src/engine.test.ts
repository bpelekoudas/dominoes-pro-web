import { describe, expect, it } from "vitest";
import {
  applyIntent,
  arrangeDeck,
  beginHand,
  conservedTiles,
  createMatch,
  deal,
  legalIntents,
  openingLead,
  replayMatch,
  type Intent,
  type MatchState,
} from "./engine.js";
import { openScore } from "./board.js";
import { deckMatchesSeed, shuffleWithSeed } from "./rng.js";
import { roundToFive, scoreDomino, scoreLocked, splitShare, winsNeeded } from "./score.js";
import { allTileIds, handPips, lowestEndKey } from "./tiles.js";
import { resolveTaunt, tauntsForPlayer } from "./taunts.js";
import { project, type TableMeta } from "./view.js";

const A = { id: "a", name: "Alex" };
const B = { id: "b", name: "Sam" };
const C = { id: "c", name: "Jo" };

function restOf(used: string[]): string[] {
  const taken = new Set(used);
  return allTileIds().filter((id) => !taken.has(id));
}

function deckFor(
  seats: string[],
  hands: Record<string, string[]>,
  boneyardPrefix: string[] = [],
): string[] {
  const used = seats.flatMap((id) => hands[id] ?? []);
  const rest = restOf(used);
  const boneyard = [...boneyardPrefix, ...rest.filter((id) => !boneyardPrefix.includes(id))];
  return arrangeDeck(seats, hands, boneyard);
}

function start(
  players: Array<{ id: string; name: string }>,
  deck: string[],
  config: {
    boneyardMode: "draw_one" | "draw_until";
    seriesLength: 3 | 5 | 7;
    targetScore: number;
  } = { boneyardMode: "draw_one", seriesLength: 3, targetScore: 150 },
): MatchState {
  return beginHand(createMatch(players, config), deck);
}

function play(match: MatchState, playerId: string, tileId: string, endId: string): MatchState {
  const result = applyIntent(match, playerId, { type: "play", tileId, endId });
  expect(result.ok, result.error).toBe(true);
  return result.match;
}

describe("dealing", () => {
  it("deals 7 tiles and leaves the right boneyard", () => {
    const deck = allTileIds();
    expect(deal(deck, ["a", "b"]).boneyard).toHaveLength(14);
    expect(deal(deck, ["a", "b", "c"]).boneyard).toHaveLength(7);
    expect(deal(deck, ["a", "b", "c", "d"]).boneyard).toHaveLength(0);
    const two = deal(deck, ["a", "b"]);
    expect(two.hands.a).toHaveLength(7);
    expect(two.hands.b).toHaveLength(7);
    expect(new Set([...two.hands.a!, ...two.hands.b!, ...two.boneyard]).size).toBe(28);
  });
});

describe("opening lead", () => {
  it("forces the 6–6 holder to play it on the first hand of a series", () => {
    const hands = {
      a: ["0-0", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["6-6", "1-1", "1-3", "1-4", "1-5", "2-2", "2-3"],
    };
    const match = start([A, B], deckFor(["a", "b"], hands));
    expect(match.hand?.leaderId).toBe("b");
    expect(match.hand?.openingTileId).toBe("6-6");
    const wrong = applyIntent(match, "b", { type: "play", tileId: "1-1", endId: "lead" });
    expect(wrong.ok).toBe(false);
    const led = play(match, "b", "6-6", "lead");
    expect(led.hand?.board.center?.tileId).toBe("6-6");
    expect(led.scores.b).toBe(0);
    expect(led.lastPlay?.total).toBe(12);
    expect(led.lastPlay?.awarded).toBe(0);
  });

  it("uses the highest double when 6–6 is in the boneyard, and scores 5–5 as 10", () => {
    const hands = {
      a: ["5-5", "0-1", "0-2", "0-3", "0-4", "1-2", "1-3"],
      b: ["4-4", "1-4", "1-5", "2-3", "2-4", "2-5", "3-4"],
    };
    const match = start([A, B], deckFor(["a", "b"], hands, ["6-6"]));
    expect(match.hand?.openingTileId).toBe("5-5");
    expect(match.hand?.leaderId).toBe("a");
    const led = play(match, "a", "5-5", "lead");
    expect(led.scores.a).toBe(10);
    expect(led.lastPlay?.awarded).toBe(10);
  });

  it("falls back to the heaviest tile when nobody was dealt a double", () => {
    const hands = {
      a: ["0-1", "0-2", "0-3", "0-4", "0-5", "0-6", "1-2"],
      b: ["1-3", "1-4", "1-5", "1-6", "2-3", "2-4", "4-6"],
    };
    expect(openingLead(hands)).toEqual({ leaderId: "b", tileId: "4-6" });
    const match = start([A, B], deckFor(["a", "b"], hands));
    expect(match.hand?.openingTileId).toBe("4-6");
    const led = play(match, "b", "4-6", "lead");
    expect(led.lastPlay?.total).toBe(10);
    expect(led.scores.b).toBe(10);
  });

  it("deals the big six again when a new game starts, then lets that hand's winner lead", () => {
    const first = {
      a: ["6-6", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["5-5", "1-1", "1-3", "1-4", "1-5", "2-2", "2-3"],
    };
    const config = { boneyardMode: "draw_one" as const, seriesLength: 3 as const, targetScore: 50 };
    let match = start([A, B], deckFor(["a", "b"], first), config);
    match = { ...match, scores: { a: 50, b: 0 } };
    match = play(match, "a", "6-6", "lead");
    expect(match.lastHand?.gameWinnerId).toBe("a");
    expect(match.lastPlay?.tileId).toBe("6-6");
    expect(match.hand?.board.center?.tileId).toBe("6-6");
    expect(match.hand?.phase).toBe("complete");

    const second = {
      a: ["0-0", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["6-6", "1-1", "1-3", "1-4", "1-5", "2-2", "2-3"],
    };
    const next = beginHand(match, deckFor(["a", "b"], second));
    expect(next.gameNumber).toBe(2);
    expect(next.handNumber).toBe(1);
    expect(next.scores).toEqual({ a: 0, b: 0 });
    expect(next.hand?.openingTileId).toBe("6-6");
    expect(next.hand?.leaderId).toBe("b");
    expect(applyIntent(next, "a", { type: "play", tileId: "0-0", endId: "lead" }).ok).toBe(false);
    expect(applyIntent(next, "b", { type: "play", tileId: "1-1", endId: "lead" }).ok).toBe(false);
    const led = play(next, "b", "6-6", "lead");

    const gone = play(
      {
        ...led,
        hand: {
          ...led.hand!,
          hands: { a: ["5-5"], b: ["5-6"] },
          boneyard: [],
          phase: "await_play",
          turnIndex: 1,
        },
      },
      "b",
      "5-6",
      "east",
    );
    expect(gone.lastHand?.reason).toBe("domino");
    expect(gone.lastHand?.winnerIds).toEqual(["b"]);
    expect(gone.lastDominoId).toBe("b");
    expect(gone.lastDominoKey).toBe("2:1");
    expect(gone.lastHand?.gameWinnerId).toBeNull();
    expect(gone.lastPlay?.tileId).toBe("5-6");
    expect(gone.lastPlay?.playerId).toBe("b");
    expect(gone.hand?.phase).toBe("complete");
    expect(gone.hand?.board.center?.tileId).toBe("6-6");
    const shown = project(gone, metaOf(gone, "a"));
    expect(shown.phase).toBe("between");
    expect(shown.board?.center?.tileId).toBe("6-6");
    expect(shown.lastPlay?.tileId).toBe("5-6");

    const follow = beginHand(gone, deckFor(["a", "b"], second));
    expect(follow.gameNumber).toBe(2);
    expect(follow.handNumber).toBe(2);
    expect(follow.lastDominoId).toBe("b");
    expect(follow.lastDominoKey).toBe("2:1");
    expect(follow.hand?.leaderId).toBe("b");
    expect(follow.hand?.openingTileId).toBeNull();
  });

  it("falls back to the highest double when a new game's boneyard holds the big six", () => {
    const first = {
      a: ["6-6", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["4-4", "1-1", "1-3", "1-4", "1-5", "2-2", "2-3"],
    };
    let match = start([A, B], deckFor(["a", "b"], first), {
      boneyardMode: "draw_until",
      seriesLength: 3,
      targetScore: 10,
    });
    match = play({ ...match, scores: { a: 10, b: 0 } }, "a", "6-6", "lead");
    const dealt = {
      a: ["5-5", "0-1", "0-2", "0-3", "0-4", "1-2", "1-3"],
      b: ["4-4", "1-4", "1-5", "2-3", "2-4", "2-5", "3-4"],
    };
    const next = beginHand(match, deckFor(["a", "b"], dealt, ["6-6"]));
    expect(next.hand?.openingTileId).toBe("5-5");
    expect(next.hand?.leaderId).toBe("a");
  });

  it("keeps an older log where the winner opened the next game with any tile", () => {
    const first = {
      a: ["5-5", "0-1", "0-2", "0-3", "0-4", "1-2", "1-3"],
      b: ["4-4", "1-4", "1-5", "2-3", "2-4", "2-5", "3-4"],
    };
    const config = { boneyardMode: "draw_one" as const, seriesLength: 3 as const, targetScore: 10 };
    const deck1 = deckFor(["a", "b"], first, ["6-6"]);
    let match = beginHand(createMatch([A, B], config), deck1, 2);
    expect(match.hand?.openingTileId).toBe("5-5");
    match = play(match, "a", "5-5", "lead");
    expect(match.lastHand?.gameWinnerId).toBe("a");
    const second = {
      a: ["3-3", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["6-6", "1-1", "1-3", "1-4", "1-5", "2-2", "2-3"],
    };
    const deck2 = deckFor(["a", "b"], second);
    const next = beginHand(match, deck2, 2);
    expect(next.hand?.leaderId).toBe("a");
    expect(next.hand?.openingTileId).toBeNull();
    const led = play(next, "a", "3-3", "lead");
    const log = [
      { deck: deck1, actions: [{ playerId: "a", intent: { type: "play" as const, tileId: "5-5", endId: "lead" } }] },
      { deck: deck2, actions: [{ playerId: "a", intent: { type: "play" as const, tileId: "3-3", endId: "lead" } }] },
    ];
    const again = replayMatch([A, B], config, log, 2);
    expect(again.hand?.board.center?.tileId).toBe("3-3");
    expect(again.gameNumber).toBe(led.gameNumber);
    expect(() => replayMatch([A, B], config, log, 3)).toThrow();
  });
});

describe("spinner score is what the table shows and what the player is paid", () => {
  it("pays 10, not 5 and not 15, for a 5–5 with an empty up side", () => {
    const hands = {
      a: ["5-5", "5-6", "4-5", "0-1", "0-2", "0-3", "1-2"],
      b: ["3-5", "4-6", "2-5", "0-4", "1-3", "1-4", "2-3"],
    };
    let match = start([A, B], deckFor(["a", "b"], hands));
    match = play(match, "a", "5-5", "lead");
    match = play(match, "b", "3-5", "west");
    match = play(match, "a", "5-6", "east");
    match = play(match, "b", "4-6", "east");
    match = play(match, "a", "4-5", "east");
    const before = match.scores.b ?? 0;
    match = play(match, "b", "2-5", "south");

    const board = match.hand!.board;
    const scored = openScore(board);
    expect(scored).toMatchObject({ parts: [3, 5, 2], total: 10, awarded: 10, equation: "3 + 5 + 2 = 10" });
    expect(match.lastPlay).toMatchObject({ total: scored.total, awarded: scored.awarded });
    expect(match.scores.b).toBe(before + scored.awarded);
    expect(match.scores.b).toBe(before + 10);

    const shown = project(match, metaOf(match, "a"));
    expect(shown.openEquation).toBe(scored.equation);
    expect(shown.openTotal).toBe(scored.total);
    expect(shown.lastPlay?.awarded).toBe(scored.awarded);
  });
});

describe("owner checklist", () => {
  const series = { boneyardMode: "draw_one" as const, seriesLength: 5 as const, targetScore: 150 };

  it("splits a tied lock and the player with the lowest end leads the next hand", () => {
    const hands = {
      a: ["6-6", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["1-1", "1-3", "1-4", "1-5", "2-2", "2-3", "2-4"],
      c: ["2-5", "3-3", "3-4", "3-5", "4-4", "4-5", "5-5"],
    };
    let match = start([A, B, C], deckFor(["a", "b", "c"], hands), series);
    match = play(match, "a", "6-6", "lead");
    match = {
      ...match,
      hand: {
        ...match.hand!,
        hands: { a: ["2-2"], b: ["1-3"], c: ["5-5", "4-5"] },
        boneyard: [],
        phase: "await_knock",
        turnIndex: 0,
      },
    };
    const locked = applyIntent(match, "a", { type: "knock" });
    expect(locked.ok, locked.error).toBe(true);
    expect(locked.match.lastHand?.reason).toBe("locked");
    expect(locked.match.lastDominoId).toBeNull();
    expect(handPips(["5-5", "4-5"])).toBe(19);
    expect(locked.match.lastHand?.leftoverAwards).toEqual({ a: 10, b: 10, c: 0 });
    expect(locked.match.lastHand?.summary).toBe("Locked and tied. Alex and Sam split the rest, 10 each. Sam leads next.");
    expect(locked.match.lastHand?.nextLeaderId).toBe("b");
    const places = locked.match.lastHand?.placements ?? [];
    expect(places.filter((row) => row.place === 1).map((row) => row.playerId).sort()).toEqual(["a", "b"]);
    expect(places.find((row) => row.playerId === "a")?.tied).toBe(true);
    expect(places.find((row) => row.playerId === "c")?.place).toBe(3);
    const remembered = applyIntent({ ...match, lastDominoId: "c", lastDominoKey: "1:4" }, "a", { type: "knock" });
    expect(remembered.ok).toBe(true);
    expect(remembered.match.lastHand?.reason).toBe("locked");
    expect(remembered.match.lastDominoId).toBe("c");
    expect(remembered.match.lastDominoKey).toBe("1:4");
    const next = beginHand(locked.match, deckFor(["a", "b", "c"], hands));
    expect(next.hand?.leaderId).toBe("b");
    expect(next.hand?.openingTileId).toBeNull();
    expect(next.config.boneyardMode).toBe("draw_one");
  });

  it("says a tied split rounds to nothing when each share is 1 or 2", () => {
    const hands = {
      a: ["6-6", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["1-1", "1-3", "1-4", "1-5", "2-2", "2-3", "2-4"],
      c: ["2-5", "3-3", "3-4", "3-5", "4-4", "4-5", "5-5"],
    };
    let match = start([A, B, C], deckFor(["a", "b", "c"], hands), series);
    match = play(match, "a", "6-6", "lead");
    match = {
      ...match,
      hand: {
        ...match.hand!,
        hands: { a: ["0-2"], b: ["1-1"], c: ["2-2"] },
        boneyard: [],
        phase: "await_knock",
        turnIndex: 0,
      },
    };
    const locked = applyIntent(match, "a", { type: "knock" });
    expect(locked.ok, locked.error).toBe(true);
    expect(locked.match.lastHand?.leftoverAwards).toEqual({ a: 0, b: 0, c: 0 });
    expect(handPips(["0-2"])).toBe(2);
    expect(handPips(["1-1"])).toBe(2);
    expect(handPips(["2-2"])).toBe(4);
    expect(locked.match.lastHand?.summary).toBe("Locked and tied. Each share rounds to nothing. Alex leads next.");
  });

  it("keeps the boneyard rule for the series, and an empty yard is a knock", () => {
    const hands = {
      a: ["6-6", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["1-1", "1-3", "1-4", "1-5", "2-2", "2-3", "2-4"],
    };
    let match = start([A, B], deckFor(["a", "b"], hands), {
      boneyardMode: "draw_until",
      seriesLength: 5,
      targetScore: 150,
    });
    match = play(match, "a", "6-6", "lead");
    match = {
      ...match,
      hand: { ...match.hand!, boneyard: [], phase: "await_knock", turnIndex: 1 },
    };
    expect(legalIntents(match, "b")).toEqual([{ type: "knock" }]);
    expect(applyIntent(match, "b", { type: "draw" }).ok).toBe(false);
    const knocked = applyIntent(match, "b", { type: "knock" });
    expect(knocked.ok, knocked.error).toBe(true);
    expect(knocked.match.config.boneyardMode).toBe("draw_until");
    const next = beginHand(knocked.match, deckFor(["a", "b"], hands));
    expect(next.config.boneyardMode).toBe("draw_until");
  });

  it.each([2, 3] as const)("a board score to 150 ends a %s-player hand immediately", (count) => {
    const players = [A, B, C].slice(0, count);
    const ids = players.map((player) => player.id);
    const hands: Record<string, string[]> = {};
    const pool = allTileIds().filter((id) => id !== "5-5" && id !== "6-6");
    hands.a = ["5-5", ...pool.splice(0, 6)];
    for (const id of ids.slice(1)) hands[id] = pool.splice(0, 7);
    let match = start(players, deckFor(ids, hands, ["6-6"]), series);
    expect(match.hand?.openingTileId).toBe("5-5");
    match = { ...match, scores: { ...match.scores, a: 145 } };
    const led = play(match, "a", "5-5", "lead");
    expect(led.lastPlay?.awarded).toBe(10);
    expect(led.scores.a).toBe(155);
    expect(led.hand?.phase).toBe("complete");
    expect(led.lastHand?.reason).toBe("score");
    expect(led.lastHand?.gameWinnerId).toBe("a");
    expect(led.phase).toBe("in_hand");
    expect(led.gamesWon.a).toBe(1);
    for (const player of players) expect(legalIntents(led, player.id)).toEqual([]);
    const next = beginHand(led, deckFor(ids, hands, ["6-6"]));
    expect(next.gameNumber).toBe(2);
    expect(next.scores.a).toBe(0);
    expect(next.hand?.openingTileId).toBe("5-5");
    expect(next.hand?.leaderId).toBe("a");
  });

  it("a board score to 150 ends a 4-player hand immediately", () => {
    const players = [A, B, C, { id: "d", name: "Dee" }];
    const ids = players.map((player) => player.id);
    const pool = allTileIds().filter((id) => id !== "6-6" && id !== "3-6");
    const hands: Record<string, string[]> = {
      a: ["6-6", ...pool.splice(0, 6)],
      b: ["3-6", ...pool.splice(0, 6)],
      c: pool.splice(0, 7),
      d: pool.splice(0, 7),
    };
    let match = start(players, deckFor(ids, hands), series);
    expect(match.hand?.openingTileId).toBe("6-6");
    match = play(match, "a", "6-6", "lead");
    expect(match.hand?.phase).toBe("await_play");
    expect(match.lastPlay?.awarded).toBe(0);
    match = { ...match, scores: { ...match.scores, b: 140 } };
    const scored = play(match, "b", "3-6", "east");
    expect(scored.lastPlay?.awarded).toBe(15);
    expect(scored.scores.b).toBe(155);
    expect(scored.hand?.phase).toBe("complete");
    expect(scored.lastHand?.reason).toBe("score");
    expect(scored.lastHand?.gameWinnerId).toBe("b");
    expect(scored.gamesWon.b).toBe(1);
    for (const player of players) expect(legalIntents(scored, player.id)).toEqual([]);
  });

  it.each([2, 3, 4] as const)("leftovers that reach 150 end a %s-player game", (count) => {
    const players = [A, B, C, { id: "d", name: "Dee" }].slice(0, count);
    const ids = players.map((player) => player.id);
    const pool = allTileIds();
    const hands: Record<string, string[]> = {};
    for (const id of ids) hands[id] = pool.splice(0, 7);
    const holder = ids.find((id) => hands[id]?.includes("6-6"));
    if (holder && holder !== "a") {
      const swap = hands.a?.[0];
      if (swap) {
        hands[holder] = (hands[holder] ?? []).map((id) => (id === "6-6" ? swap : id));
        hands.a = ["6-6", ...(hands.a ?? []).slice(1)];
      }
    }
    let match = start(players, deckFor(ids, hands), series);
    const held: Record<string, string[]> = { a: ["6-6"] };
    const heavy = ["5-5", "4-4", "3-3"];
    ids.slice(1).forEach((id, index) => {
      held[id] = [heavy[index] ?? "2-2"];
    });
    match = {
      ...match,
      scores: { ...match.scores, a: 140 },
      hand: {
        ...match.hand!,
        hands: held,
        boneyard: [],
        phase: "await_play",
        turnIndex: 0,
        openingTileId: "6-6",
      },
    };
    const out = play(match, "a", "6-6", "lead");
    expect(out.lastPlay?.awarded).toBe(0);
    expect(out.lastHand?.reason).toBe("domino");
    expect(out.scores.a).toBeGreaterThanOrEqual(150);
    expect(out.lastHand?.gameWinnerId).toBe("a");
    expect(out.hand?.phase).toBe("complete");
    for (const player of players) expect(legalIntents(out, player.id)).toEqual([]);
  });

  it("a score under 150 does not stop the hand", () => {
    const hands = {
      a: ["5-5", "0-1", "0-2", "0-3", "0-4", "1-2", "1-3"],
      b: ["4-4", "1-4", "1-5", "2-3", "2-4", "2-5", "3-4"],
    };
    let match = start([A, B], deckFor(["a", "b"], hands, ["6-6"]), series);
    match = { ...match, scores: { ...match.scores, a: 100 } };
    const led = play(match, "a", "5-5", "lead");
    expect(led.scores.a).toBe(110);
    expect(led.hand?.phase).toBe("await_play");
    expect(led.lastHand).toBeNull();
    expect(led.gamesWon.a).toBe(0);
  });

  it("plays a best of 5 through to a series winner", () => {
    const report = playSeeded(21, {
      players: [A, B, C],
      boneyardMode: "draw_until",
      seriesLength: 5,
      targetScore: 40,
    });
    expect(report.finished).toBe(true);
    expect(report.final.config.boneyardMode).toBe("draw_until");
    const winner = report.final.seriesWinnerId;
    expect(winner).toBeTruthy();
    expect(report.final.gamesWon[winner ?? ""]).toBeGreaterThanOrEqual(3);
    for (const games of Object.values(report.final.gamesWon)) expect(games).toBeLessThanOrEqual(3);
  });
});

describe("leftover rounding", () => {
  it("rounds one total to the nearest 5, for every remainder from 1 through 60", () => {
    expect(roundToFive(0)).toBe(0);
    expect(roundToFive(-3)).toBe(0);
    expect(roundToFive(7)).toBe(5);
    expect(roundToFive(8)).toBe(10);
    expect(roundToFive(12)).toBe(10);
    expect(roundToFive(13)).toBe(15);
    expect(roundToFive(29)).toBe(30);
    for (let pips = 1; pips <= 60; pips += 1) {
      const remainder = pips % 5;
      const expected = remainder === 0 ? pips : remainder <= 2 ? pips - remainder : pips + (5 - remainder);
      expect(roundToFive(pips), String(pips)).toBe(expected);
      expect(expected % 5).toBe(0);
    }

    expect(scoreDomino({ a: 0, b: 17 }, "a")).toEqual({ a: 15, b: 0 });
    expect(scoreDomino({ a: 0, b: 8 }, "a")).toEqual({ a: 10, b: 0 });
    expect(scoreDomino({ a: 0, b: 7 }, "a")).toEqual({ a: 5, b: 0 });
    expect(scoreDomino({ a: 0, b: 5 }, "a")).toEqual({ a: 5, b: 0 });
    expect(scoreDomino({ a: 0, b: 4 }, "a")).toEqual({ a: 5, b: 0 });
    expect(scoreDomino({ a: 0, b: 3 }, "a")).toEqual({ a: 5, b: 0 });
    expect(scoreDomino({ a: 0, b: 2 }, "a")).toEqual({ a: 0, b: 0 });
    // 7 and 6 are added first. 13 rounds to 15. Rounding each hand would pay 10.
    expect(scoreDomino({ a: 0, b: 7, c: 6 }, "a")).toEqual({ a: 15, b: 0, c: 0 });
    // 8 and 8 are 16, which rounds to 15. Rounding each hand would pay 20.
    expect(scoreDomino({ a: 0, b: 8, c: 8 }, "a")).toEqual({ a: 15, b: 0, c: 0 });
  });

  it("rounds a fractional share by dropping the fraction, then using the remainder rule", () => {
    expect(roundToFive(9.5)).toBe(10);
    expect(roundToFive(7.5)).toBe(5);
    expect(roundToFive(2.5)).toBe(0);
    expect(roundToFive(4.5)).toBe(5);
    expect(roundToFive(8.4)).toBe(10);
    // 19 / 2 = 9.5, which is not halfway between 5 and 10. Remainder 4 rounds up.
    expect(splitShare(19, 2)).toBe(10);
    // 15 / 2 = 7.5, halfway between 5 and 10. The half is dropped, remainder 2 rounds down.
    expect(splitShare(15, 2)).toBe(5);
    // 9 / 2 = 4.5. Truncates to 4, remainder 4, rounds up to 5.
    expect(splitShare(9, 2)).toBe(5);
    // 7 / 2 = 3.5. Truncates to 3, remainder 3, rounds up to 5.
    expect(splitShare(7, 2)).toBe(5);
    // 4 / 2 = 2. Remainder 2 rounds down to 0.
    expect(splitShare(4, 2)).toBe(0);
    expect(splitShare(10, 2)).toBe(5);
    expect(splitShare(0, 2)).toBe(0);
    // 20 / 3 = 6.666… truncates to 6, remainder 1, rounds down to 5.
    expect(splitShare(20, 3)).toBe(5);
    // 23 / 3 = 7.666… truncates to 7, remainder 2, rounds down to 5.
    expect(splitShare(23, 3)).toBe(5);
    // 25 / 3 = 8.333… truncates to 8, remainder 3, rounds up to 10.
    expect(splitShare(25, 3)).toBe(10);
  });
});

describe("locked hands", () => {
  it("pays the lightest hand the others' pips, rounded once to the nearest 5", () => {
    const hands = {
      a: ["0-2"],
      b: ["5-5", "4-4"],
      c: ["3-4"],
    };
    expect(handPips(hands.a)).toBe(2);
    expect(handPips(hands.b)).toBe(18);
    expect(handPips(hands.c)).toBe(7);
    const locked = scoreLocked(hands);
    expect(locked.winnerIds).toEqual(["a"]);
    expect(locked.awards).toEqual({ a: 25, b: 0, c: 0 });
    expect(locked.nextLeaderId).toBe("a");

    // 4-4 is 8. Floor would pay 5. Nearest pays 10.
    const eight = scoreLocked({ a: ["0-0"], b: ["4-4"] });
    expect(eight.awards).toEqual({ a: 10, b: 0 });
    // 6-6 + 5-5 + 4-3 is 29. Floor would pay 25. Nearest pays 30.
    expect(handPips(["6-6", "5-5", "3-4"])).toBe(29);
    const twentyNine = scoreLocked({ a: ["0-0"], b: ["6-6", "5-5", "3-4"] });
    expect(twentyNine.awards).toEqual({ a: 30, b: 0 });
  });

  it("splits a tie on the exact share and rounds that share to the nearest 5", () => {
    expect(splitShare(19, 2)).toBe(10);
    expect(splitShare(15, 2)).toBe(5);
    expect(splitShare(20, 3)).toBe(5);
    expect(splitShare(7, 2)).toBe(5);
    expect(splitShare(10, 2)).toBe(5);
    expect(splitShare(0, 2)).toBe(0);

    const hands = {
      a: ["2-2"],
      b: ["1-3"],
      c: ["5-6", "4-4"],
    };
    expect(handPips(hands.a)).toBe(4);
    expect(handPips(hands.b)).toBe(4);
    expect(handPips(hands.c)).toBe(19);
    const locked = scoreLocked(hands);
    expect(locked.winnerIds.sort()).toEqual(["a", "b"]);
    expect(locked.awards).toEqual({ a: 10, b: 10, c: 0 });

    // 0-2 and 1-1 are 2 each. 2-2 is 4. The share is 2, which rounds to nothing.
    const nothing = scoreLocked({ a: ["0-2"], b: ["1-1"], c: ["2-2"] });
    expect(nothing.awards).toEqual({ a: 0, b: 0, c: 0 });
    expect(nothing.nextLeaderId).toBe("a");
  });

  it("gives the next lead to the tied player with the lowest end", () => {
    const hands = {
      a: ["2-2", "5-5"],
      b: ["1-3", "4-6"],
    };
    expect(handPips(hands.a)).toBe(14);
    expect(handPips(hands.b)).toBe(14);
    expect(lowestEndKey(hands.a)[0]).toBe(2);
    expect(lowestEndKey(hands.b)[0]).toBe(1);
    const locked = scoreLocked(hands);
    expect(locked.nextLeaderId).toBe("b");

    const bothHaveBlank = scoreLocked({
      a: ["0-4", "3-3"],
      b: ["0-1", "4-5"],
    });
    expect(handPips(["0-4", "3-3"])).toBe(handPips(["0-1", "4-5"]));
    expect(bothHaveBlank.nextLeaderId).toBe("b");
  });
});

describe("a played hand", () => {
  it("rejects a tile that does not fit, a play out of turn, and a draw when you can play", () => {
    const hands = {
      a: ["6-6", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["1-1", "1-3", "1-4", "1-5", "2-2", "2-3", "2-4"],
    };
    const match = start([A, B], deckFor(["a", "b"], hands, ["3-3"]));
    expect(applyIntent(match, "a", { type: "play", tileId: "0-1", endId: "lead" }).ok).toBe(false);
    const led = play(match, "a", "6-6", "lead");
    expect(applyIntent(led, "a", { type: "play", tileId: "0-1", endId: "east" }).ok).toBe(false);
    expect(applyIntent(led, "b", { type: "play", tileId: "1-1", endId: "east" }).ok).toBe(false);
    const drew = applyIntent(led, "b", { type: "draw" }).match;
    expect(drew.hand?.hands.b).toHaveLength(8);
    expect(drew.lastDraw?.tileIds).toEqual(["3-3"]);
    // 3–3 does not fit on double-six, so the turn comes back to Alex, who also cannot fit.
    expect(drew.players[drew.hand!.turnIndex]?.id).toBe("a");
    expect(drew.hand?.phase).toBe("await_draw");
    expect(new Set(conservedTiles(drew)).size).toBe(28);
  });

  it("draw-until pulls every tile needed and then requires a play", () => {
    const hands = {
      a: ["6-6", "0-0", "0-1", "0-2", "0-3", "0-4", "0-5"],
      b: ["1-1", "1-2", "1-3", "1-4", "1-5", "2-2", "2-3"],
    };
    const deck = deckFor(["a", "b"], hands, ["2-4", "2-5", "3-3", "1-6"]);
    const led = play(start([A, B], deck, { boneyardMode: "draw_until", seriesLength: 3, targetScore: 150 }), "a", "6-6", "lead");
    const drawn = applyIntent(led, "b", { type: "draw" });
    expect(drawn.ok).toBe(true);
    expect(drawn.match.lastDraw?.tileIds).toEqual(["2-4", "2-5", "3-3", "1-6"]);
    expect(drawn.match.hand?.phase).toBe("await_play");
    expect(drawn.match.hand?.hands.b).toContain("1-6");
    const after = play(drawn.match, "b", "1-6", "east");
    expect(after.hand?.board.arms.east.at(-1)?.tileId).toBe("1-6");
    expect(new Set(conservedTiles(after)).size).toBe(28);
  });
});

describe("privacy", () => {
  it("shows a player their own hand and never the boneyard or the other hand", () => {
    const hands = {
      a: ["6-6", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["1-1", "1-3", "1-4", "1-5", "2-2", "2-3", "2-4"],
    };
    const deck = deckFor(["a", "b"], hands, ["3-3"]);
    const match = play(start([A, B], deck), "a", "6-6", "lead");
    const view = project(match, metaOf(match, "b"));
    const hidden = new Set([...(match.hand?.hands.a ?? []), ...(match.hand?.boneyard ?? [])]);
    hidden.delete("6-6");
    const serialized = JSON.stringify(view);
    for (const tile of hidden) expect(serialized).not.toContain(tile);
    expect(view.you.hand.map((tile) => tile.id).sort()).toEqual([...hands.b].sort());
    expect(view.boneyardCount).toBe(14);
    expect(serialized).not.toContain("seed");
    expect(view.openingTileId).toBeNull();
    const leaderView = project(match, metaOf(match, "a"));
    expect(leaderView.you.hand.map((tile) => tile.id)).not.toContain("6-6");
    expect(leaderView.lastDraw).toBeNull();
  });

  it("tells only the player who drew which tile came off the boneyard", () => {
    const hands = {
      a: ["6-6", "0-1", "0-2", "0-3", "0-4", "0-5", "1-2"],
      b: ["1-1", "1-3", "1-4", "1-5", "2-2", "2-3", "2-4"],
    };
    const deck = deckFor(["a", "b"], hands, ["3-4"]);
    const led = play(start([A, B], deck), "a", "6-6", "lead");
    const drawn = applyIntent(led, "b", { type: "draw" }).match;
    const sam = project(drawn, metaOf(drawn, "b"));
    const alex = project(drawn, metaOf(drawn, "a"));
    expect(sam.lastDraw).toEqual({ playerId: "b", count: 1, tileIds: ["3-4"] });
    expect(alex.lastDraw).toEqual({ playerId: "b", count: 1, tileIds: null });
    expect(JSON.stringify(alex)).not.toContain("3-4");
  });
});

describe("series lead and replay", () => {
  it("needs 2, 3, and 4 wins for best of 3, 5, and 7", () => {
    expect(winsNeeded(3)).toBe(2);
    expect(winsNeeded(5)).toBe(3);
    expect(winsNeeded(7)).toBe(4);
  });

  it("replays a seeded shuffle and the same actions to the same result", () => {
    const report = playSeeded(11, {
      players: [A, B, C],
      boneyardMode: "draw_one",
      seriesLength: 3,
      targetScore: 30,
    });
    expect(report.finished).toBe(true);
    expect(report.dominoes + report.locks).toBeGreaterThan(0);
    const again = replayMatch(report.players, report.config, report.hands);
    expect(again.scores).toEqual(report.final.scores);
    expect(again.gamesWon).toEqual(report.final.gamesWon);
    expect(again.seriesWinnerId).toEqual(report.final.seriesWinnerId);
    expect(again.hand?.board).toEqual(report.final.hand?.board);
    for (const hand of report.hands) {
      expect(deckMatchesSeed(hand.seed, hand.deck)).toBe(true);
    }
  });

  it("lets the winner lead the next hand, and deals the big six at the start of each game", () => {
    const report = playSeeded(4, {
      players: [A, B],
      boneyardMode: "draw_until",
      seriesLength: 3,
      targetScore: 20,
    });
    expect(report.finished).toBe(true);
    expect(report.leadChecks).toBeGreaterThan(0);
    expect(report.crossedGame).toBe(true);
    expect(report.scoredFive).toBe(true);
    expect(report.scoredTen).toBe(true);
    expect(report.sawSpinnerOpen).toBe(true);
  });
});

describe("taunt packs", () => {
  it("hides character packs until that character is owned", () => {
    const open = tauntsForPlayer();
    expect(open.some((taunt) => taunt.id === "uh-oh")).toBe(true);
    expect(open.some((taunt) => taunt.packId === "sample-character")).toBe(false);
    expect(resolveTaunt("sample-character", "later")).toBeNull();
    const owned = tauntsForPlayer(["future-character"]);
    expect(owned.some((taunt) => taunt.packId === "sample-character")).toBe(true);
  });
});

interface SeededReport {
  players: Array<{ id: string; name: string }>;
  config: { boneyardMode: "draw_one" | "draw_until"; seriesLength: 3 | 5 | 7; targetScore: number };
  hands: Array<{ seed: Buffer; deck: string[]; actions: Array<{ playerId: string; intent: Intent }> }>;
  final: MatchState;
  finished: boolean;
  dominoes: number;
  locks: number;
  leadChecks: number;
  crossedGame: boolean;
  scoredFive: boolean;
  scoredTen: boolean;
  sawSpinnerOpen: boolean;
}

function playSeeded(
  seedNumber: number,
  options: {
    players: Array<{ id: string; name: string }>;
    boneyardMode: "draw_one" | "draw_until";
    seriesLength: 3 | 5 | 7;
    targetScore: number;
  },
): SeededReport {
  const config = {
    boneyardMode: options.boneyardMode,
    seriesLength: options.seriesLength,
    targetScore: options.targetScore,
  };
  let match = createMatch(options.players, config);
  const hands: SeededReport["hands"] = [];
  let dominoes = 0;
  let locks = 0;
  let leadChecks = 0;
  let crossedGame = false;
  let scoredFive = false;
  let scoredTen = false;
  let sawSpinnerOpen = false;
  let guard = 0;

  while (match.phase !== "series_over" && guard < 4000) {
    guard += 1;
    if (!match.hand || match.hand.phase === "complete") {
      const expectedLeader = match.nextLeaderId;
      const freshGame = match.hand === null || Boolean(match.lastHand?.gameWinnerId);
      const seed = namedSeed(seedNumber, hands.length);
      const deck = shuffleWithSeed(seed);
      match = beginHand(match, deck);
      if (freshGame) {
        expect(match.hand?.openingTileId).not.toBeNull();
        if (match.handNumber === 1 && match.gameNumber > 1) crossedGame = true;
      } else if (expectedLeader) {
        leadChecks += 1;
        expect(match.hand?.leaderId).toBe(expectedLeader);
        expect(match.hand?.openingTileId).toBeNull();
      }
      hands.push({ seed, deck, actions: [] });
      expect(new Set(conservedTiles(match)).size).toBe(28);
      continue;
    }

    const playerId = match.players[match.hand.turnIndex]!.id;
    const intents = legalIntents(match, playerId);
    expect(intents.length).toBeGreaterThan(0);
    const intent = intents[(seedNumber + guard) % intents.length]!;
    const beforeScores = { ...match.scores };
    const result = applyIntent(match, playerId, intent);
    expect(result.ok, result.error).toBe(true);
    match = result.match;
    hands[hands.length - 1]!.actions.push({ playerId, intent });
    expect(new Set(conservedTiles(match)).size).toBe(28);
    expect(conservedTiles(match)).toHaveLength(28);

    if (intent.type === "play" && match.lastPlay) {
      const total = match.lastPlay.total;
      const awarded = total >= 10 && total % 5 === 0 ? total : 0;
      expect(match.lastPlay.awarded).toBe(awarded);
      if (total === 5) scoredFive = true;
      if (awarded >= 10) scoredTen = true;
      const leftover =
        match.hand?.phase === "complete" ? (match.lastHand?.leftoverAwards[playerId] ?? 0) : 0;
      expect(match.scores[playerId]).toBe((beforeScores[playerId] ?? 0) + awarded + leftover);
    }
    if (match.hand?.board.spinnerOpen) sawSpinnerOpen = true;

    if (match.hand?.phase === "complete" && match.lastHand) {
      const resultHand = match.lastHand;
      expect(resultHand.placements).toHaveLength(match.players.length);
      expect(resultHand.remaining).toHaveLength(match.players.length);
      if (resultHand.reason === "domino") {
        dominoes += 1;
        const award = scoreDomino(resultHand.pipCounts, resultHand.winnerIds[0]!)[
          resultHand.winnerIds[0]!
        ];
        expect(resultHand.leftoverAwards[resultHand.winnerIds[0]!]).toBe(award);
        expect(award % 5).toBe(0);
      } else if (resultHand.reason === "locked") {
        locks += 1;
        for (const award of Object.values(resultHand.leftoverAwards)) expect(award % 5).toBe(0);
        if (resultHand.winnerIds.length > 1) {
          const handsNow = match.hand.hands;
          const locked = scoreLocked(handsNow);
          expect(resultHand.nextLeaderId).toBe(locked.nextLeaderId);
          expect(resultHand.leftoverAwards).toEqual(locked.awards);
        }
      } else {
        expect(resultHand.reason).toBe("score");
        expect(resultHand.gameWinnerId).toBeTruthy();
        for (const award of Object.values(resultHand.leftoverAwards)) expect(award).toBe(0);
      }
    }
  }

  return {
    players: options.players,
    config,
    hands,
    final: match,
    finished: match.phase === "series_over",
    dominoes,
    locks,
    leadChecks,
    crossedGame,
    scoredFive,
    scoredTen,
    sawSpinnerOpen,
  };
}

function namedSeed(series: number, hand: number): Buffer {
  const seed = Buffer.alloc(32);
  seed.writeUInt32BE(series + 1, 0);
  seed.writeUInt32BE(hand + 1, 4);
  return seed;
}

function metaOf(match: MatchState, youId: string): TableMeta {
  return {
    roomCode: "TEST",
    hostId: match.players[0]!.id,
    status: "playing",
    seats: match.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: true,
      bot: false,
      difficulty: null,
    })),
    settings: {
      playerCount: match.players.length as 2 | 3 | 4,
      boneyardMode: match.config.boneyardMode,
      seriesLength: match.config.seriesLength,
    },
    youId,
  };
}
