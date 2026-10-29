/**
 * Post-deploy soak. Plays full matches as headless guests against a live server.
 *
 *   npm run soak -- --url https://uhohdominoes.com --matches 8 --seats 4
 *
 * Node 22 has a global WebSocket that can send the session cookie. Node 20 uses the `ws` package.
 * `npm run build:rules` first so the replay checker can import @uhoh/rules.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { alignedFronts, createSeatSync, exposedTotal, handCountsMatch, ingest, publicSignature, scoreMove, shiftFronts } from "./soak-sync.mjs";

const runId = randomUUID();

const MODES = [
  { seats: 2, boneyardMode: "draw_until", seriesLength: 3 },
  { seats: 3, boneyardMode: "draw_one", seriesLength: 3 },
  { seats: 4, boneyardMode: "draw_until", seriesLength: 5 },
  { seats: 2, boneyardMode: "draw_one", seriesLength: 7 },
  { seats: 3, boneyardMode: "draw_until", seriesLength: 3 },
  { seats: 4, boneyardMode: "draw_one", seriesLength: 3 },
  { seats: 2, boneyardMode: "draw_until", seriesLength: 5 },
  { seats: 3, boneyardMode: "draw_one", seriesLength: 7 },
];

const args = parseArgs(process.argv.slice(2));

let rules;
try {
  rules = await import("@uhoh/rules");
} catch {
  console.error("The rules build is missing. Run npm run build:rules, then the soak again.");
  process.exit(1);
}

const {
  allTileIds,
  applyIntent,
  beginHand,
  boardAward,
  createMatch,
  gameWinnerId,
  scoreDomino,
  scoreLocked,
  shuffleWithSeed,
  layoutBoard,
  layoutOverlaps,
  tilesOnBoard,
  winsNeeded,
} = rules;

if (args.replay) {
  const code = replayFile(args.replay);
  process.exit(code);
}

if (!args.url) {
  console.error("Pass --url https://host . Example: npm run soak -- --url https://uhohdominoes.com --matches 8 --seats 4");
  process.exit(1);
}

const pageUrl = new URL(args.url);
const wsUrl = `${pageUrl.protocol === "https:" ? "wss:" : "ws:"}//${pageUrl.host}/ws`;
const outDir = args.out;
mkdirSync(outDir, { recursive: true });

const report = {
  url: pageUrl.origin,
  runId,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  matches: [],
  hands: 0,
  knocks: 0,
  locks: 0,
  dominoes: 0,
  gameWins: 0,
  durationsMs: [],
  reconnect: "pending",
  emptyBoneyardKnocks: 0,
  botKnock: null,
  botRestore: null,
  failures: [],
  ui: null,
};

let exitCode = 0;
try {
  const cleaned = await cleanup();
  console.log(`Cleanup before the run: ${JSON.stringify(cleaned)}`);
  console.log("Computer knock on an empty boneyard");
  report.botKnock = await computerKnockProbe();
  console.log(`  ${report.botKnock}`);
  console.log("Restore a computer turn");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22) {
    report.botRestore = `skipped on Node ${process.versions.node} (this drill boots a Node 22 server)`;
  } else {
    report.botRestore = await restoreDrill();
  }
  console.log(`  ${report.botRestore}`);
  const modes = MODES.filter((mode) => mode.seats <= args.seats);
  if (modes.length === 0) throw new Error("--seats must be 2, 3, or 4.");
  let reconnectUsed = false;
  for (let index = 0; index < args.matches; index += 1) {
    const mode = modes[index % modes.length];
    console.log(
      `Match ${index + 1}/${args.matches}: ${mode.seats} seats, ${mode.boneyardMode}, best of ${mode.seriesLength}`,
    );
    const started = Date.now();
    const result = await playMatch(mode, index, { reconnect: !reconnectUsed });
    if (result.reconnected) {
      reconnectUsed = true;
      report.reconnect = "ok";
    }
    const durationMs = Date.now() - started;
    report.durationsMs.push(durationMs);
    report.hands += result.hands;
    report.knocks += result.knocks;
    report.locks += result.locks;
    report.dominoes += result.dominoes;
    report.gameWins += result.gameWins;
    report.matches.push({ ...mode, room: result.room, hands: result.hands, ms: durationMs });
    console.log(
      `  room ${result.room}  hands ${result.hands}  knocks ${result.knocks}  locks ${result.locks}  dominoes ${result.dominoes}  game wins ${result.gameWins}  ${(durationMs / 1000).toFixed(1)}s`,
    );
  }
  if (report.reconnect === "pending") report.reconnect = "skipped";
  if (!args.noUi) {
    console.log("UI smoke at 390×844");
    report.ui = await uiSmoke(pageUrl.origin, args.out);
    console.log(`  ${report.ui.summary}`);
  } else {
    report.ui = { ok: true, skipped: true, summary: "skipped (--no-ui)" };
  }
} catch (error) {
  exitCode = 1;
  const message = error instanceof Error ? error.message : String(error);
  const replay = error && error.replay ? error.replay : null;
  report.failures.push({ message, replay: replay ? path.basename(replay) : null });
  console.error(message);
  if (replay) console.error(`Replay log: ${replay}`);
} finally {
  try {
    const cleaned = await cleanup();
    report.cleanup = cleaned;
  } catch (error) {
    exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    report.failures.push({ message: `cleanup: ${message}` });
    console.error(`cleanup: ${message}`);
  }
  report.finishedAt = new Date().toISOString();
  const summaryPath = path.join(outDir, "summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(report, null, 2)}\n`);
  const human = humanSummary(report);
  console.log(`\n${human}`);
  console.log(`JSON: ${summaryPath}`);
}

process.exit(exitCode);

async function computerKnockProbe() {
  const name = soakName("k");
  const cookie = await guest(name);
  const seat = { playerId: null, view: null, onReady: null, cookie };
  let failure = null;
  let done = false;
  let closing = false;
  let lastActivity = Date.now();
  let knockKey = "";
  let acted = "";
  const socket = await openSocket(wsUrl, cookie);
  socket.on("message", (raw) => {
    lastActivity = Date.now();
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      failure = "The server sent a message that could not be read.";
      return;
    }
    if (message.type === "error") {
      failure = `Server error: ${message.message}`;
      if (seat.onView) seat.onView();
      return;
    }
    if (message.type === "welcome") {
      seat.playerId = message.playerId;
      if (seat.onReady) seat.onReady();
      return;
    }
    if (message.type !== "state") return;
    seat.view = message.view;
    if (seat.onReady) seat.onReady();
    if (seat.onView) seat.onView();
    const view = seat.view;
    if (
      view.boneyardCount === 0 &&
      view.lastEvent?.kind === "knock" &&
      view.lastEvent.playerId === seat.playerId &&
      view.players.some((player) => player.id === view.turnPlayerId && player.bot) &&
      view.phase !== "between" &&
      view.betweenHands !== true
    ) {
      knockKey = turnKey(view);
    }
    if (knockKey && turnKey(view) !== knockKey) done = true;
  });
  socket.on("close", () => {
    if (!closing && !done) failure = failure ?? "The socket closed before the computer moved.";
  });
  const ready = waitSeat(seat);
  socket.send(
    JSON.stringify({
      type: "solo",
      name,
      playerCount: 2,
      boneyardMode: "draw_until",
      seriesLength: 3,
      difficulty: "easy",
      fixture: "empty-knock",
    }),
  );
  await ready;
  // The welcome is followed by the lobby, then the fixture deal. Read the deal, not the first state.
  const opened = await waitForKnockDeal(seat, () => failure);
  if (!failure && !knockDealReady(opened, seat.playerId)) {
    failure = "The knock fixture did not put an empty boneyard on your turn.";
  }
  const deadline = Date.now() + 90_000;
  const limit = Math.min(args.stallMs, 12_000);
  try {
    while (!done && !failure && Date.now() < deadline) {
      if (Date.now() - lastActivity > limit) {
        failure = knockKey ? "Stalled after a knock with an empty boneyard." : "The computer table went quiet.";
        break;
      }
      const view = seat.view;
      if (view?.phase === "between" || view?.betweenHands) {
        const key = `between:${view.lastHand?.gameNumber}-${view.lastHand?.handNumber}`;
        if (acted !== key) {
          acted = key;
          socket.send(JSON.stringify({ type: "continue" }));
        }
      } else if (view && view.turnPlayerId === seat.playerId && (view.phase === "play" || view.phase === "draw" || view.phase === "knock")) {
        const key = turnKey(view);
        if (acted !== key) {
          acted = key;
          socket.send(JSON.stringify({ type: "intent", intent: probeIntent(view) }));
        }
      }
      await sleep(40);
    }
  } finally {
    closing = true;
    try {
      socket.close();
    } catch {
      // already closed
    }
  }
  if (failure) throw new Error(failure);
  if (!done) throw new Error("The computer never had to answer an empty-boneyard knock.");
  return "the computer moved after an empty-boneyard knock";
}

function turnKey(view) {
  return [
    view.status,
    view.phase,
    view.gameNumber,
    view.handNumber,
    view.turnPlayerId,
    view.boneyardCount,
    view.lastPlay?.seq ?? 0,
    view.lastEvent?.kind ?? "",
    view.lastEvent?.playerId ?? "",
    view.betweenHands ? 1 : 0,
  ].join(":");
}

function probeIntent(view) {
  if (view.phase === "play") {
    const play = view.legalPlays[0];
    if (!play) throw new Error("The turn to play had no legal tile.");
    return { type: "play", tileId: play.tileId, endId: play.endId };
  }
  if (view.phase === "draw") return { type: "draw" };
  if (!view.canKnock) throw new Error("A knock was offered while a tile could be played.");
  return { type: "knock" };
}

function knockDealReady(view, playerId) {
  return Boolean(
    view &&
      view.boneyardCount === 0 &&
      view.turnPlayerId === playerId &&
      view.phase === "knock" &&
      view.canKnock === true,
  );
}

/** Resolves on the fixture deal, a server error, or the timeout. Not a fixed pause. */
function waitForKnockDeal(seat, failed) {
  const timeoutMs = 10_000;
  return new Promise((resolve) => {
    const finish = (view) => {
      clearTimeout(timer);
      seat.onView = null;
      resolve(view ?? null);
    };
    const timer = setTimeout(() => finish(seat.view), timeoutMs);
    const consider = () => {
      if (failed()) {
        finish(seat.view);
        return;
      }
      if (knockDealReady(seat.view, seat.playerId)) finish(seat.view);
    };
    seat.onView = consider;
    consider();
  });
}

