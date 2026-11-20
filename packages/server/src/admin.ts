import { statfsSync, statSync } from "node:fs";
import type { Store } from "./db.js";
import { listBackups } from "./backup.js";
import { COIN_PACKS } from "./coins.js";
import { dailyAdmin, type DailyAdmin } from "./daily.js";
import type { Hub } from "./hub.js";

/** Used when ADMIN_EMAILS is unset. An env value replaces this list. */
export const DEFAULT_ADMIN_EMAILS = [
  "bpelekoudas@gmail.com",
  "uhohdominoes@gmail.com",
  "gipsondre@gmail.com",
  "justinmmichaels@gmail.com",
  "kyleedrington@gmail.com",
] as const;

const CACHE_MS = 60_000;
const PLAN_DISK_BYTES = 1024 * 1024 * 1024;
const BUSY_YELLOW = 15;
const BUSY_RED = 25;

/**
 * Same mailbox for Gmail. Dots and +tags in the name do not make a new address,
 * and googlemail.com is gmail.com. Other domains only get trim and lowercase.
 */
export function canonicalEmail(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase().replace(/^["']+|["']+$/g, "");
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@") || at === email.length - 1) return null;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (!local || !domain || local.includes(" ") || domain.includes(" ")) return null;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replaceAll(".", "");
  }
  if (!local) return null;
  return `${local}@${domain}`;
}

export function adminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.ADMIN_EMAILS;
  const source = raw == null || raw.trim() === "" ? DEFAULT_ADMIN_EMAILS.join(",") : raw.trim().replace(/^["']+|["']+$/g, "");
  const allow = new Set<string>();
  for (const part of source.split(/[,;\n]+/)) {
    const email = canonicalEmail(part);
    if (email) allow.add(email);
  }
  return allow;
}

export function emailIsAdmin(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const canonical = canonicalEmail(email);
  if (!canonical) return false;
  return adminEmails(env).has(canonical);
}

export function accountEmails(store: Store, userId: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const row of store.identitiesForUser(userId)) {
    const email = row.email?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export function userIsAdmin(store: Store, userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return accountEmails(store, userId).some((email) => emailIsAdmin(email, env));
}

/** Shown only after a real session. Names the address on the account so a partner can see a mismatch. */
export function adminDeniedMessage(emails: string[]): string {
  if (emails.length === 0) {
    return "You are signed in, but this account has no email saved. Sign in with Google or an email link, then open this page again.";
  }
  return `You are signed in as ${emails.join(", ")}, which is not on the approved list.`;
}

export type Capacity = "green" | "yellow" | "red";

export interface DayCount {
  day: string;
  n: number;
}

export interface AdminStats {
  generatedAt: string;
  players: {
    accounts: number;
    guests: number;
    signedIn: number;
    google: number;
    email: number;
    apple: number;
    newPerDay: DayCount[];
    activeToday: number;
    activeWeek: number;
    returningRate: number | null;
    onlineNow: number;
    recent: string[];
  };
  gameplay: {
    tablesOpen: number;
    tablesPlaying: number;
    humanSeats: number;
    botSeats: number;
    handsPerDay: DayCount[];
    gamesPerDay: DayCount[];
    roomsPerDay: DayCount[];
    averageMatchSeconds: number | null;
    averageHumans: number | null;
    quickRooms: number;
    friendRooms: number;
    seriesFinished: number;
    seriesAbandoned: number;
    gamesWon: number;
    completionRate: number | null;
    shareTaps: number;
  };
  retention: {
    day1: { cohort: number; returned: number; rate: number } | null;
    day7: { cohort: number; returned: number; rate: number } | null;
  };
  economy: {
    shopMode: "TEST" | "LIVE" | "CLOSED";
    bonesEarned: number;
    bonesHeld: number;
    goldHeld: number;
    purchases: Array<{ pack: string; count: number; cents: number }>;
    topItems: Array<{ id: string; count: number }>;
    characters: Array<{ name: string; count: number }>;
  };
  safety: {
    reports: number;
    blocks: number;
    ageBlocked: number;
    accountsDeleted: number;
  };
  health: {
    uptimeSeconds: number;
    commit: string | null;
    memoryMb: number;
    cpuPercent: number | null;
    sockets: number;
    errorsToday: number;
    errorsSinceBoot: number;
    lastBackupAt: string | null;
    backupCount: number;
    databaseBytes: number;
    diskBytes: number | null;
    diskTotalBytes: number | null;
    planDiskBytes: number;
    playingTables: number;
    capacity: Capacity;
  };
  daily: DailyAdmin;
  omitted: string[];
}

const seenToday = new Set<string>();
let serverErrors = 0;
let lastCpu = process.cpuUsage();
let lastCpuAt = process.hrtime.bigint();
let cache: { at: number; body: AdminStats } | null = null;

export function clearAdminCache(): void {
  cache = null;
}

export function notePresence(store: Store, userId: string, now = new Date()): void {
  const row = store.user(userId);
  if (!row || row.is_bot === 1 || row.is_soak === 1) return;
  const day = now.toISOString().slice(0, 10);
  const key = `${day}:${userId}`;
  if (seenToday.has(key)) return;
  seenToday.add(key);
  if (seenToday.size > 20_000) seenToday.clear();
  store.notePresence(userId, day);
}

export function noteServerError(store: Store, now = new Date()): void {
  serverErrors += 1;
  try {
    store.bumpPulse("http_5xx", now.toISOString().slice(0, 10));
  } catch {
    // A stats write must not turn one error into another.
  }
}

export function noteAgeBlocked(store: Store, now = new Date()): void {
  try {
    store.bumpPulse("age_blocked", now.toISOString().slice(0, 10));
  } catch {
    // The refusal still stands.
  }
}

function capacityFor(playing: number): Capacity {
  if (playing >= BUSY_RED) return "red";
  if (playing >= BUSY_YELLOW) return "yellow";
  return "green";
}

function cpuPercent(): number | null {
  const now = process.cpuUsage();
  const at = process.hrtime.bigint();
  const used = now.user - lastCpu.user + (now.system - lastCpu.system);
  const elapsedUs = Number(at - lastCpuAt) / 1000;
  lastCpu = now;
  lastCpuAt = at;
  if (elapsedUs <= 0) return null;
  return Math.round((used / elapsedUs) * 1000) / 10;
}

function dayList(now: Date, count = 30): string[] {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) days.push(new Date(start - i * 86_400_000).toISOString().slice(0, 10));
  return days;
}

function fillDays(days: string[], rows: Array<{ day: string; n: number }>): DayCount[] {
  const map = new Map(rows.map((row) => [row.day, row.n]));
  return days.map((day) => ({ day, n: map.get(day) ?? 0 }));
}

function count(store: Store, sql: string, ...args: Array<string | number>): number {
  const row = store.db.prepare(sql).get(...args) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

function rowsOf<T>(store: Store, sql: string, ...args: Array<string | number>): T[] {
  return store.db.prepare(sql).all(...args) as T[];
}

function humans(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}is_bot = 0 AND COALESCE(${p}is_soak, 0) = 0`;
}

function rate(part: number, whole: number): { cohort: number; returned: number; rate: number } | null {
  if (whole <= 0) return null;
  return { cohort: whole, returned: part, rate: Math.round((part / whole) * 1000) / 1000 };
}

function shopMode(shape: string): "TEST" | "LIVE" | "CLOSED" {
  if (shape === "live") return "LIVE";
  if (shape === "test") return "TEST";
  return "CLOSED";
}

export function collectAdminStats(input: {
  store: Store;
  hub: Hub;
  dataDir: string;
  dbFile: string;
  shopShape: string;
  now?: Date;
}): AdminStats {
  const now = input.now ?? new Date();
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.body;
  const since = dayList(now)[0] ?? now.toISOString().slice(0, 10);
  const week = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const live = input.hub.liveCensus();
  const days = dayList(now);

  const newPerDay = fillDays(
    days,
    rowsOf(input.store, `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM users WHERE ${humans()} AND substr(created_at, 1, 10) >= ? GROUP BY day`, since),
  );
  const handsPerDay = fillDays(
    days,
    rowsOf(
      input.store,
      `SELECT substr(h.created_at, 1, 10) AS day, COUNT(*) AS n
       FROM hands h JOIN rooms r ON r.id = h.room_id
       WHERE COALESCE(r.soak, 0) = 0 AND substr(h.created_at, 1, 10) >= ?
       GROUP BY day`,
      since,
    ),
  );
  const gamesPerDay = fillDays(
    days,
    rowsOf(
      input.store,
      `SELECT substr(rh.created_at, 1, 10) AS day, COUNT(*) AS n
       FROM rating_history rh JOIN users u ON u.id = rh.user_id
       WHERE ${humans("u")} AND substr(rh.created_at, 1, 10) >= ?
       GROUP BY day`,
      since,
    ),
  );
  const roomsPerDay = fillDays(
    days,
    rowsOf(
      input.store,
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM rooms
       WHERE COALESCE(soak, 0) = 0 AND substr(created_at, 1, 10) >= ? GROUP BY day`,
      since,
    ),
  );

  const finished = count(input.store, `SELECT COUNT(*) AS n FROM rooms WHERE status = 'complete' AND COALESCE(soak, 0) = 0`);
  const abandoned = count(input.store, `SELECT COUNT(*) AS n FROM rooms WHERE status = 'abandoned' AND COALESCE(soak, 0) = 0`);
  const matchSeconds = input.store.db
    .prepare(
      `SELECT AVG((julianday(h.last_at) - julianday(r.created_at)) * 86400.0) AS n
       FROM rooms r
       JOIN (SELECT room_id, MAX(created_at) AS last_at FROM hands GROUP BY room_id) h ON h.room_id = r.id
       WHERE r.status = 'complete' AND COALESCE(r.soak, 0) = 0 AND h.last_at > r.created_at`,
    )
    .get() as { n: number | null };
  const humansAvg = input.store.db
    .prepare(
      `SELECT AVG(humans) AS n FROM (
         SELECT SUM(CASE WHEN p.bot = 0 THEN 1 ELSE 0 END) AS humans
         FROM players p JOIN rooms r ON r.id = p.room_id
         WHERE COALESCE(r.soak, 0) = 0
         GROUP BY p.room_id
       )`,
    )
    .get() as { n: number | null };

  const day1 = rate(
    count(
      input.store,
      `SELECT COUNT(*) AS n FROM users u
       WHERE ${humans("u")}
         AND substr(u.created_at, 1, 10) <= date(?, '-1 day')
         AND substr(u.created_at, 1, 10) >= date(?, '-30 day')
         AND (
           EXISTS (SELECT 1 FROM rating_history rh WHERE rh.user_id = u.id AND substr(rh.created_at, 1, 10) = date(substr(u.created_at, 1, 10), '+1 day'))
           OR EXISTS (SELECT 1 FROM daily_presence dp WHERE dp.user_id = u.id AND dp.day = date(substr(u.created_at, 1, 10), '+1 day'))
         )`,
      today,
      today,
    ),
    count(
      input.store,
      `SELECT COUNT(*) AS n FROM users WHERE ${humans()} AND substr(created_at, 1, 10) <= date(?, '-1 day') AND substr(created_at, 1, 10) >= date(?, '-30 day')`,
      today,
      today,
    ),
  );
  const day7 = rate(
    count(
      input.store,
      `SELECT COUNT(*) AS n FROM users u
       WHERE ${humans("u")}
         AND substr(u.created_at, 1, 10) <= date(?, '-7 day')
         AND substr(u.created_at, 1, 10) >= date(?, '-37 day')
         AND (
           EXISTS (SELECT 1 FROM rating_history rh WHERE rh.user_id = u.id AND substr(rh.created_at, 1, 10) = date(substr(u.created_at, 1, 10), '+7 day'))
           OR EXISTS (SELECT 1 FROM daily_presence dp WHERE dp.user_id = u.id AND dp.day = date(substr(u.created_at, 1, 10), '+7 day'))
         )`,
      today,
      today,
    ),
    count(
      input.store,
      `SELECT COUNT(*) AS n FROM users WHERE ${humans()} AND substr(created_at, 1, 10) <= date(?, '-7 day') AND substr(created_at, 1, 10) >= date(?, '-37 day')`,
      today,
      today,
    ),
  );

  const purchases = rowsOf<{ lookup_key: string; n: number }>(
    input.store,
    `SELECT lookup_key, COUNT(*) AS n FROM coin_purchases GROUP BY lookup_key ORDER BY n DESC`,
  ).map((row) => {
    const pack = COIN_PACKS.find((item) => item.lookupKey === row.lookup_key);
    return { pack: pack?.name ?? row.lookup_key, count: row.n, cents: (pack?.cents ?? 0) * row.n };
  });
  const characters = rowsOf<{ name: string; n: number }>(
    input.store,
    `SELECT CASE
        WHEN l.character_id IS NULL OR l.character_id = 'CHR-015' THEN '2 Hot 4 TV'
        ELSE l.character_id
      END AS name, COUNT(*) AS n
     FROM loadouts l JOIN users u ON u.id = l.user_id
     WHERE ${humans("u")}
     GROUP BY name ORDER BY n DESC`,
  ).map((row) => ({ name: row.name, count: row.n }));

  let databaseBytes = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      databaseBytes += statSync(`${input.dbFile}${suffix}`).size;
    } catch {
      // The extra files appear only while the database is in use.
    }
  }
  let diskBytes: number | null = null;
  let diskTotalBytes: number | null = null;
  try {
    const disk = statfsSync(input.dataDir);
    diskTotalBytes = Number(disk.blocks) * Number(disk.bsize);
    diskBytes = diskTotalBytes - Number(disk.bavail) * Number(disk.bsize);
  } catch {
    diskBytes = null;
  }
  const backups = listBackups(input.dataDir);
  let lastBackupAt: string | null = null;
  if (backups.length > 0) {
    try {
      lastBackupAt = statSync(backups[backups.length - 1] ?? "").mtime.toISOString();
    } catch {
      lastBackupAt = null;
    }
  }

  const body: AdminStats = {
    generatedAt: now.toISOString(),
    players: {
      accounts: count(input.store, `SELECT COUNT(*) AS n FROM users WHERE ${humans()}`),
      guests: count(input.store, `SELECT COUNT(*) AS n FROM users WHERE ${humans()} AND is_guest = 1`),
      signedIn: count(input.store, `SELECT COUNT(*) AS n FROM users WHERE ${humans()} AND is_guest = 0`),
      google: count(
        input.store,
        `SELECT COUNT(DISTINCT i.user_id) AS n FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = 'google' AND ${humans("u")}`,
      ),
      email: count(
        input.store,
        `SELECT COUNT(DISTINCT i.user_id) AS n FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = 'email' AND ${humans("u")}`,
      ),
      apple: count(
        input.store,
        `SELECT COUNT(DISTINCT i.user_id) AS n FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = 'apple' AND ${humans("u")}`,
      ),
      newPerDay,
      activeToday: count(
        input.store,
        `SELECT COUNT(DISTINCT user_id) AS n FROM (
           SELECT user_id FROM daily_presence WHERE day = ?
           UNION
           SELECT rh.user_id FROM rating_history rh JOIN users u ON u.id = rh.user_id
           WHERE substr(rh.created_at, 1, 10) = ? AND ${humans("u")}
         )`,
        today,
        today,
      ),
      activeWeek: count(
        input.store,
        `SELECT COUNT(DISTINCT user_id) AS n FROM (
           SELECT user_id FROM daily_presence WHERE day >= ?
           UNION
           SELECT rh.user_id FROM rating_history rh JOIN users u ON u.id = rh.user_id
           WHERE substr(rh.created_at, 1, 10) >= ? AND ${humans("u")}
         )`,
        week,
        week,
      ),
      returningRate: (() => {
        const whole = count(
          input.store,
          `SELECT COUNT(*) AS n FROM users WHERE ${humans()} AND substr(created_at, 1, 10) < ?`,
          today,
        );
        const back = count(
          input.store,
          `SELECT COUNT(*) AS n FROM users u WHERE ${humans("u")} AND substr(u.created_at, 1, 10) < ?
           AND (
             EXISTS (SELECT 1 FROM rating_history rh WHERE rh.user_id = u.id AND substr(rh.created_at, 1, 10) > substr(u.created_at, 1, 10))
             OR EXISTS (SELECT 1 FROM daily_presence dp WHERE dp.user_id = u.id AND dp.day > substr(u.created_at, 1, 10))
           )`,
          today,
        );
        return whole > 0 ? Math.round((back / whole) * 1000) / 1000 : null;
      })(),
      onlineNow: live.humansOnline,
      recent: rowsOf<{ display_name: string }>(
        input.store,
        `SELECT display_name FROM users WHERE ${humans()} AND is_guest = 0 AND age_ok = 1 ORDER BY updated_at DESC LIMIT 12`,
      ).map((row) => row.display_name),
    },
    gameplay: {
      tablesOpen: live.openTables,
      tablesPlaying: live.playingTables,
      humanSeats: live.humanSeats,
      botSeats: live.botSeats,
      handsPerDay,
      gamesPerDay,
      roomsPerDay,
      averageMatchSeconds: matchSeconds.n == null ? null : Math.round(matchSeconds.n),
      averageHumans: humansAvg.n == null ? null : Math.round(humansAvg.n * 10) / 10,
      quickRooms: count(input.store, `SELECT COUNT(*) AS n FROM rooms WHERE COALESCE(listed, 0) = 1 AND COALESCE(soak, 0) = 0`),
      friendRooms: count(input.store, `SELECT COUNT(*) AS n FROM rooms WHERE COALESCE(listed, 0) = 0 AND COALESCE(soak, 0) = 0`),
      seriesFinished: finished,
      seriesAbandoned: abandoned,
      gamesWon: count(input.store, `SELECT COALESCE(SUM(COALESCE(ranked_wins, 0) + COALESCE(vs_wins, 0)), 0) AS n FROM users WHERE ${humans()}`),
      completionRate: finished + abandoned > 0 ? Math.round((finished / (finished + abandoned)) * 1000) / 1000 : null,
      shareTaps: count(input.store, `SELECT COALESCE(SUM(n), 0) AS n FROM pulses WHERE name = 'share'`),
    },
    retention: { day1, day7 },
    economy: {
      shopMode: shopMode(input.shopShape),
      bonesEarned: count(
        input.store,
        `SELECT COALESCE(SUM(g.amount), 0) AS n FROM bone_grants g JOIN users u ON u.id = g.user_id WHERE ${humans("u")}`,
      ),
      bonesHeld: count(
        input.store,
        `SELECT COALESCE(SUM(w.bones), 0) AS n FROM wallets w JOIN users u ON u.id = w.user_id WHERE ${humans("u")}`,
      ),
      goldHeld: count(
        input.store,
        `SELECT COALESCE(SUM(w.gold_bones), 0) AS n FROM wallets w JOIN users u ON u.id = w.user_id WHERE ${humans("u")}`,
      ),
      purchases,
      topItems: rowsOf<{ id: string; n: number }>(
        input.store,
        `SELECT o.item_id AS id, COUNT(*) AS n FROM owned_items o JOIN users u ON u.id = o.user_id
         WHERE ${humans("u")}
         GROUP BY o.item_id ORDER BY n DESC LIMIT 8`,
      ).map((row) => ({ id: row.id, count: row.n })),
      characters,
    },
    safety: {
      reports: count(input.store, `SELECT COUNT(*) AS n FROM player_reports`),
      blocks: count(input.store, `SELECT COUNT(*) AS n FROM player_blocks`),
      ageBlocked: count(input.store, `SELECT COALESCE(SUM(n), 0) AS n FROM pulses WHERE name = 'age_blocked'`),
      accountsDeleted: count(input.store, `SELECT COUNT(*) AS n FROM users WHERE display_name = 'Deleted' AND is_bot = 0`),
    },
    health: {
      uptimeSeconds: Math.round(process.uptime()),
      commit: (process.env.RENDER_GIT_COMMIT ?? "").trim() || null,
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      cpuPercent: cpuPercent(),
      sockets: live.sockets,
      errorsToday: count(input.store, `SELECT COALESCE(SUM(n), 0) AS n FROM pulses WHERE name = 'http_5xx' AND day = ?`, today),
      errorsSinceBoot: serverErrors,
      lastBackupAt,
      backupCount: backups.length,
      databaseBytes,
      diskBytes,
      diskTotalBytes,
      planDiskBytes: PLAN_DISK_BYTES,
      playingTables: live.playingTables,
      capacity: capacityFor(live.playingTables),
    },
    daily: dailyAdmin(input.store, now),
    omitted: [
      "Bones spent are not in a ledger, so only Bones earned and Bones still held are shown.",
      "Each purchase does not record whether that charge was test or live. The shop mode shown is the mode right now.",
      "Age-gate refusals and server errors are counted from this deploy forward.",
      "A visit that never played a counted game is counted only from this deploy forward.",
      "The latest bot soak result is not stored on the server.",
      "Guest nicknames, emails, and minor details are not shown.",
    ],
  };
  cache = { at: now.getTime(), body };
  return body;
}
