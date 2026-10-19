import { randomBytes } from "node:crypto";
import {
  applyIntent,
  beginHand,
  chooseBotIntent,
  skipTurn,
  createMatch,
  currentPlayerId,
  deckMatchesSeed,
  project,
  replayMatch,
  resolveTaunt,
  shuffleWithSeed,
  tauntsForPlayer,
  randomSeed,
  RULES_VERSION,
  turnHoldMs,
  avatarForSeed,
  pickDistinctAvatar,
  resolveAvatar,
  BIG_MOMENT_SCORE,
  CHAT_TEXT_LIMIT,
  type BoneyardMode,
  type BotDifficulty,
  type Intent,
  type MatchState,
  type PlayerView,
  type RankRecap,
  type SeriesLength,
  type TableMeta,
} from "@uhoh/rules";
import { Store, type ChatRow, type RoomRow } from "./db.js";
import { describePlayer, seatRankOf, settleGame } from "./ranking.js";

export interface ChatLine {
  id: number;
  playerId: string;
  name: string;
  kind: "preset" | "text";
  packId: string | null;
  tauntId: string | null;
  text: string;
  at: string;
}

export type ServerMessage =
  | { type: "welcome"; token: string; playerId: string; roomCode: string; chat: ChatLine[] }
  | { type: "state"; view: PlayerView }
  | { type: "chat"; line: ChatLine }
  | { type: "error"; message: string };

export type ClientMessage =
  | {
      type: "create";
      name: string;
      playerCount: number;
      boneyardMode: string;
      seriesLength: number;
      casual?: boolean;
      /** Public quick-match table. The phone does not send this for a private room. */
      listed?: boolean;
    }
  | { type: "set-casual"; casual: boolean }
  | { type: "quick"; name: string; size: number | "any" }
  | { type: "fill-quick" }
  | { type: "keep-waiting" }
  | { type: "cancel-quick" }
  | { type: "join"; code: string; name: string }
  | { type: "reconnect"; token: string }
  | { type: "start" }
  | { type: "intent"; intent: Intent }
  | { type: "chat"; kind: "preset"; packId: string; tauntId: string }
  | { type: "chat"; kind: "text"; text: string }
  | { type: "continue" }
  | { type: "rematch" }
  | {
      type: "solo";
      name: string;
      playerCount?: number;
      boneyardMode?: string;
      seriesLength?: number;
      difficulty?: string;
    }
  | { type: "add-bot"; difficulty?: string }
  | { type: "remove-bot"; playerId: string };

interface LiveSeat {
  id: string;
  name: string;
  token: string;
  connected: boolean;
  bot: boolean;
  difficulty: BotDifficulty | null;
  generation: number;
  send: ((message: ServerMessage) => void) | null;
  close: (() => void) | null;
  leaveTimer: ReturnType<typeof setTimeout> | null;
  chatTimes: number[];
  missedTurn: boolean;
  /** Account that sat down, when the phone had one. Computers stay null. */
  userId: string | null;
  avatarId: string;
}

interface LiveRoom {
  id: string;
  code: string;
  hostId: string;
  seriesId: string;
  settings: {
    playerCount: 2 | 3 | 4;
    boneyardMode: BoneyardMode;
    seriesLength: SeriesLength;
  };
  casual: boolean;
  /** Public quick-match table others can find while it is waiting. */
  listed: boolean;
  createdAt: number;
  /** When the wait offer may appear. Null on a private room. */
  quickWaitUntil: number | null;
  recap: RankRecap | null;
  status: "lobby" | "playing" | "complete" | "abandoned";
  seats: LiveSeat[];
  match: MatchState | null;
  handId: string | null;
  actionSeq: number;
  betweenHands: boolean;
  turnDeadline: number | null;
  continueDeadline: number | null;
  ended: { reason: "player_left"; playerId: string; name: string } | null;
}

export interface BoundSession {
  playerId: string;
  generation: number;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_NAMES = ["Bones", "Pips", "Lucky"] as const;

/** Computers wait this long before they play, so a person can watch the tile. */
export const BOT_TURN_MS = 2_000;

/** How long a quick table waits before it offers to fill empty seats with computers. */
export const QUICK_WAIT_MS = 60_000;

function defaultBotPace(): number {
  return BOT_TURN_MS;
}

function asDifficulty(value: unknown): BotDifficulty {
  if (value === "easy" || value === "medium" || value === "hard" || value === "expert") return value;
  if (value === "normal") return "medium";
  return "medium";
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

export function cleanName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 16) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

export function cleanChatText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.replace(/\s+/g, " ").trim();
  if (!text || text.length > CHAT_TEXT_LIMIT) return null;
  if (/[\u0000-\u001f]/.test(text)) return null;
  return text;
}

function roomCode(store: Store): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = randomBytes(6);
    let code = "";
    for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    if (!store.roomByCode(code)) return code;
  }
  throw new Error("Could not make a room code.");
}

