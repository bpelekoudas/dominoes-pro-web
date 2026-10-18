import { randomBytes } from "node:crypto";
import {
  applyIntent,
  beginHand,
  chooseBotIntent,
  createMatch,
  currentPlayerId,
  deckMatchesSeed,
  project,
  replayMatch,
  resolveTaunt,
  shuffleWithSeed,
  tauntsForPlayer,
  randomSeed,
  CHAT_TEXT_LIMIT,
  type BoneyardMode,
  type BotDifficulty,
  type Intent,
  type MatchState,
  type PlayerView,
  type SeriesLength,
  type TableMeta,
} from "@uhoh/rules";
import { Store, type ChatRow } from "./db.js";

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
    }
  | { type: "join"; code: string; name: string }
  | { type: "reconnect"; token: string }
  | { type: "start" }
  | { type: "intent"; intent: Intent }
  | { type: "chat"; kind: "preset"; packId: string; tauntId: string }
  | { type: "chat"; kind: "text"; text: string }
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
  status: "lobby" | "playing" | "complete";
  seats: LiveSeat[];
  match: MatchState | null;
  handId: string | null;
  actionSeq: number;
}

export interface BoundSession {
  playerId: string;
  generation: number;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_NAMES = ["Bones", "Pips", "Lucky"] as const;

function defaultBotPace(): number {
  return 800 + Math.floor(Math.random() * 701);
}

function asDifficulty(value: unknown): BotDifficulty {
  return value === "easy" ? "easy" : "normal";
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

  constructor(
    private readonly store: Store,
    private readonly lobbyGraceMs = 20_000,
    private readonly botPace: () => number = defaultBotPace,
  ) {
    this.restore();
  }

  connect(message: ClientMessage, send: (message: ServerMessage) => void, close: () => void):
    | { ok: true; session: BoundSession }
    | { ok: false; error: string } {
    if (message.type === "create") return this.create(message, send, close);
    if (message.type === "join") return this.join(message, send, close);
    if (message.type === "reconnect") return this.reconnect(message.token, send, close);
    if (message.type === "solo") return this.solo(message, send, close);
    return { ok: false, error: "Join a table first." };
  }

  command(playerId: string, message: ClientMessage): void {
    const room = this.roomFor(playerId);
    const seat = room?.seats.find((candidate) => candidate.id === playerId);
    if (!room || !seat) return;
    if (message.type === "start") this.start(room, seat);
    else if (message.type === "intent") this.intent(room, seat, message.intent);
    else if (message.type === "chat") this.chat(room, seat, message);
    else if (message.type === "rematch") this.rematch(room, seat);
    else if (message.type === "add-bot") this.addBot(room, seat, asDifficulty(message.difficulty));
    else if (message.type === "remove-bot") this.removeBot(room, seat, message.playerId);
    else this.tell(seat, { type: "error", message: "You're already at a table." });
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
      status: "lobby",
      seats: [],
      match: null,
      handId: null,
      actionSeq: 0,
    };
    const seat = this.makeSeat(room.hostId, name);
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
  ): { ok: true; session: BoundSession } | { ok: false; error: string } {
    const name = cleanName(message.name);
    if (!name) return { ok: false, error: "Use a name, up to 16 letters." };
    const code = message.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const room = this.byCode.get(code) ? this.rooms.get(this.byCode.get(code)!) : undefined;
    if (!room) return { ok: false, error: "No table with that code." };
    if (room.status !== "lobby") return { ok: false, error: "That game has already started." };
    if (room.seats.length >= room.settings.playerCount) return { ok: false, error: "That table is full." };
    const seat = this.makeSeat(makeId("p"), name);
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
    });
    const generation = this.bind(seat, send, close);
    this.welcome(room, seat);
    this.broadcast(room);
    return { ok: true, session: { playerId: seat.id, generation } };
  }

  private reconnect(
    token: string,
    send: (message: ServerMessage) => void,
    close: () => void,
  ): { ok: true; session: BoundSession } | { ok: false; error: string } {
    if (typeof token !== "string" || token.length < 20) {
      return { ok: false, error: "This device isn't at a table. Join with a code." };
    }
    const row = this.store.playerByToken(token);
    if (!row || row.bot) return { ok: false, error: "This device isn't at a table. Join with a code." };
    const room = this.rooms.get(row.room_id);
    const seat = room?.seats.find((candidate) => candidate.id === row.id);
    if (!room || !seat) return { ok: false, error: "This device isn't at a table. Join with a code." };
    const generation = this.bind(seat, send, close);
    this.welcome(room, seat);
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
    const result = applyIntent(room.match, seat.id, intent);
    if (!result.ok || !room.handId) {
      this.tell(seat, { type: "error", message: result.error ?? "That move doesn't work." });
      return;
    }
    room.actionSeq += 1;
    this.store.insertAction({
      hand_id: room.handId,
      seq: room.actionSeq,
      player_id: seat.id,
      payload_json: JSON.stringify(intent),
      created_at: nowIso(),
    });
    room.match = result.match;
    if (room.match.hand?.phase === "complete" && room.match.lastHand) {
      this.store.setHandResult(room.handId, JSON.stringify(room.match.lastHand));
      if (room.match.phase === "series_over") {
        room.status = "complete";
        this.store.updateRoom(room.id, { status: "complete" });
      } else {
        this.openHand(room, room.match);
      }
    }
    this.broadcast(room);
  }

  private chat(room: LiveRoom, seat: LiveSeat, message: Extract<ClientMessage, { type: "chat" }>): void {
    const now = Date.now();
    seat.chatTimes = seat.chatTimes.filter((stamp) => now - stamp < 10_000);
    if (seat.chatTimes.length >= 5) {
      this.tell(seat, { type: "error", message: "Easy. Give the table a second." });
      return;
    }
    let text: string | null = null;
    let packId: string | null = null;
    let tauntId: string | null = null;
    let kind: "preset" | "text" = "text";
    if (message.kind === "preset") {
      const taunt = resolveTaunt(message.packId, message.tauntId);
      if (!taunt) {
        this.tell(seat, { type: "error", message: "That line isn't in the pack." });
        return;
      }
      text = taunt.text;
      packId = taunt.packId;
      tauntId = taunt.id;
      kind = "preset";
    } else if (message.kind === "text") {
      text = cleanChatText(message.text);
      if (!text) {
        this.tell(seat, { type: "error", message: `Keep it to ${CHAT_TEXT_LIMIT} characters.` });
        return;
      }
    } else {
      return;
    }
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
  }

  private solo(
    message: Extract<ClientMessage, { type: "solo" }>,
    send: (message: ServerMessage) => void,
    close: () => void,
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
    if (room.seats.filter((seat) => seat.bot).length >= 3) {
      this.tell(host, { type: "error", message: "Three computers is the table limit." });
      return;
    }
    const name = this.nextBotName(room);
    const seat = this.makeSeat(makeId("p"), name, randomBytes(32).toString("hex"), true, true, difficulty);
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
    });
    this.broadcast(room);
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
    if (!room.match || room.status !== "playing") return;
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
    const intent = chooseBotIntent(room.match, playerId, seat.difficulty ?? "normal", Math.random);
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

  private dropRoom(room: LiveRoom): void {
    const timer = this.botTimers.get(room.id);
    if (timer) clearTimeout(timer);
    this.botTimers.delete(room.id);
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
        status: row.status as LiveRoom["status"],
        seats: players.map((player) =>
          this.makeSeat(
            player.id,
            player.name,
            player.token,
            player.bot === 1,
            player.bot === 1,
            player.difficulty === "easy" || player.difficulty === "normal" ? player.difficulty : null,
          ),
        ),
        match: null,
        handId: null,
        actionSeq: 0,
      };
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
          let match = replayMatch(
            room.seats.map((seat) => ({ id: seat.id, name: seat.name })),
            { ...room.settings, targetScore: 150 },
            logged,
          );
          const last = logged[logged.length - 1]!;
          room.handId = last.id;
          room.actionSeq = last.actions.length;
          if (match.hand?.phase === "complete" && match.phase !== "series_over") {
            this.openHand(room, match);
            match = room.match!;
          }
          room.match = match;
          if (match.phase === "series_over") room.status = "complete";
        }
      }
      this.remember(room);
      if (room.status === "playing") this.scheduleBot(room);
    }
  }

  private remember(room: LiveRoom): void {
    this.rooms.set(room.id, room);
    this.byCode.set(room.code, room.id);
    for (const seat of room.seats) this.byPlayer.set(seat.id, room.id);
  }

  private makeSeat(
    id: string,
    name: string,
    token = randomBytes(32).toString("hex"),
    connected = false,
    bot = false,
    difficulty: BotDifficulty | null = null,
  ): LiveSeat {
    return {
      id,
      name,
      token,
      connected,
      bot,
      difficulty: bot ? (difficulty ?? "normal") : null,
      generation: 0,
      send: null,
      close: null,
      leaveTimer: null,
      chatTimes: [],
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

  private broadcast(room: LiveRoom): void {
    for (const seat of room.seats) {
      if (!seat.send) continue;
      seat.send({ type: "state", view: this.view(room, seat.id) });
    }
    this.scheduleBot(room);
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
      })),
      settings: room.settings,
      youId,
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
