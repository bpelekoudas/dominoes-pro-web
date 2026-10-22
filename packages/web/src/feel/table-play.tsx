import { useEffect, useMemo, useState } from "react";
import type { PlayerView } from "@uhoh/rules";
import { emptyBoard, openEnds, openScore, placeTile, type BoardState } from "../../../rules/src/board.js";
import { scoreDomino, scoreLocked } from "../../../rules/src/score.js";
import { tileById } from "../../../rules/src/tiles.js";

/** Real-table debug reel. Off unless the page is opened with ?feel=play. */
export function feelTableRequested(): boolean {
  return new URLSearchParams(location.search).get("feel") === "play";
}

/**
 * Wall-clock length of the reel, from the first paint to the game-win hold.
 * The capture waits this long.
 */
export const FEEL_PLAY_END_MS = 29600;

const T = {
  table: 0,
  play: 1400,
  score10: 3000,
  score25: 4600,
  knock1: 7600,
  knock2: 8600,
  knock3: 9600,
  silence: 10600,
  lock: 11200,
  low: 12800,
  rack: 15200,
  empty: 16000,
  domino: 16800,
  hand: 17420,
  tally: 18420,
  gameRack: 21400,
  gameEmpty: 22200,
  game: 23000,
  gameWord: 27000,
} as const;

type Step = [string, string];

const OPEN: Step[] = [["lead", "0-0"]];
const AFTER_PLAY: Step[] = [
  ["lead", "0-0"],
  ["west", "0-5"],
];
const AFTER_10: Step[] = [
  ["lead", "0-0"],
  ["west", "0-5"],
  ["west", "5-5"],
];
const BEFORE_25: Step[] = [
  ...AFTER_10,
  ["east", "0-4"],
  ["east", "4-5"],
  ["north", "0-3"],
  ["north", "3-5"],
  ["south", "0-2"],
];
const AFTER_25: Step[] = [...BEFORE_25, ["south", "2-5"]];
const DOMINO_BOARD: Step[] = [
  ["lead", "6-6"],
  ["west", "4-6"],
  ["east", "5-6"],
  ["north", "2-6"],
];
const GAME_BOARD: Step[] = [
  ["lead", "1-1"],
  ["west", "1-2"],
  ["east", "0-1"],
  ["west", "2-4"],
];

function boardFrom(steps: readonly Step[]): BoardState {
  let board = emptyBoard();
  for (const [end, id] of steps) board = placeTile(board, end, tileById(id));
  return board;
}

function faces(ids: readonly string[]): PlayerView["you"]["hand"] {
  return ids.map((id) => {
    const tile = tileById(id);
    return { id: tile.id, low: tile.low, high: tile.high };
  });
}

interface Cast {
  you: number;
  rio: number;
  sam: number;
  jordan: number;
}

function players(scores: Cast, counts: Cast, turn: keyof Cast, gamesWon = 0): PlayerView["players"] {
  const row: Array<[keyof Cast, string, string]> = [
    ["you", "Alex", "2hot4tv"],
    ["rio", "Rio", "surfer"],
    ["sam", "Sam", "hipster"],
    ["jordan", "Jordan", "golfer"],
  ];
  return row.map(([id, name, avatar], index) => ({
    id,
    name,
    seat: index,
    connected: true,
    score: scores[id],
    gamesWon: id === "you" ? gamesWon : 0,
    tileCount: counts[id],
    isYou: id === "you",
    isTurn: turn === id,
    bot: id !== "you",
    accountBot: false,
    difficulty: id === "you" ? null : ("medium" as const),
    rank: null,
    avatarId: avatar,
    frameId: null,
    effectId: "glass",
    effectItemId: null,
    tileId: null,
    tileSkin: "ivory",
    tableId: "TBL-011",
  }));
}

