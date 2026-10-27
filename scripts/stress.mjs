/**
 * Local room capacity check. Never points at the live site.
 *
 *   node scripts/stress.mjs
 *   node scripts/stress.mjs --rooms 100 --step 25
 *
 * Opens mixed 2/3/4-player computer tables, lets them play, then drops
 * every socket at once and reconnects. Prints memory, CPU, and where it stopped.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = parseArgs(process.argv.slice(2));
const roomsTarget = args.rooms;
const step = args.step;
const port = args.port;
const rssLimit = 380 * 1024 * 1024;
const healthLimitMs = 1_000;

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const code = await main();
  process.exit(code);
}

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "uhoh-stress-"));
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "packages/server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      BOTS_ENABLED: "0",
      BOT_PACE_MS: "150",
      BACKUP_EVERY_MS: "0",
      TURN_LIMIT_MS: "60000",
      CONTINUE_MS: "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => {
    serverLog += chunk.toString();
    if (serverLog.length > 20_000) serverLog = serverLog.slice(-10_000);
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
    if (serverLog.length > 20_000) serverLog = serverLog.slice(-10_000);
  });
  const origin = `http://127.0.0.1:${port}`;
  const rooms = [];
  const steps = [];
  let stopReason = "reached the requested room count";
  const driver = setInterval(() => {
    for (const room of rooms) nudge(room);
  }, 40);
  try {
    await waitForHealth(origin, 15_000);
    const before = await measure(server.pid, origin);
    console.log(`Server up. RSS ${mb(before.rss)} MB, health ${before.healthMs} ms.`);
    for (let target = step; target <= roomsTarget; target += step) {
      const opened = await openRooms(origin, rooms, target);
      const ready = await waitUntil(12_000, () => rooms.filter((room) => room.view?.status === "playing").length >= opened * 0.9);
      const sample = await measure(server.pid, origin, 2_000);
      const playing = rooms.filter((room) => room.view?.status === "playing").length;
      const row = {
        rooms: rooms.length,
        playing,
        rss: sample.rss,
        cpuPercent: sample.cpuPercent,
        healthMs: sample.healthMs,
      };
      steps.push(row);
      console.log(
        `${row.rooms} rooms, ${row.playing} playing, RSS ${mb(row.rss)} MB, CPU ${row.cpuPercent.toFixed(1)}% of one core, health ${row.healthMs} ms`,
      );
      if (!ready) {
        stopReason = `only ${playing} of ${rooms.length} rooms were playing`;
        break;
      }
      if (sample.rss > rssLimit) {
        stopReason = `memory reached ${mb(sample.rss)} MB, past the 380 MB line for a 512 MB server`;
        break;
      }
      if (sample.healthMs > healthLimitMs) {
        stopReason = `health took ${sample.healthMs} ms`;
        break;
      }
      if (server.exitCode !== null) {
        stopReason = "the server exited";
        break;
      }
    }
    const storm = await reconnectStorm(origin, rooms);
    const after = await measure(server.pid, origin, 1_000);
    console.log(
      `Reconnect storm: ${storm.back}/${storm.tried} seats back in ${storm.ms} ms. RSS ${mb(after.rss)} MB, health ${after.healthMs} ms.`,
    );
    const peak = steps.reduce((best, row) => (row.rss > best.rss ? row : best), steps[0] ?? { rss: 0, cpuPercent: 0, rooms: 0, healthMs: 0 });
    const comfortable = comfortableRooms(steps);
    const report = {
      stopReason,
      steps,
      storm,
      peakRssMb: mb(peak.rss),
      peakCpuPercent: Number(peak.cpuPercent.toFixed(1)),
      comfortableRooms: comfortable,
      liveBox: "0.5 CPU, 512 MB",
    };
    console.log(JSON.stringify(report, null, 2));
    if (rooms.length === 0 || storm.back < storm.tried * 0.9) return 1;
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(serverLog.slice(-2000));
    return 1;
  } finally {
    clearInterval(driver);
    for (const room of rooms) room.socket?.close();
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        server.kill("SIGKILL");
        resolve();
      }, 3_000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function comfortableRooms(steps) {
  // The live box is half a core, so 50% of one core fills it. Keep fast play under about 70% of that box.
  let rooms = 0;
  for (const row of steps) {
    if (row.cpuPercent * 2 > 70 || row.rss > 350 * 1024 * 1024 || row.healthMs > 500) break;
    rooms = row.rooms;
  }
  return rooms;
}

async function openRooms(origin, rooms, target) {
  const jobs = [];
  while (rooms.length + jobs.length < target) {
    const index = rooms.length + jobs.length;
    const seats = [2, 3, 4][index % 3];
    jobs.push(openRoom(origin, index, seats).then((room) => rooms.push(room)));
    if (jobs.length >= 8) {
      await Promise.all(jobs.splice(0, jobs.length));
    }
  }
  await Promise.all(jobs);
  return rooms.length;
}

async function openRoom(origin, index, seats) {
  const name = `Load${index}`.slice(0, 16);
  const cookie = await guest(origin, name);
  const socket = await connect(origin, cookie);
  const room = { index, seats, cookie, socket, token: "", view: null, error: "", sent: "", wait: false };
  socket.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : String(event.data);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.type === "welcome") room.token = message.token;
    if (message.type === "state") {
      room.view = message.view;
      room.wait = false;
    }
    if (message.type === "error") {
      room.error = message.message;
      room.wait = false;
    }
  });
  socket.send(
    JSON.stringify({
      type: "create",
      name,
      playerCount: seats,
      boneyardMode: index % 2 === 0 ? "draw_until" : "draw_one",
      seriesLength: 3,
      casual: true,
    }),
  );
  return room;
}

function nudge(room) {
  const view = room.view;
  if (!view || room.wait) return;
  if (view.status === "lobby") {
    room.wait = true;
    if (view.players.length < view.settings.playerCount) room.socket.send(JSON.stringify({ type: "add-bot", difficulty: "medium" }));
    else if (view.canStart) room.socket.send(JSON.stringify({ type: "start" }));
    else room.wait = false;
    return;
  }
  if (view.betweenHands || view.phase === "between") {
    const key = `between:${view.gameNumber}:${view.handNumber}`;
    if (room.sent === key) return;
    room.sent = key;
    room.socket.send(JSON.stringify({ type: "continue" }));
    return;
  }
  if (view.status !== "playing" || view.turnPlayerId !== view.yourId) return;
  const key = `${view.gameNumber}:${view.handNumber}:${view.lastPlay?.seq ?? -1}`;
  if (room.sent === key) return;
  const play = view.legalPlays?.[0];
  let intent = null;
  if (play) intent = { type: "play", tileId: play.tileId, endId: play.endId };
  else if (view.canDraw) intent = { type: "draw" };
  else if (view.canKnock) intent = { type: "knock" };
  if (!intent) return;
  room.sent = key;
  room.socket.send(JSON.stringify({ type: "intent", intent }));
}

async function reconnectStorm(origin, rooms) {
  const started = Date.now();
  for (const room of rooms) {
    try {
      room.socket.close();
    } catch {
      // Already closed.
    }
  }
  await sleep(150);
  let back = 0;
  const tried = rooms.filter((room) => room.token).length;
  await Promise.all(
    rooms.map(async (room) => {
      if (!room.token) return;
      try {
        const socket = await connect(origin, room.cookie);
        const seen = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 8_000);
          socket.addEventListener("message", (event) => {
            const text = typeof event.data === "string" ? event.data : String(event.data);
            if (text.includes('"type":"state"') || text.includes('"type": "state"')) {
              clearTimeout(timer);
              resolve(true);
            }
          });
        });
        socket.send(JSON.stringify({ type: "reconnect", token: room.token }));
        const ok = await seen;
        room.socket = socket;
        if (ok) back += 1;
      } catch {
        // Counted as not back.
      }
    }),
  );
  return { tried, back, ms: Date.now() - started };
}

async function guest(origin, name) {
  const response = await fetch(new URL("/api/guest", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: name, age13: true }),
  });
  if (!response.ok) throw new Error(`Guest sign-in returned ${response.status}.`);
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const lines = cookies.length > 0 ? cookies : [response.headers.get("set-cookie") ?? ""];
  for (const line of lines) {
    const match = /uhoh_session=([^;]+)/.exec(line);
    if (match) return `uhoh_session=${match[1]}`;
  }
  throw new Error("Guest sign-in did not set a session.");
}

function connect(origin, cookie) {
  const url = origin.replace(/^http/, "ws") + "/ws";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Cookie: cookie } });
    const fail = () => reject(new Error("The socket failed."));
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
}

async function waitForHealth(origin, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(new URL("/health", origin));
      if (response.ok) return;
    } catch {
      // The process is still booting.
    }
    await sleep(100);
  }
  throw new Error("The local server did not answer /health.");
}

async function measure(pid, origin, windowMs = 0) {
  const start = cpuSnap(pid);
  const healthStarted = performance.now();
  const response = await fetch(new URL("/health", origin));
  const healthMs = Math.round(performance.now() - healthStarted);
  if (!response.ok) throw new Error(`Health returned ${response.status}.`);
  if (windowMs > 0) await sleep(windowMs);
  const end = cpuSnap(pid);
  const ticks = end.total - start.total;
  const seconds = Math.max(0.05, (end.at - start.at) / 1000);
  const cpuPercent = (ticks / 100 / seconds) * 100;
  return { rss: end.rss, cpuPercent, healthMs };
}

function cpuSnap(pid) {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = text.lastIndexOf(")");
  const parts = text.slice(end + 2).split(" ");
  return {
    total: Number(parts[11]) + Number(parts[12]),
    rss: Number(parts[21]) * 4096,
    at: Date.now(),
  };
}

function waitUntil(timeoutMs, test) {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (test()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
}

function mb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const out = { rooms: 100, step: 25, port: 8878 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rooms") out.rooms = Number(argv[++index] ?? 100);
    else if (arg === "--step") out.step = Number(argv[++index] ?? 25);
    else if (arg === "--port") out.port = Number(argv[++index] ?? 8878);
  }
  if (!Number.isFinite(out.rooms) || out.rooms < 1) out.rooms = 100;
  if (!Number.isFinite(out.step) || out.step < 1) out.step = 25;
  return out;
}
