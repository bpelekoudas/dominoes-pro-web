import { openEnds, openEquation, openTotal, type BoardState } from "./board.js";
import { winsNeeded } from "./score.js";
import { tauntsForPlayer, type AvailableTaunt } from "./taunts.js";
import { tileById } from "./tiles.js";
import type { BotDifficulty } from "./bot.js";
import {
  currentPlayerId,
  legalIntents,
  type BoneyardMode,
  type HandResult,
  type LastDraw,
  type LastPlay,
  type MatchState,
  type SeriesLength,
} from "./engine.js";

export interface TileFace {
  id: string;
  low: number;
  high: number;
}

export interface OpenEndView {
  id: string;
  match: number;
  scorePips: number;
}

export interface PlayerView {
  roomCode: string;
  status: "lobby" | "playing" | "complete";
  yourId: string;
  hostId: string;
  settings: {
    playerCount: number;
    boneyardMode: BoneyardMode;
    seriesLength: SeriesLength;
    targetScore: number;
  };
  players: Array<{
    id: string;
    name: string;
    seat: number;
    connected: boolean;
    score: number;
    gamesWon: number;
    tileCount: number;
    isYou: boolean;
    isTurn: boolean;
    bot: boolean;
    difficulty: BotDifficulty | null;
  }>;
  you: { hand: TileFace[] };
  board: BoardState | null;
  openEnds: OpenEndView[];
  openTotal: number;
  openEquation: string | null;
  boneyardCount: number;
  turnPlayerId: string | null;
  phase: "lobby" | "play" | "draw" | "knock" | "over";
  prompt: string;
  legalPlays: Array<{ tileId: string; endId: string }>;
  canDraw: boolean;
  canKnock: boolean;
  canStart: boolean;
  canRematch: boolean;
  openingTileId: string | null;
  gameNumber: number;
  handNumber: number;
  winsNeeded: number;
  seriesWinnerId: string | null;
  lastHand: Pick<
    HandResult,
    "summary" | "reason" | "gameWinnerId" | "scoresAfter" | "gameNumber" | "handNumber"
  > | null;
  lastPlay: LastPlay | null;
  lastDraw: { playerId: string; count: number; tileIds: string[] | null } | null;
  taunts: AvailableTaunt[];
}

export interface TableSeat {
  id: string;
  name: string;
  connected: boolean;
  bot: boolean;
  difficulty: BotDifficulty | null;
}

export interface TableMeta {
  roomCode: string;
  hostId: string;
  status: "lobby" | "playing" | "complete";
  seats: TableSeat[];
  settings: {
    playerCount: 2 | 3 | 4;
    boneyardMode: BoneyardMode;
    seriesLength: SeriesLength;
  };
  youId: string;
}

const EMPTY_DRAW: LastDraw | null = null;