interface HandInput {
  chain: readonly Step[];
  hand: readonly string[];
  scores: Cast;
  counts: Cast;
  turn: keyof Cast;
  handNumber: number;
  phase?: PlayerView["phase"];
  between?: boolean;
  play?: { playerId: string; tileId: string; endId: string; awarded: number; seq: number } | null;
  knock?: { playerId: string; streak: number } | null;
  lastHand?: PlayerView["lastHand"];
  gamesWon?: number;
}

function makeView(input: HandInput): PlayerView {
  const board = boardFrom(input.chain);
  const scored = openScore(board);
  const now = Date.now();
  const play = input.play;
  return {
    roomCode: "FEEL",
    status: "playing",
    yourId: "you",
    hostId: "you",
    settings: { playerCount: 4, boneyardMode: "draw_until", seriesLength: 3, targetScore: 150, casual: true },
    players: players(input.scores, input.counts, input.turn, input.gamesWon ?? 0),
    you: { hand: faces(input.hand) },
    board,
    openEnds: openEnds(board).map((end) => ({ id: end.id, match: end.match, scorePips: end.scorePips })),
    openTotal: scored.total,
    openEquation: scored.equation,
    boneyardCount: 8,
    turnPlayerId: input.turn,
    phase: input.phase ?? "play",
    turnDeadline: input.between ? null : now + 24_000,
    turnBudgetMs: 30_000,
    serverNow: now,
    betweenHands: input.between ?? false,
    continueDeadline: input.between ? now + 20_000 : null,
    ended: null,
    prompt: "",
    legalPlays: [],
    canDraw: false,
    canKnock: false,
    canStart: false,
    canRematch: false,
    openingTileId: null,
    gameNumber: 1,
    handNumber: input.handNumber,
    winsNeeded: 2,
    seriesWinnerId: null,
    lastHand: input.lastHand ?? null,
    recap: null,
    quick: null,
    tableId: "TBL-011",
    lastPlay: play
      ? { playerId: play.playerId, tileId: play.tileId, endId: play.endId, total: scored.total, awarded: play.awarded, seq: play.seq }
      : null,
    lastEvent: input.knock ? { playerId: input.knock.playerId, kind: "knock" } : play ? { playerId: play.playerId, kind: "play" } : null,
    knockStreak: input.knock?.streak ?? 0,
    lastDraw: null,
    taunts: [],
  };
}

const SCORES: Cast = { you: 20, rio: 35, sam: 15, jordan: 10 };
const COUNTS: Cast = { you: 5, rio: 5, sam: 4, jordan: 4 };
const HAND = ["5-5", "2-5", "4-6", "4-4", "3-6"];

function lockHand(): PlayerView["lastHand"] {
  const hands = {
    rio: ["6-6", "1-5"],
    sam: ["4-6", "0-1"],
    jordan: ["5-6", "4-4", "2-3"],
    you: ["3-4"],
  };
  const locked = scoreLocked(hands);
  return {
    summary: "The hand locked. Alex holds the low hand.",
    reason: "locked",
    gameWinnerId: null,
    seriesWinnerId: null,
    winnerIds: locked.winnerIds,
    nextLeaderId: locked.nextLeaderId,
    pipCounts: locked.pipCounts,
    leftoverAwards: locked.awards,
    placements: [
      { playerId: "you", place: 1, pips: 7, tied: false },
      { playerId: "sam", place: 2, pips: 11, tied: false },
      { playerId: "rio", place: 3, pips: 18, tied: false },
      { playerId: "jordan", place: 4, pips: 24, tied: false },
    ],
    remaining: (["rio", "sam", "jordan", "you"] as const).map((id) => ({
      playerId: id,
      pips: locked.pipCounts[id] ?? 0,
      tiles: faces(hands[id]),
    })),
    scoresAfter: { you: 105, rio: 35, sam: 15, jordan: 10 },
    gameNumber: 1,
    handNumber: 1,
  };
}