function waitSeat(seat) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The table did not send a welcome.")), 15_000);
    const finish = () => {
      if (seat.failed) {
        clearTimeout(timer);
        seat.onReady = null;
        reject(new Error(seat.failed));
        return;
      }
      if (!seat.playerId || !seat.view) return;
      clearTimeout(timer);
      seat.onReady = null;
      resolve(seat);
    };
    seat.onReady = finish;
    finish();
  });
}

async function restoreDrill() {
  const entry = path.join(process.cwd(), "packages/server/dist/index.js");
  if (!existsSync(entry)) throw new Error("Build the server before the restore check (npm run build).");
  const dir = path.join("/tmp", `uhoh-soak-restore-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const port = 20000 + (process.pid % 20000);
  const origin = `http://127.0.0.1:${port}`;
  const socketUrl = `ws://127.0.0.1:${port}/ws`;
  let child = startRestoreServer(dir, port);
  try {
    await waitHealth(origin, child);
    const parked = await parkBotTurn(origin, socketUrl);
    await stopChild(child);
    child = startRestoreServer(dir, port);
    await waitHealth(origin, child);
    await expectRestoredBot(origin, socketUrl, parked);
    return "a restored computer turn moved";
  } finally {
    await stopChild(child);
    rmSync(dir, { recursive: true, force: true });
  }
}

function startRestoreServer(dir, port) {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "packages/server/dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, BOTS_ENABLED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderrText = "";
  child.stderr?.on("data", (chunk) => {
    child.stderrText = `${child.stderrText}${chunk.toString()}`.slice(-400);
  });
  child.stdout?.resume();
  return child;
}

async function waitHealth(origin, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      const detail = String(child.stderrText ?? "").trim().split("\n").at(-1);
      throw new Error(detail ? `The restore server exited before it was ready. ${detail}` : "The restore server exited before it was ready.");
    }
    try {
      const response = await fetch(new URL("/health", origin));
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error("The restore server did not become ready.");
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  const deadline = Date.now() + 5_000;
  while (child.exitCode == null && Date.now() < deadline) await sleep(50);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function parkBotTurn(origin, socketUrl) {
  const name = soakName("r");
  const cookie = await guest(name, origin);
  const seat = { playerId: null, token: null, view: null, onReady: null };
  const socket = await openSocket(socketUrl, cookie);
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "welcome") {
      seat.playerId = message.playerId;
      seat.token = message.token;
      if (seat.onReady) seat.onReady();
      return;
    }
    if (message.type === "error") {
      seat.failed = message.message;
      if (seat.onReady) seat.onReady();
      return;
    }
    if (message.type !== "state") return;
    seat.view = message.view;
    if (seat.onReady) seat.onReady();
  });
  const ready = waitSeat(seat);
  socket.send(
    JSON.stringify({ type: "solo", name, playerCount: 4, boneyardMode: "draw_until", seriesLength: 3, difficulty: "easy" }),
  );
  await ready;
  let acted = "";
  const deadline = Date.now() + 60_000;
  let parked = null;
  while (!parked && Date.now() < deadline) {
    const view = seat.view;
    if (view?.phase === "between" || view?.betweenHands) {
      const key = `between:${view.handNumber}`;
      if (acted !== key) {
        acted = key;
        socket.send(JSON.stringify({ type: "continue" }));
      }
    } else if (view && view.turnPlayerId === seat.playerId) {
      const key = turnKey(view);
      if (acted !== key) {
        acted = key;
        socket.send(JSON.stringify({ type: "intent", intent: probeIntent(view) }));
      }
    } else if (view && view.players.some((player) => player.id === view.turnPlayerId && player.bot)) {
      parked = { token: seat.token, key: turnKey(view), playerId: seat.playerId };
      break;
    }
    await sleep(40);
  }
  if (!parked) {
    try {
      socket.close();
    } catch {
      // already closed
    }
    throw new Error("The restore table never reached a computer's turn.");
  }
  // Leave the socket open until the process dies, so a leave timer cannot abandon the hand.
  parked.socket = socket;
  return parked;
}

