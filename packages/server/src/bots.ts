import { randomBytes } from "node:crypto";
import {
  BIG_MOMENT_SCORE,
  CATALOG,
  RULES_VERSION,
  applyIntent,
  beginHand,
  canBuy,
  chooseBotIntent,
  createMatch,
  currentPlayerId,
  isWithheldId,
  itemById,
  randomSeed,
  scoreLocked,
  shuffleWithSeed,
  tauntsForPlayer,
  type BotDifficulty,
  type MatchState,
  type StoreItem,
} from "@uhoh/rules";
import { Cosmetics } from "./cosmetics.js";
import type { Store } from "./db.js";
import { GAME_BONES_DAILY_CAP, bonesForGame } from "./economy.js";
import { Hub, type AccountBotCard, type ServerMessage } from "./hub.js";
import { denverDay, leaderboard, settleGame } from "./ranking.js";

type Personality = "flashy" | "collector" | "talker" | "portrait" | "balanced";

interface BotProfile extends AccountBotCard {
  personality: Personality;
}

interface WalletSnap {
  bones: number;
  gold_bones: number;
  earned_day: string | null;
  earned_today: number;
}

const ROSTER: Array<{ name: string; personality: Personality }> = [
  { name: "Pip Squeak", personality: "talker" },
  { name: "Double Six", personality: "portrait" },
  { name: "Boneyard", personality: "collector" },
  { name: "Spinner", personality: "flashy" },
  { name: "Lockjaw", personality: "balanced" },
  { name: "Snake Eyes", personality: "talker" },
  { name: "Boxcar", personality: "collector" },
  { name: "Heavy Tile", personality: "balanced" },
  { name: "Knock Knock", personality: "talker" },
  { name: "Draw One", personality: "portrait" },
  { name: "Capstone", personality: "flashy" },
  { name: "Blank End", personality: "collector" },
  { name: "Night Train", personality: "balanced" },
  { name: "The Block", personality: "flashy" },
  { name: "Uh Oh", personality: "talker" },
  { name: "Tile Shark", personality: "portrait" },
  { name: "Clack", personality: "collector" },
  { name: "Shuffle", personality: "balanced" },
  { name: "Open End", personality: "flashy" },
  { name: "Last Tile", personality: "talker" },
  { name: "Big Six", personality: "portrait" },
  { name: "Suit Stack", personality: "collector" },
  { name: "Pip Count", personality: "balanced" },
  { name: "Table Talk", personality: "talker" },
  { name: "Cold Table", personality: "collector" },
  { name: "Hot End", personality: "flashy" },
  { name: "Double Blank", personality: "balanced" },
  { name: "Lead Out", personality: "portrait" },
  { name: "Dead End", personality: "flashy" },
  { name: "Match Point", personality: "talker" },
];

const SKILLS: BotDifficulty[] = ["easy", "medium", "hard", "expert"];

const NOTE =
  "Account bots, including the quick-match fill, play ranked games. Anonymous computer fill does not. Bots start at 0 Bones and only spend Bones earned from games.";

export function botsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.BOTS_ENABLED;
  if (raw == null || raw.trim() === "") return true;
  return !/^(0|false|off|no)$/i.test(raw.trim());
}

export function leaderboardIncludesBots(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LEADERBOARD_INCLUDE_BOTS;
  if (raw == null || raw.trim() === "") return true;
  return !/^(0|false|off|no)$/i.test(raw.trim());
}

function envInt(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function freeFaces(): Array<{ id: string; avatarId: string }> {
  return CATALOG.filter(
    (item) =>
      item.category === "character" &&
      item.obtain === "free" &&
      item.avatarId &&
      !isWithheldId(item.id) &&
      !isWithheldId(item.avatarId),
  ).map((item) => ({ id: item.id, avatarId: item.avatarId as string }));
}

function latestView(messages: ServerMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "state") return message.view;
  }
  return null;
}

