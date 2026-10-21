import { openEnds, openScore, type BoardState } from "./board.js";
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

export type TierStep = "III" | "II" | "I";

/** What the table shows beside a name. Computers have none. */
export interface SeatRank {
  rating: number;
  provisional: boolean;
  tierId: string;
  tierName: string;
  step: TierStep | null;
}

export interface PointBreakdown {
  finish: number;
  win: number;
  second: number;
  moments: number;
  momentCount: number;
  streak: number;
  streakCount: number;
  firstWin: number;
  doubled: boolean;
  total: number;
}

export interface RankedPlayerRecap {
  playerId: string;
  ranked: boolean;
  ratingBefore: number | null;
  ratingAfter: number | null;
  delta: number | null;
  provisional: boolean;
  pointsEarned: number;
  pointsBefore: number;
  pointsAfter: number;
  breakdown: PointBreakdown;
  tierBeforeId: string;
  tierBeforeName: string;
  tierBeforeStep: TierStep | null;
  tierAfterId: string;
  tierAfterName: string;
  tierAfterStep: TierStep | null;
  steppedUp: boolean;
  stepFloor: number;
  nextAt: number | null;
}

/** Shown once, when a game to 150 ends or someone leaves for good. */
export interface RankRecap {
  gameNumber: number;
  ranked: boolean;
  casual: boolean;
  vsComputer: boolean;
  seasonEndsAt: string;
  players: RankedPlayerRecap[];
}

export interface PlayerView {
  roomCode: string;
  status: "lobby" | "playing" | "complete" | "abandoned";
  yourId: string;
  hostId: string;
  settings: {
    playerCount: number;
    boneyardMode: BoneyardMode;
    seriesLength: SeriesLength;
    targetScore: number;
    casual: boolean;
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
    /** Server account that plays itself. Anonymous computers stay bot without this. */
    accountBot: boolean;
    difficulty: BotDifficulty | null;
    rank: SeatRank | null;
    avatarId: string;
    frameId: string | null;
    effectId: string;
    effectItemId: string | null;
    tileId: string | null;
    tileSkin: string;
    tableId: string | null;
  }>;
  you: { hand: TileFace[] };
  board: BoardState | null;
  openEnds: OpenEndView[];
  openTotal: number;
  openEquation: string | null;
  boneyardCount: number;
  turnPlayerId: string | null;
  phase: "lobby" | "play" | "draw" | "knock" | "between" | "over";
  turnDeadline: number | null;
  turnBudgetMs: number;
  serverNow: number;
  betweenHands: boolean;
  continueDeadline: number | null;
  ended: { reason: "player_left"; playerId: string; name: string } | null;
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
  lastHand: {
    summary: string;
    reason: HandResult["reason"];
    gameWinnerId: string | null;
    seriesWinnerId: string | null;
    winnerIds: string[];
    nextLeaderId: string;
    pipCounts: Record<string, number>;
    leftoverAwards: Record<string, number>;
    placements: HandResult["placements"];
    remaining: Array<{ playerId: string; pips: number; tiles: TileFace[] }>;
    scoresAfter: Record<string, number>;
    gameNumber: number;
    handNumber: number;
  } | null;
  recap: RankRecap | null;
  /** Set while a public quick table is still waiting for people. */
  quick: { waitUntil: number; canFill: boolean; botFillAt?: number | null } | null;
  lastPlay: LastPlay | null;
  lastDraw: { playerId: string; count: number; tileIds: string[] | null } | null;
  taunts: AvailableTaunt[];
}

export interface TableSeat {
  id: string;
  name: string;
  connected: boolean;
  bot: boolean;
  accountBot?: boolean;
  difficulty: BotDifficulty | null;
  rank?: SeatRank | null;
  avatarId?: string | null;
  frameId?: string | null;
  effectId?: string | null;
  effectItemId?: string | null;
  tileId?: string | null;
  tileSkin?: string | null;
  tableId?: string | null;
}

