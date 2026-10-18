import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { PlayerView } from "@uhoh/rules";
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
