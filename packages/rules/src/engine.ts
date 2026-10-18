import { openEnds, openScore, placeTile, tileFits, emptyBoard, type BoardState } from "./board.js";
import { gameWinnerId, scoreDomino, scoreLocked, winsNeeded } from "./score.js";
import { allTileIds, handPips, tileById, tileLabel } from "./tiles.js";

export type BoneyardMode = "draw_one" | "draw_until";
export type SeriesLength = 3 | 5 | 7;

export interface MatchConfig {
  boneyardMode: BoneyardMode;
  seriesLength: SeriesLength;
  /**
   * Real rooms always play to 150. Tests may pass a smaller multiple of 5
   * so a series can finish. The server never takes this number from a client.
   */
  targetScore: number;
}

export interface MatchPlayer {
  id: string;
  name: string;
}

export type Intent =
  | { type: "play"; tileId: string; endId: string }
  | { type: "draw" }
  | { type: "knock" };

export interface HandResult {
  reason: "domino" | "locked";
  winnerIds: string[];
  nextLeaderId: string;
  pipCounts: Record<string, number>;
  leftoverAwards: Record<string, number>;
  boardPoints: Record<string, number>;
  scoresAfter: Record<string, number>;
  gameWinnerId: string | null;
  seriesWinnerId: string | null;
  summary: string;
  gameNumber: number;
  handNumber: number;
}

export interface LastPlay {
  playerId: string;
  tileId: string;
  endId: string;
  total: number;
  awarded: number;
  seq: number;
}

export interface LastDraw {
  playerId: string;
  tileIds: string[];
}

export interface HandState {
  deck: string[];
  hands: Record<string, string[]>;
  boneyard: string[];
  board: BoardState;
  turnIndex: number;
  phase: "await_play" | "await_draw" | "await_knock" | "complete";
  /** Set only on the first hand of a series. That tile must be the lead. */
  openingTileId: string | null;
  leaderId: string;
  boardPoints: Record<string, number>;
  result: HandResult | null;
}

export interface MatchState {
  config: MatchConfig;
  players: MatchPlayer[];
  gamesWon: Record<string, number>;
  scores: Record<string, number>;
  gameNumber: number;
  handNumber: number;
  phase: "ready" | "in_hand" | "series_over";
  hand: HandState | null;
  /** Null only before the first hand. After that, the previous deal picks the leader. */
  nextLeaderId: string | null;
  lastHand: HandResult | null;
  seriesWinnerId: string | null;
  playSeq: number;
  lastPlay: LastPlay | null;
  lastDraw: LastDraw | null;
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  match: MatchState;
}

export interface LoggedAction {
  playerId: string;
  intent: Intent;
}

export interface LoggedHand {
  deck: string[];
  actions: LoggedAction[];
}

const SERIES_LENGTHS = new Set<SeriesLength>([3, 5, 7]);

export function createMatch(players: MatchPlayer[], config: MatchConfig): MatchState {
  if (players.length < 2 || players.length > 4) {
    throw new Error("Uh Oh is played by 2 to 4 people.");
  }
  if (!SERIES_LENGTHS.has(config.seriesLength)) {
    throw new Error("A series is best of 3, 5, or 7.");
  }
  if (config.boneyardMode !== "draw_one" && config.boneyardMode !== "draw_until") {
    throw new Error("Pick a boneyard rule.");
  }
  if (!Number.isInteger(config.targetScore) || config.targetScore < 10 || config.targetScore % 5 !== 0) {
    throw new Error("The target score has to be a multiple of 5, at least 10.");
  }
  const ids = new Set<string>();
  for (const player of players) {
    if (!player.id || ids.has(player.id)) throw new Error("Every player needs their own seat.");
    ids.add(player.id);
  }
  return {
    config: { ...config },
    players: players.map((player) => ({ ...player })),
    gamesWon: zeroNumbers(players.map((player) => player.id)),
    scores: zeroNumbers(players.map((player) => player.id)),
    gameNumber: 0,
    handNumber: 0,
    phase: "ready",
    hand: null,
    nextLeaderId: null,
    lastHand: null,
    seriesWinnerId: null,
    playSeq: 0,
    lastPlay: null,
    lastDraw: null,
  };
}