async function expectRestoredBot(origin, socketUrl, parked) {
  const cookie = await guest(soakName("b"), origin);
  const seat = { playerId: null, view: null, onReady: null };
  const socket = await openSocket(socketUrl, cookie);
  let failure = null;
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "error") {
      seat.failed = message.message;
      failure = message.message;
      if (seat.onReady) seat.onReady();
      return;
    }
    if (message.type === "welcome") {
      seat.playerId = message.playerId;
      if (seat.onReady) seat.onReady();
      return;
    }
    if (message.type !== "state") return;
    seat.view = message.view;
    if (seat.onReady) seat.onReady();
  });
  const ready = waitSeat(seat);
  socket.send(JSON.stringify({ type: "reconnect", token: parked.token }));
  await ready;
  if (failure) throw new Error(failure);
  if (seat.playerId !== parked.playerId) throw new Error("Reconnect sat a different player after the restart.");
  if (turnKey(seat.view) !== parked.key) throw new Error("The restored table was not on the computer's turn.");
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (turnKey(seat.view) !== parked.key) {
      try {
        socket.close();
      } catch {
        // already closed
      }
      try {
        parked.socket?.close();
      } catch {
        // already closed
      }
      return;
    }
    await sleep(50);
  }
  throw new Error("Stalled on a restored computer turn.");
}

function humanSummary(data) {
  const lines = [
    `Soak ${data.url}`,
    `${data.matches.length} matches, ${data.hands} hands, ${data.knocks} knocks, ${data.locks} locks, ${data.dominoes} dominoes, ${data.gameWins} game wins`,
    `durations: ${data.durationsMs.map((ms) => `${(ms / 1000).toFixed(1)}s`).join(", ") || "none"}`,
    `reconnect: ${data.reconnect}`,
    `empty-boneyard knocks: ${data.emptyBoneyardKnocks ?? 0}`,
    `bot knock: ${data.botKnock ?? "not run"}`,
    `bot restore: ${data.botRestore ?? "not run"}`,
    `ui: ${data.ui?.summary ?? "not run"}`,
    `failures: ${data.failures.length}`,
  ];
  for (const failure of data.failures) {
    lines.push(`- ${failure.message}${failure.replay ? ` (${failure.replay})` : ""}`);
  }
  return lines.join("\n");
}

