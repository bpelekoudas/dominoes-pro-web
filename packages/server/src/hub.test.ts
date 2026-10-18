import { copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { RULES_VERSION, shuffleWithSeed, type PlayerView } from "@uhoh/rules";
import { Store } from "./db.js";
import { BOT_TURN_MS, Hub, type ServerMessage } from "./hub.js";

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
});

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

function boardIds(view: PlayerView | null): string[] {
  if (!view?.board) return [];
  const ids: string[] = [];
  if (view.board.center) ids.push(view.board.center.tileId);
  for (const arm of Object.values(view.board.arms)) {
    for (const tile of arm) ids.push(tile.tileId);
  }
  return ids;
}