export function deal(
  deck: readonly string[],
  playerIds: readonly string[],
): { hands: Record<string, string[]>; boneyard: string[] } {
  assertDeck(deck);
  const hands: Record<string, string[]> = {};
  for (const id of playerIds) hands[id] = [];
  let index = 0;
  for (let round = 0; round < 7; round += 1) {
    for (const id of playerIds) {
      hands[id]!.push(deck[index]!);
      index += 1;
    }
  }
  return { hands, boneyard: deck.slice(index) };
}

/**
 * Build a deck whose round-robin deal yields exactly these hands.
 * Useful in tests. The server always shuffles instead.
 */
export function arrangeDeck(
  playerIds: readonly string[],
  hands: Record<string, readonly string[]>,
  boneyard: readonly string[],
): string[] {
  const deck: string[] = [];
  for (let round = 0; round < 7; round += 1) {
    for (const id of playerIds) {
      const tile = hands[id]?.[round];
      if (!tile) throw new Error(`Player ${id} needs 7 tiles.`);
      deck.push(tile);
    }
  }
  deck.push(...boneyard);
  assertDeck(deck);
  return deck;
}

export function assertDeck(deck: readonly string[]): void {
  if (deck.length !== 28) throw new Error("A double-six deck has 28 tiles.");
  const seen = new Set(deck);
  if (seen.size !== 28) throw new Error("The deck has a duplicate tile.");
  for (const id of allTileIds()) {
    if (!seen.has(id)) throw new Error(`The deck is missing ${id}.`);
  }
}

/**
 * Who leads the first hand of a series, and which tile they must play.
 * 6–6 if anyone was dealt it, otherwise the highest double in any hand.
 * If no hand holds a double, the heaviest tile leads (see house rules notes).
 */
export function openingLead(hands: Record<string, readonly string[]>): {
  leaderId: string;
  tileId: string;
} {
  let bestDouble: { leaderId: string; value: number; tileId: string } | null = null;
  let bestTile: { leaderId: string; sum: number; high: number; low: number; tileId: string } | null =
    null;
  for (const [playerId, tiles] of Object.entries(hands)) {
    for (const tileId of tiles) {
      const tile = tileById(tileId);
      if (tile.low === tile.high) {
        if (!bestDouble || tile.low > bestDouble.value) {
          bestDouble = { leaderId: playerId, value: tile.low, tileId };
        }
      }
      const sum = tile.low + tile.high;
      const heavier =
        !bestTile ||
        sum > bestTile.sum ||
        (sum === bestTile.sum && tile.high > bestTile.high) ||
        (sum === bestTile.sum && tile.high === bestTile.high && tile.low > bestTile.low);
      if (heavier) {
        bestTile = { leaderId: playerId, sum, high: tile.high, low: tile.low, tileId };
      }
    }
  }
  if (bestDouble) return { leaderId: bestDouble.leaderId, tileId: bestDouble.tileId };
  if (!bestTile) throw new Error("No tiles were dealt.");
  return { leaderId: bestTile.leaderId, tileId: bestTile.tileId };
}

export function beginHand(match: MatchState, deck: string[]): MatchState {
  if (match.phase === "series_over") throw new Error("The series is over.");
  if (match.hand && match.hand.phase !== "complete") {
    throw new Error("The current hand is still going.");
  }
  assertDeck(deck);
  const playerIds = match.players.map((player) => player.id);

  let scores = match.scores;
  let gameNumber = match.gameNumber;
  let handNumber = match.handNumber;
  if (!match.hand) {
    gameNumber = 1;
    handNumber = 1;
    scores = zeroNumbers(playerIds);
  } else if (match.lastHand?.gameWinnerId) {
    gameNumber += 1;
    handNumber = 1;
    scores = zeroNumbers(playerIds);
  } else {
    handNumber += 1;
  }

  const dealt = deal(deck, playerIds);
  let leaderId: string;
  let openingTileId: string | null;
  if (match.nextLeaderId === null) {
    const opening = openingLead(dealt.hands);
    leaderId = opening.leaderId;
    openingTileId = opening.tileId;
  } else {
    leaderId = match.nextLeaderId;
    openingTileId = null;
  }
  const turnIndex = playerIds.indexOf(leaderId);
  if (turnIndex < 0) throw new Error("The leader is not sitting at this table.");

  const hand: HandState = {
    deck: [...deck],
    hands: dealt.hands,
    boneyard: dealt.boneyard,
    board: emptyBoard(),
    turnIndex,
    phase: "await_play",
    openingTileId,
    leaderId,
    boardPoints: zeroNumbers(playerIds),
    result: null,
  };

  return {
    ...match,
    scores,
    gameNumber,
    handNumber,
    phase: "in_hand",
    hand,
    lastPlay: null,
    lastDraw: null,
  };
}

