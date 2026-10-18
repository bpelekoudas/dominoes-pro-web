import { DatabaseSync } from "node:sqlite";
import type { Intent } from "@uhoh/rules";

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
        created_at TEXT NOT NULL
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
  }

  insertRoom(room: RoomRow): void {
    this.db
      .prepare(
        `INSERT INTO rooms (
          id, code, host_id, series_id, player_count, boneyard_mode, series_length, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
  }

  updateRoom(id: string, patch: { host_id?: string; series_id?: string; status?: string }): void {
    const current = this.room(id);
    if (!current) throw new Error("Room disappeared.");
    this.db
      .prepare(`UPDATE rooms SET host_id = ?, series_id = ?, status = ? WHERE id = ?`)
      .run(patch.host_id ?? current.host_id, patch.series_id ?? current.series_id, patch.status ?? current.status, id);
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
        `INSERT INTO players (id, room_id, name, token, seat, created_at, bot, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
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

  actions(handId: string): Array<{ playerId: string; intent: Intent }> {
    const rows = this.db
      .prepare(`SELECT player_id, payload_json FROM actions WHERE hand_id = ? ORDER BY seq`)
      .all(handId) as unknown as Array<{ player_id: string; payload_json: string }>;
    return rows.map((row) => ({
      playerId: row.player_id,
      intent: JSON.parse(row.payload_json) as Intent,
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
}
