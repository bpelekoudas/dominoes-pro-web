import { DEFAULT_AVATAR } from "./avatars.js";
import { openEnds, openScore, placeTile, type BoardState } from "./board.js";
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
  type PublicEvent,
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

/** This viewer's grade for the game that just ended. Absent when they had no real choice. */
export interface PlayAccuracyView {
  percent: number;
  missTileId: string | null;
  missPoints: number;
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
  /** `points` is the board award for that play, before the tile is committed. */
  legalPlays: Array<{ tileId: string; endId: string; points: number }>;
  /** Casual table where every opponent is an easy computer. Score numbers are allowed only here. */
  easyPractice: boolean;
  /** Finished games this account has played against a computer. */
  botGames: number;
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
  /** Set on the game-over screen for a human who had a real choice in that game. */
  playAccuracy?: PlayAccuracyView | null;
  /** Set while a public quick table is still waiting for people. */
  quick: {
    waitUntil: number;
    canFill: boolean;
    botFillAt?: number | null;
    /** Quick Play deals with computers at this time if the seats are still open. */
    autoStartAt?: number | null;
  } | null;
  /**
   * One table skin for the whole match. Every client renders this.
   * It is the host's equipped table, or the first human's when the host is a bot.
   */
  tableId: string;
  lastPlay: LastPlay | null;
  /** Latest public action this hand. A knock is visible here even though no tile landed. */
  lastEvent: { playerId: string; kind: PublicEvent["kind"] } | null;
  /** Knocks in a row at the end of the hand log. A play or a draw resets it. */
  knockStreak: number;
  lastDraw: { playerId: string; count: number; tileIds: string[] | null } | null;
  taunts: AvailableTaunt[];
  /** Lines for challenges that just paid. Empty until a hand earns one. */
  dailyNotes?: string[];
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
  playAccuracy?: PlayAccuracyView | null;
  quick?: {
    waitUntil: number;
    canFill: boolean;
    botFillAt?: number | null;
    autoStartAt?: number | null;
  } | null;
  /** Shared table skin. The hub picks the host, never a bot while a human is seated. */
  sharedTableId?: string | null;
  youId: string;
  /** Finished computer games for the seated account. Guests count too. */
  youBotGames?: number;
  turnDeadline?: number | null;
  turnBudgetMs?: number;
  serverNow?: number;
  betweenHands?: boolean;
  continueDeadline?: number | null;
  ended?: { reason: "player_left"; playerId: string; name: string } | null;
  dailyNotes?: string[];
}

const EMPTY_DRAW: LastDraw | null = null;

/** Score numbers belong on an easy practice table, never on a ranked or human table. */
function easyTable(meta: TableMeta): boolean {
  if (meta.settings.casual !== true) return false;
  const others = meta.seats.filter((seat) => seat.id !== meta.youId);
  return others.length > 0 && others.every((seat) => seat.bot && seat.difficulty === "easy");
}

export function project(match: MatchState | null, meta: TableMeta): PlayerView {
  const targetScore = match?.config.targetScore ?? 150;
  const turnPlayerId = match ? currentPlayerId(match) : null;
  const intents = match ? legalIntents(match, meta.youId) : [];
  const legalPlays: Array<{ tileId: string; endId: string; points: number }> = [];
  const playBoard = match?.hand?.board ?? null;
  for (const intent of intents) {
    if (intent.type !== "play" || !playBoard) continue;
    const placed = placeTile(playBoard, intent.endId, tileById(intent.tileId));
    legalPlays.push({ tileId: intent.tileId, endId: intent.endId, points: openScore(placed).awarded });
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
      avatarId: seat.avatarId || DEFAULT_AVATAR,
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
    easyPractice: easyTable(meta),
    botGames: meta.youBotGames ?? 0,
    canDraw: intents.some((intent) => intent.type === "draw"),
    canKnock: intents.some((intent) => intent.type === "knock"),
    canStart:
      meta.status === "lobby" &&
      meta.youId === meta.hostId &&
      meta.seats.length === meta.settings.playerCount,
    canRematch:
      status === "complete" &&
      meta.youId === meta.hostId &&
      !meta.ended &&
      meta.seats.length === meta.settings.playerCount,
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
    playAccuracy: meta.playAccuracy ?? null,
    quick: meta.quick ?? null,
    tableId: meta.sharedTableId || "TBL-001",
    lastPlay: match?.lastPlay ?? null,
    lastEvent: match?.log.length ? { playerId: match.log[match.log.length - 1]!.playerId, kind: match.log[match.log.length - 1]!.kind } : null,
    knockStreak: knockStreakOf(match?.log ?? []),
    lastDraw,
    taunts: tauntsForPlayer(),
    dailyNotes: meta.dailyNotes ?? [],
  };
}

export function knockStreakOf(log: readonly { kind: string }[]): number {
  let streak = 0;
  for (let index = log.length - 1; index >= 0; index -= 1) {
    if (log[index]?.kind !== "knock") break;
    streak += 1;
  }
  return streak;
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
  if (turnPlayerId === meta.youId) return "Your turn.";
  const seat = meta.seats.find((candidate) => candidate.id === turnPlayerId);
  const name = seat?.bot ? `${seat.name} (computer)` : (seat?.name ?? "Someone");
  return `${name}'s turn.`;
}
