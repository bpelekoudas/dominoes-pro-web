import { describe, expect, it } from "vitest";
import { tilesOnBoard } from "./board.js";
import { chooseBotIntent, type BotDifficulty } from "./bot.js";
import {
  applyIntent,
  arrangeDeck,
  beginHand,
  createMatch,
  currentPlayerId,
  legalIntents,
  type BoneyardMode,
  type MatchState,
} from "./engine.js";
import { shuffleWithSeed } from "./rng.js";
import { winsNeeded } from "./score.js";
import { allTileIds } from "./tiles.js";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedBuf(n: number): Buffer {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(n >>> 0, 0);
  buf.writeUInt32BE(0x0b07, 4);
  buf.writeUInt32BE((n * 17) >>> 0, 8);
  return buf;
}

function conserved(match: MatchState): boolean {
  const hand = match.hand;
  if (!hand) return true;
  const ids = [
    ...hand.boneyard,
    ...tilesOnBoard(hand.board),
    ...Object.values(hand.hands).flat(),
  ];
  return ids.length === 28 && new Set(ids).size === 28;
}

function playSeries(
  playerCount: 2 | 3 | 4,
  mode: BoneyardMode,
  difficulty: BotDifficulty,
  seed: number,
  targetScore = 150,
): void {
  const names = ["Bones", "Pips", "Lucky", "Ace"];
  const players = Array.from({ length: playerCount }, (_, index) => ({
    id: `p${index}`,
    name: names[index] ?? `Seat ${index}`,
  }));
  let match = createMatch(players, {
    boneyardMode: mode,
    seriesLength: 3,
    targetScore,
  });
  const rng = mulberry32(seed);
  let moves = 0;
  let deals = 0;
  while (match.phase !== "series_over") {
    if (!match.hand || match.hand.phase === "complete") {
      deals += 1;
      match = beginHand(match, shuffleWithSeed(seedBuf(seed * 100003 + deals)));
    }
    const playerId = currentPlayerId(match);
    if (!playerId) throw new Error("The hand has no player to move.");
    const intent = chooseBotIntent(match, playerId, difficulty, rng);
    if (!intent) throw new Error(`${playerId} had no legal move.`);
    const result = applyIntent(match, playerId, intent);
    if (!result.ok) throw new Error(result.error ?? "The computer's move was rejected.");
    match = result.match;
    expect(conserved(match)).toBe(true);
    for (const score of Object.values(match.scores)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score % 5).toBe(0);
    }
    if (match.lastPlay) {
      const awarded = match.lastPlay.awarded;
      expect(awarded === 0 || (awarded >= 10 && awarded % 5 === 0)).toBe(true);
    }
    moves += 1;
    if (moves > 8000) throw new Error(`Still playing after ${moves} moves.`);
  }
  expect(deals).toBeGreaterThan(0);
  expect(match.seriesWinnerId).toBeTruthy();
  expect(match.gamesWon[match.seriesWinnerId ?? ""]).toBeGreaterThanOrEqual(winsNeeded(3));
}