async function cleanup() {
  const response = await fetch(new URL("/api/soak/cleanup", pageUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  if (response.status >= 500) throw new Error(`Cleanup returned ${response.status}.`);
  if (!response.ok) throw new Error(`Cleanup returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function guest(name, origin = pageUrl) {
  const response = await fetch(new URL("/api/guest", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: name, soakRun: runId, age13: true }),
  });
  if (response.status >= 500) throw new Error(`Guest sign-in returned ${response.status}.`);
  if (!response.ok) throw new Error(`Guest sign-in returned ${response.status}: ${await response.text()}`);
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const lines = cookies.length > 0 ? cookies : [response.headers.get("set-cookie") ?? ""];
  for (const line of lines) {
    const match = /uhoh_session=([^;]+)/.exec(line);
    if (match) return `uhoh_session=${match[1]}`;
  }
  throw new Error("Guest sign-in did not set a session.");
}

function soakName(seat) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let tail = "";
  for (let i = 0; i < 6; i += 1) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `soak-${seat}${tail}`.slice(0, 16);
}

async function playMatch(mode, index, options) {
  const seats = [];
  for (let seat = 0; seat < mode.seats; seat += 1) {
    const name = soakName(seat);
    seats.push({
      name,
      cookie: await guest(name),
      playerId: null,
      token: null,
      view: null,
      socket: null,
      pausing: false,
      acted: new Set(),
      ...createSeatSync(),
    });
  }

  const log = {
    players: [],
    config: {
      boneyardMode: mode.boneyardMode,
      seriesLength: mode.seriesLength,
      targetScore: 150,
    },
    hands: [],
    failure: null,
  };
  const stats = { hands: 0, knocks: 0, locks: 0, dominoes: 0, gameWins: 0, room: "", reconnected: false };
  const seenDeals = new Set();
  const seenEnds = new Set();
  let prevScores = {};
  let prevGames = null;
  let prevPlaySeq = 0;
  let prevGame = 0;
  let checkedSig = "";
  let lastActivity = Date.now();
  let done = false;
  let failure = null;
  let continueKey = "";
  let actions = 0;
  let reconnectStarted = false;
  let hold = false;

  const fail = (message) => {
    if (failure) return;
    failure = message;
    log.failure = message;
    const file = path.join(outDir, `replay-${Date.now()}-m${index + 1}.json`);
    writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
    const error = new Error(message);
    error.replay = file;
    failureError = error;
  };
  let failureError = null;

  const onMessage = (seat, socket, raw) => {
    if (seat.socket !== socket) return;
    lastActivity = Date.now();
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      fail("The server sent a message that could not be read.");
      return;
    }
    if (message.type === "error") {
      fail(`Server error: ${message.message}`);
      return;
    }
    const kind = ingest(seat, message);
    if (kind === "welcome") {
      seat.playerId = message.playerId;
      seat.token = message.token;
      if (seat.onReady) seat.onReady();
      return;
    }
    if (kind === "foreign") {
      fail("The server sent another player's hand.");
      return;
    }
    if (kind !== "queued" && kind !== "duplicate" && kind !== "lobby") return;
    seat.stateGen = (seat.stateGen ?? 0) + 1;
    seat.view = seat.latest;
    if (message.audit?.handSeed) noteSeed(message.view, message.audit.handSeed);
    if (seat.onReady) seat.onReady();
    try {
      step();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };

  // Keep every public update until all seats have it. A later turn must not
  // erase a scoring play that the slower sockets have not checked yet.
  function step() {
    while (true) {
      const fronts = alignedFronts(seats);
      if (!fronts) break;
      review(fronts[0], fronts);
      shiftFronts(seats);
    }
    if (hold) return;
    if (seats.every((seat) => seat.queue.length === 0)) {
      for (const player of seats) act(player);
    }
  }

  function noteSeed(view, seed) {
    const hand = ensureHand(view);
    if (hand.seed && hand.seed !== seed) throw new Error("The hand seed changed mid-hand.");
    hand.seed = seed;
  }

  function ensureHand(view) {
    let hand = log.hands.find((item) => item.gameNumber === view.gameNumber && item.handNumber === view.handNumber);
    if (!hand) {
      hand = { gameNumber: view.gameNumber, handNumber: view.handNumber, seed: null, actions: [] };
      log.hands.push(hand);
    }
    return hand;
  }

  function review(view, fronts) {
    const signature = publicSignature(view);
    if (signature === checkedSig) return;
    checkedSig = signature;
    if (!stats.room) stats.room = view.roomCode;
    if (log.players.length === 0 && view.players.length === mode.seats) {
      log.players = view.players.map((player) => ({ id: player.id, name: player.name }));
    }
    if (view.phase === "lobby") return;
    if (view.settings.targetScore !== 150) throw new Error(`Target is ${view.settings.targetScore}, expected 150.`);
    if (view.winsNeeded !== winsNeeded(view.settings.seriesLength)) {
      throw new Error("winsNeeded does not match the series length.");
    }
    const dealKey = `${view.gameNumber}-${view.handNumber}`;
    if (!seenDeals.has(dealKey)) {
      seenDeals.add(dealKey);
      stats.hands += 1;
      ensureHand(view);
      console.log(`  hand ${stats.hands} (game ${view.gameNumber}, hand ${view.handNumber})`);
    }
    const handLog = log.hands.find((item) => item.gameNumber === view.gameNumber && item.handNumber === view.handNumber);
    if (handLog && !handLog.seed) throw new Error("The soak table did not send the hand seed.");

    if (view.gameNumber !== prevGame) {
      prevScores = {};
      prevPlaySeq = 0;
      prevGame = view.gameNumber;
    }
    checkBoard(view);
    checkTiles(view, fronts);
    checkTurn(view);
    const endKey = view.lastHand ? `${view.lastHand.gameNumber}-${view.lastHand.handNumber}` : null;
    const endedNow = Boolean(endKey && !seenEnds.has(endKey));
    if (endedNow) {
      seenEnds.add(endKey);
      checkHandResult(view.lastHand, view.settings.targetScore);
      if (view.lastHand.reason === "locked") stats.locks += 1;
      if (view.lastHand.reason === "domino") stats.dominoes += 1;
      if (view.lastHand.gameWinnerId) stats.gameWins += 1;
      for (const player of view.players) {
        if (player.score !== view.lastHand.scoresAfter[player.id]) {
          throw new Error("The scoreboard disagrees with scoresAfter.");
        }
      }
    }
    for (const player of view.players) {
      if (player.score % 5 !== 0) throw new Error(`Score ${player.score} is not a multiple of 5.`);
      const move = scoreMove(player, view, prevScores[player.id] ?? 0, prevPlaySeq, endedNow);
      if (move.delta !== move.expected) {
        throw new Error(`Score moved by ${move.delta}, expected ${move.expected}.`);
      }
      prevScores[player.id] = player.score;
    }
    if (view.lastPlay && view.lastPlay.seq > prevPlaySeq) prevPlaySeq = view.lastPlay.seq;
    checkGames(view);
    if (view.boneyardCount === 0 && view.lastEvent?.kind === "knock") report.emptyBoneyardKnocks = (report.emptyBoneyardKnocks ?? 0) + 1;
    checkSeries(view);
    if (view.status === "complete" || view.phase === "over") done = true;
  }

  function checkBoard(view) {
    if (view.board?.center) {
      const pictures = [
        layoutBoard(view.board),
        layoutBoard(view.board, { width: 220, height: 640 }),
        layoutBoard(view.board, { width: 344, height: 720 }),
      ];
      if (pictures.some((layout) => layoutOverlaps(layout))) {
        throw new Error("A tile covers another tile.");
      }
    }
    if (!view.board?.center) {
      if (view.openTotal !== 0) throw new Error("An empty board reported open points.");
      return;
    }
    const exposed = exposedTotal(view.board);
    if (view.openTotal !== exposed) {
      throw new Error(`openTotal ${view.openTotal} is not the exposed-end total ${exposed}.`);
    }
    if (view.lastPlay && view.lastPlay.awarded !== boardAward(view.lastPlay.total)) {
      throw new Error("The last play awarded points that are not the board award.");
    }
    if (view.lastEvent?.kind === "play" && view.openTotal !== view.lastPlay?.total) {
      throw new Error("The open total disagrees with the tile that was just played.");
    }
  }

  function checkTiles(view, fronts) {
    const ids = [];
    if (!handCountsMatch(fronts)) throw new Error("A hand count does not match the tiles dealt.");
    for (const seatView of fronts) ids.push(...seatView.you.hand.map((tile) => tile.id));
    if (view.board) ids.push(...tilesOnBoard(view.board));
    const unique = new Set(ids);
    if (unique.size !== ids.length) throw new Error("A tile appears more than once.");
    if (ids.length + view.boneyardCount !== 28) {
      throw new Error(`Tile count is ${ids.length} plus ${view.boneyardCount} in the boneyard, not 28.`);
    }
    const universe = new Set(allTileIds());
    for (const id of ids) {
      if (!universe.has(id)) throw new Error(`Unknown tile ${id}.`);
    }
  }

  function checkTurn(view) {
    if (view.phase === "between" || view.phase === "over" || view.phase === "lobby") return;
    const event = view.lastEvent;
    if (!event) return;
    if (event.kind === "timeout") throw new Error("A seat missed the turn clock.");
    if (event.kind === "play" || event.kind === "knock") {
      if (view.turnPlayerId !== nextSeat(view, event.playerId)) throw new Error("The turn skipped a seat.");
    }
    if (event.kind === "draw") {
      const stayed = view.turnPlayerId === event.playerId;
      const passed = view.turnPlayerId === nextSeat(view, event.playerId);
      if (stayed && view.phase !== "play") throw new Error("A draw kept the turn without a playable tile.");
      if (!stayed && !passed) throw new Error("The turn after a draw is wrong.");
    }
  }

  function checkGames(view) {
    const total = view.players.reduce((sum, player) => sum + player.gamesWon, 0);
    const closedThisGame = Boolean(view.lastHand?.gameWinnerId && view.lastHand.gameNumber === view.gameNumber);
    const expected = closedThisGame ? view.gameNumber : Math.max(0, view.gameNumber - 1);
    if (total !== expected) throw new Error(`Games won add up to ${total}, expected ${expected}.`);
    if (!prevGames) {
      prevGames = Object.fromEntries(view.players.map((player) => [player.id, player.gamesWon]));
      return;
    }
    for (const player of view.players) {
      const before = prevGames[player.id] ?? 0;
      if (player.gamesWon < before || player.gamesWon > before + 1) {
        throw new Error(`${player.name} games went from ${before} to ${player.gamesWon}.`);
      }
      if (player.gamesWon === before + 1 && view.lastHand?.gameWinnerId !== player.id) {
        throw new Error(`${player.name} gained a game without winning it.`);
      }
      if (player.gamesWon > view.winsNeeded) throw new Error(`${player.name} has more games than the series needs.`);
      prevGames[player.id] = player.gamesWon;
    }
  }

  function checkSeries(view) {
    const need = winsNeeded(view.settings.seriesLength);
    const leaders = view.players.filter((player) => player.gamesWon >= need);
    if (view.status === "complete" || view.phase === "over") {
      if (leaders.length !== 1) throw new Error("The series ended without a single winner.");
      if (view.seriesWinnerId !== leaders[0].id) throw new Error("seriesWinnerId is not the player who won enough games.");
      return;
    }
    if (leaders.length > 0) throw new Error("A player reached the series win and the match kept going.");
  }

  function checkHandResult(hand, target) {
    if (hand.reason === "domino") {
      if (hand.winnerIds.length !== 1) throw new Error("A domino had more than one winner.");
      const awards = scoreDomino(hand.pipCounts, hand.winnerIds[0]);
      if (!sameMap(awards, hand.leftoverAwards)) throw new Error("The domino award does not match the remaining pips.");
      if (hand.nextLeaderId !== hand.winnerIds[0]) throw new Error("The domino winner does not lead the next hand.");
    } else if (hand.reason === "locked") {
      const hands = {};
      for (const remaining of hand.remaining) hands[remaining.playerId] = remaining.tiles.map((tile) => tile.id);
      const locked = scoreLocked(hands);
      if (!sameIds(locked.winnerIds, hand.winnerIds)) throw new Error("The lock winner is not the low hand.");
      if (locked.nextLeaderId !== hand.nextLeaderId) throw new Error("The next leader after a lock is wrong.");
      if (!sameMap(locked.awards, hand.leftoverAwards)) throw new Error("The lock award does not match the rules.");
      if (!sameMap(locked.pipCounts, hand.pipCounts)) throw new Error("The lock pip counts do not match the remaining tiles.");
    } else if (hand.reason === "score") {
      for (const award of Object.values(hand.leftoverAwards)) {
        if (award !== 0) throw new Error("A target-score hand also paid leftover pips.");
      }
      if (!hand.gameWinnerId) throw new Error("The target was crossed and no game winner was named.");
    } else {
      throw new Error(`Unknown hand result ${hand.reason}.`);
    }
    for (const score of Object.values(hand.scoresAfter)) {
      if (score % 5 !== 0) throw new Error("A score after the hand is not a multiple of 5.");
    }
    if (gameWinnerId(hand.scoresAfter, target) !== hand.gameWinnerId) {
      throw new Error("gameWinnerId does not match the target rule.");
    }
  }

  function act(seat) {
    const view = seat.view;
    if (hold || !view || seat.pausing || failure) return;
    if (view.phase === "between") {
      if (seat !== seats[0]) return;
      const key = view.lastHand ? `${view.lastHand.gameNumber}-${view.lastHand.handNumber}` : "";
      if (!key || key === continueKey) return;
      continueKey = key;
      seat.socket.send(JSON.stringify({ type: "continue" }));
      return;
    }
    if (view.turnPlayerId !== seat.playerId) return;
    if (view.phase !== "play" && view.phase !== "draw" && view.phase !== "knock") return;
    const key = [
      view.gameNumber,
      view.handNumber,
      view.phase,
      view.you.hand.length,
      view.boneyardCount,
      view.lastPlay?.seq ?? 0,
      view.lastEvent?.kind ?? "",
      view.lastEvent?.playerId ?? "",
    ].join(":");
    if (seat.acted.has(key)) return;
    const intent = chooseIntent(view);
    seat.acted.add(key);
    ensureHand(view).actions.push({ playerId: seat.playerId, intent });
    actions += 1;
    if (intent.type === "knock") stats.knocks += 1;
    seat.socket.send(JSON.stringify({ type: "intent", intent }));
  }

  function chooseIntent(view) {
    if (view.phase === "play") {
      const play = view.legalPlays[0];
      if (!play || view.legalPlays.some((item) => !item.tileId || !item.endId)) {
        throw new Error("The turn to play had no legal tile.");
      }
      return { type: "play", tileId: play.tileId, endId: play.endId };
    }
    if (view.phase === "draw") {
      if (view.legalPlays.length > 0 || !view.canDraw) throw new Error("A draw was offered while a tile could be played.");
      return { type: "draw" };
    }
    if (view.legalPlays.length > 0 || view.canDraw || !view.canKnock) {
      throw new Error("A knock was offered while a tile could be played.");
    }
    return { type: "knock" };
  }

  const wire = (seat, socket) => {
    socket.on("message", (raw) => onMessage(seat, socket, raw));
    socket.on("close", () => {
      if (seat.socket !== socket || seat.pausing || done || failure) return;
      fail("The socket closed before the match finished.");
    });
  };

  try {
    seats[0].socket = await openSocket(wsUrl, seats[0].cookie);
    wire(seats[0], seats[0].socket);
    seats[0].socket.send(
      JSON.stringify({
        type: "create",
        name: seats[0].name,
        playerCount: mode.seats,
        boneyardMode: mode.boneyardMode,
        seriesLength: mode.seriesLength,
        casual: true,
      }),
    );
    await waitReady(seats[0], 1);
    const code = seats[0].view?.roomCode;
    if (!code) throw new Error("The table did not send a room code.");
    stats.room = code;
    for (let seat = 1; seat < seats.length; seat += 1) {
      const player = seats[seat];
      player.socket = await openSocket(wsUrl, player.cookie);
      wire(player, player.socket);
      player.socket.send(JSON.stringify({ type: "join", code, name: player.name }));
      await waitReady(player, 1);
    }
    seats[0].socket.send(JSON.stringify({ type: "start" }));

    const deadline = Date.now() + 60 * 60 * 1000;
    while (!done && !failure) {
      if (Date.now() > deadline) fail("The match ran longer than 60 minutes.");
      if (Date.now() - lastActivity > args.stallMs) {
        const frozen = seats.map((seat) => seat.view).find(Boolean);
        if (frozen?.boneyardCount === 0 && frozen.lastEvent?.kind === "knock") {
          fail("Stalled after a knock with an empty boneyard.");
        }
        fail(`No state change for more than ${Math.round(args.stallMs / 1000)}s.`);
      }
      if (
        options.reconnect &&
        !reconnectStarted &&
        actions >= 6 &&
        seats.every((seat) => seat.queue.length === 0 && seat.view) &&
        seats[1].view.turnPlayerId !== seats[1].playerId &&
        (seats[1].view.phase === "play" || seats[1].view.phase === "draw" || seats[1].view.phase === "knock")
      ) {
        reconnectStarted = true;
        hold = true;
        try {
          await reconnect(seats[1]);
          stats.reconnected = true;
        } finally {
          hold = false;
        }
        step();
      }
      await sleep(40);
    }
  } catch (error) {
    if (!failure) fail(error instanceof Error ? error.message : String(error));
  } finally {
    for (const seat of seats) {
      seat.pausing = true;
      try {
        seat.socket?.close();
      } catch {
        // already closed
      }
    }
  }
  if (failureError) throw failureError;
  return stats;

  async function reconnect(seat) {
    const expected = seat.playerId;
    const token = seat.token;
    const welcomeAt = seat.welcomeGen + 1;
    seat.pausing = true;
    const previous = seat.socket;
    seat.socket = null;
    previous?.close();
    await sleep(80);
    const next = await openSocket(wsUrl, seat.cookie);
    seat.socket = next;
    wire(seat, next);
    const ready = waitReady(seat, welcomeAt);
    seat.pausing = false;
    next.send(JSON.stringify({ type: "reconnect", token }));
    await ready;
    if (seat.playerId !== expected) throw new Error("Reconnect sat a different player.");
  }

  function waitReady(seat, welcomeAt) {
    const seenStates = seat.stateGen ?? 0;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The table did not send a welcome.")), 15_000);
      const finish = () => {
        if (seat.welcomeGen !== welcomeAt) return;
        if ((seat.stateGen ?? 0) <= seenStates) return;
        if (!seat.playerId || !seat.view) return;
        clearTimeout(timer);
        seat.onReady = null;
        resolve(seat);
      };
      seat.onReady = finish;
      finish();
    });
  }
}

function nextSeat(view, playerId) {
  const ids = view.players.map((player) => player.id);
  const index = ids.indexOf(playerId);
  if (index < 0) throw new Error("The turn names a player who is not at the table.");
  return ids[(index + 1) % ids.length];
}

function sameMap(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  return true;
}

function sameIds(left, right) {
  return [...left].sort().join() === [...right].sort().join();
}

function replayFile(file) {
  const log = JSON.parse(readFileSync(file, "utf8"));
  let match = createMatch(log.players, log.config);
  for (const hand of log.hands) {
    if (!hand.seed) {
      console.error("Replay log is missing a hand seed.");
      return 1;
    }
    match = beginHand(match, shuffleWithSeed(Buffer.from(hand.seed, "hex")));
    for (const action of hand.actions) {
      const result = applyIntent(match, action.playerId, action.intent);
      if (!result.ok) {
        console.error(`Replay stopped: ${result.error ?? "illegal move"}`);
        return 1;
      }
      match = result.match;
    }
  }
  console.log(`Replayed ${log.hands.length} hands. Phase ${match.phase}.`);
  return 0;
}

async function takeUiTurn(page) {
  const skip = page.locator("[data-action=skip-feel], [data-action=skip-win]");
  if (await skip.count()) await skip.first().click().catch(() => undefined);
  const playable = page.locator(".hand-tile[data-playable=true]");
  if (await playable.count()) {
    await playable.first().click();
    const end = page.locator("[data-end-id][data-hot=true]");
    if (await end.count()) await end.first().click();
    return;
  }
  if (await page.locator("[data-action=draw]").count()) {
    await page.locator("[data-action=draw]").first().click();
    return;
  }
  if (await page.locator("[data-action=knock]").count()) {
    await page.locator("[data-action=knock]").first().click();
    return;
  }
  if (await page.locator("[data-action=continue]").count()) await page.locator("[data-action=continue]").first().click();
}

async function uiSmoke(origin, outDir = "soak-reports") {
  let chromium;
  try {
    const imported = await import("playwright-core");
    chromium = imported.chromium ?? imported.default?.chromium;
  } catch {
    chromium = null;
  }
  if (!chromium) throw new Error("Playwright is not installed. npm install --no-save playwright-core, or pass --no-ui.");
  const chrome = [process.env.CHROME_PATH, "/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(
    (candidate) => candidate && existsSync(candidate),
  );
  if (!chrome) throw new Error("Chrome was not found. Set CHROME_PATH, or pass --no-ui.");
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const splash = page.locator("[data-screen=splash]");
    if (await splash.count()) await splash.click();
    await page.locator(".arcade-name input").fill("soak-ui");
    const age = page.locator("[data-action=age-13]");
    // Ticking the box removes it. check() waits for it to stay checked.
    if (await age.count()) await age.click();
    await page.locator("[data-action=solo]").click();
    await page.locator("[data-screen=mode] button", { hasText: /^4$/ }).click();
    await page.locator("[data-action=start-solo]").click();
    // The human holds the opening tile about a third of the time. The felt stays empty until that tile is played.
    const ready = page.locator(
      ".table-scroll [data-board-tile], .hand-tile[data-playable=true], [data-action=draw], [data-action=knock]",
    );
    await ready.first().waitFor({ timeout: 25_000 });
    if ((await page.locator(".table-scroll [data-board-tile]").count()) === 0) await takeUiTurn(page);
    await page.waitForSelector(".table-scroll [data-board-tile]", { timeout: 25_000 });
    const pop = await probeWinnerPop(page);
    if (!pop.ok) {
      const saved = await saveUiFailure(page, outDir, pop);
      throw new Error(`${pop.reason} Screenshot: ${saved.shot} Details: ${saved.dump}`);
    }
    const tally = await page.evaluate(auditGameTally);
    if (!tally.ok) {
      const saved = await saveUiFailure(page, outDir, tally);
      throw new Error(`${tally.reason} Screenshot: ${saved.shot} Details: ${saved.dump}`);
    }
    for (let step = 0; step < 10; step += 1) {
      await takeUiTurn(page);
      await page.waitForTimeout(350);
    }
    // The new chain is on screen immediately, and the camera eases onto it for
    // 360ms. A landing hop can also carry the last tile onto a badge. Both are
    // gone once the picture settles, which is the frame this check is about.
    await settleCamera(page);
    const audit = await page.evaluate(auditTable);
    if (!audit.ok) {
      const saved = await saveUiFailure(page, outDir, audit);
      throw new Error(`${audit.reason} Screenshot: ${saved.shot} Details: ${saved.dump}`);
    }
    const noisy = errors.filter((line) => !/favicon|Failed to load resource/i.test(line));
    if (noisy.length > 0) throw new Error(`Console errors: ${noisy.slice(0, 3).join(" | ")}`);
    return { ok: true, skipped: false, summary: `${pop.summary}; ${tally.summary}; ${audit.summary}` };
  } finally {
    await browser.close();
  }
}

async function settleCamera(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const moving = () => {
      const nodes = document.querySelectorAll(".board-scaler, .board-stage, .board-tile, .table-scroll");
      for (const node of nodes) {
        for (const anim of node.getAnimations()) {
          const iterations = anim.effect?.getComputedTiming?.().iterations ?? 1;
          if (anim.playState === "running" && iterations !== Infinity) return true;
        }
      }
      return false;
    };
    const started = performance.now();
    while (performance.now() - started < 2500) {
      if (!moving()) {
        await sleep(60);
        if (!moving()) return;
      }
      await sleep(40);
    }
  });
}

async function saveUiFailure(page, outDir, audit) {
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const shot = path.join(outDir, `ui-overlap-${stamp}.png`);
  const dump = path.join(outDir, `ui-overlap-${stamp}.json`);
  await page.screenshot({ path: shot });
  writeFileSync(dump, JSON.stringify(audit, null, 2));
  return { shot, dump };
}

async function probeWinnerPop(page) {
  const control = ".hand-tile[data-playable=true], [data-action=draw], [data-action=knock], [data-action=continue]";
  const before = await page.locator(control).count();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("uhoh-winner-pop", { detail: { kind: "game" } }));
  });
  const pop = page.locator("[data-winner-pop]");
  try {
    await pop.waitFor({ state: "attached", timeout: 2_000 });
  } catch {
    return { ok: false, reason: "The winner pop did not appear." };
  }
  // Game pop reaches its hold at 360ms and stays there until 1400ms.
  await page.waitForTimeout(480);
  const audit = await page.evaluate(auditWinnerPop);
  if (!audit.ok) return audit;
  try {
    await pop.waitFor({ state: "detached", timeout: 2_400 });
  } catch {
    return { ok: false, reason: "The winner pop stayed on screen and would block the next hand.", ...audit };
  }
  const after = await page.locator(control).count();
  if (before > 0 && after === 0) return { ok: false, reason: "The winner pop removed the turn control.", ...audit };
  return audit;
}

function auditGameTally() {
  const target = document.querySelector("[data-series-target]");
  const needed = Number(target?.getAttribute("data-series-target"));
  if (!needed) return { ok: false, reason: "The series target is not on screen." };
  const label = target.textContent ?? "";
  if (!label.includes(`to ${needed}`)) return { ok: false, reason: "The series target text does not match the count." };
  const chips = [...document.querySelectorAll(".seat-chip[data-player-id]")];
  if (chips.length < 2) return { ok: false, reason: "The game tally is missing a seat." };
  const counts = [];
  for (const chip of chips) {
    const mark = chip.querySelector("[data-games-won]");
    if (!mark) return { ok: false, reason: "A seat has no games tally." };
    const won = Number(mark.getAttribute("data-games-won"));
    const need = Number(mark.getAttribute("data-games-needed"));
    const text = (mark.textContent ?? "").replace(/\s+/g, "");
    if (need !== needed) return { ok: false, reason: "A seat's series target disagrees with the table." };
    if (text !== `${won}/${need}`) return { ok: false, reason: "The games label does not match the game-win count." };
    counts.push(won);
  }
  return { ok: true, summary: `games ${counts.join("-")} first to ${needed} on ${chips.length} seats` };
}

function auditWinnerPop() {
  const pop = document.querySelector("[data-winner-pop]");
  if (!pop) return { ok: false, reason: "The winner pop left before the hold could be measured." };
  const style = getComputedStyle(pop);
  if (style.pointerEvents !== "none") return { ok: false, reason: "The winner pop blocks taps." };
  const round = (value) => Math.round(value * 10) / 10;
  const plain = (box) => ({
    left: round(box.left),
    top: round(box.top),
    right: round(box.right),
    bottom: round(box.bottom),
    width: round(box.width),
    height: round(box.height),
  });
  const union = (a, b) => ({
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  });
  let box = pop.getBoundingClientRect();
  for (const extra of pop.querySelectorAll(".avatar-pose, .avatar-frame")) {
    const part = extra.getBoundingClientRect();
    if (part.width > 2 && part.height > 2) box = union(box, part);
  }
  box = { ...box, width: box.right - box.left, height: box.bottom - box.top };
  const overlaps = (a, b) => a.left < b.right - 0.6 && a.right > b.left + 0.6 && a.top < b.bottom - 0.6 && a.bottom > b.top + 0.6;
  const hits = [];
  for (const node of document.querySelectorAll(
    "[data-board-tile], .hand-tile, .edge-badge, .seat-chip, .edge-slivers, .hand-tray, .playbar",
  )) {
    if (node.closest(".winner-pop")) continue;
    const other = node.getBoundingClientRect();
    if (other.width < 2 || other.height < 2) continue;
    if (!overlaps(box, other)) continue;
    const tile = node.getAttribute("data-board-tile");
    const classes = typeof node.className === "string" ? node.className : "";
    hits.push(tile ? `tile ${tile}` : classes || node.tagName);
  }
  if (hits.length > 0) {
    return {
      ok: false,
      reason: "The winner pop covers a tile, the rack, or a badge.",
      hits: hits.slice(0, 8),
      pop: plain(box),
    };
  }
  const tile = document.querySelector(".table-scroll [data-board-tile]");
  if (tile) {
    const tileBox = tile.getBoundingClientRect();
    const hit = document.elementFromPoint(tileBox.left + tileBox.width / 2, tileBox.top + tileBox.height / 2);
    if (hit && pop.contains(hit)) return { ok: false, reason: "The winner pop blocks a board tile.", pop: plain(box) };
  }
  return {
    ok: true,
    summary: `winner pop ${Math.round(box.width)}x${Math.round(box.height)} clear of tiles`,
  };
}

function auditTable() {
  const felt = document.querySelector(".table-scroll");
  if (!felt) return { ok: false, reason: "The table is not on screen." };
  const round = (value) => Math.round(value * 10) / 10;
  const plain = (box) => ({
    left: round(box.left),
    top: round(box.top),
    right: round(box.right),
    bottom: round(box.bottom),
    width: round(box.width),
    height: round(box.height),
  });
  const camera = {};
  for (const name of felt.getAttributeNames()) {
    if (name.startsWith("data-")) camera[name] = felt.getAttribute(name);
  }
  const scaler = felt.querySelector(".board-scaler");
  const stage = felt.querySelector(".board-stage");
  const motion = {
    camera: felt.getAttribute("data-camera"),
    running: [...felt.querySelectorAll(".board-scaler, .board-stage, .board-tile")].some((node) =>
      node.getAnimations().some((anim) => {
        const iterations = anim.effect?.getComputedTiming?.().iterations ?? 1;
        return anim.playState === "running" && iterations !== Infinity;
      }),
    ),
    scaler: scaler ? getComputedStyle(scaler).transform : null,
    stage: stage ? getComputedStyle(stage).transform : null,
  };
  const safe = felt.getBoundingClientRect();
  const tiles = [...felt.querySelectorAll("[data-board-tile]")];
  const evidence = { felt: plain(safe), camera, motion, tiles: tiles.length };
  if (tiles.length === 0) return { ok: false, reason: "No board tiles to measure.", ...evidence };
  const zones = [...document.querySelectorAll(".edge-badge, .edge-slivers, .playbar, .hand-tray, .seat-pips")].map((node) => {
    const edge = node.closest("[data-edge]")?.getAttribute("data-edge") ?? "";
    const classes = typeof node.className === "string" ? node.className : "";
    return { selector: [edge && `edge-${edge}`, classes].filter(Boolean).join(" "), box: node.getBoundingClientRect() };
  });
  const overlaps = (a, b) => a.left < b.right - 0.6 && a.right > b.left + 0.6 && a.top < b.bottom - 0.6 && a.bottom > b.top + 0.6;
  for (const tile of tiles) {
    const box = tile.getBoundingClientRect();
    const tileId = tile.getAttribute("data-board-tile");
    const inside =
      box.left >= safe.left - 0.6 && box.top >= safe.top - 0.6 && box.right <= safe.right + 0.6 && box.bottom <= safe.bottom + 0.6;
    if (!inside) {
      return { ok: false, reason: "A tile sits outside the felt.", tile: { id: tileId, rect: plain(box) }, ...evidence };
    }
    const hit = zones.find((zone) => overlaps(box, zone.box));
    if (hit) {
      return {
        ok: false,
        reason: "A tile sits under a seat badge or the rack.",
        tile: { id: tileId, rect: plain(box) },
        zone: { selector: hit.selector, rect: plain(hit.box) },
        zones: zones.map((zone) => ({ selector: zone.selector, rect: plain(zone.box) })),
        ...evidence,
      };
    }
  }
  const rail = document.querySelector(".edge-top");
  const badge = rail?.querySelector(".edge-badge");
  if (!badge) return { ok: false, reason: "The top seat is missing, so the talk line was not checked.", ...evidence };
  const bubble = document.createElement("p");
  bubble.className = "talk-line";
  bubble.textContent = "Boneyard called. They want their luck back.";
  badge.appendChild(bubble);
  const bubbleBox = bubble.getBoundingClientRect();
  const badgeBox = badge.getBoundingClientRect();
  const onTile = tiles.some((tile) => overlaps(bubbleBox, tile.getBoundingClientRect()));
  const inBadge =
    bubbleBox.left >= badgeBox.left - 1 &&
    bubbleBox.right <= badgeBox.right + 1 &&
    bubbleBox.top >= badgeBox.top - 1 &&
    bubbleBox.bottom <= badgeBox.bottom + 1;
  bubble.remove();
  if (!inBadge || onTile) {
    return {
      ok: false,
      reason: "The talk line covers a board tile.",
      bubble: plain(bubbleBox),
      badge: plain(badgeBox),
      ...evidence,
    };
  }
  const token = document.querySelector("[data-control='token']");
  const turnChip = document.querySelector(".seat-chip.turn");
  if (turnChip && !token) {
    return { ok: false, reason: "The control marker is missing.", ...evidence };
  }
  if (token) {
    const tokenBox = token.getBoundingClientRect();
    const covered = tiles.find((tile) => overlaps(tokenBox, tile.getBoundingClientRect()));
    const talkHit = [...document.querySelectorAll(".talk-line")].find((line) => overlaps(tokenBox, line.getBoundingClientRect()));
    if (covered || talkHit) {
      return {
        ok: false,
        reason: "The control marker covers a tile.",
        token: plain(tokenBox),
        tile: covered ? covered.getAttribute("data-board-tile") : null,
        ...evidence,
      };
    }
  }
  return { ok: true, summary: `${tiles.length} tiles inside the safe rect, talk clear of the chain` };
}

function openSocket(url, cookie) {
  const headers = { Cookie: cookie };
  // Node 22 has a global WebSocket that accepts a cookie header. Node 20 does not, so it uses `ws`.
  // SOAK_WS=ws forces that package on either runtime.
  const usePackage = process.env.SOAK_WS === "ws" || typeof WebSocket !== "function";
  if (usePackage) {
    return import("ws").then(
      ({ default: WS }) =>
        new Promise((resolve, reject) => {
          const sock = new WS(url, { headers });
          const fail = () => reject(new Error("The socket failed."));
          sock.once("open", () => resolve(adaptWs(sock)));
          sock.once("error", fail);
        }),
    );
  }
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url, { headers });
    sock.addEventListener("open", () => resolve(adaptGlobal(sock)), { once: true });
    sock.addEventListener("error", () => reject(new Error("The socket failed.")), { once: true });
  });
}

function adaptGlobal(sock) {
  return {
    send(text) {
      sock.send(text);
    },
    close() {
      sock.close();
    },
    on(type, fn) {
      if (type === "message") {
        sock.addEventListener("message", (event) => fn(typeof event.data === "string" ? event.data : String(event.data)));
      } else if (type === "close") sock.addEventListener("close", () => fn());
    },
  };
}

function adaptWs(sock) {
  return {
    send(text) {
      sock.send(text);
    },
    close() {
      sock.close();
    },
    on(type, fn) {
      sock.on(type, (data) => fn(type === "message" ? data.toString() : undefined));
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = { url: "", matches: 8, seats: 4, noUi: false, stallMs: 20_000, out: "soak-reports", replay: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--no-ui") parsed.noUi = true;
    else if (token === "--url") parsed.url = next ?? "";
    else if (token === "--matches") parsed.matches = Number(next);
    else if (token === "--seats") parsed.seats = Number(next);
    else if (token === "--stall-ms") parsed.stallMs = Number(next);
    else if (token === "--out") parsed.out = next ?? parsed.out;
    else if (token === "--replay") parsed.replay = next ?? "";
    else continue;
    if (token !== "--no-ui") i += 1;
  }
  if (!Number.isFinite(parsed.matches) || parsed.matches < 1) parsed.matches = 8;
  if (!Number.isFinite(parsed.seats)) parsed.seats = 4;
  if (!Number.isFinite(parsed.stallMs) || parsed.stallMs < 1000) parsed.stallMs = 20_000;
  return parsed;
}