export function project(match: MatchState | null, meta: TableMeta): PlayerView {
  const targetScore = match?.config.targetScore ?? 150;
  const turnPlayerId = match ? currentPlayerId(match) : null;
  const intents = match ? legalIntents(match, meta.youId) : [];
  const legalPlays: Array<{ tileId: string; endId: string }> = [];
  for (const intent of intents) {
    if (intent.type === "play") legalPlays.push({ tileId: intent.tileId, endId: intent.endId });
  }
  const handTiles = match?.hand?.hands[meta.youId] ?? [];
  const youHand = handTiles
    .map((id) => tileById(id))
    .sort((a, b) => b.high - a.high || b.low - a.low)
    .map((tile) => ({ id: tile.id, low: tile.low, high: tile.high }));

  const board = match?.hand ? structuredClone(match.hand.board) : null;
  const ends = board?.center ? openEnds(board) : [];
  const status = match?.phase === "series_over" ? "complete" : meta.status;
  const phase = viewPhase(match, meta, turnPlayerId);
  const lastDraw = privateDraw(match?.lastDraw ?? EMPTY_DRAW, meta.youId);

  return {
    roomCode: meta.roomCode,
    status,
    yourId: meta.youId,
    hostId: meta.hostId,
    settings: {
      playerCount: meta.settings.playerCount,
      boneyardMode: meta.settings.boneyardMode,
      seriesLength: meta.settings.seriesLength,
      targetScore,
    },
    players: meta.seats.map((seat, seatIndex) => ({
      id: seat.id,
      name: seat.name,
      seat: seatIndex,
      connected: seat.connected,
      score: match?.scores[seat.id] ?? 0,
      gamesWon: match?.gamesWon[seat.id] ?? 0,
      tileCount: match?.hand?.hands[seat.id]?.length ?? 0,
      isYou: seat.id === meta.youId,
      isTurn: seat.id === turnPlayerId,
      bot: seat.bot,
      difficulty: seat.difficulty,
    })),
    you: { hand: youHand },
    board,
    openEnds: ends.map((end) => ({ id: end.id, match: end.match, scorePips: end.scorePips })),
    openTotal: board?.center ? openTotal(board) : 0,
    openEquation: board?.center ? openEquation(board) : null,
    boneyardCount: match?.hand?.boneyard.length ?? 0,
    turnPlayerId,
    phase,
    prompt: promptFor(match, meta, phase, turnPlayerId),
    legalPlays,
    canDraw: intents.some((intent) => intent.type === "draw"),
    canKnock: intents.some((intent) => intent.type === "knock"),
    canStart:
      meta.status === "lobby" &&
      meta.youId === meta.hostId &&
      meta.seats.length === meta.settings.playerCount,
    canRematch: status === "complete" && meta.youId === meta.hostId,
    openingTileId:
      match?.hand?.leaderId === meta.youId ? (match.hand.openingTileId ?? null) : null,
    gameNumber: match?.gameNumber ?? 0,
    handNumber: match?.handNumber ?? 0,
    winsNeeded: winsNeeded(meta.settings.seriesLength),
    seriesWinnerId: match?.seriesWinnerId ?? null,
    lastHand: match?.lastHand
      ? {
          summary: match.lastHand.summary,
          reason: match.lastHand.reason,
          gameWinnerId: match.lastHand.gameWinnerId,
          scoresAfter: match.lastHand.scoresAfter,
          gameNumber: match.lastHand.gameNumber,
          handNumber: match.lastHand.handNumber,
        }
      : null,
    lastPlay: match?.lastPlay ?? null,
    lastDraw,
    taunts: tauntsForPlayer(),
  };
}

function privateDraw(draw: LastDraw | null, viewerId: string): PlayerView["lastDraw"] {
  if (!draw) return null;
  return {
    playerId: draw.playerId,
    count: draw.tileIds.length,
    tileIds: draw.playerId === viewerId ? [...draw.tileIds] : null,
  };
}

function viewPhase(
  match: MatchState | null,
  meta: TableMeta,
  turnPlayerId: string | null,
): PlayerView["phase"] {
  if (!match || meta.status === "lobby") return "lobby";
  if (match.phase === "series_over") return "over";
  if (!match.hand || match.hand.phase === "complete") return "over";
  if (turnPlayerId !== meta.youId) return "play";
  if (match.hand.phase === "await_draw") return "draw";
  if (match.hand.phase === "await_knock") return "knock";
  return "play";
}

function promptFor(
  match: MatchState | null,
  meta: TableMeta,
  phase: PlayerView["phase"],
  turnPlayerId: string | null,
): string {
  if (!match || phase === "lobby") {
    const waiting = meta.settings.playerCount - meta.seats.length;
    if (waiting > 0) {
      return waiting === 1 ? "Waiting for 1 more player." : `Waiting for ${waiting} more players.`;
    }
    if (meta.youId === meta.hostId) return "Everyone's here. Start when you're ready.";
    return "Waiting for the host to start.";
  }
  if (match.phase === "series_over") return match.lastHand?.summary ?? "The series is over.";
  if (phase === "draw") {
    return match.config.boneyardMode === "draw_one"
      ? "Nothing fits. Draw one tile."
      : "Nothing fits. Draw until you can play.";
  }
  if (phase === "knock") return "Nothing fits, and the boneyard is empty. Knock.";
  if (turnPlayerId === meta.youId) {
    const opening = match.hand?.openingTileId;
    if (opening && !match.hand?.board.center) {
      const tile = tileById(opening);
      const name = tile.low === tile.high ? `double ${tile.high}` : `${tile.high}–${tile.low}`;
      return `You lead. Play the ${name}.`;
    }
    return "Your turn.";
  }
  const seat = meta.seats.find((candidate) => candidate.id === turnPlayerId);
  const name = seat?.bot ? `${seat.name} (computer)` : (seat?.name ?? "Someone");
  return `${name}'s turn.`;
}
