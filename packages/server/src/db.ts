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
  /** 1 when the host marked the room casual. Older rows are ranked. */
  casual?: number | null;
  /** 1 when the room is a public quick-match table. Older rows are private. */
  listed?: number | null;
  /** 1 when every seat is a soak test. Those rooms are not ranked and are deleted after the run. */
  soak?: number | null;
  /** The soak process that opened this table. Cleanup for one run leaves the others. */
  soak_run?: string | null;
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
  /** Portrait id. Null on rows saved before avatars; the server fills a default. */
  avatar_id?: string | null;
}

export interface UserRow {
  id: string;
  display_name: string;
  avatar_id: string | null;
  created_at: string;
  updated_at: string;
  is_guest: number;
  rating?: number;
  ranked_games?: number;
  ranked_wins?: number;
  ranked_losses?: number;
  vs_games?: number;
  vs_wins?: number;
  vs_losses?: number;
  games_played?: number;
  season_id?: number;
  season_points?: number;
  win_streak?: number;
  last_win_day?: string | null;
  peak_tier?: string;
  peak_step?: string | null;
  /** 1 for a server-owned practice account. Humans stay 0. */
  is_bot?: number;
  /** 1 for a post-deploy soak account. Hidden from leaderboards and stats. */
  is_soak?: number;
  /** Which soak process created this account. Null on older rows. */
  soak_run?: string | null;
  /** 1 after the player confirms they are 13 or older. */
  age_ok?: number;
}

export interface StandingUpdate {
  rating: number;
  ranked_games: number;
  ranked_wins: number;
  ranked_losses: number;
  vs_games: number;
  vs_wins: number;
  vs_losses: number;
  games_played: number;
  season_id: number;
  season_points: number;
  win_streak: number;
  last_win_day: string | null;
  peak_tier: string;
  peak_step: string | null;
  updated_at: string;
}

export interface RatingEventRow {
  id: string;
  user_id: string;
  room_id: string;
  series_id: string;
  game_number: number;
  player_id: string;
  ranked: number;
  provisional: number;
  rating_before: number;
  rating_after: number;
  delta: number;
  season_id: number;
  points_earned: number;
  points_before: number;
  points_after: number;
  tier_before: string;
  tier_after: string;
  step_before: "III" | "II" | "I" | null;
  step_after: "III" | "II" | "I" | null;
  stepped_up: number;
  breakdown_json: string;
  created_at: string;
}