export function currentPlayerId(match: MatchState): string | null {
  if (!match.hand || match.hand.phase === "complete") return null;
  return match.players[match.hand.turnIndex]?.id ?? null;
}

export function legalPlays(match: MatchState, playerId: string): Array<{ tileId: string; endId: string }> {
  const hand = match.hand;
  if (!hand || hand.phase !== "await_play") return [];
  if (currentPlayerId(match) !== playerId) return [];
  const tiles = hand.hands[playerId] ?? [];
  if (!hand.board.center) {
    const allowed = hand.openingTileId ? tiles.filter((tileId) => tileId === hand.openingTileId) : tiles;
    return allowed.map((tileId) => ({ tileId, endId: "lead" }));
  }
  const ends = openEnds(hand.board).filter((end) => end.id !== "lead");
  const plays: Array<{ tileId: string; endId: string }> = [];
  for (const tileId of tiles) {
    const tile = tileById(tileId);
    for (const end of ends) {
      if (tileFits(tile, end.match)) plays.push({ tileId, endId: end.id });
    }
  }
  return plays;
}

export function legalIntents(match: MatchState, playerId: string): Intent[] {
  const hand = match.hand;
  if (!hand || match.phase !== "in_hand" || currentPlayerId(match) !== playerId) return [];
  if (hand.phase === "await_play") {
    return legalPlays(match, playerId).map((play) => ({ type: "play", ...play }));
  }
  if (hand.phase === "await_draw") return [{ type: "draw" }];
  if (hand.phase === "await_knock") return [{ type: "knock" }];
  return [];
}

export function applyIntent(match: MatchState, playerId: string, intent: Intent): ApplyResult {
  if (!match.hand || match.phase !== "in_hand") {
    return fail(match, "There is no hand in progress.");
  }
  if (currentPlayerId(match) !== playerId) {
    return fail(match, "It's not your turn.");
  }
  if (intent.type === "play") return applyPlay(match, playerId, intent.tileId, intent.endId);
  if (intent.type === "draw") return applyDraw(match, playerId);
  if (intent.type === "knock") return applyKnock(match, playerId);
  return fail(match, "That action is not part of the game.");
}

export function replayMatch(
  players: MatchPlayer[],
  config: MatchConfig,
  hands: readonly LoggedHand[],
): MatchState {
  let match = createMatch(players, config);
  for (const hand of hands) {
    match = beginHand(match, [...hand.deck]);
    for (const action of hand.actions) {
      const result = applyIntent(match, action.playerId, action.intent);
      if (!result.ok) throw new Error(result.error ?? "Replay failed.");
      match = result.match;
    }
  }
  return match;
}

function applyPlay(match: MatchState, playerId: string, tileId: string, endId: string): ApplyResult {
  const hand = match.hand!;
  if (hand.phase !== "await_play") return fail(match, "You have to draw or knock.");
  const owned = hand.hands[playerId] ?? [];
  const index = owned.indexOf(tileId);
  if (index < 0) return fail(match, "That tile is not in your hand.");
  if (!hand.board.center && hand.openingTileId && tileId !== hand.openingTileId) {
    return fail(match, `The opening lead has to be the ${tileLabel(hand.openingTileId)}.`);
  }
  if (!hand.board.center && endId !== "lead") {
    return fail(match, "Play the opening tile onto the table.");
  }
  const allowed = legalPlays(match, playerId).some((play) => play.tileId === tileId && play.endId === endId);
  if (!allowed) return fail(match, "That tile does not fit there.");

  const board = placeTile(hand.board, endId, tileById(tileId));
  const scored = openScore(board);
  const total = scored.total;
  const awarded = scored.awarded;
  const remaining = owned.slice(0, index).concat(owned.slice(index + 1));
  const hands = { ...hand.hands, [playerId]: remaining };
  const scores = { ...match.scores, [playerId]: (match.scores[playerId] ?? 0) + awarded };
  const boardPoints = {
    ...hand.boardPoints,
    [playerId]: (hand.boardPoints[playerId] ?? 0) + awarded,
  };
  const playSeq = match.playSeq + 1;
  const advanced: MatchState = {
    ...match,
    scores,
    playSeq,
    lastPlay: { playerId, tileId, endId, total, awarded, seq: playSeq },
    lastDraw: null,
    hand: {
      ...hand,
      hands,
      board,
      boardPoints,
    },
  };

  if (remaining.length === 0) return finishDomino(advanced, playerId);
  return ok(passTurn(advanced));
}

