import { emptyBoard, openScore, placeTile, type BoardState } from "./board.js";
import { applyIntent, createMatch, currentPlayerId, legalIntents, type MatchState } from "./engine.js";
import { allTileIds, tileById } from "./tiles.js";

/** Soak-only deals. A normal table never asks for one. */
export type SoakFixture = "empty-knock" | "score-reel";

export function cleanSoakFixture(input: unknown): SoakFixture | null {
  if (input === "empty-knock" || input === "score-reel") return input;
  return input == null || input === "" ? null : null;
}

/** True when the client sent a fixture field that is not one of the two soak deals. */
export function unknownSoakFixture(input: unknown): boolean {
  if (input == null || input === "") return false;
  return cleanSoakFixture(input) == null;
}

/**
 * The human is to knock, the boneyard is empty, and the next seat can play.
 * Nothing about this depends on the shuffle.
 */
export function emptyBoneyardKnock(match: MatchState): MatchState {
  const human = match.players[0];
  const next = match.players[1];
  if (!human || !next) throw new Error("The knock fixture needs the human and one computer.");
  const board = placeTile(emptyBoard(), "lead", tileById("0-0"));
  const hands: Record<string, string[]> = {};
  for (const player of match.players) hands[player.id] = [];
  // Every blank stays with the computer, so the human has nothing that fits the double-blank.
  hands[next.id] = allTileIds().filter((id) => id.startsWith("0-") && id !== "0-0");
  hands[human.id] = allTileIds().filter((id) => !id.startsWith("0-"));
  const dealt = new Set<string>(["0-0", ...(hands[human.id] ?? []), ...(hands[next.id] ?? [])]);
  if (dealt.size !== 28) throw new Error("The knock fixture did not use each tile once.");
  return seated(match, {
    board,
    hands,
    boneyard: [],
    turnIndex: 0,
    phase: "await_knock",
    leaderId: human.id,
  });
}

/**
 * A 2-player hand already in motion:
 * double-six, then 1-6 to the west (open total 13).
 * The human's only tile that fits is 1-3, which scores 15.
 * The computer's only reply is 2-3, which scores 0.
 * The human's last tile, 2-4, goes out, and the computer still holds 25.
 */
export function scoreReel(match: MatchState): MatchState {
  if (match.players.length !== 2) throw new Error("The score reel is a 2-player table.");
  const human = match.players[0]!;
  const computer = match.players[1]!;
  let board = placeTile(emptyBoard(), "lead", tileById("6-6"));
  board = placeTile(board, "west", tileById("1-6"));
  const humanTiles = ["1-3", "2-4"];
  const computerTiles = ["2-3", "5-5", "4-4", "2-5"];
  const used = new Set(["6-6", "1-6", ...humanTiles, ...computerTiles]);
  const boneyard = allTileIds().filter((id) => !used.has(id));
  if (used.size + boneyard.length !== 28) throw new Error("The score reel did not use each tile once.");
  const seatedMatch = seated(match, {
    board,
    hands: { [human.id]: humanTiles, [computer.id]: computerTiles },
    boneyard,
    turnIndex: 0,
    phase: "await_play",
    leaderId: human.id,
  });
  const open = openScore(seatedMatch.hand!.board);
  if (open.total !== 13 || open.awarded !== 0) {
    throw new Error("The score reel did not open on 1 + 12.");
  }
  return seatedMatch;
}

/** Play the reel's three forced moves. Tests and the table use the same order. */
export function playScoreReel(match: MatchState): {
  scored: MatchState;
  quiet: MatchState;
  ended: MatchState;
} {
  const human = match.players[0]!.id;
  const computer = match.players[1]!.id;
  const scored = mustPlay(match, human, "1-3", "west");
  if (scored.lastPlay?.awarded !== 15) throw new Error("The 1-3 did not score 15.");
  const quiet = mustPlay(scored, computer, "2-3", "west");
  if (quiet.lastPlay?.awarded !== 0 || quiet.lastPlay.total !== 14) {
    throw new Error("The 2-3 did not score 0 on 2 + 12.");
  }
  const ended = mustPlay(quiet, human, "2-4", "west");
  const award = ended.lastHand?.leftoverAwards[human] ?? -1;
  if (ended.hand?.phase !== "complete" || award !== 25) {
    throw new Error("Going out did not take 25.");
  }
  return { scored, quiet, ended };
}

function mustPlay(match: MatchState, playerId: string, tileId: string, endId: string): MatchState {
  const plays = legalIntents(match, playerId).filter((intent) => intent.type === "play");
  if (plays.length !== 1 || plays[0]?.tileId !== tileId || plays[0]?.endId !== endId) {
    throw new Error(`${playerId} was not forced to play ${tileId} on ${endId}.`);
  }
  const result = applyIntent(match, playerId, { type: "play", tileId, endId });
  if (!result.ok) throw new Error(result.error ?? "The fixture play was rejected.");
  if (currentPlayerId(result.match) === playerId && result.match.hand?.phase !== "complete") {
    throw new Error("The turn did not pass.");
  }
  return result.match;
}

function seated(
  match: MatchState,
  hand: {
    board: BoardState;
    hands: Record<string, string[]>;
    boneyard: string[];
    turnIndex: number;
    phase: "await_play" | "await_knock";
    leaderId: string;
  },
): MatchState {
  const boardPoints: Record<string, number> = {};
  for (const player of match.players) boardPoints[player.id] = 0;
  return {
    ...match,
    gameNumber: Math.max(1, match.gameNumber),
    handNumber: Math.max(1, match.handNumber),
    phase: "in_hand",
    playSeq: 0,
    lastPlay: null,
    lastDraw: null,
    lastHand: null,
    log: [],
    hand: {
      deck: allTileIds(),
      hands: hand.hands,
      boneyard: hand.boneyard,
      board: hand.board,
      turnIndex: hand.turnIndex,
      phase: hand.phase,
      openingTileId: null,
      leaderId: hand.leaderId,
      boardPoints,
      result: null,
    },
  };
}

/** A match the fixture can sit on. Seat 0 is the human. */
export function fixtureMatch(names: string[]): MatchState {
  return createMatch(
    names.map((name, index) => ({ id: `p${index}`, name })),
    { boneyardMode: "draw_until", seriesLength: 3, targetScore: 150 },
  );
}