export interface SeasonPeakRow {
  user_id: string;
  season_id: number;
  tier: string;
  step: string | null;
  points: number;
  reward_id: string;
  created_at: string;
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
  /** 1 when the player confirmed 13+ before asking for this link. */
  age_ok?: number;
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
    // A deploy runs the new process before the old one has exited, and both
    // open this file. Wait instead of failing the request with a locked database.
    this.db.exec(`PRAGMA busy_timeout = 3000;`);
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
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rating_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        game_number INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        ranked INTEGER NOT NULL,
        provisional INTEGER NOT NULL,
        rating_before INTEGER NOT NULL,
        rating_after INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        season_id INTEGER NOT NULL,
        points_earned INTEGER NOT NULL,
        points_before INTEGER NOT NULL,
        points_after INTEGER NOT NULL,
        tier_before TEXT NOT NULL,
        tier_after TEXT NOT NULL,
        step_before TEXT,
        step_after TEXT,
        stepped_up INTEGER NOT NULL,
        breakdown_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, room_id, series_id, game_number)
      );
      CREATE TABLE IF NOT EXISTS season_peaks (
        user_id TEXT NOT NULL,
        season_id INTEGER NOT NULL,
        tier TEXT NOT NULL,
        step TEXT,
        points INTEGER NOT NULL,
        reward_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, season_id)
      );
      CREATE TABLE IF NOT EXISTS game_moments (
        room_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        game_number INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (room_id, series_id, game_number, player_id)
      );
      CREATE TABLE IF NOT EXISTS wallets (
        user_id TEXT PRIMARY KEY,
        bones INTEGER NOT NULL,
        gold_bones INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS owned_items (
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        PRIMARY KEY (user_id, item_id)
      );
      CREATE TABLE IF NOT EXISTS loadouts (
        user_id TEXT PRIMARY KEY,
        character_id TEXT,
        tile_id TEXT,
        table_id TEXT,
        frame_id TEXT,
        effect_id TEXT,
        trash_id TEXT,
        emote_id TEXT
      );
    `);
    const roomsNow = this.db.prepare(`PRAGMA table_info(rooms)`).all() as Array<{ name: string }>;
    if (!roomsNow.some((column) => column.name === "casual")) {
      this.db.exec(`ALTER TABLE rooms ADD COLUMN casual INTEGER NOT NULL DEFAULT 0`);
    }
    if (!roomsNow.some((column) => column.name === "listed")) {
      this.db.exec(`ALTER TABLE rooms ADD COLUMN listed INTEGER NOT NULL DEFAULT 0`);
    }
    if (!roomsNow.some((column) => column.name === "soak")) {
      this.db.exec(`ALTER TABLE rooms ADD COLUMN soak INTEGER NOT NULL DEFAULT 0`);
    }
    if (!roomsNow.some((column) => column.name === "soak_run")) {
      this.db.exec(`ALTER TABLE rooms ADD COLUMN soak_run TEXT`);
    }
    const playersNow = this.db.prepare(`PRAGMA table_info(players)`).all() as Array<{ name: string }>;
    if (!playersNow.some((column) => column.name === "avatar_id")) {
      this.db.exec(`ALTER TABLE players ADD COLUMN avatar_id TEXT`);
    }
    const usersNow = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
    const userNames = new Set(usersNow.map((column) => column.name));
    const addUser = (name: string, ddl: string) => {
      if (!userNames.has(name)) this.db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`);
    };
    addUser("rating", "rating INTEGER NOT NULL DEFAULT 1200");
    addUser("ranked_games", "ranked_games INTEGER NOT NULL DEFAULT 0");
    addUser("ranked_wins", "ranked_wins INTEGER NOT NULL DEFAULT 0");
    addUser("ranked_losses", "ranked_losses INTEGER NOT NULL DEFAULT 0");
    addUser("vs_games", "vs_games INTEGER NOT NULL DEFAULT 0");
    addUser("vs_wins", "vs_wins INTEGER NOT NULL DEFAULT 0");
    addUser("vs_losses", "vs_losses INTEGER NOT NULL DEFAULT 0");
    addUser("games_played", "games_played INTEGER NOT NULL DEFAULT 0");
    addUser("season_id", "season_id INTEGER NOT NULL DEFAULT 0");
    addUser("season_points", "season_points INTEGER NOT NULL DEFAULT 0");
    addUser("win_streak", "win_streak INTEGER NOT NULL DEFAULT 0");
    addUser("last_win_day", "last_win_day TEXT");
    addUser("peak_tier", "peak_tier TEXT NOT NULL DEFAULT 'rookie'");
    addUser("peak_step", "peak_step TEXT");
    addUser("is_bot", "is_bot INTEGER NOT NULL DEFAULT 0");
    addUser("is_soak", "is_soak INTEGER NOT NULL DEFAULT 0");
    addUser("soak_run", "soak_run TEXT");
    addUser("age_ok", "age_ok INTEGER NOT NULL DEFAULT 0");
    const walletCols = this.db.prepare(`PRAGMA table_info(wallets)`).all() as Array<{ name: string }>;
    const walletNames = new Set(walletCols.map((column) => column.name));
    if (!walletNames.has("earned_day")) this.db.exec(`ALTER TABLE wallets ADD COLUMN earned_day TEXT`);
    if (!walletNames.has("earned_today")) {
      this.db.exec(`ALTER TABLE wallets ADD COLUMN earned_today INTEGER NOT NULL DEFAULT 0`);
    }
    const magicCols = this.db.prepare(`PRAGMA table_info(magic_links)`).all() as Array<{ name: string }>;
    if (!magicCols.some((column) => column.name === "age_ok")) {
      this.db.exec(`ALTER TABLE magic_links ADD COLUMN age_ok INTEGER NOT NULL DEFAULT 0`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bone_grants (
        user_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        game_number INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, room_id, series_id, game_number)
      );
      CREATE TABLE IF NOT EXISTS bot_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bot_events_kind ON bot_events (kind);
      CREATE TABLE IF NOT EXISTS stripe_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_blocks (
        user_id TEXT NOT NULL,
        blocked_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, blocked_user_id)
      );
      CREATE TABLE IF NOT EXISTS player_reports (
        id TEXT PRIMARY KEY,
        reporter_user_id TEXT NOT NULL,
        reported_user_id TEXT NOT NULL,
        room_code TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coin_purchases (
        session_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        lookup_key TEXT NOT NULL,
        coins INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pulses (
        day TEXT NOT NULL,
        name TEXT NOT NULL,
        n INTEGER NOT NULL,
        PRIMARY KEY (day, name)
      );
      CREATE TABLE IF NOT EXISTS client_errors (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_presence (
        day TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (day, user_id)
      );
    `);
  }

  insertRoom(room: RoomRow): void {
    this.db
      .prepare(
        `INSERT INTO rooms (
          id, code, host_id, series_id, player_count, boneyard_mode, series_length, status, created_at, rules_version, casual, listed, soak, soak_run
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        room.casual ? 1 : 0,
        room.listed ? 1 : 0,
        room.soak ? 1 : 0,
        room.soak_run ?? null,
      );
  }

  updateRoom(
    id: string,
    patch: {
      host_id?: string;
      series_id?: string;
      status?: string;
      rules_version?: number | null;
      casual?: boolean;
      listed?: boolean;
    },
  ): void {
    const current = this.room(id);
    if (!current) throw new Error("Room disappeared.");
    const version = patch.rules_version === undefined ? current.rules_version : patch.rules_version;
    const casual = patch.casual === undefined ? (current.casual ? 1 : 0) : patch.casual ? 1 : 0;
    const listed = patch.listed === undefined ? (current.listed ? 1 : 0) : patch.listed ? 1 : 0;
    this.db
      .prepare(
        `UPDATE rooms SET host_id = ?, series_id = ?, status = ?, rules_version = ?, casual = ?, listed = ? WHERE id = ?`,
      )
      .run(
        patch.host_id ?? current.host_id,
        patch.series_id ?? current.series_id,
        patch.status ?? current.status,
        version,
        casual,
        listed,
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
        `INSERT INTO players (id, room_id, name, token, seat, created_at, bot, difficulty, user_id, avatar_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        player.avatar_id ?? null,
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

  playerById(id: string): PlayerRow | null {
    return (this.db.prepare(`SELECT * FROM players WHERE id = ?`).get(id) as PlayerRow | undefined) ?? null;
  }

  markAge(userId: string, at: string): void {
    this.db.prepare(`UPDATE users SET age_ok = 1, updated_at = ? WHERE id = ?`).run(at, userId);
  }

  blockUser(userId: string, blockedUserId: string, at: string): void {
    this.db
      .prepare(
        `INSERT INTO player_blocks (user_id, blocked_user_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id, blocked_user_id) DO NOTHING`,
      )
      .run(userId, blockedUserId, at);
  }

  isBlocked(userId: string, blockedUserId: string): boolean {
    return Boolean(
      this.db.prepare(`SELECT 1 AS n FROM player_blocks WHERE user_id = ? AND blocked_user_id = ?`).get(userId, blockedUserId),
    );
  }

  isBlockedEither(left: string, right: string): boolean {
    return this.isBlocked(left, right) || this.isBlocked(right, left);
  }

  reportCountSince(userId: string, since: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM player_reports WHERE reporter_user_id = ? AND created_at > ?`)
      .get(userId, since) as { n: number };
    return row.n;
  }

  notePresence(userId: string, day: string): void {
    this.db.prepare(`INSERT INTO daily_presence (day, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`).run(day, userId);
  }

  bumpPulse(name: string, day: string): void {
    this.db
      .prepare(
        `INSERT INTO pulses (day, name, n) VALUES (?, ?, 1)
         ON CONFLICT (day, name) DO UPDATE SET n = n + 1`,
      )
      .run(day, name);
  }

  pulseCounts(): Array<{ day: string; name: string; n: number }> {
    return this.db.prepare(`SELECT day, name, n FROM pulses ORDER BY day ASC, name ASC`).all() as Array<{
      day: string;
      name: string;
      n: number;
    }>;
  }

  noteClientError(id: string, message: string, at: string): void {
    this.db.prepare(`INSERT INTO client_errors (id, created_at, message) VALUES (?, ?, ?)`).run(id, at, message);
    const rows = this.db.prepare(`SELECT id FROM client_errors ORDER BY created_at ASC`).all() as Array<{ id: string }>;
    const extra = rows.length - 200;
    if (extra <= 0) return;
    const drop = this.db.prepare(`DELETE FROM client_errors WHERE id = ?`);
    for (const row of rows.slice(0, extra)) drop.run(row.id);
  }

  clientErrors(): Array<{ id: string; message: string }> {
    return this.db
      .prepare(`SELECT id, message FROM client_errors ORDER BY created_at ASC`)
      .all() as Array<{ id: string; message: string }>;
  }

  insertReport(row: {
    id: string;
    reporterUserId: string;
    reportedUserId: string;
    roomCode: string | null;
    reason: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO player_reports (id, reporter_user_id, reported_user_id, room_code, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.reporterUserId, row.reportedUserId, row.roomCode, row.reason, row.createdAt);
  }

  /**
   * Drop the name, email, and sign-in. The user id stays so old game rows still add up.
   * Purchases stay too, keyed by that id, with no card data on them.
   */
  erasePersonalData(userId: string, at: string): boolean {
    const user = this.user(userId);
    if (!user || user.is_bot === 1) return false;
    const emails = this.identitiesForUser(userId)
      .map((row) => row.email)
      .filter((email): email is string => Boolean(email));
    this.db.prepare(`DELETE FROM identities WHERE user_id = ?`).run(userId);
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
    this.db.prepare(`DELETE FROM magic_links WHERE user_id = ?`).run(userId);
    for (const email of emails) this.db.prepare(`DELETE FROM magic_links WHERE email = ?`).run(email);
    this.db.prepare(`DELETE FROM player_blocks WHERE user_id = ? OR blocked_user_id = ?`).run(userId, userId);
    this.db.prepare(`UPDATE players SET name = 'Deleted' WHERE user_id = ?`).run(userId);
    this.db
      .prepare(
        `UPDATE users SET display_name = 'Deleted', avatar_id = '2hot4tv', is_guest = 1, soak_run = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(at, userId);
    return true;
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
        `INSERT INTO users (id, display_name, avatar_id, created_at, updated_at, is_guest, is_soak) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.display_name,
        user.avatar_id,
        user.created_at,
        user.updated_at,
        user.is_guest,
        user.is_soak ? 1 : 0,
      );
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
        `INSERT INTO magic_links (id, email, token_hash, user_id, expires_at, used_at, created_at, age_ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.email, row.token_hash, row.user_id, row.expires_at, row.used_at, row.created_at, row.age_ok === 1 ? 1 : 0);
  }

  magicLinkByHash(tokenHash: string): MagicLinkRow | null {
    return (this.db.prepare(`SELECT * FROM magic_links WHERE token_hash = ?`).get(tokenHash) as MagicLinkRow | undefined) ?? null;
  }

  markMagicLinkUsed(id: string, usedAt: string): void {
    this.db.prepare(`UPDATE magic_links SET used_at = ? WHERE id = ? AND used_at IS NULL`).run(usedAt, id);
  }

  meta(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`).run(key, value);
  }

  saveStanding(userId: string, patch: StandingUpdate): void {
    this.db
      .prepare(
        `UPDATE users SET
          rating = ?, ranked_games = ?, ranked_wins = ?, ranked_losses = ?,
          vs_games = ?, vs_wins = ?, vs_losses = ?, games_played = ?,
          season_id = ?, season_points = ?, win_streak = ?, last_win_day = ?,
          peak_tier = ?, peak_step = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        patch.rating,
        patch.ranked_games,
        patch.ranked_wins,
        patch.ranked_losses,
        patch.vs_games,
        patch.vs_wins,
        patch.vs_losses,
        patch.games_played,
        patch.season_id,
        patch.season_points,
        patch.win_streak,
        patch.last_win_day,
        patch.peak_tier,
        patch.peak_step,
        patch.updated_at,
        userId,
      );
  }

  allUsers(): UserRow[] {
    return this.db.prepare(`SELECT * FROM users`).all() as unknown as UserRow[];
  }

  topBySeason(limit: number, includeBots = false): UserRow[] {
    const sql = includeBots
      ? `SELECT * FROM users WHERE COALESCE(is_soak, 0) = 0 ORDER BY season_points DESC, rating DESC, display_name ASC LIMIT ?`
      : `SELECT * FROM users WHERE is_bot = 0 AND COALESCE(is_soak, 0) = 0 ORDER BY season_points DESC, rating DESC, display_name ASC LIMIT ?`;
    return this.db.prepare(sql).all(limit) as unknown as UserRow[];
  }

  topByRating(limit: number, includeBots = false): UserRow[] {
    const sql = includeBots
      ? `SELECT * FROM users WHERE COALESCE(is_soak, 0) = 0 ORDER BY rating DESC, ranked_games DESC, display_name ASC LIMIT ?`
      : `SELECT * FROM users WHERE is_bot = 0 AND COALESCE(is_soak, 0) = 0 ORDER BY rating DESC, ranked_games DESC, display_name ASC LIMIT ?`;
    return this.db.prepare(sql).all(limit) as unknown as UserRow[];
  }

  markSoak(id: string): void {
    this.db.prepare(`UPDATE users SET is_soak = 1 WHERE id = ?`).run(id);
  }

  /** Remember which soak process owns this account. The flag stays set. */
  setSoakRun(id: string, runId: string): void {
    this.db.prepare(`UPDATE users SET soak_run = ?, is_soak = 1 WHERE id = ?`).run(runId, id);
  }

  markBot(id: string): void {
    this.db.prepare(`UPDATE users SET is_bot = 1 WHERE id = ?`).run(id);
  }

  listBots(): UserRow[] {
    return this.db.prepare(`SELECT * FROM users WHERE is_bot = 1 ORDER BY display_name ASC`).all() as unknown as UserRow[];
  }

  insertBotEvent(kind: string, name: string, detail: string, at: string): void {
    this.db
      .prepare(`INSERT INTO bot_events (kind, name, detail, created_at) VALUES (?, ?, ?, ?)`)
      .run(kind, name, detail, at);
  }

  /** Deletes bot accounts and the stats, wallets, and items that belong to them. */
  purgeBots(): number {
    const rows = this.db.prepare(`SELECT id FROM users WHERE is_bot = 1`).all() as Array<{ id: string }>;
    for (const row of rows) {
      this.db.prepare(`DELETE FROM wallets WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM owned_items WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM loadouts WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM rating_history WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM identities WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM season_peaks WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM bone_grants WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM players WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM users WHERE id = ?`).run(row.id);
    }
    this.db.prepare(`DELETE FROM bot_events`).run();
    this.db.prepare(`DELETE FROM app_meta WHERE key LIKE 'bot_%'`).run();
    return rows.length;
  }

  /** Deletes one room and the hands, actions, chat, and moments that belong to it. */
  purgeRoom(id: string): void {
    const hands = this.db.prepare(`SELECT id FROM hands WHERE room_id = ?`).all(id) as Array<{ id: string }>;
    for (const hand of hands) this.db.prepare(`DELETE FROM actions WHERE hand_id = ?`).run(hand.id);
    this.db.prepare(`DELETE FROM hands WHERE room_id = ?`).run(id);
    this.db.prepare(`DELETE FROM chat WHERE room_id = ?`).run(id);
    this.db.prepare(`DELETE FROM game_moments WHERE room_id = ?`).run(id);
    this.db.prepare(`DELETE FROM rating_history WHERE room_id = ?`).run(id);
    this.db.prepare(`DELETE FROM bone_grants WHERE room_id = ?`).run(id);
    this.db.prepare(`DELETE FROM players WHERE room_id = ?`).run(id);
    this.db.prepare(`DELETE FROM rooms WHERE id = ?`).run(id);
  }

  /**
   * Deletes one soak run's accounts and tables. Other runs, and real players, stay.
   * Call after that run's live rooms have been dropped, so a deleted row is not still in memory.
   */
  purgeSoak(runId: string): { users: number; rooms: number } {
    if (!runId) return { users: 0, rooms: 0 };
    const rooms = this.db.prepare(`SELECT id FROM rooms WHERE soak_run = ?`).all(runId) as Array<{ id: string }>;
    for (const room of rooms) this.purgeRoom(room.id);
    const users = this.db.prepare(`SELECT id FROM users WHERE soak_run = ?`).all(runId) as Array<{ id: string }>;
    for (const row of users) {
      this.db.prepare(`DELETE FROM wallets WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM owned_items WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM loadouts WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM rating_history WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM identities WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM season_peaks WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM bone_grants WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM players WHERE user_id = ?`).run(row.id);
      this.db.prepare(`DELETE FROM users WHERE id = ?`).run(row.id);
    }
    return { users: users.length, rooms: rooms.length };
  }

  ratingEvent(userId: string, roomId: string, seriesId: string, gameNumber: number): RatingEventRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM rating_history WHERE user_id = ? AND room_id = ? AND series_id = ? AND game_number = ?`,
        )
        .get(userId, roomId, seriesId, gameNumber) as RatingEventRow | undefined) ?? null
    );
  }

  insertRatingEvent(row: RatingEventRow): void {
    this.db
      .prepare(
        `INSERT INTO rating_history (
          id, user_id, room_id, series_id, game_number, player_id, ranked, provisional,
          rating_before, rating_after, delta, season_id, points_earned, points_before, points_after,
          tier_before, tier_after, step_before, step_after, stepped_up, breakdown_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.user_id,
        row.room_id,
        row.series_id,
        row.game_number,
        row.player_id,
        row.ranked,
        row.provisional,
        row.rating_before,
        row.rating_after,
        row.delta,
        row.season_id,
        row.points_earned,
        row.points_before,
        row.points_after,
        row.tier_before,
        row.tier_after,
        row.step_before,
        row.step_after,
        row.stepped_up,
        row.breakdown_json,
        row.created_at,
      );
  }

  saveSeasonPeak(row: SeasonPeakRow): void {
    this.db
      .prepare(
        `INSERT INTO season_peaks (user_id, season_id, tier, step, points, reward_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, season_id) DO UPDATE SET
           tier = excluded.tier, step = excluded.step, points = excluded.points, reward_id = excluded.reward_id`,
      )
      .run(row.user_id, row.season_id, row.tier, row.step, row.points, row.reward_id, row.created_at);
  }

  seasonPeak(userId: string, seasonId: number): SeasonPeakRow | null {
    return (
      (this.db.prepare(`SELECT * FROM season_peaks WHERE user_id = ? AND season_id = ?`).get(userId, seasonId) as
        | SeasonPeakRow
        | undefined) ?? null
    );
  }

  addBigMoment(roomId: string, seriesId: string, gameNumber: number, playerId: string): void {
    this.db
      .prepare(
        `INSERT INTO game_moments (room_id, series_id, game_number, player_id, count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(room_id, series_id, game_number, player_id) DO UPDATE SET count = count + 1`,
      )
      .run(roomId, seriesId, gameNumber, playerId);
  }

  bigMoments(roomId: string, seriesId: string, gameNumber: number): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT player_id, count FROM game_moments WHERE room_id = ? AND series_id = ? AND game_number = ?`)
      .all(roomId, seriesId, gameNumber) as unknown as Array<{ player_id: string; count: number }>;
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.player_id] = row.count;
    return counts;
  }
}