export class Hub {
  private readonly rooms = new Map<string, LiveRoom>();
  private readonly byPlayer = new Map<string, string>();
  private readonly byCode = new Map<string, string>();
  private readonly botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly turnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly continueTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: Store,
    private readonly lobbyGraceMs = 20_000,
    private readonly botPace: () => number = defaultBotPace,
    private readonly turnLimitMs = 30_000,
    private readonly continueMs = 9_000,
    private readonly quickWaitMs = QUICK_WAIT_MS,
  ) {
    this.restore();
  }

  connect(
    message: ClientMessage,
    send: (message: ServerMessage) => void,
    close: () => void,
    accountUserId: string | null = null,
  ):
    | { ok: true; session: BoundSession }
    | { ok: false; error: string } {
    if (message.type === "create") return this.create(message, send, close, accountUserId);
    if (message.type === "join") return this.join(message, send, close, accountUserId);
    if (message.type === "reconnect") return this.reconnect(message.token, send, close, accountUserId);
    if (message.type === "solo") return this.solo(message, send, close, accountUserId);
    if (message.type === "quick") return this.quick(message, send, close, accountUserId);
    return { ok: false, error: "Join a table first." };
  }

  command(playerId: string, message: ClientMessage): void {
    const room = this.roomFor(playerId);
    const seat = room?.seats.find((candidate) => candidate.id === playerId);
    if (!room || !seat) return;
    if (message.type === "start") this.start(room, seat);
    else if (message.type === "intent") this.intent(room, seat, message.intent);
    else if (message.type === "chat") this.chat(room, seat, message);
    else if (message.type === "continue") this.continueHand(room, seat);
    else if (message.type === "rematch") this.rematch(room, seat);
    else     if (message.type === "add-bot") this.addBot(room, seat, asDifficulty(message.difficulty));
    else if (message.type === "remove-bot") this.removeBot(room, seat, message.playerId);
    else if (message.type === "set-casual") this.setCasual(room, seat, message.casual === true);
    else if (message.type === "fill-quick") this.fillQuick(room, seat);
    else if (message.type === "keep-waiting") this.keepWaiting(room, seat);
    else if (message.type === "cancel-quick") this.cancelQuick(room, seat);
    else this.tell(seat, { type: "error", message: "You're already at a table." });
  }

  /** Public quick tables that are still waiting. */
  openTables(): Array<{
    code: string;
    playerCount: number;
    seated: number;
    players: Array<{
      name: string;
      avatarId: string;
      rating: number;
      provisional: boolean;
      tierId: string;
      tierName: string;
      step: "III" | "II" | "I" | null;
    }>;
  }> {
    const tables = [];
    for (const room of this.rooms.values()) {
      if (!room.listed || room.status !== "lobby") continue;
      if (room.seats.length >= room.settings.playerCount) continue;
      const humans = room.seats.filter((seat) => !seat.bot);
      tables.push({
        code: room.code,
        playerCount: room.settings.playerCount,
        seated: humans.length,
        players: humans.map((seat) => {
          const rank = this.rankFor(seat.userId);
          return {
            name: seat.name,
            avatarId: this.avatarFor(seat),
            rating: rank?.rating ?? 1200,
            provisional: rank?.provisional ?? true,
            tierId: rank?.tierId ?? "rookie",
            tierName: rank?.tierName ?? "Rookie",
            step: rank?.step ?? null,
          };
        }),
      });
    }
    tables.sort((a, b) => b.seated - a.seated || a.code.localeCompare(b.code));
    return tables;
  }

  disconnect(playerId: string, generation: number): void {
    const room = this.roomFor(playerId);
    const seat = room?.seats.find((candidate) => candidate.id === playerId);
    if (!room || !seat || seat.generation !== generation) return;
    seat.connected = false;
    seat.send = null;
    seat.close = null;
    if (room.status === "lobby") {
      seat.leaveTimer = setTimeout(() => this.removeLobbySeat(room.id, seat.id), this.lobbyGraceMs);
      seat.leaveTimer.unref?.();
    }
    this.broadcast(room);
  }

  private create(
    message: Extract<ClientMessage, { type: "create" }>,
    send: (message: ServerMessage) => void,
    close: () => void,
    accountUserId: string | null,
  ): { ok: true; session: BoundSession } | { ok: false; error: string } {
    const name = cleanName(message.name);
    if (!name) return { ok: false, error: "Use a name, up to 16 letters." };
    if (message.playerCount !== 2 && message.playerCount !== 3 && message.playerCount !== 4) {
      return { ok: false, error: "A table is 2, 3, or 4 players." };
    }
    if (message.boneyardMode !== "draw_one" && message.boneyardMode !== "draw_until") {
      return { ok: false, error: "Pick a boneyard rule." };
    }
    if (message.seriesLength !== 3 && message.seriesLength !== 5 && message.seriesLength !== 7) {
      return { ok: false, error: "A series is best of 3, 5, or 7." };
    }
    const created = nowIso();
    const room: LiveRoom = {
      id: makeId("r"),
      code: roomCode(this.store),
      hostId: makeId("p"),
      seriesId: makeId("s"),
      settings: {
        playerCount: message.playerCount,
        boneyardMode: message.boneyardMode,
        seriesLength: message.seriesLength,
      },
      casual: message.listed === true ? false : message.casual === true,
      listed: message.listed === true,
      createdAt: Date.now(),
      quickWaitUntil: message.listed === true ? Date.now() + this.quickWaitMs : null,
      recap: null,
      status: "lobby",
      seats: [],
      match: null,
      handId: null,
      actionSeq: 0,
      betweenHands: false,
      turnDeadline: null,
      continueDeadline: null,
      ended: null,
    };
    const seat = this.makeSeat(
      room.hostId,
      name,
      undefined,
      false,
      false,
      null,
      accountUserId,
      this.portraitFor(accountUserId),
    );
    room.seats.push(seat);
    this.store.insertRoom({
      id: room.id,
      code: room.code,
      host_id: room.hostId,
      series_id: room.seriesId,
      player_count: room.settings.playerCount,
      boneyard_mode: room.settings.boneyardMode,
      series_length: room.settings.seriesLength,
      status: room.status,
      created_at: created,
      rules_version: RULES_VERSION,
      casual: room.casual ? 1 : 0,
      listed: room.listed ? 1 : 0,
    });
    this.store.insertPlayer({
      id: seat.id,
      room_id: room.id,
      name: seat.name,
      token: seat.token,
      seat: 0,
      created_at: created,
      bot: 0,
      difficulty: null,
      user_id: accountUserId,
      avatar_id: seat.avatarId,
    });
    this.remember(room);
    const generation = this.bind(seat, send, close);
    this.welcome(room, seat);
    return { ok: true, session: { playerId: seat.id, generation } };
  }

  private join(
    message: Extract<ClientMessage, { type: "join" }>,
    send: (message: ServerMessage) => void,
    close: () => void,
    accountUserId: string | null,
  ): { ok: true; session: BoundSession } | { ok: false; error: string } {
    const name = cleanName(message.name);
    if (!name) return { ok: false, error: "Use a name, up to 16 letters." };
    const code = message.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const room = this.byCode.get(code) ? this.rooms.get(this.byCode.get(code)!) : undefined;
    if (!room) return { ok: false, error: "No table with that code." };
    if (room.status !== "lobby") return { ok: false, error: "That game has already started." };
    if (room.seats.length >= room.settings.playerCount) return { ok: false, error: "That table is full." };
    const seat = this.makeSeat(
      makeId("p"),
      name,
      undefined,
      false,
      false,
      null,
      accountUserId,
      this.portraitFor(accountUserId),
    );
    room.seats.push(seat);
    this.byPlayer.set(seat.id, room.id);
    this.store.insertPlayer({
      id: seat.id,
      room_id: room.id,
      name: seat.name,
      token: seat.token,
      seat: room.seats.length - 1,
      created_at: nowIso(),
      bot: 0,
      difficulty: null,
      user_id: accountUserId,
      avatar_id: seat.avatarId,
    });
    const generation = this.bind(seat, send, close);
    this.welcome(room, seat);
    if (room.listed) {
      room.quickWaitUntil = Date.now() + this.quickWaitMs;
      if (room.seats.length >= room.settings.playerCount) {
        const host = room.seats.find((candidate) => candidate.id === room.hostId);
        if (host) this.start(room, host);
        return { ok: true, session: { playerId: seat.id, generation } };
      }
    }
    this.broadcast(room);
    return { ok: true, session: { playerId: seat.id, generation } };
  }

  private reconnect(
    token: string,
    send: (message: ServerMessage) => void,
    close: () => void,
    accountUserId: string | null,
  ): { ok: true; session: BoundSession } | { ok: false; error: string } {
    if (typeof token !== "string" || token.length < 20) {
      return { ok: false, error: "This device isn't at a table. Join with a code." };
    }
    const row = this.store.playerByToken(token);
    if (!row || row.bot) return { ok: false, error: "This device isn't at a table. Join with a code." };
    const room = this.rooms.get(row.room_id);
    const seat = room?.seats.find((candidate) => candidate.id === row.id);
    if (!room || !seat) return { ok: false, error: "This device isn't at a table. Join with a code." };
    if (!seat.userId && row.user_id) seat.userId = row.user_id;
    // A seat keeps the account it sat down with. Fill it in only while it is still blank.
    if (accountUserId && !seat.userId && !seat.bot) {
      this.store.setPlayerUser(seat.id, accountUserId);
      seat.userId = accountUserId;
    }
    const generation = this.bind(seat, send, close);
    seat.missedTurn = false;
    this.welcome(room, seat);
    // Everyone else still had this seat marked away. Tell them the player is back.
    this.broadcast(room);
    return { ok: true, session: { playerId: seat.id, generation } };
  }

  private start(room: LiveRoom, seat: LiveSeat): void {
    if (seat.id !== room.hostId) {
      this.tell(seat, { type: "error", message: "Only the host can start." });
      return;
    }
    if (room.status !== "lobby") {
      this.tell(seat, { type: "error", message: "The game has already started." });
      return;
    }
    if (room.seats.length !== room.settings.playerCount) {
      this.tell(seat, { type: "error", message: "Wait until everyone has joined." });
      return;
    }
    const match = createMatch(
      room.seats.map((player) => ({ id: player.id, name: player.name })),
      { ...room.settings, targetScore: 150 },
    );
    room.status = "playing";
    this.store.updateRoom(room.id, { status: "playing" });
    try {
      this.openHand(room, match);
    } catch {
      room.status = "lobby";
      room.match = null;
      this.store.updateRoom(room.id, { status: "lobby" });
      this.tell(seat, { type: "error", message: "The deal didn't go through. Try again." });
      return;
    }
    this.broadcast(room);
  }

  private rematch(room: LiveRoom, seat: LiveSeat): void {
    if (room.status !== "complete") {
      this.tell(seat, { type: "error", message: "Finish this series first." });
      return;
    }
    if (seat.id !== room.hostId) {
      this.tell(seat, { type: "error", message: "Only the host can start another series." });
      return;
    }
    room.seriesId = makeId("s");
    room.status = "playing";
    this.store.updateRoom(room.id, { status: "playing", series_id: room.seriesId });
    const match = createMatch(
      room.seats.map((player) => ({ id: player.id, name: player.name })),
      { ...room.settings, targetScore: 150 },
    );
    this.openHand(room, match);
    this.broadcast(room);
  }

  private intent(room: LiveRoom, seat: LiveSeat, intent: Intent): void {
    if (!room.match || !isIntent(intent)) {
      this.tell(seat, { type: "error", message: "That move doesn't make sense." });
      return;
    }
    const before = room.match;
    const result = applyIntent(room.match, seat.id, intent);
    if (!result.ok || !room.handId) {
      this.tell(seat, { type: "error", message: result.error ?? "That move doesn't work." });
      return;
    }
    seat.missedTurn = false;
    room.actionSeq += 1;
    this.store.insertAction({
      hand_id: room.handId,
      seq: room.actionSeq,
      player_id: seat.id,
      payload_json: JSON.stringify(intent),
      created_at: nowIso(),
    });
    room.match = result.match;
    this.noteBigMoment(room, before, room.match);
    if (room.match.hand?.phase === "complete" && room.match.lastHand) {
      this.store.setHandResult(room.handId, JSON.stringify(room.match.lastHand));
      if (room.match.phase === "series_over") {
        room.status = "complete";
        room.betweenHands = false;
        room.continueDeadline = null;
        this.store.updateRoom(room.id, { status: "complete" });
      } else {
        this.holdForSummary(room);
      }
      this.settleCompleted(room);
    }
    const holdMs = intent.type === "play" ? turnHoldMs(room.match.lastPlay?.awarded ?? 0) : 0;
    this.broadcast(room, holdMs);
  }

  private continueHand(room: LiveRoom, seat: LiveSeat): void {
    if (!room.betweenHands || !room.match) {
      this.tell(seat, { type: "error", message: "The next hand isn't waiting." });
      return;
    }
    this.openHeldHand(room);
    this.broadcast(room);
  }

  private holdForSummary(room: LiveRoom): void {
    room.betweenHands = true;
    room.turnDeadline = null;
    room.continueDeadline = Date.now() + this.continueMs;
    this.clearTimer(this.turnTimers, room.id);
    this.armContinue(room);
  }

  private armContinue(room: LiveRoom): void {
    this.clearTimer(this.continueTimers, room.id);
    const wait = Math.max(0, (room.continueDeadline ?? Date.now()) - Date.now());
    const timer = setTimeout(() => this.openHeldHand(room, true), wait);
    timer.unref?.();
    this.continueTimers.set(room.id, timer);
  }

  private openHeldHand(room: LiveRoom, fromTimer = false): void {
    if (!room.betweenHands || !room.match) return;
    this.clearTimer(this.continueTimers, room.id);
    room.betweenHands = false;
    room.continueDeadline = null;
    this.openHand(room, room.match);
    if (fromTimer) this.broadcast(room);
  }

  private onTurnTimeout(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    const seat = room?.seats.find((candidate) => candidate.id === playerId);
    if (!room?.match || !seat || seat.bot || room.ended) return;
    if (currentPlayerId(room.match) !== playerId) return;
    if (seat.missedTurn) {
      this.abandon(room, seat);
      return;
    }
    seat.missedTurn = true;
    const before = room.match;
    const result = skipTurn(room.match, playerId);
    if (!result.ok || !room.handId) return;
    room.actionSeq += 1;
    this.store.insertAction({
      hand_id: room.handId,
      seq: room.actionSeq,
      player_id: seat.id,
      payload_json: JSON.stringify({ type: "timeout" }),
      created_at: nowIso(),
    });
    const nextMatch = result.match;
    room.match = nextMatch;
    this.noteBigMoment(room, before, room.match);
    if (nextMatch.hand?.phase === "complete" && nextMatch.lastHand) {
      this.store.setHandResult(room.handId, JSON.stringify(nextMatch.lastHand));
      if (nextMatch.phase === "series_over") {
        room.status = "complete";
        this.store.updateRoom(room.id, { status: "complete" });
      } else {
        this.holdForSummary(room);
      }
      this.settleCompleted(room);
    }
    this.broadcast(room);
  }

  private abandon(room: LiveRoom, seat: LiveSeat): void {
    room.ended = { reason: "player_left", playerId: seat.id, name: seat.name };
    room.status = "abandoned";
    room.betweenHands = false;
    room.turnDeadline = null;
    room.continueDeadline = null;
    this.clearTimer(this.botTimers, room.id);
    this.clearTimer(this.turnTimers, room.id);
    this.clearTimer(this.continueTimers, room.id);
    this.store.updateRoom(room.id, { status: "abandoned" });
    if (room.handId && room.match?.lastHand) {
      this.store.setHandResult(room.handId, JSON.stringify({ ...room.match.lastHand, abandoned: room.ended }));
    }
    this.settleAbandoned(room, seat.id);
    this.broadcast(room);
  }

  private chat(room: LiveRoom, seat: LiveSeat, message: Extract<ClientMessage, { type: "chat" }>): void {
    const now = Date.now();
    seat.chatTimes = seat.chatTimes.filter((stamp) => now - stamp < 2_000);
    if (seat.chatTimes.length >= 1) {
      this.tell(seat, { type: "error", message: "Easy. Give the table a second." });
      return;
    }
    if (message.kind !== "preset") {
      this.tell(seat, { type: "error", message: "Pick a line from the list." });
      return;
    }
    const taunt = resolveTaunt(message.packId, message.tauntId);
    if (!taunt) {
      this.tell(seat, { type: "error", message: "That line isn't in the pack." });
      return;
    }
    const text = taunt.text;
    const packId = taunt.packId;
    const tauntId = taunt.id;
    const kind = "preset" as const;
    seat.chatTimes.push(now);
    const row = this.store.insertChat({
      room_id: room.id,
      player_id: seat.id,
      kind,
      pack_id: packId,
      taunt_id: tauntId,
      text,
      created_at: nowIso(),
    });
    const line = toChatLine(row, seat.name);
    for (const player of room.seats) {
      if (player.send) player.send({ type: "chat", line });
    }
  }

  private openHand(room: LiveRoom, match: MatchState): void {
    const seed = randomSeed();
    const deck = shuffleWithSeed(seed);
    if (!deckMatchesSeed(seed, deck)) throw new Error("The shuffle could not be verified.");
    const next = beginHand(match, deck);
    const handId = makeId("h");
    this.store.insertHand({
      id: handId,
      room_id: room.id,
      series_id: room.seriesId,
      game_number: next.gameNumber,
      hand_number: next.handNumber,
      seed: seed.toString("hex"),
      deck_json: JSON.stringify(deck),
      result_json: null,
      created_at: nowIso(),
    });
    room.match = next;
    room.handId = handId;
    room.actionSeq = 0;
    room.recap = null;
  }

  private solo(
    message: Extract<ClientMessage, { type: "solo" }>,
    send: (message: ServerMessage) => void,
    close: () => void,
    accountUserId: string | null,
  ): { ok: true; session: BoundSession } | { ok: false; error: string } {
    const boneyardMode = message.boneyardMode ?? "draw_until";
    const seriesLength = message.seriesLength ?? 3;
    const playerCount = message.playerCount ?? 4;
    const opened = this.create(
      {
        type: "create",
        name: message.name,
        playerCount,
        boneyardMode,
        seriesLength,
      },
      send,
      close,
      accountUserId,
    );
    if (!opened.ok) return opened;
    const room = this.roomFor(opened.session.playerId);
    const seat = room?.seats.find((candidate) => candidate.id === opened.session.playerId);
    if (!room || !seat) return { ok: false, error: "The table didn't open." };
    const difficulty = asDifficulty(message.difficulty);
    for (let count = 1; count < playerCount; count += 1) this.addBot(room, seat, difficulty);
    this.start(room, seat);
    return opened;
  }

  private addBot(room: LiveRoom, host: LiveSeat, difficulty: BotDifficulty): void {
    if (host.id !== room.hostId) {
      this.tell(host, { type: "error", message: "Only the host can add a computer." });
      return;
    }
    if (room.status !== "lobby") {
      this.tell(host, { type: "error", message: "Computers can only sit down before the deal." });
      return;
    }
    if (room.seats.length >= room.settings.playerCount) {
      this.tell(host, { type: "error", message: "That table is full." });
      return;
    }
    if (room.listed) {
      this.tell(host, { type: "error", message: "A quick table stays all human until you fill the empty seats." });
      return;
    }
    if (room.seats.filter((seat) => seat.bot).length >= 3) {
      this.tell(host, { type: "error", message: "Three computers is the table limit." });
      return;
    }
    this.pushBot(room, difficulty);
    this.broadcast(room);
  }

  private pushBot(room: LiveRoom, difficulty: BotDifficulty): void {
    const name = this.nextBotName(room);
    const avatarId = pickDistinctAvatar(room.seats.map((seat) => seat.avatarId), Math.random);
    const seat = this.makeSeat(makeId("p"), name, randomBytes(32).toString("hex"), true, true, difficulty, null, avatarId);
    room.seats.push(seat);
    this.byPlayer.set(seat.id, room.id);
    this.store.insertPlayer({
      id: seat.id,
      room_id: room.id,
      name: seat.name,
      token: seat.token,
      seat: room.seats.length - 1,
      created_at: nowIso(),
      bot: 1,
      difficulty,
      avatar_id: avatarId,
    });
  }

  private removeBot(room: LiveRoom, host: LiveSeat, playerId: string): void {
    if (host.id !== room.hostId) {
      this.tell(host, { type: "error", message: "Only the host can remove a computer." });
      return;
    }
    if (room.status !== "lobby") {
      this.tell(host, { type: "error", message: "Computers can only leave before the deal." });
      return;
    }
    const target = room.seats.find((candidate) => candidate.id === playerId);
    if (!target?.bot) {
      this.tell(host, { type: "error", message: "Only a computer can be removed from here." });
      return;
    }
    room.seats = room.seats.filter((candidate) => candidate.id !== target.id);
    this.byPlayer.delete(target.id);
    this.store.deletePlayer(target.id);
    this.broadcast(room);
  }

  private nextBotName(room: LiveRoom): string {
    const used = new Set(room.seats.map((seat) => seat.name));
    for (const name of BOT_NAMES) {
      if (!used.has(name)) return name;
    }
    return `Bones ${room.seats.length}`;
  }

  private scheduleBot(room: LiveRoom): void {
    if (this.botTimers.has(room.id)) return;
    if (!room.match || room.status !== "playing" || room.betweenHands || room.ended) return;
    const turnId = currentPlayerId(room.match);
    if (!turnId) return;
    const seat = room.seats.find((candidate) => candidate.id === turnId);
    if (!seat?.bot) return;
    const wait = Math.max(0, this.botPace());
    const timer = setTimeout(() => {
      this.botTimers.delete(room.id);
      this.playBot(room.id, seat.id);
    }, wait);
    timer.unref?.();
    this.botTimers.set(room.id, timer);
  }

  private playBot(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    const seat = room?.seats.find((candidate) => candidate.id === playerId);
    if (!room || !seat?.bot || !room.match) return;
    if (currentPlayerId(room.match) !== playerId) return;
    const intent = chooseBotIntent(room.match, playerId, seat.difficulty ?? "medium", Math.random);
    if (!intent) return;
    const before = room.match.playSeq;
    this.intent(room, seat, intent);
    if (room.match && room.match.playSeq > before && Math.random() < 0.12) this.botTaunt(room, seat);
  }

  private botTaunt(room: LiveRoom, seat: LiveSeat): void {
    const lines = tauntsForPlayer();
    if (lines.length === 0) return;
    const line = lines[Math.floor(Math.random() * lines.length)];
    if (!line) return;
    this.chat(room, seat, { type: "chat", kind: "preset", packId: line.packId, tauntId: line.id });
  }

  private clearTimer(timers: Map<string, ReturnType<typeof setTimeout>>, roomId: string): void {
    const timer = timers.get(roomId);
    if (timer) clearTimeout(timer);
    timers.delete(roomId);
  }

  private dropRoom(room: LiveRoom): void {
    this.clearTimer(this.botTimers, room.id);
    this.clearTimer(this.turnTimers, room.id);
    this.clearTimer(this.continueTimers, room.id);
    for (const seat of room.seats) this.byPlayer.delete(seat.id);
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    this.store.deleteRoom(room.id);
  }

  private removeLobbySeat(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    const seat = room?.seats.find((candidate) => candidate.id === playerId);
    if (!room || !seat || room.status !== "lobby" || seat.connected) return;
    room.seats = room.seats.filter((candidate) => candidate.id !== playerId);
    this.byPlayer.delete(playerId);
    this.store.deletePlayer(playerId);
    if (room.seats.length === 0) {
      this.rooms.delete(room.id);
      this.byCode.delete(room.code);
      this.store.deleteRoom(room.id);
      return;
    }
    if (room.hostId === playerId) {
      const human = room.seats.find((candidate) => !candidate.bot);
      if (!human) {
        this.dropRoom(room);
        return;
      }
      room.hostId = human.id;
      this.store.updateRoom(room.id, { host_id: room.hostId });
    }
    this.broadcast(room);
  }

  private restore(): void {
    for (const row of this.store.listRooms()) {
      try {
        this.restoreRoom(row);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "The saved game could not be replayed.";
        console.warn(`Room ${row.id} could not be restored (${detail}). Closing it.`);
        try {
          this.store.updateRoom(row.id, { status: "abandoned", rules_version: null });
        } catch (closeError) {
          const closeDetail = closeError instanceof Error ? closeError.message : "The room could not be closed.";
          console.warn(`Room ${row.id} stayed on disk (${closeDetail}).`);
        }
      }
    }
  }

  private restoreRoom(row: RoomRow): void {
    if (row.rules_version !== RULES_VERSION) {
      // Already closed on an earlier boot. Leave it on disk and do not load it again.
      if (row.status === "abandoned") return;
      const saved = row.rules_version == null ? "an older version" : `version ${row.rules_version}`;
      throw new Error(`it was saved under ${saved} of the rules`);
    }
    const players = this.store.players(row.id);
    const room: LiveRoom = {
      id: row.id,
      code: row.code,
      hostId: row.host_id,
      seriesId: row.series_id,
      settings: {
        playerCount: row.player_count as 2 | 3 | 4,
        boneyardMode: row.boneyard_mode as BoneyardMode,
        seriesLength: row.series_length as SeriesLength,
      },
      casual: row.casual === 1,
      listed: row.listed === 1,
      createdAt: Date.parse(row.created_at) || Date.now(),
      quickWaitUntil: row.listed === 1 && row.status === "lobby" ? Date.now() + this.quickWaitMs : null,
      recap: null,
      status: row.status as LiveRoom["status"],
      seats: [],
      match: null,
      handId: null,
      actionSeq: 0,
      betweenHands: false,
      turnDeadline: null,
      continueDeadline: null,
      ended: null,
    };
    const worn = new Set<string>();
    for (const player of players) {
      const avatar =
        player.avatar_id && player.avatar_id.length > 0
          ? player.avatar_id
          : player.bot === 1
            ? avatarForSeed(player.id, worn)
            : this.portraitFor(player.user_id ?? null);
      worn.add(avatar);
      room.seats.push(
        this.makeSeat(
          player.id,
          player.name,
          player.token,
          player.bot === 1,
          player.bot === 1,
          asDifficulty(player.difficulty),
          player.user_id ?? null,
          avatar,
        ),
      );
    }
    if (row.status !== "lobby") {
      const logged = this.store.handsForSeries(row.id, row.series_id).map((hand) => ({
        deck: JSON.parse(hand.deck_json) as string[],
        actions: this.store.actions(hand.id),
        id: hand.id,
      }));
      if (logged.length === 0) {
        room.status = "lobby";
        this.store.updateRoom(room.id, { status: "lobby" });
      } else {
        const match = replayMatch(
          room.seats.map((seat) => ({ id: seat.id, name: seat.name })),
          { ...room.settings, targetScore: 150 },
          logged,
        );
        const last = logged[logged.length - 1]!;
        room.handId = last.id;
        room.actionSeq = last.actions.length;
        if (match.hand?.phase === "complete" && match.phase !== "series_over") {
          room.betweenHands = true;
          room.continueDeadline = Date.now() + this.continueMs;
        }
        room.match = match;
        if (match.phase === "series_over") room.status = "complete";
      }
    }
    try {
      if (room.match?.lastHand?.gameWinnerId) this.settleCompleted(room);
      if (room.status === "abandoned" && room.match) {
        const leaver = this.savedLeaver(room);
        if (leaver) this.settleAbandoned(room, leaver);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The rating could not be saved.";
      console.warn(`Room ${room.id} rating was not restored (${detail}).`);
    }
    this.remember(room);
    if (room.betweenHands) this.armContinue(room);
    if (room.status === "playing") this.scheduleBot(room);
  }

  private remember(room: LiveRoom): void {
    this.rooms.set(room.id, room);
    this.byCode.set(room.code, room.id);
    for (const seat of room.seats) this.byPlayer.set(seat.id, room.id);
  }

  private makeSeat(
    id: string,
    name: string,
    token?: string,
    connected = false,
    bot = false,
    difficulty: BotDifficulty | null = null,
    userId: string | null = null,
    avatarId: string | null = null,
  ): LiveSeat {
    return {
      id,
      name,
      token: token ?? randomBytes(32).toString("hex"),
      connected,
      bot,
      difficulty: bot ? (difficulty ?? "medium") : null,
      missedTurn: false,
      generation: 0,
      send: null,
      close: null,
      leaveTimer: null,
      chatTimes: [],
      userId: bot ? null : userId,
      avatarId: resolveAvatar(avatarId),
    };
  }

  private bind(seat: LiveSeat, send: (message: ServerMessage) => void, close: () => void): number {
    const generation = seat.generation + 1;
    const previous = seat.close;
    if (seat.leaveTimer) clearTimeout(seat.leaveTimer);
    seat.leaveTimer = null;
    seat.generation = generation;
    seat.send = send;
    seat.close = close;
    seat.connected = true;
    if (previous) previous();
    return generation;
  }

  private welcome(room: LiveRoom, seat: LiveSeat): void {
    const chat = this.store.recentChat(room.id).map((row) => {
      const speaker = room.seats.find((candidate) => candidate.id === row.player_id);
      return toChatLine(row, speaker?.name ?? "Someone");
    });
    this.tell(seat, { type: "welcome", token: seat.token, playerId: seat.id, roomCode: room.code, chat });
    this.tell(seat, { type: "state", view: this.view(room, seat.id) });
  }

  private broadcast(room: LiveRoom, holdMs = 0): void {
    this.armTurn(room, holdMs);
    for (const seat of room.seats) {
      if (!seat.send) continue;
      seat.send({ type: "state", view: this.view(room, seat.id) });
    }
    this.scheduleBot(room);
  }

  private armTurn(room: LiveRoom, holdMs = 0): void {
    this.clearTimer(this.turnTimers, room.id);
    room.turnDeadline = null;
    if (room.ended || room.betweenHands || room.status !== "playing" || !room.match) return;
    const turnId = currentPlayerId(room.match);
    const seat = room.seats.find((candidate) => candidate.id === turnId);
    if (!seat || seat.bot) return;
    const budget = this.turnLimitMs + Math.max(0, holdMs);
    room.turnDeadline = Date.now() + budget;
    const timer = setTimeout(() => this.onTurnTimeout(room.id, seat.id), budget);
    timer.unref?.();
    this.turnTimers.set(room.id, timer);
  }

  private quick(
    message: Extract<ClientMessage, { type: "quick" }>,
    send: (message: ServerMessage) => void,
    close: () => void,
    accountUserId: string | null,
  ): { ok: true; session: BoundSession } | { ok: false; error: string } {
    const name = cleanName(message.name);
    if (!name) return { ok: false, error: "Use a name, up to 16 letters." };
    const size = message.size;
    if (size !== 2 && size !== 3 && size !== 4 && size !== "any") {
      return { ok: false, error: "Pick 2, 3, 4, or any size." };
    }
    const existing = this.findQuick(size);
    if (existing) return this.join({ type: "join", name, code: existing.code }, send, close, accountUserId);
    return this.create(
      {
        type: "create",
        name,
        playerCount: size === "any" ? 4 : size,
        boneyardMode: "draw_until",
        seriesLength: 3,
        listed: true,
      },
      send,
      close,
      accountUserId,
    );
  }

  private findQuick(size: 2 | 3 | 4 | "any"): LiveRoom | null {
    const open = [...this.rooms.values()].filter(
      (room) =>
        room.listed &&
        room.status === "lobby" &&
        room.seats.length < room.settings.playerCount &&
        room.seats.every((seat) => !seat.bot) &&
        (size === "any" || room.settings.playerCount === size),
    );
    open.sort((a, b) => b.seats.length - a.seats.length || a.createdAt - b.createdAt);
    return open[0] ?? null;
  }

  private fillQuick(room: LiveRoom, seat: LiveSeat): void {
    if (!room.listed || room.status !== "lobby") {
      this.tell(seat, { type: "error", message: "This table has already started." });
      return;
    }
    if (Date.now() < (room.quickWaitUntil ?? 0)) {
      this.tell(seat, { type: "error", message: "Give the table a minute." });
      return;
    }
    while (room.seats.length < room.settings.playerCount) this.pushBot(room, "medium");
    const host = room.seats.find((candidate) => candidate.id === room.hostId) ?? seat;
    this.start(room, host);
  }

  private keepWaiting(room: LiveRoom, seat: LiveSeat): void {
    if (!room.listed || room.status !== "lobby") return;
    room.quickWaitUntil = Date.now() + this.quickWaitMs;
    this.broadcast(room);
    void seat;
  }

  private cancelQuick(room: LiveRoom, seat: LiveSeat): void {
    if (!room.listed || room.status !== "lobby") {
      this.tell(seat, { type: "error", message: "This table has already started." });
      return;
    }
    seat.connected = false;
    const close = seat.close;
    seat.send = null;
    seat.close = null;
    if (seat.leaveTimer) clearTimeout(seat.leaveTimer);
    seat.leaveTimer = null;
    this.removeLobbySeat(room.id, seat.id);
    close?.();
  }

  private portraitFor(userId: string | null): string {
    if (!userId) return resolveAvatar(null);
    try {
      return resolveAvatar(this.store.user(userId)?.avatar_id);
    } catch {
      return resolveAvatar(null);
    }
  }

  private avatarFor(seat: LiveSeat): string {
    if (!seat.bot && seat.userId) return this.portraitFor(seat.userId);
    return resolveAvatar(seat.avatarId);
  }

  private setCasual(room: LiveRoom, seat: LiveSeat, casual: boolean): void {
    if (room.listed) {
      this.tell(seat, { type: "error", message: "A quick table stays ranked until computers sit down." });
      return;
    }
    if (seat.id !== room.hostId) {
      this.tell(seat, { type: "error", message: "Only the host can change that." });
      return;
    }
    if (room.status !== "lobby") {
      this.tell(seat, { type: "error", message: "The table is already dealing." });
      return;
    }
    room.casual = casual;
    this.store.updateRoom(room.id, { casual });
    this.broadcast(room);
  }

  private noteBigMoment(room: LiveRoom, before: MatchState, after: MatchState): void {
    const play = after.lastPlay;
    if (!play || before.lastPlay?.seq === play.seq) return;
    if (play.awarded < BIG_MOMENT_SCORE) return;
    try {
      this.store.addBigMoment(room.id, room.seriesId, after.gameNumber, play.playerId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The moment was not counted.";
      console.warn(`Room ${room.id} missed a big moment (${detail}).`);
    }
  }

  private settleCompleted(room: LiveRoom): void {
    const hand = room.match?.lastHand;
    if (!hand?.gameWinnerId || !room.match) return;
    if (room.recap?.gameNumber === hand.gameNumber) return;
    try {
      room.recap = settleGame(this.store, {
        roomId: room.id,
        seriesId: room.seriesId,
        gameNumber: hand.gameNumber,
        casual: room.casual,
        completed: true,
        winnerId: hand.gameWinnerId,
        now: new Date(),
        seats: this.finishSeats(room, hand.scoresAfter, null, hand.gameNumber),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The rating could not be saved.";
      console.warn(`Room ${room.id} rating was not saved (${detail}).`);
    }
  }

  private settleAbandoned(room: LiveRoom, leaverId: string): void {
    const gameNumber = room.match?.gameNumber ?? 0;
    if (!room.match || gameNumber < 1) return;
    if (room.recap?.gameNumber === gameNumber) return;
    try {
      room.recap = settleGame(this.store, {
        roomId: room.id,
        seriesId: room.seriesId,
        gameNumber,
        casual: room.casual,
        completed: false,
        winnerId: null,
        now: new Date(),
        seats: this.finishSeats(room, room.match.scores, leaverId, gameNumber),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The rating could not be saved.";
      console.warn(`Room ${room.id} rating was not saved (${detail}).`);
    }
  }

  private finishSeats(room: LiveRoom, scores: Record<string, number>, leaverId: string | null, gameNumber: number) {
    const moments = this.store.bigMoments(room.id, room.seriesId, gameNumber);
    return room.seats.map((seat) => ({
      playerId: seat.id,
      name: seat.name,
      userId: seat.userId,
      bot: seat.bot,
      score: scores[seat.id] ?? 0,
      left: leaverId === seat.id,
      bigMoments: moments[seat.id] ?? 0,
    }));
  }

  private savedLeaver(room: LiveRoom): string | null {
    const hands = this.store.handsForSeries(room.id, room.seriesId);
    const last = hands[hands.length - 1];
    if (!last?.result_json) return null;
    try {
      const parsed = JSON.parse(last.result_json) as { abandoned?: { playerId?: string } };
      return typeof parsed.abandoned?.playerId === "string" ? parsed.abandoned.playerId : null;
    } catch {
      return null;
    }
  }

  private showRecap(room: LiveRoom): boolean {
    if (!room.recap) return false;
    if (room.ended) return true;
    const hand = room.match?.lastHand;
    if (!hand?.gameWinnerId || hand.gameNumber !== room.recap.gameNumber) return false;
    return room.betweenHands || room.status === "complete" || room.match?.phase === "series_over";
  }

  private rankFor(userId: string | null) {
    if (!userId) return null;
    try {
      const standing = describePlayer(this.store, userId, new Date());
      return standing ? seatRankOf(standing) : null;
    } catch {
      return null;
    }
  }

  private view(room: LiveRoom, playerId: string): PlayerView {
    return project(room.match, this.meta(room, playerId));
  }

  private meta(room: LiveRoom, youId: string): TableMeta {
    return {
      roomCode: room.code,
      hostId: room.hostId,
      status: room.status,
      seats: room.seats.map((seat) => ({
        id: seat.id,
        name: seat.name,
        connected: seat.connected,
        bot: seat.bot,
        difficulty: seat.difficulty,
        rank: this.rankFor(seat.userId),
        avatarId: this.avatarFor(seat),
      })),
      settings: { ...room.settings, casual: room.casual },
      recap: this.showRecap(room) ? room.recap : null,
      quick:
        room.listed && room.status === "lobby"
          ? { waitUntil: room.quickWaitUntil ?? 0, canFill: Date.now() >= (room.quickWaitUntil ?? 0) }
          : null,
      youId,
      turnDeadline: room.turnDeadline,
      turnBudgetMs: this.turnLimitMs,
      serverNow: Date.now(),
      betweenHands: room.betweenHands,
      continueDeadline: room.continueDeadline,
      ended: room.ended,
    };
  }

  private roomFor(playerId: string): LiveRoom | null {
    const roomId = this.byPlayer.get(playerId);
    return roomId ? (this.rooms.get(roomId) ?? null) : null;
  }

  private tell(seat: LiveSeat, message: ServerMessage): void {
    seat.send?.(message);
  }
}

function toChatLine(row: ChatRow, name: string): ChatLine {
  return {
    id: row.id,
    playerId: row.player_id,
    name,
    kind: row.kind === "preset" ? "preset" : "text",
    packId: row.pack_id,
    tauntId: row.taunt_id,
    text: row.text,
    at: row.created_at,
  };
}

function isIntent(value: Intent): value is Intent {
  if (!value || typeof value !== "object") return false;
  if (value.type === "draw" || value.type === "knock") return true;
  return value.type === "play" && typeof value.tileId === "string" && typeof value.endId === "string";
}