function applyDraw(match: MatchState, playerId: string): ApplyResult {
  const hand = match.hand!;
  if (hand.phase !== "await_draw") return fail(match, "You can play a tile.");
  if (hand.boneyard.length === 0) return fail(match, "The boneyard is empty.");

  const hands = copyHands(hand.hands);
  const boneyard = [...hand.boneyard];
  const drawn: string[] = [];
  const mine = [...(hands[playerId] ?? [])];

  const takeOne = (): void => {
    const tile = boneyard.shift();
    if (!tile) return;
    mine.push(tile);
    drawn.push(tile);
    hands[playerId] = mine;
  };

  if (match.config.boneyardMode === "draw_one") {
    takeOne();
  } else {
    while (boneyard.length > 0 && !playerCanPlay(hand.board, mine, hand.openingTileId)) {
      takeOne();
    }
  }

  let next: MatchState = {
    ...match,
    lastDraw: { playerId, tileIds: drawn },
    hand: { ...hand, hands, boneyard },
  };

  if (playerCanPlay(next.hand!.board, mine, next.hand!.openingTileId)) {
    next = { ...next, hand: { ...next.hand!, phase: "await_play" } };
    return ok(next);
  }

  if (next.hand!.boneyard.length === 0 && !anybodyCanPlay(next)) {
    return finishLock(next);
  }
  return ok(passTurn(next));
}

function applyKnock(match: MatchState, playerId: string): ApplyResult {
  const hand = match.hand!;
  if (hand.phase !== "await_knock") {
    return fail(match, hand.boneyard.length > 0 ? "Draw from the boneyard." : "You have a tile that fits.");
  }
  if (anybodyCanPlay(match)) return ok(passTurn(match));
  return finishLock(match);
}

function playerCanPlay(board: BoardState, tiles: readonly string[], openingTileId: string | null): boolean {
  if (!board.center) {
    if (openingTileId) return tiles.includes(openingTileId);
    return tiles.length > 0;
  }
  const ends = openEnds(board);
  return tiles.some((tileId) => {
    const tile = tileById(tileId);
    return ends.some((end) => tileFits(tile, end.match));
  });
}

function anybodyCanPlay(match: MatchState): boolean {
  const hand = match.hand!;
  return match.players.some((player) =>
    playerCanPlay(hand.board, hand.hands[player.id] ?? [], hand.openingTileId),
  );
}

function passTurn(match: MatchState): MatchState {
  const hand = match.hand!;
  const turnIndex = (hand.turnIndex + 1) % match.players.length;
  const turned: MatchState = { ...match, hand: { ...hand, turnIndex } };
  return { ...turned, hand: { ...turned.hand!, phase: phaseFor(turned) } };
}

function phaseFor(match: MatchState): HandState["phase"] {
  const hand = match.hand!;
  const playerId = match.players[hand.turnIndex]!.id;
  if (playerCanPlay(hand.board, hand.hands[playerId] ?? [], hand.openingTileId)) return "await_play";
  if (hand.boneyard.length > 0) return "await_draw";
  return "await_knock";
}

function finishDomino(match: MatchState, winnerId: string): ApplyResult {
  const hand = match.hand!;
  const pipCounts: Record<string, number> = {};
  for (const player of match.players) pipCounts[player.id] = handPips(hand.hands[player.id] ?? []);
  const leftoverAwards = scoreDomino(pipCounts, winnerId);
  const scores = { ...match.scores };
  for (const [id, award] of Object.entries(leftoverAwards)) {
    scores[id] = (scores[id] ?? 0) + award;
  }
  const winner = nameOf(match, winnerId);
  const award = leftoverAwards[winnerId] ?? 0;
  const summary =
    award > 0
      ? `${winner} went out and took ${award} from the table.`
      : `${winner} went out. The leftovers round down to nothing.`;
  return finish(match, {
    reason: "domino",
    winnerIds: [winnerId],
    nextLeaderId: winnerId,
    pipCounts,
    leftoverAwards,
    scores,
    summary,
  });
}

