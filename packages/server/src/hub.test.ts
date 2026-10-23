import { copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  RULES_VERSION,
  applyIntent,
  beginHand,
  createMatch,
  currentPlayerId,
  legalIntents,
  shuffleWithSeed,
  type PlayerView,
} from "@uhoh/rules";
import { Store } from "./db.js";
import { Cosmetics } from "./cosmetics.js";
import { BOT_TURN_MS, BOT_WATCH_MARGIN_MS, Hub, botThinkMs, type ServerMessage } from "./hub.js";

function latestView(messages: ServerMessage[]): PlayerView | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.type === "state") return message.view;
  }
  return null;
}

function setup() {
  const store = new Store(":memory:");
  const hub = new Hub(store, 30);
  const connect = (message: Parameters<Hub["connect"]>[0]) => {
    const messages: ServerMessage[] = [];
    const result = hub.connect(
      message,
      (outgoing) => messages.push(outgoing),
      () => undefined,
    );
    if (!result.ok) throw new Error(result.error);
    return { ...result.session, messages };
  };
  return { store, hub, connect };
}

describe("rooms", () => {
  it("deals a private hand, hides the seed, and replays after a restart", () => {
    const { store, hub, connect } = setup();
    const alex = connect({
      type: "create",
      name: "Alex",
      playerCount: 2,
      boneyardMode: "draw_one",
      seriesLength: 3,
    });
    const code = latestView(alex.messages)?.roomCode ?? "";
    const sam = connect({ type: "join", code, name: "Sam" });
    expect(hub.command).toBeTypeOf("function");
    hub.command(sam.playerId, { type: "start" });
    const refused = sam.messages.at(-1);
    expect(refused?.type).toBe("error");

    hub.command(alex.playerId, { type: "start" });
    const alexView = latestView(alex.messages);
    const samView = latestView(sam.messages);
    expect(alexView?.status).toBe("playing");
    expect(alexView?.settings.targetScore).toBe(150);
    expect(alexView?.boneyardCount).toBe(14);
    expect(alexView?.you.hand).toHaveLength(7);
    expect(samView?.you.hand).toHaveLength(7);
    expect(alexView?.you.hand.map((tile) => tile.id).sort()).not.toEqual(
      samView?.you.hand.map((tile) => tile.id).sort(),
    );

    const hands = store.handsForSeries(
      store.roomByCode(code)!.id,
      store.roomByCode(code)!.series_id,
    );
    const seed = hands[0]?.seed ?? "";
    const deck = JSON.parse(hands[0]?.deck_json ?? "[]") as string[];
    const wire = JSON.stringify([...alex.messages, ...sam.messages]);
    expect(seed.length).toBe(64);
    expect(wire).not.toContain(seed);
    expect(wire).not.toContain(hands[0]?.deck_json ?? "missing");

    const hiddenFromSam = new Set(deck);
    for (const tile of samView?.you.hand ?? []) hiddenFromSam.delete(tile.id);
    for (const id of boardIds(samView)) hiddenFromSam.delete(id);
    for (const id of hiddenFromSam) expect(JSON.stringify(sam.messages)).not.toContain(id);

    for (let step = 0; step < 16; step += 1) {
      const turn = [alex, sam].find((player) => latestView(player.messages)?.turnPlayerId === player.playerId);
      const view = turn ? latestView(turn.messages) : null;
      if (!turn || !view) break;
      if (view.legalPlays[0]) {
        hub.command(turn.playerId, { type: "intent", intent: { type: "play", ...view.legalPlays[0] } });
      } else if (view.canDraw) {
        hub.command(turn.playerId, { type: "intent", intent: { type: "draw" } });
      } else if (view.canKnock) {
        hub.command(turn.playerId, { type: "intent", intent: { type: "knock" } });
      } else break;
    }

    hub.command(alex.playerId, { type: "chat", kind: "preset", packId: "table", tauntId: "uh-oh" });
    hub.command(sam.playerId, {
      type: "chat",
      kind: "preset",
      packId: "sample-character",
      tauntId: "later",
    });
    expect(sam.messages.at(-1)?.type).toBe("error");
    hub.command(sam.playerId, { type: "chat", kind: "text", text: "x".repeat(81) });
    expect(sam.messages.at(-1)?.type).toBe("error");
    const heard = alex.messages.filter((message) => message.type === "chat");
    expect(heard.some((message) => message.type === "chat" && message.line.text === "Uh oh.")).toBe(true);

    const alexToken = alex.messages.find((message) => message.type === "welcome");
    const samToken = sam.messages.find((message) => message.type === "welcome");
    const restored = new Hub(store, 30);
    const alexAgain = {
      messages: [] as ServerMessage[],
    };
    const samAgain = {
      messages: [] as ServerMessage[],
    };
    restored.connect(
      { type: "reconnect", token: alexToken?.type === "welcome" ? alexToken.token : "" },
      (message) => alexAgain.messages.push(message),
      () => undefined,
    );
    restored.connect(
      { type: "reconnect", token: samToken?.type === "welcome" ? samToken.token : "" },
      (message) => samAgain.messages.push(message),
      () => undefined,
    );
    expect(latestView(alexAgain.messages)?.you.hand).toEqual(latestView(alex.messages)?.you.hand);
    expect(latestView(samAgain.messages)?.you.hand).toEqual(latestView(sam.messages)?.you.hand);
    expect(latestView(alexAgain.messages)?.players.map((player) => player.score)).toEqual(
      latestView(alex.messages)?.players.map((player) => player.score),
    );
    expect(latestView(alexAgain.messages)?.openEquation).toBe(latestView(alex.messages)?.openEquation);
  });

  it("rejects a third player and a bad code", () => {
    const { hub, connect } = setup();
    const alex = connect({
      type: "create",
      name: "Alex",
      playerCount: 2,
      boneyardMode: "draw_until",
      seriesLength: 5,
    });
    const code = latestView(alex.messages)?.roomCode ?? "";
    connect({ type: "join", code, name: "Sam" });
    const messages: ServerMessage[] = [];
    const blocked = hub.connect(
      { type: "join", code, name: "Jo" },
      (message) => messages.push(message),
      () => undefined,
    );
    expect(blocked.ok).toBe(false);
    const missing = hub.connect(
      { type: "join", code: "ZZZZZZ", name: "Jo" },
      (message) => messages.push(message),
      () => undefined,
    );
    expect(missing.ok).toBe(false);
  });

  it("lets the host add and remove computers, and logs a computer move", async () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 30, () => 0);
    const messages: ServerMessage[] = [];
    const alex = hub.connect(
      { type: "create", name: "Alex", playerCount: 4, boneyardMode: "draw_until", seriesLength: 3 },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!alex.ok) throw new Error(alex.error);
    const code = latestView(messages)?.roomCode ?? "";
    const samMessages: ServerMessage[] = [];
    const sam = hub.connect(
      { type: "join", code, name: "Sam" },
      (message) => samMessages.push(message),
      () => undefined,
    );
    if (!sam.ok) throw new Error(sam.error);

    hub.command(sam.session.playerId, { type: "add-bot", difficulty: "easy" });
    expect(samMessages.at(-1)?.type).toBe("error");

    hub.command(alex.session.playerId, { type: "add-bot", difficulty: "easy" });
    hub.command(alex.session.playerId, { type: "add-bot" });
    let view = latestView(messages);
    expect(view?.players.filter((player) => player.bot).map((player) => player.name)).toEqual(["Bones", "Pips"]);
    expect(view?.players.find((player) => player.name === "Bones")?.difficulty).toBe("easy");
    expect(view?.players.find((player) => player.name === "Pips")?.difficulty).toBe("medium");
    expect(view?.canStart).toBe(true);

    const bones = view?.players.find((player) => player.name === "Bones");
    hub.command(alex.session.playerId, { type: "remove-bot", playerId: alex.session.playerId });
    expect(messages.at(-1)?.type).toBe("error");
    hub.command(alex.session.playerId, { type: "remove-bot", playerId: bones?.id ?? "" });
    view = latestView(messages);
    expect(view?.players.some((player) => player.bot)).toBe(true);
    expect(view?.players.some((player) => player.name === "Bones")).toBe(false);
    expect(view?.canStart).toBe(false);

    hub.command(alex.session.playerId, { type: "add-bot", difficulty: "normal" });
    hub.command(alex.session.playerId, { type: "start" });
    const playing = latestView(messages);
    expect(playing?.status).toBe("playing");
    expect(playing?.players.filter((player) => player.bot)).toHaveLength(2);

    const actions = await untilBotActs(hub, store, code, [
      { playerId: alex.session.playerId, messages },
      { playerId: sam.session.playerId, messages: samMessages },
    ]);
    const botIds = new Set(store.players(store.roomByCode(code)!.id).filter((player) => player.bot).map((player) => player.id));
    expect(actions.some((action) => botIds.has(action.playerId))).toBe(true);

    const during = latestView(messages);
    if (during?.status === "playing") {
      hub.command(alex.session.playerId, { type: "add-bot" });
      expect(messages.at(-1)?.type).toBe("error");
    }
  });

  it.each([
    { playerCount: 2, bots: 1, boneyardMode: "draw_until", seriesLength: 3 },
    { playerCount: 3, bots: 2, boneyardMode: "draw_one", seriesLength: 5 },
    { playerCount: 4, bots: 3, boneyardMode: "draw_until", seriesLength: 7 },
  ] as const)(
    "Play vs computer uses $playerCount seats and the chosen boneyard and series",
    ({ playerCount, bots, boneyardMode, seriesLength }) => {
      const store = new Store(":memory:");
      const hub = new Hub(store, 30, () => 0);
      const messages: ServerMessage[] = [];
      const alex = hub.connect(
        { type: "solo", name: "Alex", playerCount, boneyardMode, seriesLength },
        (message) => messages.push(message),
        () => undefined,
      );
      if (!alex.ok) throw new Error(alex.error);
      const view = latestView(messages);
      expect(view?.status).toBe("playing");
      expect(view?.settings.playerCount).toBe(playerCount);
      expect(view?.settings.boneyardMode).toBe(boneyardMode);
      expect(view?.settings.seriesLength).toBe(seriesLength);
      expect(view?.players).toHaveLength(playerCount);
      expect(view?.players.filter((player) => player.bot)).toHaveLength(bots);
      expect(view?.players.filter((player) => !player.bot)).toHaveLength(1);
    },
  );

  it("starts a four-seat table against three computers", async () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 30, () => 0);
    const messages: ServerMessage[] = [];
    const alex = hub.connect(
      { type: "solo", name: "Alex", playerCount: 4, boneyardMode: "draw_one", seriesLength: 5 },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!alex.ok) throw new Error(alex.error);
    const alexId = alex.session.playerId;
    const view = latestView(messages);
    expect(view?.status).toBe("playing");
    expect(view?.settings.playerCount).toBe(4);
    expect(view?.settings.seriesLength).toBe(5);
    expect(view?.settings.boneyardMode).toBe("draw_one");
    expect(view?.players.filter((player) => player.bot)).toHaveLength(3);
    expect(view?.players.filter((player) => player.bot).every((player) => player.connected)).toBe(true);

    const room = store.roomByCode(view?.roomCode ?? "");
    const bot = store.players(room?.id ?? "").find((player) => player.bot);
    const refused = hub.connect(
      { type: "reconnect", token: bot?.token ?? "" },
      () => undefined,
      () => undefined,
    );
    expect(refused.ok).toBe(false);

    const actions = await untilBotActs(hub, store, view?.roomCode ?? "", [
      { playerId: alexId, messages },
    ]);
    expect(actions.some((action) => action.playerId === bot?.id || store.players(room?.id ?? "").some((player) => player.bot && player.id === action.playerId))).toBe(true);
  });

  it("adds the computer columns when an older database is opened", () => {
    const file = `/tmp/uhoh-bot-migrate-${Date.now()}.sqlite`;
    const raw = new DatabaseSync(file);
    raw.exec(`
      CREATE TABLE players (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        seat INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    raw.close();
    const store = new Store(file);
    store.insertPlayer({
      id: "p1",
      room_id: "r1",
      name: "Bones",
      token: "t".repeat(32),
      seat: 1,
      created_at: new Date().toISOString(),
      bot: 1,
      difficulty: "easy",
    });
    const row = store.playerByToken("t".repeat(32));
    expect(row?.bot).toBe(1);
    expect(row?.difficulty).toBe("easy");
    store.db.close();
  });

  it("waits two seconds before a computer plays", () => {
    expect(BOT_TURN_MS).toBe(2_000);
    expect(botThinkMs(1)).toBe(980);
    expect(botThinkMs(4)).toBe(980 + 3 * 130);
    expect(botThinkMs(20)).toBe(2_000);
  });

  it("only accepts a preset line, and only one every two seconds", () => {
    const { hub, connect } = setup();
    const alex = connect({
      type: "create",
      name: "Alex",
      playerCount: 2,
      boneyardMode: "draw_one",
      seriesLength: 3,
    });
    hub.command(alex.playerId, { type: "chat", kind: "text", text: "nice tile" });
    expect(alex.messages.at(-1)).toMatchObject({ type: "error", message: "Pick a line from the list." });
    hub.command(alex.playerId, { type: "chat", kind: "preset", packId: "table", tauntId: "nope" });
    expect(alex.messages.at(-1)).toMatchObject({ type: "error", message: "That line isn't in the pack." });
    hub.command(alex.playerId, { type: "chat", kind: "preset", packId: "table", tauntId: "gg" });
    expect(alex.messages.filter((message) => message.type === "chat")).toHaveLength(1);
    hub.command(alex.playerId, { type: "chat", kind: "preset", packId: "table", tauntId: "lucky" });
    expect(alex.messages.at(-1)).toMatchObject({ type: "error", message: "Easy. Give the table a second." });
  });

  it("skips a turn when the clock runs out, and ends the game on the next miss", async () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 30, () => 0, 40, 60_000);
    const alexMessages: ServerMessage[] = [];
    const samMessages: ServerMessage[] = [];
    const alex = hub.connect(
      { type: "create", name: "Alex", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      (message) => alexMessages.push(message),
      () => undefined,
    );
    if (!alex.ok) throw new Error(alex.error);
    const code = latestView(alexMessages)?.roomCode ?? "";
    const sam = hub.connect(
      { type: "join", code, name: "Sam" },
      (message) => samMessages.push(message),
      () => undefined,
    );
    if (!sam.ok) throw new Error(sam.error);
    hub.command(alex.session.playerId, { type: "start" });

    const abandoned = await waitFor(() => latestView(alexMessages)?.status === "abandoned");
    expect(abandoned).toBe(true);
    const view = latestView(alexMessages);
    expect(view?.prompt).toMatch(/^Game ended - (Alex|Sam) left$/);
    expect(view?.ended?.reason).toBe("player_left");
    expect(view?.board?.center ?? null).toBeNull();

    const room = store.roomByCode(code);
    const actions = store.handsForSeries(room!.id, room!.series_id).flatMap((hand) => store.actions(hand.id));
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.intent.type === "timeout")).toBe(true);
  });

  it("clears a missed turn when that player reconnects before the turn comes back", async () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 30, () => 0, 200, 60_000);
    const messages: ServerMessage[] = [];
    const alex = hub.connect(
      { type: "create", name: "Alex", playerCount: 2, boneyardMode: "draw_one", seriesLength: 3 },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!alex.ok) throw new Error(alex.error);
    const code = latestView(messages)?.roomCode ?? "";
    const sam = hub.connect(
      { type: "join", code, name: "Sam" },
      () => undefined,
      () => undefined,
    );
    if (!sam.ok) throw new Error(sam.error);
    hub.command(alex.session.playerId, { type: "start" });
    const roomId = () => store.roomByCode(code)!;
    const timeoutCount = () =>
      store.handsForSeries(roomId().id, roomId().series_id).flatMap((hand) => store.actions(hand.id)).length;

    const firstMiss = await waitFor(() => timeoutCount() >= 1, 1_500);
    expect(firstMiss).toBe(true);
    const first = store.handsForSeries(roomId().id, roomId().series_id).flatMap((hand) => store.actions(hand.id))[0];
    const token = store.players(roomId().id).find((player) => player.id === first?.playerId)?.token ?? "";
    const back = hub.connect(
      { type: "reconnect", token },
      (message) => messages.push(message),
      () => undefined,
    );
    expect(back.ok).toBe(true);

    const ended = await waitFor(() => latestView(messages)?.status === "abandoned", 4_000);
    expect(ended).toBe(true);
    const actions = store.handsForSeries(roomId().id, roomId().series_id).flatMap((hand) => store.actions(hand.id));
    expect(actions.length).toBeGreaterThanOrEqual(3);
    expect(latestView(messages)?.prompt.startsWith("Game ended - ")).toBe(true);
  });

  it("holds the summary, then deals the next hand when someone continues", async () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 30, () => 0, 30_000, 60_000);
    const messages: ServerMessage[] = [];
    const alex = hub.connect(
      { type: "solo", name: "Alex", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3, difficulty: "easy" },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!alex.ok) throw new Error(alex.error);
    const code = latestView(messages)?.roomCode ?? "";
    for (let step = 0; step < 600 && latestView(messages)?.betweenHands !== true; step += 1) {
      const view = latestView(messages);
      if (view?.turnPlayerId === alex.session.playerId) {
        const play = view.legalPlays[0];
        if (play) hub.command(alex.session.playerId, { type: "intent", intent: { type: "play", ...play } });
        else if (view.canDraw) hub.command(alex.session.playerId, { type: "intent", intent: { type: "draw" } });
        else if (view.canKnock) hub.command(alex.session.playerId, { type: "intent", intent: { type: "knock" } });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const summary = latestView(messages);
    expect(summary?.betweenHands).toBe(true);
    expect(summary?.phase).toBe("between");
    expect(summary?.lastHand?.placements.length).toBe(2);
    expect(summary?.turnDeadline).toBeNull();
    const handBefore = summary?.handNumber ?? 0;
    const gameBefore = summary?.gameNumber ?? 0;
    hub.command(alex.session.playerId, { type: "continue" });
    const next = latestView(messages);
    expect(next?.betweenHands).toBe(false);
    expect(next?.status).toBe("playing");
    expect((next?.gameNumber ?? 0) > gameBefore || (next?.handNumber ?? 0) > handBefore).toBe(true);
    expect(next?.you.hand).toHaveLength(7);
    expect(store.roomByCode(code)?.status).toBe("playing");
  });

  it("starts when a saved game cannot be replayed", () => {
    const file = `/tmp/uhoh-bad-room-${Date.now()}.sqlite`;
    const deck = shuffleWithSeed(Buffer.alloc(32, 7));
    const seed = Buffer.alloc(32, 7).toString("hex");
    const raw = new DatabaseSync(file);
    raw.exec(`
      CREATE TABLE rooms (
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
      CREATE TABLE players (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        seat INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        bot INTEGER NOT NULL DEFAULT 0,
        difficulty TEXT
      );
      CREATE TABLE hands (
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
      CREATE TABLE actions (
        hand_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (hand_id, seq)
      );
    `);
    const stamp = "2020-01-01T00:00:00.000Z";
    raw.prepare(
      `INSERT INTO rooms (
        id, code, host_id, series_id, player_count, boneyard_mode, series_length, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("r_old", "OLDROOM", "p_old", "s_old", 2, "draw_one", 3, "playing", stamp);
    raw.prepare(
      `INSERT INTO players (id, room_id, name, token, seat, created_at, bot, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p_old", "r_old", "Pat", "o".repeat(32), 0, stamp, 0, null);
    raw.prepare(
      `INSERT INTO players (id, room_id, name, token, seat, created_at, bot, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p_old2", "r_old", "Jo", "q".repeat(32), 1, stamp, 0, null);
    raw.prepare(
      `INSERT INTO hands (
        id, room_id, series_id, game_number, hand_number, seed, deck_json, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("h_old", "r_old", "s_old", 1, 1, seed, JSON.stringify(deck), null, stamp);
    raw.prepare(
      `INSERT INTO actions (hand_id, seq, player_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run("h_old", 1, "not-seated", JSON.stringify({ type: "play", tileId: deck[0], endId: "lead" }), stamp);
    raw.close();

    const store = new Store(file);
    expect(store.room("r_old")?.rules_version).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hub = new Hub(store, 30, () => 0, 60_000);
      expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toMatch(/Room r_old could not be restored/);
      expect(store.room("r_old")?.status).toBe("abandoned");
      expect(store.room("r_old")?.rules_version).toBeNull();

      const messages: ServerMessage[] = [];
      const alex = hub.connect(
        { type: "create", name: "Alex", playerCount: 2, boneyardMode: "draw_one", seriesLength: 3 },
        (message) => messages.push(message),
        () => undefined,
      );
      if (!alex.ok) throw new Error(alex.error);
      const code = latestView(messages)?.roomCode ?? "";
      const sam = hub.connect(
        { type: "join", code, name: "Sam" },
        () => undefined,
        () => undefined,
      );
      if (!sam.ok) throw new Error(sam.error);
      hub.command(alex.session.playerId, { type: "start" });
      const before = latestView(messages);
      expect(before?.status).toBe("playing");
      const good = store.roomByCode(code);
      expect(good?.rules_version).toBe(RULES_VERSION);
      const token = messages.find((message) => message.type === "welcome");
      const welcome = token?.type === "welcome" ? token.token : "";

      const now = new Date().toISOString();
      store.insertRoom({
        id: "r_bad",
        code: "BADROOM",
        host_id: "p_bad",
        series_id: "s_bad",
        player_count: 2,
        boneyard_mode: "draw_one",
        series_length: 3,
        status: "playing",
        created_at: now,
        rules_version: RULES_VERSION,
      });
      store.insertPlayer({
        id: "p_bad",
        room_id: "r_bad",
        name: "Pat",
        token: "b".repeat(32),
        seat: 0,
        created_at: now,
        bot: 0,
        difficulty: null,
      });
      store.insertPlayer({
        id: "p_bad2",
        room_id: "r_bad",
        name: "Jo",
        token: "d".repeat(32),
        seat: 1,
        created_at: now,
        bot: 0,
        difficulty: null,
      });
      store.insertHand({
        id: "h_bad",
        room_id: "r_bad",
        series_id: "s_bad",
        game_number: 1,
        hand_number: 1,
        seed,
        deck_json: JSON.stringify(deck),
        result_json: null,
        created_at: now,
      });
      store.insertAction({
        hand_id: "h_bad",
        seq: 1,
        player_id: "not-seated",
        payload_json: JSON.stringify({ type: "play", tileId: deck[0], endId: "lead" }),
        created_at: now,
      });
      store.insertRoom({
        id: "r_settled",
        code: "SETTLED",
        host_id: "p_settled",
        series_id: "s_settled",
        player_count: 2,
        boneyard_mode: "draw_one",
        series_length: 3,
        status: "abandoned",
        created_at: now,
        rules_version: null,
      });

      warn.mockClear();
      const restored = new Hub(store, 30, () => 0, 60_000);
      const warnings = warn.mock.calls.map((call) => String(call[0]));
      expect(warnings.some((line) => line.includes("r_bad") && line.includes("It's not your turn."))).toBe(true);
      expect(warnings.some((line) => line.includes("r_old") || line.includes("r_settled"))).toBe(false);
      expect(store.room("r_bad")?.status).toBe("abandoned");
      expect(store.room("r_bad")?.rules_version).toBeNull();
      expect(store.room(good?.id ?? "")?.status).toBe("playing");

      const again: ServerMessage[] = [];
      const back = restored.connect(
        { type: "reconnect", token: welcome },
        (message) => again.push(message),
        () => undefined,
      );
      expect(back.ok).toBe(true);
      expect(latestView(again)?.status).toBe("playing");
      expect(latestView(again)?.you.hand).toEqual(before?.you.hand);
      expect(latestView(again)?.players.map((player) => player.score)).toEqual(
        before?.players.map((player) => player.score),
      );
      const refused = restored.connect(
        { type: "reconnect", token: "b".repeat(32) },
        () => undefined,
        () => undefined,
      );
      expect(refused.ok).toBe(false);
    } finally {
      warn.mockRestore();
      store.db.close();
    }
  });

  it("restores a skipped turn after the server starts again", async () => {
    const file = `/tmp/uhoh-timeout-restart-${Date.now()}.sqlite`;
    const store = new Store(file);
    const hub = new Hub(store, 30, () => 0, 300, 60_000);
    const messages: ServerMessage[] = [];
    const alex = hub.connect(
      { type: "solo", name: "Alex", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3, difficulty: "easy" },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!alex.ok) throw new Error(alex.error);
    const playerId = alex.session.playerId;
    let humanMoves = 0;
    const ready = await waitFor(() => {
      const view = latestView(messages);
      const room = store.roomByCode(view?.roomCode ?? "");
      const actions = room ? store.handsForSeries(room.id, room.series_id).flatMap((hand) => store.actions(hand.id)) : [];
      const hasTimeout = actions.some((action) => action.intent.type === "timeout");
      if (
        view &&
        view.status === "playing" &&
        view.betweenHands !== true &&
        view.turnPlayerId === playerId &&
        humanMoves < 2 &&
        !hasTimeout
      ) {
        const play = view.legalPlays[0];
        if (play) hub.command(playerId, { type: "intent", intent: { type: "play", ...play } });
        else if (view.canDraw) hub.command(playerId, { type: "intent", intent: { type: "draw" } });
        else if (view.canKnock) hub.command(playerId, { type: "intent", intent: { type: "knock" } });
        humanMoves += 1;
      }
      return (
        humanMoves >= 1 &&
        hasTimeout &&
        view?.status === "playing" &&
        view.betweenHands !== true &&
        view.turnPlayerId === playerId
      );
    }, 5_000);
    expect(ready).toBe(true);
    const before = latestView(messages);
    const welcome = messages.find((message) => message.type === "welcome");
    const token = welcome?.type === "welcome" ? welcome.token : "";
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const copy = `${file}.copy`;
    copyFileSync(file, copy);

    const restoredStore = new Store(copy);
    const restored = new Hub(restoredStore, 30, () => 0, 60_000, 60_000);
    const room = restoredStore.roomByCode(before?.roomCode ?? "");
    const actions = restoredStore.handsForSeries(room!.id, room!.series_id).flatMap((hand) => restoredStore.actions(hand.id));
    expect(actions.some((action) => action.intent.type === "timeout")).toBe(true);
    expect(actions.some((action) => action.intent.type !== "timeout")).toBe(true);
    expect(room?.rules_version).toBe(RULES_VERSION);
    const again: ServerMessage[] = [];
    const back = restored.connect(
      { type: "reconnect", token },
      (message) => again.push(message),
      () => undefined,
    );
    expect(back.ok).toBe(true);
    const after = latestView(again);
    expect(after?.status).toBe("playing");
    expect(after?.you.hand).toEqual(before?.you.hand);
    expect(after?.players.map((player) => player.score)).toEqual(before?.players.map((player) => player.score));
    expect(after?.openEquation).toBe(before?.openEquation);
    restoredStore.db.close();
  });

  it("restores an older room where the winner opened the next game", () => {
    const file = `/tmp/uhoh-rules2-${Date.now()}.sqlite`;
    const store = new Store(file);
    const players = [
      { id: "p_alex", name: "Alex" },
      { id: "p_sam", name: "Sam" },
    ];
    const config = { boneyardMode: "draw_one" as const, seriesLength: 3 as const, targetScore: 150 };
    let match = createMatch(players, config);
    const saved: Array<{ deck: string[]; actions: Array<{ playerId: string; intent: { type: "play" | "draw" | "knock"; tileId?: string; endId?: string } }> }> = [];
    let deals = 0;
    while (!match.lastHand?.gameWinnerId && deals < 30) {
      deals += 1;
      const seed = Buffer.alloc(32, deals);
      const deck = shuffleWithSeed(seed);
      match = beginHand(match, deck, 2);
      const actions: Array<{ playerId: string; intent: { type: "play" | "draw" | "knock"; tileId?: string; endId?: string } }> = [];
      let guard = 0;
      while (match.hand && match.hand.phase !== "complete" && guard < 400) {
        guard += 1;
        const playerId = currentPlayerId(match);
        if (!playerId) throw new Error("Nobody is up.");
        const intent = legalIntents(match, playerId)[0];
        if (!intent) throw new Error("No move.");
        const result = applyIntent(match, playerId, intent);
        if (!result.ok) throw new Error(result.error);
        match = result.match;
        actions.push({ playerId, intent });
      }
      saved.push({ deck, actions });
    }
    expect(match.lastHand?.gameWinnerId).toBeTruthy();
    const winner = match.lastHand?.gameWinnerId ?? "";
    const nextSeed = Buffer.alloc(32, 99);
    const nextDeck = shuffleWithSeed(nextSeed);
    const opened = beginHand(match, nextDeck, 2);
    expect(opened.gameNumber).toBe(2);
    expect(opened.hand?.openingTileId).toBeNull();
    expect(opened.hand?.leaderId).toBe(winner);
    const lead = legalIntents(opened, winner).find((intent) => intent.type === "play");
    if (!lead || lead.type !== "play") throw new Error("The winner had nothing to lead.");
    const led = applyIntent(opened, winner, lead);
    if (!led.ok) throw new Error(led.error);
    saved.push({ deck: nextDeck, actions: [{ playerId: winner, intent: lead }] });

    const now = new Date().toISOString();
    store.insertRoom({
      id: "r_v2",
      code: "OLDOPEN",
      host_id: "p_alex",
      series_id: "s_v2",
      player_count: 2,
      boneyard_mode: "draw_one",
      series_length: 3,
      status: "playing",
      created_at: now,
      rules_version: 2,
    });
    store.insertPlayer({
      id: "p_alex",
      room_id: "r_v2",
      name: "Alex",
      token: "a".repeat(32),
      seat: 0,
      created_at: now,
      bot: 0,
      difficulty: null,
    });
    store.insertPlayer({
      id: "p_sam",
      room_id: "r_v2",
      name: "Sam",
      token: "s".repeat(32),
      seat: 1,
      created_at: now,
      bot: 0,
      difficulty: null,
    });
    saved.forEach((hand, index) => {
      const id = `h_v2_${index}`;
      store.insertHand({
        id,
        room_id: "r_v2",
        series_id: "s_v2",
        game_number: index === saved.length - 1 ? 2 : 1,
        hand_number: index === saved.length - 1 ? 1 : index + 1,
        seed: index.toString(16).padStart(2, "0"),
        deck_json: JSON.stringify(hand.deck),
        result_json: null,
        created_at: now,
      });
      hand.actions.forEach((action, seq) => {
        store.insertAction({
          hand_id: id,
          seq: seq + 1,
          player_id: action.playerId,
          payload_json: JSON.stringify(action.intent),
          created_at: now,
        });
      });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hub = new Hub(store, 30, () => 0, 60_000);
      expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).not.toMatch(/r_v2/);
      expect(store.room("r_v2")?.status).toBe("playing");
      expect(store.room("r_v2")?.rules_version).toBe(2);
      const messages: ServerMessage[] = [];
      const back = hub.connect(
        { type: "reconnect", token: "a".repeat(32) },
        (message) => messages.push(message),
        () => undefined,
      );
      expect(back.ok).toBe(true);
      const view = latestView(messages);
      expect(view?.gameNumber).toBe(2);
      expect(view?.board?.center?.tileId).toBe(lead.tileId);
      expect(view?.lastPlay?.playerId).toBe(winner);
    } finally {
      warn.mockRestore();
      store.db.close();
    }
  });
});

describe("computer turns after a knock or a restart", () => {
  it("plays the next computer after a knock on an empty boneyard when its timer is gone", () => {
    const store = new Store(`:memory:`);
    const hub = new Hub(store, 30, () => 0);
    const messages: ServerMessage[] = [];
    const opened = hub.connect(
      { type: "solo", name: "Us", playerCount: 4, boneyardMode: "draw_until", seriesLength: 3, difficulty: "easy" },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!opened.ok) throw new Error(opened.error);
    const playerId = opened.session.playerId;
    for (let guard = 0; guard < 900; guard += 1) {
      const view = latestView(messages);
      if (!view || view.status === "complete" || view.status === "abandoned") break;
      if (view.phase === "between" || view.betweenHands) {
        hub.command(playerId, { type: "continue" });
        continue;
      }
      if (view.turnPlayerId !== playerId) {
        hub.sweepBots(Date.now() + BOT_WATCH_MARGIN_MS + 50);
        continue;
      }
      if (view.canKnock && view.boneyardCount === 0) {
        const before = actionCount(store, view.roomCode);
        hub.command(playerId, { type: "intent", intent: { type: "knock" } });
        const knocked = latestView(messages);
        if (!knocked || knocked.phase === "between" || knocked.betweenHands) continue;
        expect(knocked.lastEvent?.kind).toBe("knock");
        expect(knocked.boneyardCount).toBe(0);
        const bot = knocked.players.find((player) => player.id === knocked.turnPlayerId);
        expect(bot?.bot).toBe(true);
        hub.dropBotTimer(bot!.id);
        hub.sweepBots(Date.now() + BOT_WATCH_MARGIN_MS + 50);
        expect(actionCount(store, view.roomCode)).toBeGreaterThan(before + 1);
        expect(latestView(messages)?.turnPlayerId).not.toBe(bot!.id);
        store.db.close();
        return;
      }
      const play = view.legalPlays[0];
      if (play) hub.command(playerId, { type: "intent", intent: { type: "play", ...play } });
      else if (view.canDraw) hub.command(playerId, { type: "intent", intent: { type: "draw" } });
      else if (view.canKnock) hub.command(playerId, { type: "intent", intent: { type: "knock" } });
      else throw new Error("The human had no move.");
    }
    store.db.close();
    throw new Error("The table never knocked on an empty boneyard.");
  });

  it("plays a restored computer turn after the restart drops its timer", () => {
    const found = findEmptyKnock();
    const file = `/tmp/uhoh-bot-restore-${Date.now()}.sqlite`;
    const store = new Store(file);
    const now = new Date().toISOString();
    store.insertRoom({
      id: "r_bot",
      code: "MBD462",
      host_id: "p_you",
      series_id: "s_bot",
      player_count: 4,
      boneyard_mode: "draw_until",
      series_length: 3,
      status: "playing",
      created_at: now,
      rules_version: RULES_VERSION,
    });
    const seats = [
      { id: "p_you", name: "Us", token: "y".repeat(32), bot: 0, difficulty: null },
      { id: "p_bones", name: "Bones", token: "b".repeat(32), bot: 1, difficulty: "medium" },
      { id: "p_pips", name: "Pips", token: "p".repeat(32), bot: 1, difficulty: "medium" },
      { id: "p_lucky", name: "Lucky", token: "l".repeat(32), bot: 1, difficulty: "medium" },
    ];
    seats.forEach((seat, index) => {
      store.insertPlayer({
        id: seat.id,
        room_id: "r_bot",
        name: seat.name,
        token: seat.token,
        seat: index,
        created_at: now,
        bot: seat.bot,
        difficulty: seat.difficulty,
      });
    });
    found.hands.forEach((hand, index) => {
      const id = `h_bot_${index}`;
      store.insertHand({
        id,
        room_id: "r_bot",
        series_id: "s_bot",
        game_number: hand.gameNumber,
        hand_number: hand.handNumber,
        seed: "ab".repeat(32),
        deck_json: JSON.stringify(hand.deck),
        result_json: null,
        created_at: now,
      });
      hand.actions.forEach((action, seq) => {
        store.insertAction({
          hand_id: id,
          seq: seq + 1,
          player_id: action.playerId,
          payload_json: JSON.stringify(action.intent),
          created_at: now,
        });
      });
    });
    const before = actionCount(store, "MBD462");
    const hub = new Hub(store, 30, () => 60_000);
    const messages: ServerMessage[] = [];
    const back = hub.connect(
      { type: "reconnect", token: "y".repeat(32) },
      (message) => messages.push(message),
      () => undefined,
    );
    expect(back.ok).toBe(true);
    const view = latestView(messages);
    expect(view?.status).toBe("playing");
    expect(view?.boneyardCount).toBe(0);
    expect(view?.lastEvent?.kind).toBe("knock");
    expect(view?.prompt).toMatch(/\(computer\)'s turn/);
    const bot = view?.players.find((player) => player.id === view.turnPlayerId);
    expect(bot?.bot).toBe(true);
    hub.dropBotTimer(bot!.id);
    expect(actionCount(store, "MBD462")).toBe(before);
    hub.sweepBots(Date.now() + 60_000 + BOT_WATCH_MARGIN_MS + 1);
    expect(actionCount(store, "MBD462")).toBeGreaterThan(before);
    expect(latestView(messages)?.turnPlayerId === bot!.id && latestView(messages)?.phase === "play").toBe(false);
    store.db.close();
  });
});

function actionCount(store: Store, code: string): number {
  const room = store.roomByCode(code);
  if (!room) return 0;
  return store.handsForSeries(room.id, room.series_id).reduce((sum, hand) => sum + store.actions(hand.id).length, 0);
}

function findEmptyKnock(): {
  hands: Array<{
    gameNumber: number;
    handNumber: number;
    deck: string[];
    actions: Array<{ playerId: string; intent: { type: "play" | "draw" | "knock"; tileId?: string; endId?: string } }>;
  }>;
} {
  const players = [
    { id: "p_you", name: "Us" },
    { id: "p_bones", name: "Bones" },
    { id: "p_pips", name: "Pips" },
    { id: "p_lucky", name: "Lucky" },
  ];
  const config = { boneyardMode: "draw_until" as const, seriesLength: 3 as const, targetScore: 150 };
  let match = createMatch(players, config);
  const hands: Array<{
    gameNumber: number;
    handNumber: number;
    deck: string[];
    actions: Array<{ playerId: string; intent: { type: "play" | "draw" | "knock"; tileId?: string; endId?: string } }>;
  }> = [];
  for (let deal = 1; deal <= 60 && match.phase !== "series_over"; deal += 1) {
    const deck = shuffleWithSeed(Buffer.alloc(32, deal));
    match = beginHand(match, deck);
    const actions: Array<{ playerId: string; intent: { type: "play" | "draw" | "knock"; tileId?: string; endId?: string } }> = [];
    let guard = 0;
    while (match.hand && match.hand.phase !== "complete" && guard < 400) {
      guard += 1;
      const playerId = currentPlayerId(match);
      if (!playerId) throw new Error("Nobody is up.");
      const intents = legalIntents(match, playerId);
      const knock = intents.find((intent) => intent.type === "knock");
      if (knock && playerId === "p_you" && match.hand.boneyard.length === 0) {
        const peeked = applyIntent(match, playerId, knock);
        const botId = peeked.ok ? currentPlayerId(peeked.match) : null;
        if (peeked.ok && peeked.match.hand && peeked.match.hand.phase !== "complete" && botId && botId !== "p_you") {
          actions.push({ playerId, intent: knock });
          hands.push({ gameNumber: match.gameNumber, handNumber: match.handNumber, deck, actions });
          return { hands };
        }
      }
      const intent = intents[0];
      if (!intent) throw new Error("No move.");
      const result = applyIntent(match, playerId, intent);
      if (!result.ok) throw new Error(result.error);
      match = result.match;
      actions.push({ playerId, intent });
    }
    hands.push({
      gameNumber: hands.length === 0 ? 1 : match.gameNumber,
      handNumber: match.handNumber,
      deck,
      actions,
    });
  }
  throw new Error("No empty-boneyard knock left the next computer to move.");
}

async function waitFor(ready: () => boolean, limitMs = 2_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < limitMs) {
    if (ready()) return true;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return ready();
}

async function untilBotActs(
  hub: Hub,
  store: Store,
  code: string,
  humans: Array<{ playerId: string; messages: ServerMessage[] }>,
) {
  for (let step = 0; step < 80; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const room = store.roomByCode(code);
    if (!room) throw new Error("The room disappeared.");
    const botIds = new Set(store.players(room.id).filter((player) => player.bot).map((player) => player.id));
    const actions = store.handsForSeries(room.id, room.series_id).flatMap((hand) => store.actions(hand.id));
    if (actions.some((action) => botIds.has(action.playerId))) return actions;
    for (const human of humans) {
      const view = latestView(human.messages);
      if (!view || view.turnPlayerId !== human.playerId) continue;
      const play = view.legalPlays[0];
      if (play) hub.command(human.playerId, { type: "intent", intent: { type: "play", ...play } });
      else if (view.canDraw) hub.command(human.playerId, { type: "intent", intent: { type: "draw" } });
      else if (view.canKnock) hub.command(human.playerId, { type: "intent", intent: { type: "knock" } });
    }
  }
  throw new Error("A computer never moved.");
}

describe("quick match", () => {
  it("seats two players at the same public table and deals when it is full", () => {
    const { hub, connect } = setup();
    const ada = connect({ type: "quick", name: "Ada", size: 2 });
    const waiting = latestView(ada.messages);
    expect(waiting?.status).toBe("lobby");
    expect(waiting?.quick?.canFill).toBe(false);
    expect(waiting?.players[0]?.avatarId).toBe("2hot4tv");
    expect(hub.openTables()).toHaveLength(1);

    const bo = connect({ type: "quick", name: "Bo", size: 2 });
    const started = latestView(bo.messages);
    expect(started?.status).toBe("playing");
    expect(started?.roomCode).toBe(waiting?.roomCode);
    expect(started?.players.every((player) => !player.bot)).toBe(true);
    expect(hub.openTables()).toHaveLength(0);
    expect(latestView(ada.messages)?.status).toBe("playing");
  });

  it("lets Any join an open table, and a different size opens another", () => {
    const { hub, connect } = setup();
    const ada = connect({ type: "quick", name: "Ada", size: 4 });
    const any = connect({ type: "quick", name: "Bo", size: "any" });
    expect(latestView(any.messages)?.roomCode).toBe(latestView(ada.messages)?.roomCode);
    expect(latestView(any.messages)?.settings.playerCount).toBe(4);
    expect(latestView(any.messages)?.status).toBe("lobby");

    const other = connect({ type: "quick", name: "Cy", size: 2 });
    expect(latestView(other.messages)?.roomCode).not.toBe(latestView(ada.messages)?.roomCode);
    expect(hub.openTables()).toHaveLength(2);
    const codes = hub.openTables().map((table) => table.code);
    expect(codes).toContain(latestView(ada.messages)?.roomCode);
  });

  it("refuses computers until the wait is up, then an all-computer fill is unranked", () => {
    const { hub, connect } = setup();
    const ada = connect({ type: "quick", name: "Ada", size: 2 });
    hub.command(ada.playerId, { type: "fill-quick" });
    expect(ada.messages.at(-1)?.type).toBe("error");
    expect(latestView(ada.messages)?.status).toBe("lobby");

    const store = new Store(":memory:");
    const fast = new Hub(store, 30, () => 1, 30_000, 9_000, 0);
    const messages: ServerMessage[] = [];
    const seated = fast.connect(
      { type: "quick", name: "Ada", size: 2 },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!seated.ok) throw new Error(seated.error);
    fast.command(seated.session.playerId, { type: "fill-quick" });
    const view = latestView(messages);
    expect(view?.status).toBe("playing");
    expect(view?.players.filter((player) => player.bot)).toHaveLength(1);
    const portraits = view?.players.map((player) => player.avatarId) ?? [];
    expect(new Set(portraits).size).toBe(portraits.length);
    expect(portraits.filter((id) => id !== "2hot4tv").length).toBe(1);
  });

  it("drops a waiting seat on cancel and keeps a private room off the list", () => {
    const { hub, connect } = setup();
    const ada = connect({ type: "quick", name: "Ada", size: 4 });
    hub.command(ada.playerId, { type: "cancel-quick" });
    expect(hub.openTables()).toHaveLength(0);

    connect({ type: "create", name: "Pat", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 });
    expect(hub.openTables()).toHaveLength(0);
  });

  it("deals a fresh computer game and will not seat a human in one already going", () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 30, () => 60_000);
    const messages: ServerMessage[] = [];
    const alex = hub.connect(
      { type: "solo", name: "Bryan", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3, difficulty: "easy" },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!alex.ok) throw new Error(alex.error);
    const view = latestView(messages);
    expect(view?.status).toBe("playing");
    expect(view?.handNumber).toBe(1);
    expect(view?.gameNumber).toBe(1);
    expect(view?.players.every((player) => player.score === 0)).toBe(true);
    expect(view?.players.some((player) => player.bot && player.name === "Bones")).toBe(true);
    const opponent = view?.players.find((player) => !player.isYou);
    const dealt = (view?.you.hand.length ?? 0) + (opponent?.tileCount ?? 0) + (view?.boneyardCount ?? 0) + boardIds(view).length;
    expect(dealt).toBe(28);
    expect(boardIds(view)).toHaveLength(0);
    if (view?.turnPlayerId === view?.yourId) expect(view?.openingTileId).toBeTruthy();

    const code = view?.roomCode ?? "";
    const walkedIn = hub.connect({ type: "join", name: "Sam", code }, () => undefined, () => undefined);
    expect(walkedIn.ok).toBe(false);

    const quickMessages: ServerMessage[] = [];
    const quick = hub.connect(
      { type: "quick", name: "Sam", size: 2 },
      (message) => quickMessages.push(message),
      () => undefined,
    );
    expect(quick.ok).toBe(true);
    const quickView = latestView(quickMessages);
    expect(quickView?.status).toBe("lobby");
    expect(quickView?.roomCode).not.toBe(code);
    expect(hub.openTables().some((table) => table.code === code)).toBe(false);
  });

  it("never lets a human join a bot-only table", () => {
    const store = new Store(":memory:");
    const now = new Date().toISOString();
    store.insertRoom({
      id: "bot_league1",
      code: "BOTGM1",
      host_id: "bp1",
      series_id: "league",
      player_count: 2,
      boneyard_mode: "draw_until",
      series_length: 3,
      status: "lobby",
      created_at: now,
      rules_version: RULES_VERSION,
      casual: 0,
      listed: 1,
    });
    for (const [index, name] of ["Pip Squeak", "Double Six"].entries()) {
      store.insertPlayer({
        id: index === 0 ? "bp1" : "bp2",
        room_id: "bot_league1",
        name,
        token: `bot-token-${index}-0123456789abcdef`,
        seat: index,
        created_at: now,
        bot: 1,
        difficulty: "medium",
        user_id: `bot_${index}`,
        avatar_id: "homescreen",
      });
    }
    const hub = new Hub(store, 30);
    const joined = hub.connect({ type: "join", name: "Bryan", code: "BOTGM1" }, () => undefined, () => undefined);
    expect(joined.ok).toBe(false);
    expect(hub.openTables().some((table) => table.code === "BOTGM1")).toBe(false);
    const messages: ServerMessage[] = [];
    const quick = hub.connect({ type: "quick", name: "Bryan", size: 2 }, (message) => messages.push(message), () => undefined);
    expect(quick.ok).toBe(true);
    expect(latestView(messages)?.roomCode).not.toBe("BOTGM1");
    expect(latestView(messages)?.status).toBe("lobby");
  });

  it("shows the host table to every phone, and a human beats a bot", () => {
    const store = new Store(":memory:");
    const now = new Date().toISOString();
    const cosmetics = new Cosmetics(store);
    for (const [id, name] of [
      ["host", "Host"],
      ["guest", "Guest"],
      ["bot_pip", "Pip"],
    ] as const) {
      store.insertUser({
        id,
        display_name: name,
        avatar_id: "homescreen",
        created_at: now,
        updated_at: now,
        is_guest: id === "bot_pip" ? 0 : 1,
      });
      cosmetics.loadout(id);
    }
    store.markBot("bot_pip");
    for (const [userId, itemId] of [
      ["host", "TBL-003"],
      ["guest", "TBL-007"],
      ["bot_pip", "TBL-006"],
    ] as const) {
      store.db
        .prepare(`INSERT INTO owned_items (user_id, item_id, acquired_at) VALUES (?, ?, ?)`)
        .run(userId, itemId, now);
      const worn = cosmetics.equip(userId, itemId);
      expect(worn.ok, "equip").toBe(true);
    }

    const hub = new Hub(store, 30, () => 60_000);
    const hostMessages: ServerMessage[] = [];
    const host = hub.connect(
      { type: "create", name: "Host", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      (message) => hostMessages.push(message),
      () => undefined,
      "host",
    );
    if (!host.ok) throw new Error(host.error);
    const code = latestView(hostMessages)?.roomCode ?? "";
    const guestMessages: ServerMessage[] = [];
    const guest = hub.connect(
      { type: "join", name: "Guest", code },
      (message) => guestMessages.push(message),
      () => undefined,
      "guest",
    );
    expect(guest.ok).toBe(true);
    expect(latestView(hostMessages)?.tableId).toBe("TBL-003");
    expect(latestView(guestMessages)?.tableId).toBe("TBL-003");
    expect(latestView(guestMessages)?.players.find((player) => player.isYou)?.tileSkin).toBe("ivory");

    hub.setRoster(() => [{ userId: "bot_pip", name: "Pip", avatarId: "homescreen", difficulty: "easy" }]);
    const quickMessages: ServerMessage[] = [];
    const quick = hub.connect(
      { type: "quick", name: "Host", size: 2 },
      (message) => quickMessages.push(message),
      () => undefined,
      "host",
    );
    if (!quick.ok) throw new Error(quick.error);
    hub.command(quick.session.playerId, { type: "fill-bots" });
    const playing = latestView(quickMessages);
    expect(playing?.status).toBe("playing");
    expect(playing?.tableId).toBe("TBL-003");
    expect(playing?.players.find((player) => player.accountBot)?.tableId).toBe("TBL-006");
    expect(playing?.players.every((player) => player.score === 0)).toBe(true);
    expect(boardIds(playing)).toHaveLength(0);
  });

  it("refuses to finish a match that is still going", () => {
    const { store, hub, connect } = setup();
    const alex = connect({
      type: "create",
      name: "Alex",
      playerCount: 2,
      boneyardMode: "draw_one",
      seriesLength: 3,
    });
    const code = latestView(alex.messages)?.roomCode ?? "";
    const sam = connect({ type: "join", code, name: "Sam" });
    hub.command(alex.playerId, { type: "start" });
    hub.command(alex.playerId, { type: "finish" });
    expect(alex.messages.at(-1)).toMatchObject({ type: "error", message: "The match is still going." });
    const token = welcomeToken(alex.messages);
    expect(store.playerByToken(token)?.id).toBe(alex.playerId);

    const again = hub.connect({ type: "reconnect", token }, () => undefined, () => undefined);
    expect(again.ok).toBe(true);

    const quickMessages: ServerMessage[] = [];
    const quick = hub.connect(
      { type: "quick", name: "Ada", size: 2 },
      (message) => quickMessages.push(message),
      () => undefined,
    );
    if (!quick.ok) throw new Error(quick.error);
    const partner = hub.connect({ type: "quick", name: "Bea", size: 2 }, () => undefined, () => undefined);
    if (!partner.ok) throw new Error(partner.error);
    expect(latestView(quickMessages)?.status).toBe("playing");
    hub.command(quick.session.playerId, { type: "finish" });
    expect(quickMessages.at(-1)).toMatchObject({ type: "error", message: "The match is still going." });
    expect(store.playerByToken(welcomeToken(quickMessages))?.id).toBe(quick.session.playerId);
  });

  it("drops a finished seat without paying Bones or rating again", () => {
    const store = new Store(":memory:");
    seatUser(store, "ada", "Ada");
    seatUser(store, "bo", "Bo");
    const hub = new Hub(store, 30, () => 0, 60_000);
    const adaMessages: ServerMessage[] = [];
    const boMessages: ServerMessage[] = [];
    const ada = hub.connect(
      { type: "create", name: "Ada", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      (message) => adaMessages.push(message),
      () => undefined,
      "ada",
    );
    if (!ada.ok) throw new Error(ada.error);
    const code = latestView(adaMessages)?.roomCode ?? "";
    const bo = hub.connect(
      { type: "join", code, name: "Bo" },
      (message) => boMessages.push(message),
      () => undefined,
      "bo",
    );
    if (!bo.ok) throw new Error(bo.error);
    hub.command(ada.session.playerId, { type: "start" });

    const players = [
      { playerId: ada.session.playerId, messages: adaMessages },
      { playerId: bo.session.playerId, messages: boMessages },
    ];
    let sawBreak = false;
    const done = playSeries(hub, players, (paused) => {
      if (sawBreak) return;
      sawBreak = true;
      hub.command(paused.playerId, { type: "finish" });
      expect(paused.messages.at(-1)).toMatchObject({ type: "error", message: "The match is still going." });
    });
    expect(sawBreak).toBe(true);
    expect(done?.status).toBe("complete");
    expect(done?.phase).toBe("over");
    expect(done?.betweenHands).toBe(false);
    expect(latestView(adaMessages)?.canRematch).toBe(true);
    expect(latestView(boMessages)?.canRematch).toBe(false);
    const paid = {
      ada: credits(store, "ada"),
      bo: credits(store, "bo"),
    };
    expect(paid.ada.grants).toBeGreaterThan(0);
    expect(paid.ada.bones).toBeGreaterThan(0);
    expect(paid.bo.bones).toBeGreaterThan(0);
    expect(paid.ada.history).toBeGreaterThan(0);

    hub.command(bo.session.playerId, { type: "finish" });
    expect(store.playerByToken(welcomeToken(boMessages))).toBeNull();
    const boBack = hub.connect(
      { type: "reconnect", token: welcomeToken(boMessages) },
      () => undefined,
      () => undefined,
    );
    expect(boBack.ok).toBe(false);
    expect(latestView(adaMessages)?.status).toBe("complete");
    expect(latestView(adaMessages)?.canRematch).toBe(false);
    expect(latestView(adaMessages)?.players.some((player) => player.id === bo.session.playerId)).toBe(false);
    hub.command(ada.session.playerId, { type: "rematch" });
    expect(adaMessages.at(-1)).toMatchObject({
      type: "error",
      message: "Everyone has to still be here for another series.",
    });
    expect(credits(store, "ada")).toEqual(paid.ada);
    expect(credits(store, "bo")).toEqual(paid.bo);

    hub.command(ada.session.playerId, { type: "finish" });
    expect(store.playerByToken(welcomeToken(adaMessages))).toBeNull();
    const adaBack = hub.connect(
      { type: "reconnect", token: welcomeToken(adaMessages) },
      () => undefined,
      () => undefined,
    );
    expect(adaBack.ok).toBe(false);
    expect(store.roomByCode(code)).toBeNull();
    expect(credits(store, "ada")).toEqual(paid.ada);
    expect(credits(store, "bo")).toEqual(paid.bo);
  });

  it("lets the player who stayed leave after the opponent walks off", async () => {
    const store = new Store(":memory:");
    seatUser(store, "ada", "Ada");
    seatUser(store, "bo", "Bo");
    const hub = new Hub(store, 30, () => 0, 40, 60_000);
    const adaMessages: ServerMessage[] = [];
    const boMessages: ServerMessage[] = [];
    const ada = hub.connect(
      { type: "create", name: "Ada", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      (message) => adaMessages.push(message),
      () => undefined,
      "ada",
    );
    if (!ada.ok) throw new Error(ada.error);
    const code = latestView(adaMessages)?.roomCode ?? "";
    const bo = hub.connect(
      { type: "join", code, name: "Bo" },
      (message) => boMessages.push(message),
      () => undefined,
      "bo",
    );
    if (!bo.ok) throw new Error(bo.error);
    hub.command(ada.session.playerId, { type: "start" });
    const abandoned = await waitFor(
      () => latestView(adaMessages)?.status === "abandoned" && latestView(boMessages)?.status === "abandoned",
    );
    expect(abandoned).toBe(true);
    const paid = { ada: credits(store, "ada"), bo: credits(store, "bo") };
    expect(paid.ada.history).toBeGreaterThan(0);

    const stayer = latestView(boMessages)?.ended?.playerId === bo.session.playerId ? ada : bo;
    const stayerMessages = stayer === ada ? adaMessages : boMessages;
    expect(latestView(stayerMessages)?.ended).toBeTruthy();
    hub.command(stayer.session.playerId, { type: "finish" });
    expect(store.playerByToken(welcomeToken(stayerMessages))).toBeNull();
    const back = hub.connect(
      { type: "reconnect", token: welcomeToken(stayerMessages) },
      () => undefined,
      () => undefined,
    );
    expect(back.ok).toBe(false);
    expect(credits(store, "ada")).toEqual(paid.ada);
    expect(credits(store, "bo")).toEqual(paid.bo);

    const other = stayer === ada ? bo : ada;
    const otherMessages = other === ada ? adaMessages : boMessages;
    expect(latestView(otherMessages)?.status).toBe("abandoned");
    hub.command(other.session.playerId, { type: "finish" });
    expect(store.roomByCode(code)).toBeNull();
    expect(credits(store, "ada")).toEqual(paid.ada);
    expect(credits(store, "bo")).toEqual(paid.bo);
  });

  it("lets a player leave a finished computer game", async () => {
    const store = new Store(":memory:");
    seatUser(store, "ada", "Ada");
    const hub = new Hub(store, 30, () => 0, 40, 60_000);
    const messages: ServerMessage[] = [];
    const ada = hub.connect(
      { type: "solo", name: "Ada", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      (message) => messages.push(message),
      () => undefined,
      "ada",
    );
    if (!ada.ok) throw new Error(ada.error);
    const code = latestView(messages)?.roomCode ?? "";
    const abandoned = await waitFor(() => latestView(messages)?.status === "abandoned", 4_000);
    expect(abandoned).toBe(true);
    const paid = credits(store, "ada");
    hub.command(ada.session.playerId, { type: "finish" });
    expect(store.playerByToken(welcomeToken(messages))).toBeNull();
    const back = hub.connect({ type: "reconnect", token: welcomeToken(messages) }, () => undefined, () => undefined);
    expect(back.ok).toBe(false);
    expect(store.roomByCode(code)).toBeNull();
    expect(credits(store, "ada")).toEqual(paid);
  });

  it("brings a waiting quick table back after a restart", () => {
    const { store, connect } = setup();
    const ada = connect({ type: "quick", name: "Ada", size: 3 });
    const code = latestView(ada.messages)?.roomCode;
    const again = new Hub(store, 30);
    const tables = again.openTables();
    expect(tables.map((table) => table.code)).toContain(code);
    expect(tables[0]?.players[0]?.avatarId).toBe("2hot4tv");
  });
});

function seatUser(store: Store, id: string, name: string) {
  const now = new Date().toISOString();
  store.insertUser({
    id,
    display_name: name,
    avatar_id: "homescreen",
    created_at: now,
    updated_at: now,
    is_guest: 1,
  });
}

function credits(store: Store, userId: string) {
  const user = store.user(userId);
  const bones = store.db.prepare(`SELECT bones FROM wallets WHERE user_id = ?`).get(userId) as
    | { bones: number }
    | undefined;
  const grants = store.db.prepare(`SELECT COUNT(*) AS n FROM bone_grants WHERE user_id = ?`).get(userId) as {
    n: number;
  };
  const history = store.db.prepare(`SELECT COUNT(*) AS n FROM rating_history WHERE user_id = ?`).get(userId) as {
    n: number;
  };
  return {
    rating: user?.rating ?? null,
    points: user?.season_points ?? null,
    games: user?.games_played ?? null,
    bones: bones?.bones ?? 0,
    grants: Number(grants.n),
    history: Number(history.n),
  };
}

function welcomeToken(messages: ServerMessage[]): string {
  const welcome = messages.find((message) => message.type === "welcome");
  return welcome?.type === "welcome" ? welcome.token : "";
}

function playSeries(
  hub: Hub,
  players: Array<{ playerId: string; messages: ServerMessage[] }>,
  onBreak?: (player: { playerId: string; messages: ServerMessage[] }) => void,
) {
  for (let step = 0; step < 20_000; step += 1) {
    const view = latestView(players[0]?.messages ?? []);
    if (view?.status === "complete") return view;
    const paused = players.find((player) => latestView(player.messages)?.betweenHands);
    if (paused) {
      onBreak?.(paused);
      hub.command(paused.playerId, { type: "continue" });
      continue;
    }
    const turn = players.find((player) => latestView(player.messages)?.turnPlayerId === player.playerId);
    const turnView = turn ? latestView(turn.messages) : null;
    if (!turn || !turnView) return turnView;
    const play = turnView.legalPlays[0];
    if (play) {
      hub.command(turn.playerId, { type: "intent", intent: { type: "play", tileId: play.tileId, endId: play.endId } });
    } else if (turnView.canDraw) {
      hub.command(turn.playerId, { type: "intent", intent: { type: "draw" } });
    } else if (turnView.canKnock) {
      hub.command(turn.playerId, { type: "intent", intent: { type: "knock" } });
    } else {
      return turnView;
    }
  }
  return latestView(players[0]?.messages ?? []);
}

describe("soak fixtures", () => {
  it("refuses a fixture on a normal table and an unknown fixture", () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 30, () => 0);
    const normal: ServerMessage[] = [];
    const ada = hub.connect(
      {
        type: "solo",
        name: "Ada",
        playerCount: 2,
        boneyardMode: "draw_until",
        seriesLength: 3,
        fixture: "empty-knock",
      },
      (message) => normal.push(message),
      () => undefined,
    );
    if (!ada.ok) throw new Error(ada.error);
    expect(latestView(normal)?.status).toBe("lobby");
    expect(normal.some((message) => message.type === "error" && message.message === "That setup is only for a soak table.")).toBe(true);

    const unknown: ServerMessage[] = [];
    const soak = hub.connect(
      {
        type: "solo",
        name: "soak-ada",
        playerCount: 2,
        boneyardMode: "draw_until",
        seriesLength: 3,
        fixture: "not-a-deal",
      },
      (message) => unknown.push(message),
      () => undefined,
    );
    if (!soak.ok) throw new Error(soak.error);
    expect(latestView(unknown)?.status).toBe("lobby");
    expect(unknown.some((message) => message.type === "error" && message.message === "That setup isn't a soak deal.")).toBe(true);
  });

  it("deals an empty-boneyard knock and the computer answers", async () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 20_000, () => 0);
    const messages: ServerMessage[] = [];
    const opened = hub.connect(
      {
        type: "solo",
        name: "soak-ada",
        playerCount: 2,
        boneyardMode: "draw_until",
        seriesLength: 3,
        difficulty: "easy",
        fixture: "empty-knock",
      },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!opened.ok) throw new Error(opened.error);
    const view = latestView(messages);
    expect(view?.phase).toBe("knock");
    expect(view?.boneyardCount).toBe(0);
    expect(view?.canKnock).toBe(true);
    expect(view?.status).toBe("playing");
    hub.command(opened.session.playerId, { type: "intent", intent: { type: "knock" } });
    const answered = await waitForView(
      messages,
      (next) => next.lastPlay !== null && next.lastPlay.playerId !== opened.session.playerId,
    );
    expect(answered.lastPlay?.playerId).not.toBe(opened.session.playerId);
    expect(answered.lastEvent?.kind).toBe("play");
    expect(answered.phase).not.toBe("between");
  });

  it("plays 15, then a quiet 14, then takes 25", async () => {
    const store = new Store(":memory:");
    const hub = new Hub(store, 20_000, () => 0);
    const messages: ServerMessage[] = [];
    const opened = hub.connect(
      {
        type: "solo",
        name: "soak-reel",
        playerCount: 2,
        boneyardMode: "draw_until",
        seriesLength: 3,
        difficulty: "easy",
        fixture: "score-reel",
      },
      (message) => messages.push(message),
      () => undefined,
    );
    if (!opened.ok) throw new Error(opened.error);
    const dealt = latestView(messages);
    expect(dealt?.you.hand.map((tile) => tile.id).sort()).toEqual(["1-3", "2-4"]);
    expect(dealt?.openTotal).toBe(13);
    expect(dealt?.lastPlay).toBeNull();
    hub.command(opened.session.playerId, { type: "intent", intent: { type: "play", tileId: "1-3", endId: "west" } });
    const scored = latestView(messages);
    expect(scored?.lastPlay).toMatchObject({ tileId: "1-3", total: 15, awarded: 15 });
    const quiet = await waitForView(messages, (next) => next.lastPlay?.tileId === "2-3");
    expect(quiet.lastPlay).toMatchObject({ tileId: "2-3", total: 14, awarded: 0 });
    expect(quiet.openEquation?.replaceAll(" ", "")).toBe("2+12=14");
    hub.command(opened.session.playerId, { type: "intent", intent: { type: "play", tileId: "2-4", endId: "west" } });
    const ended = latestView(messages);
    expect(ended?.lastPlay?.awarded).toBe(0);
    expect(ended?.lastHand?.leftoverAwards[opened.session.playerId]).toBe(25);
    expect(ended?.betweenHands).toBe(true);
  });
});

async function waitForView(messages: ServerMessage[], ready: (view: PlayerView) => boolean): Promise<PlayerView> {
  for (let step = 0; step < 40; step += 1) {
    const view = latestView(messages);
    if (view && ready(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("The table did not reach the expected play.");
}

function boardIds(view: PlayerView | null): string[] {
  if (!view?.board) return [];
  const ids: string[] = [];
  if (view.board.center) ids.push(view.board.center.tileId);
  for (const arm of Object.values(view.board.arms)) {
    for (const tile of arm) ids.push(tile.tileId);
  }
  return ids;
}