function dominoHand(game: boolean): PlayerView["lastHand"] {
  const pipCounts = { rio: 12, sam: 9, jordan: 6, you: 0 };
  const awards = scoreDomino(pipCounts, "you");
  const remaining = {
    rio: ["5-5", "1-1"],
    sam: ["4-5"],
    jordan: ["3-3"],
    you: [] as string[],
  };
  return {
    summary: game ? "Alex went out and won the game." : "Alex went out.",
    reason: "domino",
    gameWinnerId: game ? "you" : null,
    seriesWinnerId: null,
    winnerIds: ["you"],
    nextLeaderId: "you",
    pipCounts,
    leftoverAwards: awards,
    placements: [
      { playerId: "you", place: 1, pips: 0, tied: false },
      { playerId: "jordan", place: 2, pips: 6, tied: false },
      { playerId: "sam", place: 3, pips: 9, tied: false },
      { playerId: "rio", place: 4, pips: 12, tied: false },
    ],
    remaining: (["rio", "sam", "jordan", "you"] as const).map((id) => ({
      playerId: id,
      pips: pipCounts[id],
      tiles: faces(remaining[id]),
    })),
    scoresAfter: game
      ? { you: 155, rio: 35, sam: 15, jordan: 10 }
      : { you: 130, rio: 35, sam: 15, jordan: 10 },
    gameNumber: 1,
    handNumber: game ? 3 : 2,
  };
}

export interface FeelBeat {
  at: number;
  scene: string;
  view: PlayerView;
}