export interface TableMeta {
  roomCode: string;
  hostId: string;
  status: "lobby" | "playing" | "complete" | "abandoned";
  seats: TableSeat[];
  settings: {
    playerCount: 2 | 3 | 4;
    boneyardMode: BoneyardMode;
    seriesLength: SeriesLength;
    casual?: boolean;
  };
  recap?: RankRecap | null;
  quick?: { waitUntil: number; canFill: boolean; botFillAt?: number | null } | null;
  youId: string;
  turnDeadline?: number | null;
  turnBudgetMs?: number;
  serverNow?: number;
  betweenHands?: boolean;
  continueDeadline?: number | null;
  ended?: { reason: "player_left"; playerId: string; name: string } | null;
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
  const scored = board?.center ? openScore(board) : null;
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
      casual: meta.settings.casual === true,
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
      accountBot: seat.accountBot === true,
      difficulty: seat.difficulty,
      rank: seat.rank ?? null,
      avatarId: seat.avatarId || "homescreen",
      frameId: seat.frameId ?? null,
      effectId: seat.effectId || "glass",
      effectItemId: seat.effectItemId ?? null,
      tileId: seat.tileId ?? null,
      tileSkin: seat.tileSkin || "ivory",
      tableId: seat.tableId ?? null,
    })),
    you: { hand: youHand },
    board,
    openEnds: ends.map((end) => ({ id: end.id, match: end.match, scorePips: end.scorePips })),
    openTotal: scored?.total ?? 0,
    openEquation: scored?.equation ?? null,
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
    canRematch: status === "complete" && meta.youId === meta.hostId && !meta.ended,
    openingTileId:
      match?.hand?.leaderId === meta.youId ? (match.hand.openingTileId ?? null) : null,
    gameNumber: match?.gameNumber ?? 0,
    handNumber: match?.handNumber ?? 0,
    winsNeeded: winsNeeded(meta.settings.seriesLength),
    seriesWinnerId: match?.seriesWinnerId ?? null,
    turnDeadline: meta.turnDeadline ?? null,
    turnBudgetMs: meta.turnBudgetMs ?? 30_000,
    serverNow: meta.serverNow ?? Date.now(),
    betweenHands: meta.betweenHands ?? false,
    continueDeadline: meta.continueDeadline ?? null,
    ended: meta.ended ?? null,
    lastHand: match?.lastHand
      ? {
          summary: match.lastHand.summary,
          reason: match.lastHand.reason,
          gameWinnerId: match.lastHand.gameWinnerId,
          seriesWinnerId: match.lastHand.seriesWinnerId,
          winnerIds: match.lastHand.winnerIds,
          nextLeaderId: match.lastHand.nextLeaderId,
          pipCounts: match.lastHand.pipCounts,
          leftoverAwards: match.lastHand.leftoverAwards,
          placements: match.lastHand.placements,
          remaining: match.lastHand.remaining.map((hand) => ({
            playerId: hand.playerId,
            pips: hand.pips,
            tiles: hand.tiles.map((id) => {
              const tile = tileById(id);
              return { id: tile.id, low: tile.low, high: tile.high };
            }),
          })),
          scoresAfter: match.lastHand.scoresAfter,
          gameNumber: match.lastHand.gameNumber,
          handNumber: match.lastHand.handNumber,
        }
      : null,
    recap: meta.recap ?? null,
    quick: meta.quick ?? null,
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
  if (meta.ended) return "over";
  if (!match || meta.status === "lobby") return "lobby";
  if (match.phase === "series_over") return "over";
  if (meta.betweenHands) return "between";
  if (!match.hand || match.hand.phase === "complete") return "between";
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
  if (meta.ended) return `Game ended - ${meta.ended.name} left`;
  if (match.phase === "series_over") return match.lastHand?.summary ?? "The series is over.";
  if (phase === "between") return "Hand over.";
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