function finishLock(match: MatchState): ApplyResult {
  const hand = match.hand!;
  const locked = scoreLocked(hand.hands);
  const scores = { ...match.scores };
  for (const [id, award] of Object.entries(locked.awards)) {
    scores[id] = (scores[id] ?? 0) + award;
  }
  let summary: string;
  if (locked.winnerIds.length === 1) {
    const winnerId = locked.winnerIds[0]!;
    const award = locked.awards[winnerId] ?? 0;
    summary =
      award > 0
        ? `Locked. ${nameOf(match, winnerId)} had the lightest hand and took ${award}.`
        : `Locked. ${nameOf(match, winnerId)} had the lightest hand. The leftovers round down to nothing.`;
  } else {
    const names = locked.winnerIds.map((id) => nameOf(match, id)).join(" and ");
    const share = locked.awards[locked.winnerIds[0]!] ?? 0;
    const leader = nameOf(match, locked.nextLeaderId);
    summary =
      share > 0
        ? `Locked and tied. ${names} split the rest, ${share} each. ${leader} leads next.`
        : `Locked and tied. Nothing is left after rounding. ${leader} leads next.`;
  }
  return finish(match, {
    reason: "locked",
    winnerIds: locked.winnerIds,
    nextLeaderId: locked.nextLeaderId,
    pipCounts: locked.pipCounts,
    leftoverAwards: locked.awards,
    scores,
    summary,
  });
}

function finish(
  match: MatchState,
  input: {
    reason: "domino" | "locked";
    winnerIds: string[];
    nextLeaderId: string;
    pipCounts: Record<string, number>;
    leftoverAwards: Record<string, number>;
    scores: Record<string, number>;
    summary: string;
  },
): ApplyResult {
  const hand = match.hand!;
  const wonGame = gameWinnerId(input.scores, match.config.targetScore);
  let summary = input.summary;
  let gamesWon = match.gamesWon;
  let seriesWinnerId: string | null = null;
  let phase: MatchState["phase"] = "in_hand";
  if (wonGame) {
    gamesWon = { ...gamesWon, [wonGame]: (gamesWon[wonGame] ?? 0) + 1 };
    const winner = nameOf(match, wonGame);
    const score = input.scores[wonGame] ?? 0;
    const needed = winsNeeded(match.config.seriesLength);
    if ((gamesWon[wonGame] ?? 0) >= needed) {
      seriesWinnerId = wonGame;
      phase = "series_over";
      const tally = match.players
        .map((player) => `${player.name} ${gamesWon[player.id] ?? 0}`)
        .join(", ");
      summary = `${summary} ${winner} reaches ${score} and wins the series, ${tally}.`;
    } else {
      summary = `${summary} ${winner} reaches ${score} and wins the game.`;
    }
  }

  const result: HandResult = {
    reason: input.reason,
    winnerIds: input.winnerIds,
    nextLeaderId: input.nextLeaderId,
    pipCounts: input.pipCounts,
    leftoverAwards: input.leftoverAwards,
    boardPoints: { ...hand.boardPoints },
    scoresAfter: input.scores,
    gameWinnerId: wonGame,
    seriesWinnerId,
    summary,
    gameNumber: match.gameNumber,
    handNumber: match.handNumber,
  };

  return ok({
    ...match,
    scores: input.scores,
    gamesWon,
    phase,
    seriesWinnerId,
    nextLeaderId: input.nextLeaderId,
    lastHand: result,
    hand: { ...hand, phase: "complete", result },
  });
}

function copyHands(hands: Record<string, string[]>): Record<string, string[]> {
  const copy: Record<string, string[]> = {};
  for (const [id, tiles] of Object.entries(hands)) copy[id] = [...tiles];
  return copy;
}

function zeroNumbers(ids: readonly string[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const id of ids) scores[id] = 0;
  return scores;
}

function nameOf(match: MatchState, playerId: string): string {
  return match.players.find((player) => player.id === playerId)?.name ?? "Someone";
}

function ok(match: MatchState): ApplyResult {
  return { ok: true, match };
}

function fail(match: MatchState, error: string): ApplyResult {
  return { ok: false, error, match };
}

/** Every tile in hands, the boneyard, and the board. A healthy hand lists all 28. */
export function conservedTiles(match: MatchState): string[] {
  if (!match.hand) return [];
  const ids = [...match.hand.boneyard];
  for (const tiles of Object.values(match.hand.hands)) ids.push(...tiles);
  if (match.hand.board.center) ids.push(match.hand.board.center.tileId);
  for (const arm of Object.values(match.hand.board.arms)) {
    for (const tile of arm) ids.push(tile.tileId);
  }
  return ids;
}