describe("computer players", () => {
  it("takes a score instead of a heavier tile that scores nothing", () => {
    const hands = {
      a: ["0-0", "1-1", "2-2", "3-3", "4-4", "5-5", "6-6"],
      b: ["5-6", "4-6", "3-6", "0-1", "0-2", "1-2", "1-4"],
    };
    const used = new Set([...hands.a, ...hands.b]);
    const boneyard = allTileIds().filter((id) => !used.has(id));
    let match = createMatch(
      [
        { id: "a", name: "Ada" },
        { id: "b", name: "Bones" },
      ],
      { boneyardMode: "draw_one", seriesLength: 3, targetScore: 150 },
    );
    match = beginHand(match, arrangeDeck(["a", "b"], hands, boneyard));
    const lead = applyIntent(match, "a", { type: "play", tileId: "6-6", endId: "lead" });
    expect(lead.ok).toBe(true);
    match = lead.match;
    const intent = chooseBotIntent(match, "b", "medium", () => 0.4);
    expect(intent).toMatchObject({ type: "play", tileId: "3-6" });
  });

  it("expert plays the same tile when hidden hands are swapped", () => {
    const players = [
      { id: "a", name: "Ada" },
      { id: "b", name: "Bones" },
      { id: "c", name: "Pips" },
    ];
    let match = createMatch(players, { boneyardMode: "draw_until", seriesLength: 3, targetScore: 150 });
    match = beginHand(match, shuffleWithSeed(seedBuf(99)));
    const leader = currentPlayerId(match);
    if (!leader || !match.hand) throw new Error("No lead.");
    const lead = legalIntents(match, leader).find((intent) => intent.type === "play");
    if (!lead || lead.type !== "play") throw new Error("No opening tile.");
    const opening = applyIntent(match, leader, lead);
    expect(opening.ok).toBe(true);
    match = opening.match;
    const actor = currentPlayerId(match);
    if (!actor || !match.hand) throw new Error("No reply.");
    const before = chooseBotIntent(match, actor, "expert", () => 0.2);
    const swapped = structuredClone(match);
    const others = swapped.players.filter((player) => player.id !== actor).map((player) => player.id);
    const bag = [
      ...others.flatMap((id) => swapped.hand?.hands[id] ?? []),
      ...(swapped.hand?.boneyard ?? []),
    ];
    bag.reverse();
    let cursor = 0;
    for (const id of others) {
      const size = swapped.hand?.hands[id]?.length ?? 0;
      swapped.hand!.hands[id] = bag.slice(cursor, cursor + size);
      cursor += size;
    }
    swapped.hand!.boneyard = bag.slice(cursor);
    const after = chooseBotIntent(swapped, actor, "expert", () => 0.2);
    expect(after).toEqual(before);
  });

  const counts = [2, 3, 4] as const;
  const modes = ["draw_one", "draw_until"] as const;
  const levels = ["easy", "medium", "hard", "expert"] as const;

  for (const count of counts) {
    for (const mode of modes) {
      for (const level of levels) {
        it(
          `finishes a ${count}-player ${mode} series on ${level}`,
          () => {
            const seed =
              count * 1000 +
              (mode === "draw_one" ? 10 : 20) +
              (level === "easy" ? 1 : level === "medium" ? 2 : level === "hard" ? 3 : 4);
            playSeries(count, mode, level, seed, level === "hard" || level === "expert" ? 60 : 150);
          },
          120_000,
        );
      }
    }
  }

  function duel(better: BotDifficulty, worse: BotDifficulty, games: number, targetScore: number): [number, number] {
    let betterWins = 0;
    let worseWins = 0;
    for (let game = 0; game < games; game += 1) {
      const pair = Math.floor(game / 2);
      const seats: BotDifficulty[] = game % 2 === 0 ? [better, worse] : [worse, better];
      const players = seats.map((level, index) => ({ id: `p${index}`, name: level }));
      const levelOf = new Map(seats.map((level, index) => [`p${index}`, level]));
      let match = createMatch(players, {
        boneyardMode: pair % 2 === 0 ? "draw_until" : "draw_one",
        seriesLength: 3,
        targetScore,
      });
      const rng = mulberry32(8000 + pair * 17 + (game % 2));
      let moves = 0;
      let deals = 0;
      while (!match.lastHand?.gameWinnerId && moves < 2500) {
        if (!match.hand || match.hand.phase === "complete") {
          deals += 1;
          match = beginHand(match, shuffleWithSeed(seedBuf(9000 + pair * 100 + deals)));
        }
        const playerId = currentPlayerId(match);
        if (!playerId) break;
        const intent = chooseBotIntent(match, playerId, levelOf.get(playerId) ?? "medium", rng);
        if (!intent) throw new Error(`${playerId} had no move`);
        const result = applyIntent(match, playerId, intent);
        if (!result.ok) throw new Error(result.error ?? "rejected");
        match = result.match;
        moves += 1;
      }
      const winner = match.lastHand?.gameWinnerId;
      const winnerLevel = winner ? levelOf.get(winner) : undefined;
      if (winnerLevel === better) betterWins += 1;
      else if (winnerLevel === worse) worseWins += 1;
    }
    return [betterWins, worseWins];
  }

  it(
    "expert wins more games than hard, then medium, then easy",
    () => {
      const pairs: [BotDifficulty, BotDifficulty][] = [
        ["expert", "hard"],
        ["hard", "medium"],
        ["medium", "easy"],
      ];
      const tally: Record<BotDifficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
      for (const [better, worse] of pairs) {
        const [won, lost] = duel(better, worse, 24, 40);
        expect(won, `${better} beat ${worse} ${won}-${lost}`).toBeGreaterThan(lost);
        tally[better] += won;
        tally[worse] += lost;
        console.log("bot duel", better, won, worse, lost);
      }
      console.log("bot win rates", JSON.stringify(tally));
    },
    120_000,
  );
});
