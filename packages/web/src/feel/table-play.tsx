import { useEffect, useMemo, useState } from "react";
import { attachAudioTap, getAudioContext } from "../audio-context";
import { unlockSound } from "../sound";
import type { PlayerView } from "@uhoh/rules";
import { emptyBoard, openEnds, openScore, placeTile, type BoardState } from "../../../rules/src/board.js";
import { scoreDomino, scoreLocked } from "../../../rules/src/score.js";
import { tileById } from "../../../rules/src/tiles.js";

/** Real-table debug reel. Off unless the page is opened with ?feel=play, hit, or seats. */
export function feelTableRequested(): boolean {
  const feel = new URLSearchParams(location.search).get("feel");
  return feel === "play" || feel === "hit" || feel === "seats" || feel === "pass";
}

export function feelPassRequested(): boolean {
  return new URLSearchParams(location.search).get("feel") === "pass";
}

export function feelHitRequested(): boolean {
  return new URLSearchParams(location.search).get("feel") === "hit";
}

export function feelSeatsRequested(): boolean {
  return new URLSearchParams(location.search).get("feel") === "seats";
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

/** A turned arm, far from the scorer's hand. The last tile is the +25. */
const FAR_BEFORE: Step[] = [
  ["lead", "3-3"],
  ["west", "3-5"],
  ["east", "3-4"],
  ["east", "4-4"],
  ["north", "0-3"],
  ["north", "0-1"],
  ["north", "1-2"],
  ["north", "0-2"],
  ["north", "0-6"],
  ["north", "1-6"],
  ["north", "1-4"],
  ["north", "4-6"],
];
const FAR_AFTER: Step[] = [...FAR_BEFORE, ["north", "6-6"]];

/** Long arms toward the top, left, and right seats, plus a south run. */
const CROWD: Step[] = [
  ["lead", "6-6"],
  ["west", "0-6"],
  ["east", "1-6"],
  ["north", "2-6"],
  ["east", "0-1"],
  ["west", "0-0"],
  ["south", "3-6"],
  ["north", "0-2"],
  ["east", "0-3"],
  ["west", "0-4"],
  ["south", "1-3"],
  ["north", "0-5"],
  ["east", "2-3"],
  ["west", "1-4"],
  ["south", "1-1"],
  ["north", "1-5"],
  ["east", "1-2"],
];

/**
 * Ends of this chain sit farther apart than a phone or a Fold inner can
 * show at the readable floor, so follow has to drop an arm.
 */
const LONG: Step[] = [
  ["lead", "6-6"],
  ["west", "1-6"],
  ["east", "2-6"],
  ["north", "3-6"],
  ["south", "4-6"],
  ["north", "0-3"],
  ["north", "0-1"],
  ["north", "1-2"],
  ["south", "0-4"],
  ["south", "0-2"],
  ["south", "2-3"],
  ["north", "2-4"],
  ["north", "4-4"],
  ["east", "2-2"],
  ["south", "1-3"],
  ["south", "1-1"],
  ["west", "1-4"],
  ["west", "3-4"],
  ["west", "3-5"],
  ["west", "0-5"],
  ["west", "0-6"],
  ["west", "5-6"],
  ["west", "1-5"],
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

function players(scores: Cast, counts: Cast, turn: keyof Cast, gamesWon = 0, seats = 4): PlayerView["players"] {
  const row: Array<[keyof Cast, string, string]> = [
    ["you", "Alex", "2hot4tv"],
    ["rio", "Rio", "surfer"],
    ["sam", "Sam", "hipster"],
    ["jordan", "Jordan", "golfer"],
  ];
  return row.slice(0, seats).map(([id, name, avatar], index) => ({
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
  seats?: number;
  play?: { playerId: string; tileId: string; endId: string; awarded: number; seq: number } | null;
  plays?: PlayerView["legalPlays"];
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
    settings: { playerCount: input.seats ?? 4, boneyardMode: "draw_until", seriesLength: 3, targetScore: 150, casual: true },
    players: players(input.scores, input.counts, input.turn, input.gamesWon ?? 0, input.seats ?? 4),
    you: { hand: faces(input.hand) },
    board,
    openEnds: openEnds(board).map((end) => ({ id: end.id, match: end.match, scorePips: end.scorePips })),
    openTotal: scored.total,
    openEquation: scored.equation,
    boneyardCount: 8,
    turnPlayerId: input.turn,
    lastDominoId: null,
    lastDominoKey: null,
    phase: input.phase ?? "play",
    turnDeadline: input.between ? null : now + 24_000,
    turnBudgetMs: 30_000,
    serverNow: now,
    betweenHands: input.between ?? false,
    continueDeadline: input.between ? now + 20_000 : null,
    ended: null,
    prompt: "",
    legalPlays: input.plays ?? [],
    easyPractice: false,
    botGames: 0,
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

function hitBeats(): FeelBeat[] {
  const params = new URLSearchParams(location.search);
  const far = params.get("arm") === "far";
  const kind = params.get("kind") === "domino" ? "domino" : params.get("kind") === "score" ? "score" : "rare";
  const scores: Cast = { you: 20, rio: 35, sam: 15, jordan: 10 };
  const counts: Cast = { you: 4, rio: 4, sam: 4, jordan: 4 };
  if (kind === "domino") {
    const chain = far ? FAR_AFTER : DOMINO_BOARD;
    const tileId = far ? "6-6" : "2-6";
    const before = makeView({
      chain: far ? FAR_BEFORE : DOMINO_BOARD.slice(0, 3),
      hand: [tileId],
      scores,
      counts: { ...counts, you: 1 },
      turn: "you",
      handNumber: 2,
    });
    const after = makeView({
      chain,
      hand: [],
      scores,
      counts: { you: 0, rio: 2, sam: 1, jordan: 1 },
      turn: "you",
      handNumber: 2,
      phase: "between",
      between: true,
      play: { playerId: "you", tileId, endId: "north", awarded: 0, seq: 8 },
      lastHand: dominoHand(false),
    });
    return [
      { at: 0, scene: "before", view: before },
      { at: 500, scene: "domino", view: after },
    ];
  }
  const beforeChain = far ? FAR_BEFORE : kind === "score" ? AFTER_PLAY : BEFORE_25;
  const afterChain = far ? FAR_AFTER : kind === "score" ? AFTER_10 : AFTER_25;
  const tileId = far ? "6-6" : kind === "score" ? "5-5" : "2-5";
  const endId = far ? "north" : kind === "score" ? "west" : "south";
  const awarded = kind === "score" ? 10 : 25;
  const hand = far ? ["6-6", "5-5", "4-4"] : kind === "score" ? ["5-5", "2-5", "4-6", "4-4"] : ["2-5", "4-6", "4-4", "3-6"];
  const before = makeView({
    chain: beforeChain,
    hand,
    scores,
    counts: { ...counts, you: hand.length },
    turn: "you",
    handNumber: 1,
  });
  const afterHand = hand.filter((id) => id !== tileId);
  const after = makeView({
    chain: afterChain,
    hand: afterHand,
    scores: { ...scores, you: scores.you + awarded },
    counts: { ...counts, you: afterHand.length },
    turn: "you",
    handNumber: 1,
    play: { playerId: "you", tileId, endId, awarded, seq: 8 },
  });
  return [
    { at: 0, scene: "before", view: before },
    { at: 500, scene: awarded >= 20 ? "score25" : "score10", view: after },
  ];
}

/** Static real table with a chain pressed toward every opponent. */
export function crowdView(): PlayerView {
  const params = new URLSearchParams(location.search);
  const seats = params.get("players") === "2" ? 2 : 4;
  const long = params.get("chain") === "long";
  return makeView({
    chain: long ? LONG : CROWD,
    hand: long ? ["4-5"] : ["5-5"],
    scores: { you: 15, rio: 40, sam: 22, jordan: 10 },
    counts: { you: 1, rio: 4, sam: 5, jordan: 4 },
    turn: "you",
    handNumber: 1,
    seats,
    plays: long ? [{ tileId: "4-5", endId: "north", points: 0 }] : [],
  });
}

const SEATS: Array<keyof Cast> = ["you", "rio", "sam", "jordan"];

/** Ordinary growth, then a score, a lock, and a domino that crosses the target. */
export function passBeats(): FeelBeat[] {
  const beats: FeelBeat[] = [];
  const scores: Cast = { you: 20, rio: 35, sam: 15, jordan: 10 };
  const counts: Cast = { you: 5, rio: 5, sam: 4, jordan: 4 };
  for (let index = 1; index <= CROWD.length; index += 1) {
    const chain = CROWD.slice(0, index);
    const step = chain[index - 1]!;
    const actor = SEATS[(index - 1) % SEATS.length]!;
    const at = (index - 1) * 1400;
    beats.push({
      at,
      scene: index === CROWD.length ? "chain" : "grow",
      view: makeView({
        chain,
        hand: ["5-5", "4-4"],
        scores,
        counts,
        turn: SEATS[index % SEATS.length]!,
        handNumber: 1,
        play: { playerId: actor, tileId: step[1], endId: step[0], awarded: 0, seq: index },
      }),
    });
  }
  const base = CROWD.length * 1400;
  const drama = feelBeats().filter((beat) => beat.scene !== "table");
  const shift = base - (drama[0]?.at ?? 0);
  for (const beat of drama) {
    beats.push({ ...beat, at: beat.at + shift });
  }
  return beats;
}

export function useFeelPlay(): FeelBeat {
  const beats = useMemo(() => (feelHitRequested() ? hitBeats() : feelPassRequested() ? passBeats() : feelBeats()), []);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("audio") !== "1") return;
    let dead = false;
    let rec: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    const start = () => {
      if (dead || rec) return;
      unlockSound();
      const ctx = getAudioContext();
      if (!ctx || ctx.state !== "running" || typeof MediaRecorder === "undefined") return;
      rec = new MediaRecorder(attachAudioTap(ctx));
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      rec.start(250);
    };
    start();
    const timer = window.setInterval(start, 200);
    const host = window as unknown as { __uhohAudio?: () => Promise<string> };
    host.__uhohAudio = () =>
      new Promise((resolve) => {
        const finish = () => {
          const blob = new Blob(chunks, { type: rec?.mimeType || "audio/webm" });
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.readAsDataURL(blob);
        };
        if (rec && rec.state !== "inactive") {
          rec.onstop = finish;
          rec.stop();
        } else finish();
      });
    return () => {
      dead = true;
      window.clearInterval(timer);
      delete host.__uhohAudio;
    };
  }, [beats]);
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