export function feelBeats(): FeelBeat[] {
  const full: Cast = { you: 4, rio: 4, sam: 4, jordan: 4 };
  const after10: Cast = { you: 30, rio: 35, sam: 15, jordan: 10 };
  const after25: Cast = { you: 55, rio: 35, sam: 15, jordan: 10 };
  const afterLock: Cast = { you: 105, rio: 35, sam: 15, jordan: 10 };
  const afterDomino: Cast = { you: 130, rio: 35, sam: 15, jordan: 10 };
  const afterGame: Cast = { you: 155, rio: 35, sam: 15, jordan: 10 };
  const lock = lockHand();
  const domino = dominoHand(false);
  const game = dominoHand(true);
  const lockView = makeView({
    chain: AFTER_25,
    hand: ["3-4"],
    scores: afterLock,
    counts: { you: 1, rio: 2, sam: 2, jordan: 3 },
    turn: "you",
    handNumber: 1,
    phase: "between",
    between: true,
    knock: { playerId: "jordan", streak: 3 },
    lastHand: lock,
  });
  const dominoView = makeView({
    chain: DOMINO_BOARD,
    hand: [],
    scores: afterDomino,
    counts: { you: 0, rio: 2, sam: 1, jordan: 1 },
    turn: "you",
    handNumber: 2,
    phase: "between",
    between: true,
    play: { playerId: "you", tileId: "2-6", endId: "north", awarded: 0, seq: 4 },
    lastHand: domino,
  });
  const gameView = makeView({
    chain: GAME_BOARD,
    hand: [],
    scores: afterGame,
    counts: { you: 0, rio: 2, sam: 1, jordan: 1 },
    turn: "you",
    handNumber: 3,
    phase: "between",
    between: true,
    play: { playerId: "you", tileId: "2-4", endId: "west", awarded: 0, seq: 5 },
    lastHand: game,
    gamesWon: 1,
  });
  const beats: Array<[number, string, PlayerView]> = [
    [T.table, "table", makeView({ chain: OPEN, hand: HAND, scores: SCORES, counts: COUNTS, turn: "you", handNumber: 1 })],
    [T.play, "play", makeView({
      chain: AFTER_PLAY,
      hand: HAND,
      scores: SCORES,
      counts: { ...COUNTS, rio: 4 },
      turn: "you",
      handNumber: 1,
      play: { playerId: "rio", tileId: "0-5", endId: "west", awarded: 0, seq: 1 },
    })],
    [T.score10, "score10", makeView({
      chain: AFTER_10,
      hand: ["2-5", "4-6", "4-4", "3-6"],
      scores: after10,
      counts: { ...full, you: 4 },
      turn: "you",
      handNumber: 1,
      play: { playerId: "you", tileId: "5-5", endId: "west", awarded: 10, seq: 2 },
    })],
    [T.score25, "score25", makeView({
      chain: AFTER_25,
      hand: ["4-6", "4-4", "3-6"],
      scores: after25,
      counts: { ...full, you: 3 },
      turn: "you",
      handNumber: 1,
      play: { playerId: "you", tileId: "2-5", endId: "south", awarded: 25, seq: 3 },
    })],
    [T.knock1, "knock1", makeView({
      chain: AFTER_25,
      hand: ["4-6", "4-4", "3-6"],
      scores: after25,
      counts: { ...full, you: 3 },
      turn: "rio",
      handNumber: 1,
      knock: { playerId: "rio", streak: 1 },
    })],
    [T.knock2, "knock2", makeView({
      chain: AFTER_25,
      hand: ["4-6", "4-4", "3-6"],
      scores: after25,
      counts: { ...full, you: 3 },
      turn: "sam",
      handNumber: 1,
      knock: { playerId: "sam", streak: 2 },
    })],
    [T.knock3, "knock3", makeView({
      chain: AFTER_25,
      hand: ["4-6", "4-4", "3-6"],
      scores: after25,
      counts: { ...full, you: 3 },
      turn: "jordan",
      handNumber: 1,
      knock: { playerId: "jordan", streak: 3 },
    })],
    [T.silence, "silence", makeView({
      chain: AFTER_25,
      hand: ["3-4"],
      scores: after25,
      counts: { you: 1, rio: 2, sam: 2, jordan: 3 },
      turn: "jordan",
      handNumber: 1,
      knock: { playerId: "jordan", streak: 3 },
    })],
    [T.lock, "lock", lockView],
    [T.low, "low", lockView],
    [T.rack, "rack", makeView({
      chain: [
        ["lead", "6-6"],
        ["west", "4-6"],
        ["east", "5-6"],
      ],
      hand: ["2-6"],
      scores: afterLock,
      counts: { you: 1, rio: 2, sam: 1, jordan: 1 },
      turn: "you",
      handNumber: 2,
    })],
    [T.empty, "empty", makeView({
      chain: DOMINO_BOARD,
      hand: [],
      scores: afterLock,
      counts: { you: 0, rio: 2, sam: 1, jordan: 1 },
      turn: "you",
      handNumber: 2,
      play: { playerId: "you", tileId: "2-6", endId: "north", awarded: 0, seq: 4 },
    })],
    [T.domino, "domino", dominoView],
    [T.hand, "hand", dominoView],
    [T.tally, "tally", dominoView],
    [T.gameRack, "game-rack", makeView({
      chain: [
        ["lead", "1-1"],
        ["west", "1-2"],
        ["east", "0-1"],
      ],
      hand: ["2-4"],
      scores: afterDomino,
      counts: { you: 1, rio: 2, sam: 1, jordan: 1 },
      turn: "you",
      handNumber: 3,
    })],
    [T.gameEmpty, "game-empty", makeView({
      chain: GAME_BOARD,
      hand: [],
      scores: afterDomino,
      counts: { you: 0, rio: 2, sam: 1, jordan: 1 },
      turn: "you",
      handNumber: 3,
      play: { playerId: "you", tileId: "2-4", endId: "west", awarded: 0, seq: 5 },
    })],
    [T.game, "game", gameView],
    [T.gameWord, "game", gameView],
  ];
  return beats.map(([at, scene, view]) => ({ at, scene, view }));
}

export function useFeelPlay(): FeelBeat {
  const beats = useMemo(() => feelBeats(), []);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    document.documentElement.dataset.feelPlay = "1";
    const timers = beats.map((beat, beatIndex) => window.setTimeout(() => setIndex(beatIndex), beat.at));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      delete document.documentElement.dataset.feelPlay;
      delete document.documentElement.dataset.feelScene;
    };
  }, [beats]);
  useEffect(() => {
    document.documentElement.dataset.feelScene = beats[index]?.scene ?? "";
  }, [beats, index]);
  return beats[index] ?? beats[0]!;
}
