import { DatabaseSync } from "node:sqlite";
import type { LoggedAction } from "@uhoh/rules";

export interface RoomRow {
  id: string;
  code: string;
  host_id: string;
  series_id: string;
  player_count: number;
  boneyard_mode: string;
  series_length: number;
  status: string;
  created_at: string;
  /** Null on tables saved before this column existed. */
  rules_version: number | null;
}

export interface PlayerRow {
  id: string;
  room_id: string;
  name: string;
  token: string;
  seat: number;
  created_at: string;
  /** 1 when the seat is a computer. Older databases gain this column on open. */
  bot: number;
  difficulty: string | null;
  /** Account that sat down, when this phone had one. Null on older rows and on computers. */
  user_id?: string | null;
}

export interface UserRow {
  id: string;
  display_name: string;
  avatar_id: string | null;
  created_at: string;
  updated_at: string;
  is_guest: number;
}

export interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  email: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
}

export interface MagicLinkRow {
  id: string;
  email: string;
  token_hash: string;
  user_id: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface HandRow {
  id: string;
  room_id: string;
  series_id: string;
  game_number: number;
  hand_number: number;
  seed: string;
  deck_json: string;
  result_json: string | null;
}

export interface ActionRow {
  hand_id: string;
  seq: number;
  player_id: string;
  payload_json: string;
}

export interface ChatRow {
  id: number;
  room_id: string;
  player_id: string;
  kind: string;
  pack_id: string | null;
  taunt_id: string | null;
  text: string;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA foreign_keys = ON;`);
    if (filename !== ":memory:") this.db.exec(`PRAGMA journal_mode = WAL;`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        host_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        player_count INTEGER NOT NULL,
        boneyard_mode TEXT NOT NULL,
        series_length INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        rules_version INTEGER
      );
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        seat INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        bot INTEGER NOT NULL DEFAULT 0,
        difficulty TEXT
      );
      CREATE TABLE IF NOT EXISTS hands (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        game_number INTEGER NOT NULL,
        hand_number INTEGER NOT NULL,
        seed TEXT NOT NULL,
        deck_json TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS actions (
        hand_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (hand_id, seq)
      );
      CREATE TABLE IF NOT EXISTS chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        pack_id TEXT,
        taunt_id TEXT,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.migrate();
  }

  /** Rooms created before computers existed are missing the seat columns. */
  private migrate(): void {
    const columns = this.db.prepare(`PRAGMA table_info(players)`).all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("bot")) {
      this.db.exec(`ALTER TABLE players ADD COLUMN bot INTEGER NOT NULL DEFAULT 0`);
    }
    if (!names.has("difficulty")) {
      this.db.exec(`ALTER TABLE players ADD COLUMN difficulty TEXT`);
    }
    const roomColumns = this.db.prepare(`PRAGMA table_info(rooms)`).all() as Array<{ name: string }>;
    const roomNames = new Set(roomColumns.map((column) => column.name));
    if (!roomNames.has("rules_version")) {
      this.db.exec(`ALTER TABLE rooms ADD COLUMN rules_version INTEGER`);
    }
    const playerColumns = this.db.prepare(`PRAGMA table_info(players)`).all() as Array<{ name: string }>;
    if (!playerColumns.some((column) => column.name === "user_id")) {
      this.db.exec(`ALTER TABLE players ADD COLUMN user_id TEXT`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        avatar_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_guest INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        email TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (provider, provider_subject)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS magic_links (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS identities_user ON identities (user_id);
      CREATE INDEX IF NOT EXISTS identities_email ON identities (email);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
      CREATE INDEX IF NOT EXISTS players_user ON players (user_id);
    `);
  }

  insertRoom(room: RoomRow): void {
    this.db
      .prepare(
        `INSERT INTO rooms (
          id, code, host_id, series_id, player_count, boneyard_mode, series_length, status, created_at, rules_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        room.id,
        room.code,
        room.host_id,
        room.series_id,
        room.player_count,
        room.boneyard_mode,
        room.series_length,
        room.status,
        room.created_at,
        room.rules_version,
      );
  }

  updateRoom(
    id: string,
    patch: { host_id?: string; series_id?: string; status?: string; rules_version?: number | null },
  ): void {
    const current = this.room(id);
    if (!current) throw new Error("Room disappeared.");
    const version = patch.rules_version === undefined ? current.rules_version : patch.rules_version;
    this.db
      .prepare(`UPDATE rooms SET host_id = ?, series_id = ?, status = ?, rules_version = ? WHERE id = ?`)
      .run(
        patch.host_id ?? current.host_id,
        patch.series_id ?? current.series_id,
        patch.status ?? current.status,
        version,
        id,
      );
  }

  deleteRoom(id: string): void {
    this.db.prepare(`DELETE FROM chat WHERE room_id = ?`).run(id);
    this.db.prepare(`DELETE FROM players WHERE room_id = ?`).run(id);
    this.db.prepare(`DELETE FROM rooms WHERE id = ?`).run(id);
  }

  room(id: string): RoomRow | null {
    return (this.db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id) as RoomRow | undefined) ?? null;
  }

  roomByCode(code: string): RoomRow | null {
    return (this.db.prepare(`SELECT * FROM rooms WHERE code = ?`).get(code) as RoomRow | undefined) ?? null;
  }

  listRooms(): RoomRow[] {
    return this.db.prepare(`SELECT * FROM rooms ORDER BY created_at`).all() as unknown as RoomRow[];
  }

  insertPlayer(player: PlayerRow): void {
    this.db
      .prepare(
        `INSERT INTO players (id, room_id, name, token, seat, created_at, bot, difficulty, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        player.id,
        player.room_id,
        player.name,
        player.token,
        player.seat,
        player.created_at,
        player.bot,
        player.difficulty,
        player.user_id ?? null,
      );
  }

  /** Stamp a seat with an account the first time we know who is holding the phone. */
  setPlayerUser(id: string, userId: string): void {
    this.db.prepare(`UPDATE players SET user_id = ? WHERE id = ? AND user_id IS NULL`).run(userId, id);
  }

  deletePlayer(id: string): void {
    this.db.prepare(`DELETE FROM players WHERE id = ?`).run(id);
  }

  players(roomId: string): PlayerRow[] {
    return this.db
      .prepare(`SELECT * FROM players WHERE room_id = ? ORDER BY seat`)
      .all(roomId) as unknown as PlayerRow[];
  }

  playerByToken(token: string): PlayerRow | null {
    return (this.db.prepare(`SELECT * FROM players WHERE token = ?`).get(token) as PlayerRow | undefined) ?? null;
  }

  insertHand(hand: HandRow & { created_at: string }): void {
    this.db
      .prepare(
        `INSERT INTO hands (
          id, room_id, series_id, game_number, hand_number, seed, deck_json, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hand.id,
        hand.room_id,
        hand.series_id,
        hand.game_number,
        hand.hand_number,
        hand.seed,
        hand.deck_json,
        hand.result_json,
        hand.created_at,
      );
  }

  setHandResult(handId: string, resultJson: string): void {
    this.db.prepare(`UPDATE hands SET result_json = ? WHERE id = ?`).run(resultJson, handId);
  }

  handsForSeries(roomId: string, seriesId: string): HandRow[] {
    return this.db
      .prepare(
        `SELECT * FROM hands WHERE room_id = ? AND series_id = ? ORDER BY game_number, hand_number, created_at`,
      )
      .all(roomId, seriesId) as unknown as HandRow[];
  }

  insertAction(action: ActionRow & { created_at: string }): void {
    this.db
      .prepare(
        `INSERT INTO actions (hand_id, seq, player_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(action.hand_id, action.seq, action.player_id, action.payload_json, action.created_at);
  }

  actions(handId: string): LoggedAction[] {
    const rows = this.db
      .prepare(`SELECT player_id, payload_json FROM actions WHERE hand_id = ? ORDER BY seq`)
      .all(handId) as unknown as Array<{ player_id: string; payload_json: string }>;
    return rows.map((row) => ({
      playerId: row.player_id,
      intent: JSON.parse(row.payload_json) as LoggedAction["intent"],
    }));
  }

  insertChat(row: Omit<ChatRow, "id">): ChatRow {
    const result = this.db
      .prepare(
        `INSERT INTO chat (room_id, player_id, kind, pack_id, taunt_id, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.room_id, row.player_id, row.kind, row.pack_id, row.taunt_id, row.text, row.created_at);
    return this.db.prepare(`SELECT * FROM chat WHERE id = ?`).get(Number(result.lastInsertRowid)) as unknown as ChatRow;
  }

  recentChat(roomId: string, limit = 40): ChatRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM chat WHERE room_id = ? ORDER BY id DESC LIMIT ?`)
      .all(roomId, limit) as unknown as ChatRow[];
    return rows.reverse();
  }

  insertUser(user: UserRow): void {
    this.db
      .prepare(
        `INSERT INTO users (id, display_name, avatar_id, created_at, updated_at, is_guest) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, user.display_name, user.avatar_id, user.created_at, user.updated_at, user.is_guest);
  }

  user(id: string): UserRow | null {
    return (this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined) ?? null;
  }

  updateUser(id: string, patch: { display_name?: string; avatar_id?: string | null; is_guest?: number; updated_at: string }): void {
    const current = this.user(id);
    if (!current) return;
    this.db
      .prepare(`UPDATE users SET display_name = ?, avatar_id = ?, is_guest = ?, updated_at = ? WHERE id = ?`)
      .run(
        patch.display_name ?? current.display_name,
        patch.avatar_id === undefined ? current.avatar_id : patch.avatar_id,
        patch.is_guest ?? current.is_guest,
        patch.updated_at,
        id,
      );
  }

  insertIdentity(row: IdentityRow): void {
    this.db
      .prepare(
        `INSERT INTO identities (id, user_id, provider, provider_subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.user_id, row.provider, row.provider_subject, row.email, row.created_at);
  }

  identity(provider: string, subject: string): IdentityRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM identities WHERE provider = ? AND provider_subject = ?`)
        .get(provider, subject) as IdentityRow | undefined) ?? null
    );
  }

  identitiesForUser(userId: string): IdentityRow[] {
    return this.db.prepare(`SELECT * FROM identities WHERE user_id = ? ORDER BY created_at`).all(userId) as unknown as IdentityRow[];
  }

  userByEmail(email: string): UserRow | null {
    const identity = this.db
      .prepare(`SELECT user_id FROM identities WHERE email = ? ORDER BY created_at LIMIT 1`)
      .get(email) as { user_id: string } | undefined;
    return identity ? this.user(identity.user_id) : null;
  }

  insertSession(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.user_id, row.token_hash, row.expires_at, row.created_at, row.last_seen_at);
  }

  sessionByHash(tokenHash: string): SessionRow | null {
    return (this.db.prepare(`SELECT * FROM sessions WHERE token_hash = ?`).get(tokenHash) as SessionRow | undefined) ?? null;
  }

  touchSession(id: string, lastSeenAt: string): void {
    this.db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(lastSeenAt, id);
  }

  deleteSessionByHash(tokenHash: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
  }

  insertMagicLink(row: MagicLinkRow): void {
    this.db
      .prepare(
        `INSERT INTO magic_links (id, email, token_hash, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.email, row.token_hash, row.user_id, row.expires_at, row.used_at, row.created_at);
  }

  magicLinkByHash(tokenHash: string): MagicLinkRow | null {
    return (this.db.prepare(`SELECT * FROM magic_links WHERE token_hash = ?`).get(tokenHash) as MagicLinkRow | undefined) ?? null;
  }

  markMagicLinkUsed(id: string, usedAt: string): void {
    this.db.prepare(`UPDATE magic_links SET used_at = ? WHERE id = ? AND used_at IS NULL`).run(usedAt, id);
  }
}
