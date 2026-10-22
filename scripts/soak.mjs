/**
 * Post-deploy soak. Plays full matches as headless guests against a live server.
 *
 *   npm run soak -- --url https://uhoh-dominoes.onrender.com --matches 8 --seats 4
 *
 * Node 22 has a global WebSocket that can send the session cookie. Node 18 uses the `ws` package.
 * `npm run build:rules` first so the replay checker can import @uhoh/rules.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  openScore,
  scoreDomino,
  scoreLocked,
  shuffleWithSeed,
  tilesOnBoard,
  winsNeeded,
} = rules;

if (args.replay) {
  const code = replayFile(args.replay);
  process.exit(code);
}

if (!args.url) {
  console.error("Pass --url https://host . Example: npm run soak -- --url https://uhoh-dominoes.onrender.com --matches 8 --seats 4");
  process.exit(1);
}

const pageUrl = new URL(args.url);
const wsUrl = `${pageUrl.protocol === "https:" ? "wss:" : "ws:"}//${pageUrl.host}/ws`;
const outDir = args.out;
mkdirSync(outDir, { recursive: true });

const report = {
  url: pageUrl.origin,
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
  failures: [],
  ui: null,
};

let exitCode = 0;
try {
  const cleaned = await cleanup();
  console.log(`Cleanup before the run: ${JSON.stringify(cleaned)}`);
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
    report.ui = await uiSmoke(pageUrl.origin);
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

function humanSummary(data) {
  const lines = [
    `Soak ${data.url}`,
    `${data.matches.length} matches, ${data.hands} hands, ${data.knocks} knocks, ${data.locks} locks, ${data.dominoes} dominoes, ${data.gameWins} game wins`,
    `durations: ${data.durationsMs.map((ms) => `${(ms / 1000).toFixed(1)}s`).join(", ") || "none"}`,
    `reconnect: ${data.reconnect}`,
    `ui: ${data.ui?.summary ?? "not run"}`,
    `failures: ${data.failures.length}`,
  ];
  for (const failure of data.failures) {
    lines.push(`- ${failure.message}${failure.replay ? ` (${failure.replay})` : ""}`);
  }
  return lines.join("\n");
}

async function cleanup() {
  const response = await fetch(new URL("/api/soak/cleanup", pageUrl), { method: "POST" });
  if (response.status >= 500) throw new Error(`Cleanup returned ${response.status}.`);
  if (!response.ok) throw new Error(`Cleanup returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function guest(name) {
  const response = await fetch(new URL("/api/guest", pageUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: name }),
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

  const onMessage = (seat, raw) => {
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
    if (message.type === "welcome") {
      seat.playerId = message.playerId;
      seat.token = message.token;
      if (seat.onReady) seat.onReady();
      return;
    }
    if (message.type !== "state") return;
    seat.view = message.view;
    if (message.audit?.handSeed) noteSeed(message.view, message.audit.handSeed);
    if (seat.onReady) seat.onReady();
    try {
      step();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };

  // The next intent waits until every seat has this public update. Acting on the
  // first socket to hear it lets a fast continue skip a scoring state on the rest.
  function step() {
    const agreed = agreedView();
    if (!agreed) return;
    review(agreed);
    for (const player of seats) act(player);
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

  function agreedView() {
    if (seats.some((seat) => !seat.view)) return null;
    const signature = publicSignature(seats[0].view);
    if (seats.some((seat) => publicSignature(seat.view) !== signature)) return null;
    return seats[0].view;
  }

  function review(view) {
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
    checkTiles(view);
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
      const before = prevScores[player.id] ?? 0;
      let expected = 0;
      if (endedNow) expected += view.lastHand.leftoverAwards[player.id] ?? 0;
      if (view.lastPlay && view.lastPlay.seq > prevPlaySeq && view.lastPlay.playerId === player.id) {
        expected += view.lastPlay.awarded;
      }
      if (player.score - before !== expected) {
        throw new Error(`Score moved by ${player.score - before}, expected ${expected}.`);
      }
      prevScores[player.id] = player.score;
    }
    if (view.lastPlay && view.lastPlay.seq > prevPlaySeq) prevPlaySeq = view.lastPlay.seq;
    checkSeries(view);
    if (view.status === "complete" || view.phase === "over") done = true;
  }

  function checkBoard(view) {
    if (!view.board?.center) {
      if (view.openTotal !== 0) throw new Error("An empty board reported open points.");
      return;
    }
    const scored = openScore(view.board);
    if (view.openTotal !== scored.total) throw new Error(`openTotal ${view.openTotal} is not the open-end sum ${scored.total}.`);
    if (view.lastPlay && view.lastPlay.awarded !== boardAward(view.lastPlay.total)) {
      throw new Error("The last play awarded points that are not the board award.");
    }
    if (view.lastEvent?.kind === "play" && view.openTotal !== view.lastPlay?.total) {
      throw new Error("The open total disagrees with the tile that was just played.");
    }
  }

  function checkTiles(view) {
    const ids = [];
    for (const seat of seats) {
      const mine = seat.view.you.hand.map((tile) => tile.id);
      const reported = seat.view.players.find((player) => player.id === seat.playerId);
      if (!reported || reported.tileCount !== mine.length) throw new Error("A hand count does not match the tiles dealt.");
      ids.push(...mine);
    }
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
    socket.on("message", (raw) => onMessage(seat, raw));
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
    await waitReady(seats[0]);
    const code = seats[0].view?.roomCode;
    if (!code) throw new Error("The table did not send a room code.");
    stats.room = code;
    for (let seat = 1; seat < seats.length; seat += 1) {
      const player = seats[seat];
      player.socket = await openSocket(wsUrl, player.cookie);
      wire(player, player.socket);
      player.socket.send(JSON.stringify({ type: "join", code, name: player.name }));
      await waitReady(player);
    }
    seats[0].socket.send(JSON.stringify({ type: "start" }));

    const deadline = Date.now() + 60 * 60 * 1000;
    while (!done && !failure) {
      if (Date.now() > deadline) fail("The match ran longer than 60 minutes.");
      if (Date.now() - lastActivity > args.stallMs) fail(`No state change for more than ${Math.round(args.stallMs / 1000)}s.`);
      if (
        options.reconnect &&
        !reconnectStarted &&
        actions >= 6 &&
        seats[1]?.view &&
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
    seat.pausing = true;
    seat.view = null;
    seat.playerId = null;
    const previous = seat.socket;
    previous?.close();
    await sleep(80);
    const next = await openSocket(wsUrl, seat.cookie);
    wire(seat, next);
    seat.socket = next;
    const ready = waitReady(seat);
    seat.pausing = false;
    next.send(JSON.stringify({ type: "reconnect", token }));
    await ready;
    if (seat.playerId !== expected) throw new Error("Reconnect sat a different player.");
  }

  function waitReady(seat) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The table did not send a welcome.")), 15_000);
      const finish = () => {
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

function publicSignature(view) {
  // Phase is private. The seat who must draw or knock sees "draw" or "knock"
  // while everyone else still sees "play" for that same update.
  return JSON.stringify({
    status: view.status,
    game: view.gameNumber,
    hand: view.handNumber,
    turn: view.turnPlayerId,
    yard: view.boneyardCount,
    play: view.lastPlay?.seq ?? 0,
    event: view.lastEvent,
    scores: view.players.map((player) => [player.id, player.score, player.gamesWon, player.tileCount]),
    end: view.lastHand ? `${view.lastHand.gameNumber}-${view.lastHand.handNumber}` : null,
    open: view.openTotal,
  });
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

async function uiSmoke(origin) {
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
    await page.locator("[data-action=solo]").click();
    await page.locator("[data-screen=mode] button", { hasText: /^4$/ }).click();
    await page.locator("[data-action=start-solo]").click();
    await page.waitForSelector(".table-scroll [data-board-tile]", { timeout: 25_000 });
    for (let step = 0; step < 10; step += 1) {
      const skip = page.locator("[data-action=skip-feel], [data-action=skip-win]");
      if (await skip.count()) await skip.first().click().catch(() => undefined);
      const playable = page.locator(".hand-tile[data-playable=true]");
      if (await playable.count()) {
        await playable.first().click();
        const end = page.locator("[data-end-id][data-hot=true]");
        if (await end.count()) await end.first().click();
      } else if (await page.locator("[data-action=draw]").count()) {
        await page.locator("[data-action=draw]").first().click();
      } else if (await page.locator("[data-action=knock]").count()) {
        await page.locator("[data-action=knock]").first().click();
      } else if (await page.locator("[data-action=continue]").count()) {
        await page.locator("[data-action=continue]").first().click();
      }
      await page.waitForTimeout(350);
    }
    const audit = await page.evaluate(auditTable);
    if (!audit.ok) throw new Error(audit.reason);
    const noisy = errors.filter((line) => !/favicon|Failed to load resource/i.test(line));
    if (noisy.length > 0) throw new Error(`Console errors: ${noisy.slice(0, 3).join(" | ")}`);
    return { ok: true, skipped: false, summary: audit.summary };
  } finally {
    await browser.close();
  }
}

function auditTable() {
  const felt = document.querySelector(".table-scroll");
  if (!felt) return { ok: false, reason: "The table is not on screen." };
  const safe = felt.getBoundingClientRect();
  const tiles = [...felt.querySelectorAll("[data-board-tile]")];
  if (tiles.length === 0) return { ok: false, reason: "No board tiles to measure." };
  const zones = [...document.querySelectorAll(".edge-badge, .edge-slivers, .playbar, .hand-tray, .seat-pips")].map((node) =>
    node.getBoundingClientRect(),
  );
  const overlaps = (a, b) => a.left < b.right - 0.6 && a.right > b.left + 0.6 && a.top < b.bottom - 0.6 && a.bottom > b.top + 0.6;
  for (const tile of tiles) {
    const box = tile.getBoundingClientRect();
    const inside =
      box.left >= safe.left - 0.6 && box.top >= safe.top - 0.6 && box.right <= safe.right + 0.6 && box.bottom <= safe.bottom + 0.6;
    if (!inside) return { ok: false, reason: "A tile sits outside the felt." };
    if (zones.some((zone) => overlaps(box, zone))) return { ok: false, reason: "A tile sits under a seat badge or the rack." };
  }
  const rail = document.querySelector(".edge-top");
  if (!rail) return { ok: false, reason: "The top seat is missing, so the reaction bubble was not checked." };
  const bubble = document.createElement("p");
  bubble.className = "talk-bubble talk-reaction";
  bubble.textContent = "👀";
  rail.appendChild(bubble);
  const bubbleBox = bubble.getBoundingClientRect();
  const railBox = rail.getBoundingClientRect();
  const onTile = tiles.some((tile) => overlaps(bubbleBox, tile.getBoundingClientRect()));
  const inRail = bubbleBox.top >= railBox.top - 1 && bubbleBox.bottom <= railBox.bottom + 1;
  bubble.remove();
  if (!inRail || onTile) return { ok: false, reason: "The top-seat reaction covers a board tile." };
  return { ok: true, summary: `${tiles.length} tiles inside the safe rect, reaction clear of the chain` };
}

function openSocket(url, cookie) {
  const headers = { Cookie: cookie };
  if (typeof WebSocket !== "function") {
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