export class BotLeague {
  private roster: BotProfile[] = [];
  private cursor = 0;
  private rules = { openingOk: 0, laterHands: 0, locked: 0, exact150: 0, overshoot: 0, lastPlayOk: 0 };
  private bugCounts = new Map<string, number>();
  private health: (() => Promise<{ status: number; ms: number }>) | null = null;
  private started = false;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly cosmetics: Cosmetics,
  ) {}

  setHealth(health: () => Promise<{ status: number; ms: number }>): void {
    this.health = health;
  }

  /** Create the accounts if they are missing. Safe to call more than once. */
  ensure(): BotProfile[] {
    const faces = freeFaces();
    const now = new Date().toISOString();
    this.roster = ROSTER.map((spec, index) => {
      const userId = `bot_${slug(spec.name)}`;
      const face = faces[index % Math.max(1, faces.length)]!;
      const existing = this.store.user(userId);
      if (!existing) {
        this.store.insertUser({
          id: userId,
          display_name: spec.name,
          avatar_id: face.avatarId,
          created_at: now,
          updated_at: now,
          is_guest: 0,
        });
      }
      this.store.markBot(userId);
      const user = this.store.user(userId);
      if (user && isWithheldId(user.avatar_id)) {
        this.store.updateUser(userId, { avatar_id: face.avatarId, updated_at: now });
      }
      this.cosmetics.loadout(userId);
      const avatarId = this.store.user(userId)?.avatar_id || face.avatarId;
      return {
        userId,
        name: spec.name,
        avatarId,
        difficulty: SKILLS[index % SKILLS.length]!,
        personality: spec.personality,
      };
    });
    this.hub.setRoster(() => this.cards());
    return this.roster;
  }

  cards(): AccountBotCard[] {
    return this.roster.map((bot) => ({
      userId: bot.userId,
      name: bot.name,
      avatarId: this.store.user(bot.userId)?.avatar_id || bot.avatarId,
      difficulty: bot.difficulty,
    }));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!botsOn()) {
      console.log("[bots] BOTS_ENABLED is off. No bot accounts will sit or play.");
      return;
    }
    const timer = setTimeout(() => {
      void this.boot();
    }, 20);
    timer.unref?.();
  }

  summary(): Record<string, unknown> {
    const events = this.store.db
      .prepare(`SELECT kind, name, detail, created_at FROM bot_events ORDER BY id DESC LIMIT 400`)
      .all() as Array<{ kind: string; name: string; detail: string; created_at: string }>;
    const errorsByType: Record<string, number> = {};
    let lastError: { type: string; detail: string; at: string } | null = null;
    const purchases = [];
    const probes = [];
    let burst: unknown = null;
    let rules: unknown = null;
    let health: unknown = null;
    for (const event of events) {
      if (event.kind === "error") {
        errorsByType[event.name] = (errorsByType[event.name] ?? 0) + 1;
        if (!lastError) lastError = { type: event.name, detail: event.detail, at: event.created_at };
      } else if (event.kind === "purchase" && purchases.length < 20) {
        purchases.push({ at: event.created_at, ...safeJson(event.detail) });
      } else if (event.kind === "probe" && probes.length < 20) {
        probes.push({ name: event.name, at: event.created_at, ...safeJson(event.detail) });
      } else if (event.kind === "burst" && !burst) {
        burst = { at: event.created_at, ...safeJson(event.detail) };
      } else if (event.kind === "rules" && !rules) {
        rules = { at: event.created_at, ...safeJson(event.detail) };
      } else if (event.kind === "health" && !health) {
        health = { at: event.created_at, ...safeJson(event.detail) };
      }
    }
    const earned = this.store.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM bone_grants WHERE user_id IN (SELECT id FROM users WHERE is_bot = 1)`,
      )
      .get() as { n: number };
    const grants = this.store.db
      .prepare(`SELECT COUNT(*) AS n FROM bot_events WHERE kind = 'grant'`)
      .get() as { n: number };
    return {
      enabled: botsOn(),
      bots: this.store.listBots().length,
      matchesPlayed: this.countKind("match"),
      purchases: this.countKind("purchase"),
      seasonGrants: Number(grants.n) || 0,
      bonesEarned: Number(earned.n) || 0,
      dailyCap: GAME_BONES_DAILY_CAP,
      errorsByType,
      lastError,
      recentPurchases: purchases,
      probes,
      burst,
      rules: rules ?? this.rules,
      health,
      note: NOTE,
    };
  }

  purge(): { deleted: number } {
    const ids = this.store.listBots().map((bot) => bot.id);
    this.hub.dropUsers(ids);
    const deleted = this.store.purgeBots();
    this.roster = [];
    this.hub.setRoster(() => []);
    console.log(`[bots] purged ${deleted} bot accounts`);
    return { deleted };
  }

  /** One ranked game to 150, then a shop attempt. Used by tests and the league. */
  playOne(group?: BotProfile[]): { ok: boolean; winnerId: string | null } {
    if (this.roster.length === 0) this.ensure();
    return this.playMatch(group ?? this.pickSpread());
  }

  async probeNow(): Promise<void> {
    if (this.roster.length === 0) this.ensure();
    await this.probes();
  }

  private async boot(): Promise<void> {
    try {
      this.ensure();
      const seedTarget = envInt("BOT_SEED_MATCHES", 12);
      const have = this.countKind("match");
      for (let index = have; index < seedTarget; index += 1) {
        this.playMatch(this.pickSpread());
        await yieldTick();
      }
      const purchaseGoal = envInt("BOT_SEED_PURCHASES", 4);
      const extraCap = envInt("BOT_SEED_PURCHASE_GAMES", 60);
      let extra = 0;
      while (this.countKind("purchase") < purchaseGoal && extra < extraCap) {
        this.playMatch(this.pickSpenders());
        extra += 1;
        await yieldTick();
      }
      await this.probes();
      await this.burstOnce();
      this.writeRules();
      this.armInterval();
      const summary = this.summary();
      console.log(
        `[bots] ${summary.bots} bots, ${summary.matchesPlayed} matches, ${summary.purchases} purchases, ${summary.bonesEarned} Bones earned`,
      );
    } catch (error) {
      this.bug("boot", error instanceof Error ? error.message : "The bot league failed to start.");
    }
  }

  private armInterval(): void {
    const every = Math.max(15_000, envInt("BOT_MATCH_INTERVAL_MS", 180_000));
    const timer = setInterval(() => {
      if (!botsOn()) return;
      try {
        const count = Math.max(1, envInt("BOT_MATCHES_PER_TICK", 2));
        for (let index = 0; index < count; index += 1) {
          this.playMatch(index === count - 1 && this.countKind("match") % 3 === 0 ? this.pickSpenders() : this.pickSpread());
        }
      } catch (error) {
        this.bug("tick", error instanceof Error ? error.message : "A background match failed.");
      }
    }, every);
    timer.unref?.();
  }

  private async burstOnce(): Promise<void> {
    const previous = this.store.meta("bot_burst_at");
    if (previous && Date.now() - Date.parse(previous) < 6 * 60 * 60 * 1000) return;
    const size = Math.max(1, envInt("BOT_BURST_MATCHES", 20));
    const cpu0 = process.cpuUsage();
    const heap0 = process.memoryUsage();
    const started = performance.now();
    for (let index = 0; index < size; index += 1) {
      this.playMatch(index % 2 === 0 ? this.pickSpenders() : this.pickSpread());
      await yieldTick();
    }
    const cpu = process.cpuUsage(cpu0);
    const heap1 = process.memoryUsage();
    let health: { status: number; ms: number } | null = null;
    if (this.health) {
      try {
        health = await this.health();
      } catch (error) {
        this.bug("health", error instanceof Error ? error.message : "Health check failed during the burst.");
      }
    }
    const detail = {
      matches: size,
      ms: Math.round(performance.now() - started),
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      heapUsed: heap1.heapUsed,
      heapBefore: heap0.heapUsed,
      rss: heap1.rss,
      health,
    };
    const at = new Date().toISOString();
    this.store.insertBotEvent("burst", "concurrency", JSON.stringify(detail), at);
    if (health) this.store.insertBotEvent("health", "inject", JSON.stringify(health), at);
    this.store.db
      .prepare(`INSERT INTO app_meta (key, value) VALUES ('bot_burst_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(at);
    console.log(
      `[bots] burst ${size} matches in ${detail.ms}ms, cpu ${detail.cpuUserMs}+${detail.cpuSystemMs}ms, rss ${detail.rss}`,
    );
  }

  private pickSpread(): BotProfile[] {
    const size = this.cursor % 6 === 5 ? 4 : this.cursor % 6 === 3 ? 3 : 2;
    const group: BotProfile[] = [];
    for (let index = 0; index < size; index += 1) {
      group.push(this.roster[(this.cursor + index) % this.roster.length]!);
    }
    this.cursor = (this.cursor + size) % this.roster.length;
    return group;
  }

  private pickSpenders(): BotProfile[] {
    const ranked = [...this.roster].sort((a, b) => this.bonesOf(b.userId) - this.bonesOf(a.userId));
    const pool = ranked.slice(0, 6);
    const first = pool[this.cursor % pool.length]!;
    const second = pool[(this.cursor + 1) % pool.length]!;
    this.cursor += 1;
    return first.userId === second.userId ? ranked.slice(0, 2) : [first, second];
  }

  private playMatch(group: BotProfile[]): { ok: boolean; winnerId: string | null } {
    if (group.length < 2) return { ok: false, winnerId: null };
    const roomId = `bot_${randomBytes(6).toString("hex")}`;
    const seriesId = "league";
    const difficulty = new Map(group.map((bot) => [bot.userId, bot.difficulty]));
    let match = createMatch(
      group.map((bot) => ({ id: bot.userId, name: bot.name })),
      { boneyardMode: "draw_until", seriesLength: 3, targetScore: 150 },
    );
    const moments: Record<string, number> = {};
    let expectOpening = true;
    let moves = 0;
    while (!match.lastHand?.gameWinnerId && moves < 2500) {
      if (!match.hand || match.hand.phase === "complete") {
        match = beginHand(match, shuffleWithSeed(randomSeed()), RULES_VERSION);
        this.checkOpening(match, expectOpening);
        continue;
      }
      const playerId = currentPlayerId(match);
      if (!playerId) {
        this.bug("stuck", `No player to move after ${moves} plays.`);
        break;
      }
      const intent = chooseBotIntent(match, playerId, difficulty.get(playerId) ?? "medium", Math.random);
      if (!intent) {
        this.bug("stuck", `${playerId} had no legal move.`);
        break;
      }
      const before = match.lastPlay?.seq ?? -1;
      const applied = applyIntent(match, playerId, intent);
      if (!applied.ok) {
        this.bug("illegal-move", applied.error ?? "The engine rejected a bot move.");
        break;
      }
      match = applied.match;
      const play = match.lastPlay;
      if (play && play.seq !== before && play.awarded >= BIG_MOMENT_SCORE) {
        moments[play.playerId] = (moments[play.playerId] ?? 0) + 1;
      }
      if (match.hand?.phase === "complete" && match.lastHand) {
        this.checkHandEnd(match);
        expectOpening = Boolean(match.lastHand.gameWinnerId);
      }
      moves += 1;
    }
    const winnerId = match.lastHand?.gameWinnerId ?? null;
    if (!winnerId) {
      this.bug("stuck", `Game stopped after ${moves} plays without a winner.`);
      return { ok: false, winnerId: null };
    }
    const now = new Date();
    const before = new Map(group.map((bot) => [bot.userId, this.wallet(bot.userId)]));
    let recap;
    try {
      recap = settleGame(this.store, {
        roomId,
        seriesId,
        gameNumber: match.gameNumber,
        casual: false,
        completed: true,
        winnerId,
        now,
        seats: group.map((bot) => ({
          playerId: bot.userId,
          name: bot.name,
          userId: bot.userId,
          bot: false,
          score: match.scores[bot.userId] ?? 0,
          left: false,
          bigMoments: moments[bot.userId] ?? 0,
        })),
      });
    } catch (error) {
      this.bug("settle", error instanceof Error ? error.message : "settleGame failed.");
      return { ok: false, winnerId };
    }
    if (!recap.ranked || recap.vsComputer) {
      this.bug("rating", "A bot-vs-bot game was not ranked.");
    }
    const day = denverDay(now);
    for (const bot of group) {
      const won = winnerId === bot.userId;
      const gross = bonesForGame({ completed: true, won, moments: moments[bot.userId] ?? 0 });
      const prior = before.get(bot.userId);
      const earnedToday = prior?.earned_day === day ? prior.earned_today : 0;
      const expected = Math.min(gross, Math.max(0, GAME_BONES_DAILY_CAP - earnedToday));
      const after = this.wallet(bot.userId);
      const paid = this.grantAmount(bot.userId, roomId, seriesId, match.gameNumber);
      if (!after || after.bones < 0 || after.gold_bones < 0) {
        this.bug("negative-balance", `${bot.name} balance went negative.`);
      } else if (paid !== expected || after.bones !== (prior?.bones ?? 0) + expected) {
        this.bug("economy", `${bot.name} earned ${paid}, expected ${expected}.`);
      }
      this.shop(bot);
    }
    const score = match.scores[winnerId] ?? 0;
    this.store.insertBotEvent(
      "match",
      "game",
      JSON.stringify({
        roomId,
        players: group.map((bot) => bot.name),
        winner: group.find((bot) => bot.userId === winnerId)?.name ?? winnerId,
        score,
        moves,
        ranked: recap.ranked,
      }),
      now.toISOString(),
    );
    return { ok: true, winnerId };
  }

  private shop(bot: BotProfile): void {
    const wallet = this.wallet(bot.userId);
    if (!wallet || wallet.bones <= 0) return;
    const owned = new Set(this.owned(bot.userId));
    const choices = CATALOG.filter((item) => {
      if (isWithheldId(item.id) || isWithheldId(item.avatarId)) return false;
      if (!canBuy(item, "bones")) return false;
      if (owned.has(item.id)) return false;
      return (item.bones ?? 0) > 0 && (item.bones ?? 0) <= wallet.bones;
    });
    if (choices.length === 0) return;
    const picked = weighted(choices, bot.personality, Math.random());
    const price = picked.bones ?? 0;
    const before = wallet.bones;
    const bought = this.cosmetics.buy(bot.userId, picked.id, "bones");
    const after = this.wallet(bot.userId);
    if (!bought.ok) {
      this.bug("purchase", `${bot.name} could not buy ${picked.id}: ${bought.error}`);
      return;
    }
    if (!after || after.bones !== before - price || after.bones < 0) {
      this.bug("double-charge", `${bot.name} paid ${before - (after?.bones ?? before)} for ${picked.id}, price ${price}.`);
    }
    const again = this.cosmetics.buy(bot.userId, picked.id, "bones");
    const afterAgain = this.wallet(bot.userId);
    if (again.ok || afterAgain?.bones !== after?.bones) {
      this.bug("duplicate-own", `${bot.name} bought ${picked.id} twice.`);
    }
    if (this.owned(bot.userId).filter((id) => id === picked.id).length !== 1) {
      this.bug("duplicate-own", `${bot.name} owns ${picked.id} more than once.`);
    }
    let equipped = false;
    if (Math.random() < 0.65) {
      const worn = this.cosmetics.equip(bot.userId, picked.id);
      equipped = worn.ok;
      if (!worn.ok) this.bug("equip", `${bot.name} bought ${picked.id} but could not wear it: ${worn.error}`);
    }
    const detail = {
      userId: bot.userId,
      name: bot.name,
      itemId: picked.id,
      item: picked.name,
      price,
      balance: afterAgain?.bones ?? after?.bones ?? null,
      equipped,
    };
    this.store.insertBotEvent("purchase", picked.id, JSON.stringify(detail), new Date().toISOString());
    console.log(`[bots] ${bot.name} bought ${picked.id} for ${price} Bones, balance ${detail.balance}`);
  }

  private checkOpening(match: MatchState, expectOpening: boolean): void {
    const hand = match.hand;
    if (!hand) return;
    const dealt = Object.values(hand.hands).some((tiles) => tiles.includes("6-6"));
    if (expectOpening) {
      if (!hand.openingTileId) {
        this.bug("opening", "The first hand of a game did not force a lead.");
        return;
      }
      if (dealt && hand.openingTileId !== "6-6") {
        this.bug("opening", `The double six was dealt but the lead was ${hand.openingTileId}.`);
        return;
      }
      this.rules.openingOk += 1;
      return;
    }
    if (hand.openingTileId) {
      this.bug("opening", "A later hand forced an opening tile.");
      return;
    }
    this.rules.laterHands += 1;
  }

  private checkHandEnd(match: MatchState): void {
    const hand = match.lastHand;
    if (!hand) return;
    if (!match.lastPlay?.tileId) this.bug("last-play", "The hand ended without a last tile to highlight.");
    else this.rules.lastPlayOk += 1;
    if (hand.reason === "locked") {
      const hands: Record<string, string[]> = {};
      for (const remaining of hand.remaining) hands[remaining.playerId] = [...remaining.tiles];
      const locked = scoreLocked(hands);
      const mismatch = Object.keys({ ...locked.awards, ...hand.leftoverAwards }).some(
        (id) => (locked.awards[id] ?? 0) !== (hand.leftoverAwards[id] ?? 0),
      );
      if (mismatch) this.bug("locked", "A locked hand paid a different leftover than the rules.");
      else this.rules.locked += 1;
    }
    if (hand.gameWinnerId) {
      const score = hand.scoresAfter[hand.gameWinnerId] ?? 0;
      if (score < 150) this.bug("target", `The winner stopped at ${score}, under 150.`);
      else if (score === 150) this.rules.exact150 += 1;
      else this.rules.overshoot += 1;
    }
  }

  private async probes(): Promise<void> {
    await this.probeRooms();
    await this.probeReconnect();
    await this.probeAbandon();
    await this.probeChat();
    await this.probeEquip();
    this.probeBoard();
    this.writeRules();
  }

  private async probeRooms(): Promise<void> {
    const guests: string[] = [];
    try {
      for (const count of [2, 3, 4] as const) {
        const host = this.guest(`H${count}`);
        guests.push(host.id);
        const messages: ServerMessage[] = [];
        const opened = this.hub.connect(
          { type: "create", name: host.name, playerCount: count, boneyardMode: "draw_until", seriesLength: 3 },
          (message) => messages.push(message),
          () => undefined,
          host.id,
        );
        if (!opened.ok) throw new Error(opened.error);
        const code = latestView(messages)?.roomCode;
        if (!code) throw new Error(`No code for a ${count}-player room.`);
        for (let seat = 1; seat < count; seat += 1) {
          const joiner = this.guest(`S${count}${seat}`);
          guests.push(joiner.id);
          const joined = this.hub.connect(
            { type: "join", code, name: joiner.name },
            () => undefined,
            () => undefined,
            joiner.id,
          );
          if (!joined.ok) throw new Error(joined.error);
        }
        this.hub.command(opened.session.playerId, { type: "start" });
        const view = latestView(messages);
        if (view?.status !== "playing" || view.players.length !== count) {
          throw new Error(`A ${count}-player room did not start.`);
        }
        this.hub.discardRoom(opened.session.playerId);
      }
      this.probeOk("private-rooms", "Created and started 2, 3, and 4 player rooms by code.");
    } catch (error) {
      this.bug("private-rooms", error instanceof Error ? error.message : "Private rooms failed.");
      this.probeFail("private-rooms", error);
    } finally {
      this.removeGuests(guests);
    }
  }

  private async probeReconnect(): Promise<void> {
    const guests: string[] = [];
    try {
      const host = this.guest("Re");
      const other = this.guest("Join");
      guests.push(host.id, other.id);
      const hostMessages: ServerMessage[] = [];
      const otherMessages: ServerMessage[] = [];
      const opened = this.hub.connect(
        { type: "create", name: host.name, playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
        (message) => hostMessages.push(message),
        () => undefined,
        host.id,
      );
      if (!opened.ok) throw new Error(opened.error);
      const code = latestView(hostMessages)?.roomCode;
      if (!code) throw new Error("Reconnect probe had no room code.");
      const joined = this.hub.connect(
        { type: "join", code, name: other.name },
        (message) => otherMessages.push(message),
        () => undefined,
        other.id,
      );
      if (!joined.ok) throw new Error(joined.error);
      this.hub.command(opened.session.playerId, { type: "start" });
      const before = latestView(hostMessages);
      if (!before || before.status !== "playing") throw new Error("The hand never started.");
      const token = hostMessages.find((message) => message.type === "welcome");
      if (!token || token.type !== "welcome") throw new Error("No reconnect token.");
      this.hub.disconnect(opened.session.playerId, opened.session.generation);
      const again: ServerMessage[] = [];
      const back = this.hub.connect(
        { type: "reconnect", token: token.token },
        (message) => {
          again.push(message);
          hostMessages.push(message);
        },
        () => undefined,
        host.id,
      );
      if (!back.ok) throw new Error(back.error);
      const restored = latestView(again);
      if (!restored || restored.yourId !== before.yourId || restored.you.hand.length !== before.you.hand.length) {
        throw new Error("Rejoin did not restore the hand.");
      }
      if (restored.players.some((player, index) => player.score !== before.players[index]?.score)) {
        throw new Error("Rejoin changed the score.");
      }
      let sawNextHand = false;
      for (let step = 0; step < 220 && !sawNextHand; step += 1) {
        this.drive(opened.session.playerId, hostMessages);
        this.drive(joined.session.playerId, otherMessages);
        const view = latestView(hostMessages);
        if (view && view.handNumber >= 2 && view.status === "playing" && !view.betweenHands) sawNextHand = true;
        if (view?.betweenHands) this.hub.command(opened.session.playerId, { type: "continue" });
      }
      if (!sawNextHand) throw new Error("The match never reached a later hand.");
      const mid = latestView(hostMessages);
      this.hub.disconnect(back.session.playerId, back.session.generation);
      const third: ServerMessage[] = [];
      const midBack = this.hub.connect(
        { type: "reconnect", token: token.token },
        (message) => {
          third.push(message);
          hostMessages.push(message);
        },
        () => undefined,
        host.id,
      );
      if (!midBack.ok) throw new Error(midBack.error);
      const midView = latestView(third);
      if (!midView || midView.gameNumber !== mid?.gameNumber || midView.handNumber !== mid?.handNumber) {
        throw new Error("Rejoin did not restore the later hand.");
      }
      this.hub.discardRoom(midBack.session.playerId);
      this.probeOk("reconnect", "Rejoin restored the open hand and a later hand.");
    } catch (error) {
      this.bug("reconnect", error instanceof Error ? error.message : "Reconnect failed.");
      this.probeFail("reconnect", error);
    } finally {
      this.removeGuests(guests);
    }
  }

  private async probeAbandon(): Promise<void> {
    const guests: string[] = [];
    try {
      const host = this.guest("Left");
      const other = this.guest("Stay");
      guests.push(host.id, other.id);
      const hostMessages: ServerMessage[] = [];
      const otherMessages: ServerMessage[] = [];
      const opened = this.hub.connect(
        { type: "create", name: host.name, playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
        (message) => hostMessages.push(message),
        () => undefined,
        host.id,
      );
      if (!opened.ok) throw new Error(opened.error);
      const code = latestView(hostMessages)?.roomCode;
      if (!code) throw new Error("Abandon probe had no room code.");
      const joined = this.hub.connect(
        { type: "join", code, name: other.name },
        (message) => otherMessages.push(message),
        () => undefined,
        other.id,
      );
      if (!joined.ok) throw new Error(joined.error);
      this.hub.command(opened.session.playerId, { type: "start" });
      const before = this.wallet(host.id)?.bones ?? null;
      let abandoned = false;
      for (let step = 0; step < 40 && !abandoned; step += 1) {
        const view = latestView(hostMessages);
        if (view?.status === "abandoned" || view?.ended) {
          abandoned = true;
          break;
        }
        if (view?.turnPlayerId === opened.session.playerId) this.hub.missTurn(opened.session.playerId);
        else this.drive(joined.session.playerId, otherMessages);
      }
      const view = latestView(hostMessages);
      if (view?.status !== "abandoned" || !view.ended) throw new Error("Two missed turns did not end the game.");
      if (!view.recap || view.recap.players.some((player) => player.breakdown.win !== 0)) {
        throw new Error("The abandoned game paid a win.");
      }
      const after = this.wallet(host.id)?.bones ?? null;
      if (after !== before) throw new Error("An abandoned game changed the Bones balance.");
      this.hub.discardRoom(opened.session.playerId);
      this.probeOk("abandon", "Two missed turns abandoned the game with no Bones and no win.");
    } catch (error) {
      this.bug("abandon", error instanceof Error ? error.message : "Abandon failed.");
      this.probeFail("abandon", error);
    } finally {
      this.removeGuests(guests);
    }
  }

  private async probeChat(): Promise<void> {
    const guests: string[] = [];
    try {
      const host = this.guest("Chat");
      guests.push(host.id);
      const messages: ServerMessage[] = [];
      const opened = this.hub.connect(
        { type: "create", name: host.name, playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
        (message) => messages.push(message),
        () => undefined,
        host.id,
      );
      if (!opened.ok) throw new Error(opened.error);
      const line = tauntsForPlayer()[0];
      if (!line) throw new Error("No chat line is available.");
      this.hub.command(opened.session.playerId, { type: "chat", kind: "preset", packId: line.packId, tauntId: line.id });
      this.hub.command(opened.session.playerId, { type: "chat", kind: "preset", packId: line.packId, tauntId: line.id });
      const errors = messages.filter((message) => message.type === "error");
      const limited = errors.some((message) => message.type === "error" && message.message.includes("Give the table a second"));
      if (!limited) throw new Error("A second line in the same moment was accepted.");
      this.hub.discardRoom(opened.session.playerId);
      this.probeOk("chat", "The second line inside two seconds was refused.");
    } catch (error) {
      this.bug("chat", error instanceof Error ? error.message : "Chat limit failed.");
      this.probeFail("chat", error);
    } finally {
      this.removeGuests(guests);
    }
  }

  private async probeEquip(): Promise<void> {
    const guests: string[] = [];
    try {
      const bot = this.roster[0];
      if (!bot) throw new Error("No bot account.");
      const loadout = this.cosmetics.loadout(bot.userId);
      const human = this.guest("Watch");
      guests.push(human.id);
      const messages: ServerMessage[] = [];
      const opened = this.hub.connect(
        { type: "quick", name: human.name, size: 2 },
        (message) => messages.push(message),
        () => undefined,
        human.id,
      );
      if (!opened.ok) throw new Error(opened.error);
      this.hub.command(opened.session.playerId, { type: "fill-bots" });
      const view = latestView(messages);
      const seat = view?.players.find((player) => player.accountBot && player.name === bot.name);
      if (!seat?.accountBot) throw new Error("The quick table did not seat the equipped bot.");
      if (seat.frameId !== loadout.frameId) throw new Error(`Frame showed ${seat.frameId}.`);
      if (seat.effectItemId !== loadout.effectId) throw new Error(`Effect showed ${seat.effectItemId}.`);
      if (seat.tileId !== loadout.tileId || seat.tableId !== loadout.tableId) throw new Error("Tile or table did not sync.");
      if (!seat.avatarId || isWithheldId(seat.avatarId)) throw new Error("Bot avatar was missing or withheld.");
      this.hub.discardRoom(opened.session.playerId);
      this.probeOk("equip", `${seat.name} showed ${loadout.frameId ?? "no frame"}, ${loadout.effectId}, ${loadout.tileId}, ${loadout.tableId}.`);
    } catch (error) {
      this.bug("equip-sync", error instanceof Error ? error.message : "Equip sync failed.");
      this.probeFail("equip", error);
    } finally {
      this.removeGuests(guests);
    }
  }

  private probeBoard(): void {
    try {
      const board = leaderboard(this.store, "rating", new Date(), 50, true);
      for (let index = 1; index < board.rows.length; index += 1) {
        const prev = board.rows[index - 1]!;
        const row = board.rows[index]!;
        if (row.rating > prev.rating) throw new Error(`${row.name} outranks ${prev.name} with a lower place.`);
      }
      const hidden = leaderboard(this.store, "rating", new Date(), 50, false);
      if (hidden.rows.some((row) => row.bot)) throw new Error("The board included a bot while bots were hidden.");
      this.probeOk("leaderboard", `${board.rows.length} rows in rating order.`);
    } catch (error) {
      this.bug("leaderboard", error instanceof Error ? error.message : "Leaderboard check failed.");
      this.probeFail("leaderboard", error);
    }
  }

  private drive(playerId: string, messages: ServerMessage[]): void {
    const view = latestView(messages);
    if (!view || view.turnPlayerId !== playerId || view.status !== "playing") return;
    const play = view.legalPlays[0];
    if (play) this.hub.command(playerId, { type: "intent", intent: { type: "play", tileId: play.tileId, endId: play.endId } });
    else if (view.canDraw) this.hub.command(playerId, { type: "intent", intent: { type: "draw" } });
    else if (view.canKnock) this.hub.command(playerId, { type: "intent", intent: { type: "knock" } });
  }

  private guest(prefix: string): { id: string; name: string } {
    const id = `probe_${randomBytes(4).toString("hex")}`;
    const name = prefix.slice(0, 16);
    const now = new Date().toISOString();
    this.store.insertUser({
      id,
      display_name: name,
      avatar_id: "homescreen",
      created_at: now,
      updated_at: now,
      is_guest: 1,
    });
    return { id, name };
  }

  private removeGuests(ids: string[]): void {
    for (const id of ids) {
      this.hub.dropUsers([id]);
      this.store.db.prepare(`DELETE FROM wallets WHERE user_id = ?`).run(id);
      this.store.db.prepare(`DELETE FROM owned_items WHERE user_id = ?`).run(id);
      this.store.db.prepare(`DELETE FROM loadouts WHERE user_id = ?`).run(id);
      this.store.db.prepare(`DELETE FROM rating_history WHERE user_id = ?`).run(id);
      this.store.db.prepare(`DELETE FROM bone_grants WHERE user_id = ?`).run(id);
      this.store.db.prepare(`DELETE FROM season_peaks WHERE user_id = ?`).run(id);
      this.store.db.prepare(`DELETE FROM players WHERE user_id = ?`).run(id);
      this.store.db.prepare(`DELETE FROM users WHERE id = ? AND is_bot = 0`).run(id);
    }
  }

  private probeOk(name: string, detail: string): void {
    this.store.insertBotEvent("probe", name, JSON.stringify({ ok: true, detail }), new Date().toISOString());
  }

  private probeFail(name: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : "Failed.";
    this.store.insertBotEvent("probe", name, JSON.stringify({ ok: false, detail }), new Date().toISOString());
  }

  private writeRules(): void {
    this.store.insertBotEvent("rules", "tally", JSON.stringify(this.rules), new Date().toISOString());
  }

  private bug(type: string, detail: string): void {
    const count = (this.bugCounts.get(type) ?? 0) + 1;
    this.bugCounts.set(type, count);
    if (count > 5) return;
    console.warn(`[bots] ${type}: ${detail}`);
    this.store.insertBotEvent("error", type, detail, new Date().toISOString());
  }

  private countKind(kind: string): number {
    const row = this.store.db.prepare(`SELECT COUNT(*) AS n FROM bot_events WHERE kind = ?`).get(kind) as { n: number };
    return Number(row.n) || 0;
  }

  private bonesOf(userId: string): number {
    return this.wallet(userId)?.bones ?? 0;
  }

  private wallet(userId: string): WalletSnap | null {
    return (
      (this.store.db
        .prepare(`SELECT bones, gold_bones, earned_day, earned_today FROM wallets WHERE user_id = ?`)
        .get(userId) as WalletSnap | undefined) ?? null
    );
  }

  private owned(userId: string): string[] {
    const rows = this.store.db.prepare(`SELECT item_id FROM owned_items WHERE user_id = ?`).all(userId) as Array<{
      item_id: string;
    }>;
    return rows.map((row) => row.item_id);
  }

  private grantAmount(userId: string, roomId: string, seriesId: string, gameNumber: number): number | null {
    const row = this.store.db
      .prepare(`SELECT amount FROM bone_grants WHERE user_id = ? AND room_id = ? AND series_id = ? AND game_number = ?`)
      .get(userId, roomId, seriesId, gameNumber) as { amount: number } | undefined;
    return row ? row.amount : null;
  }
}

function weighted(items: StoreItem[], personality: Personality, rng: number): StoreItem {
  const weights = items.map((item) => itemWeight(item, personality));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = Math.max(0, Math.min(0.999999, rng)) * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index] ?? 0;
    if (cursor <= 0) return items[index]!;
  }
  return items[0]!;
}

function itemWeight(item: StoreItem, personality: Personality): number {
  const rarity = item.rarity === "Common" ? 5 : item.rarity === "Rare" ? 3 : item.rarity === "Epic" ? 2 : 1;
  let taste = 1;
  if (personality === "flashy" && (item.category === "effect" || item.category === "frame")) taste = 4;
  if (personality === "collector" && (item.category === "tile" || item.category === "table")) taste = 4;
  if (personality === "talker" && (item.category === "trash" || item.category === "emote")) taste = 4;
  if (personality === "portrait" && item.category === "character") taste = 4;
  return rarity * taste;
}

function safeJson(detail: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(detail) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { detail };
  } catch {
    return { detail };
  }
}

function yieldTick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
