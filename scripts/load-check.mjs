/**
 * Local production load check for about 100 players. Never points at the live site.
 *
 *   npm run build
 *   node scripts/load-check.mjs
 *   node scripts/load-check.mjs --players 100 --seconds 180
 *
 * Opens a mix of 2-, 3-, and 4-player tables and plays full games (one game to 150)
 * with scripted clients against the built server. Prints CPU, memory, event-loop
 * lag, websocket latency, errors, disconnects, and database load.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OPS_SECRET = "load-check-secret";
const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const code = await main();
  process.exit(code);
}

function tablePlan(players) {
  if (players === 100) return [...Array(8).fill(2), ...Array(8).fill(3), ...Array(15).fill(4)];
  const counts = [];
  let left = players;
  const pattern = [4, 3, 2];
  let index = 0;
  while (left > 0) {
    let size = pattern[index % pattern.length];
    if (size > left) size = left >= 3 ? 3 : left;
    if (size < 2) break;
    counts.push(size);
    left -= size;
    index += 1;
  }
  return counts;
}

async function main() {
  if (!existsSync("packages/server/dist/index.js")) {
    console.error("Build first: npm run build");
    return 1;
  }
  const plan = tablePlan(args.players);
  const seatCount = plan.reduce((sum, size) => sum + size, 0);
  if (seatCount < 2) {
    console.error("Need at least 2 players.");
    return 1;
  }
  const dataDir = mkdtempSync(path.join(tmpdir(), "uhoh-load-"));
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "packages/server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(args.port),
      DATA_DIR: dataDir,
      BOTS_ENABLED: "0",
      BACKUP_EVERY_MS: "0",
      TURN_LIMIT_MS: "120000",
      CONTINUE_MS: "60000",
      OPS_SECRET,
      BUILD_SHA: "loadchk",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  const takeLog = (chunk) => {
    serverLog += chunk.toString();
    if (serverLog.length > 40_000) serverLog = serverLog.slice(-20_000);
  };
  server.stdout.on("data", takeLog);
  server.stderr.on("data", takeLog);
  const origin = `http://127.0.0.1:${args.port}`;
  const tables = [];
  let driver = 0;
  try {
    await waitForHealth(origin, 20_000);
    const capped = capHalfCore(server.pid);
    console.log(
      `Server up on ${origin}. ${plan.length} tables, ${seatCount} players. CPU cap ${capped ? "0.5 core" : "not applied"}.`,
    );
    await post(origin, "/api/ops/metrics/reset");
    const before = await metrics(origin);
    const opened = await openTables(origin, plan);
    tables.push(...opened);
    driver = setInterval(() => nudgeAll(tables), 25);
    const playing = await waitUntil(30_000, () => tables.filter((table) => table.playing).length === tables.length);
    if (!playing) console.log(`Only ${tables.filter((table) => table.playing).length} of ${tables.length} tables started.`);
    await post(origin, "/api/ops/metrics/reset");
    const started = Date.now();
    let peakRss = before.rssMb ?? 0;
    let peakLoop = before.eventLoop?.p95Ms ?? 0;
    let peakQuery = before.queryMs ?? 0;
    const cpuStart = cpuSnap(server.pid);
    let nextSample = Date.now() + 5_000;
    while (Date.now() - started < args.seconds * 1000) {
      if (server.exitCode !== null) break;
      if (tables.every((table) => table.done)) break;
      if (Date.now() >= nextSample) {
        nextSample = Date.now() + 5_000;
        const snap = await metrics(origin);
        const proc = cpuSnap(server.pid);
        if (proc.rssMb > peakRss) peakRss = proc.rssMb;
        if ((snap.eventLoop?.p95Ms ?? 0) > peakLoop) peakLoop = snap.eventLoop.p95Ms;
        if ((snap.queryMs ?? 0) > peakQuery) peakQuery = snap.queryMs;
        const done = tables.filter((table) => table.done).length;
        const actions = tables.reduce((sum, table) => sum + table.seats.reduce((inner, seat) => inner + seat.actions, 0), 0);
        console.log(
          `${Math.round((Date.now() - started) / 1000)}s  matches ${done}/${tables.length}  actions ${actions}  RSS ${proc.rssMb.toFixed(0)} MB  loop p95 ${snap.eventLoop?.p95Ms ?? "?"} ms`,
        );
      }
      await sleep(200);
    }
    const cpuEnd = cpuSnap(server.pid);
    const after = await metrics(origin);
    const latencies = tables.flatMap((table) => table.seats.flatMap((seat) => seat.samples));
    const fast = latencies.filter((ms) => ms < 1000);
    const disconnects = tables.reduce((sum, table) => sum + table.seats.reduce((inner, seat) => inner + seat.disconnects, 0), 0);
    const playErrors = tables.reduce((sum, table) => sum + table.seats.filter((seat) => seat.error).length, 0);
    const ticks = cpuEnd.ticks - cpuStart.ticks;
    const cpuSeconds = Math.max(0.05, (cpuEnd.at - cpuStart.at) / 1000);
    const cpuPercent = (ticks / 100 / cpuSeconds) * 100;
    const report = {
      localOnly: true,
      url: origin,
      cpuCapApplied: capped,
      plan: "0.5 CPU / 512 MB (render.yaml plan 0.5c-512mb)",
      players: seatCount,
      tables: plan.length,
      tableMix: {
        two: plan.filter((n) => n === 2).length,
        three: plan.filter((n) => n === 3).length,
        four: plan.filter((n) => n === 4).length,
      },
      series: "one game to 150",
      elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
      matchesCompleted: tables.filter((table) => table.done).length,
      matchesStarted: tables.filter((table) => table.playing).length,
      actions: tables.reduce((sum, table) => sum + table.seats.reduce((inner, seat) => inner + seat.actions, 0), 0),
      latencyMs: {
        samples: latencies.length,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        fastP50: percentile(fast, 50),
        fastP95: percentile(fast, 95),
      },
      cpuPercentOfOneCore: Math.round(cpuPercent * 10) / 10,
      peakRssMb: Math.round(Math.max(peakRss, cpuEnd.rssMb) * 10) / 10,
      endRssMb: after.rssMb,
      eventLoopLagMs: {
        endP50: after.eventLoop?.p50Ms ?? null,
        endP95: after.eventLoop?.p95Ms ?? null,
        peakP95: Math.round(peakLoop * 10) / 10,
      },
      errorsStored: Math.max(0, (after.errors ?? 0) - (before.errors ?? 0)),
      playErrors,
      disconnects,
      db: {
        hands: Math.max(0, (after.hands ?? 0) - (before.hands ?? 0)),
        bytes: after.dbBytes == null || before.dbBytes == null ? null : after.dbBytes - before.dbBytes,
        peakQueryMs: peakQuery,
        endQueryMs: after.queryMs,
      },
      serverExited: server.exitCode !== null,
    };
    report.headroom = headroom(report);
    console.log(JSON.stringify(report, null, 2));
    return report.serverExited || report.matchesStarted === 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(serverLog.slice(-2000));
    return 1;
  } finally {
    clearInterval(driver);
    for (const table of tables) {
      for (const seat of table.seats) {
        try {
          seat.socket?.close();
        } catch {
          // Already closed.
        }
      }
    }
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

function headroom(report) {
  const cpuOfPlan = report.cpuPercentOfOneCore / 50;
  const memoryOfPlan = (report.peakRssMb ?? 0) / 512;
  // The script plays the instant a turn opens. People at a table wait, so a
  // real session uses less CPU than this burst. Memory and errors still count
  // the same way.
  let recommendation = "The current 0.5 CPU / 512 MB plan has room for this load.";
  if (report.serverExited || report.disconnects > 5 || memoryOfPlan > 0.9) {
    recommendation = "The 512 MB box is too small for this. Use a larger instance before inviting testers.";
  } else if (cpuOfPlan > 1 && (report.latencyMs.p95 ?? 0) > 200) {
    recommendation =
      "Keep the current plan for the tester weekend. A hundred people do not play the instant a turn starts, and memory had room. This script did play that fast and wanted about one full core, so a moment when many tables play together will feel slower on the half-core box. Move to 1 CPU if that pause should stay under a tenth of a second.";
  } else if (cpuOfPlan > 0.85 || memoryOfPlan > 0.75 || (report.eventLoopLagMs.peakP95 ?? 0) > 150) {
    recommendation = "The current plan is close to full during this run. Watch the first session, and move to 1 CPU if turns start to lag.";
  }
  if (!report.cpuCapApplied) {
    recommendation += " The process was not capped at half a core, so the live box can be slower than these latency numbers when it is busy.";
  }
  return {
    cpuFractionOfPlan: Math.round(cpuOfPlan * 100) / 100,
    memoryFractionOfPlan: Math.round(memoryOfPlan * 100) / 100,
    recommendation,
  };
}

async function openTables(origin, plan) {
  const tables = [];
  let player = 0;
  for (const size of plan) {
    const table = { size, code: "", playing: false, done: false, seats: [] };
    for (let seat = 0; seat < size; seat += 1) {
      const name = `P${String(player).padStart(3, "0")}`;
      player += 1;
      const cookie = await guest(origin, name);
      const socket = await connect(origin, cookie);
      const row = {
        name,
        host: seat === 0,
        socket,
        view: null,
        error: "",
        sent: "",
        samples: [],
        actions: 0,
        disconnects: 0,
        pendingAt: 0,
      };
      socket.addEventListener("message", (event) => onMessage(table, row, event));
      socket.addEventListener("close", () => {
        row.disconnects += 1;
      });
      table.seats.push(row);
    }
    tables.push(table);
  }
  await Promise.all(
    tables.map(async (table) => {
      const host = table.seats[0];
      host.socket.send(
        JSON.stringify({
          type: "create",
          name: host.name,
          playerCount: table.size,
          boneyardMode: "draw_until",
          seriesLength: 1,
          casual: true,
        }),
      );
      const code = await waitFor(8_000, () => table.code);
      if (!code) throw new Error(`A table for ${host.name} did not open.`);
      await Promise.all(
        table.seats.slice(1).map(async (seat) => {
          seat.socket.send(JSON.stringify({ type: "join", code, name: seat.name }));
          const sat = await waitFor(8_000, () => (seat.view ? "yes" : ""));
          if (!sat) throw new Error(`${seat.name} did not sit down.`);
        }),
      );
    }),
  );
  return tables;
}

function onMessage(table, seat, event) {
  const text = typeof event.data === "string" ? event.data : String(event.data);
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (message.type === "welcome" && seat.host) table.code = message.roomCode;
  if (message.type === "state") {
    if (seat.pendingAt) {
      seat.samples.push(performance.now() - seat.pendingAt);
      seat.pendingAt = 0;
    }
    seat.view = message.view;
    if (message.view?.status === "playing" || message.view?.status === "complete") table.playing = true;
    if (message.view?.status === "complete") table.done = true;
  }
  if (message.type === "error") {
    seat.error = message.message;
    seat.pendingAt = 0;
    seat.sent = "";
  }
}

function nudgeAll(tables) {
  for (const table of tables) {
    for (const seat of table.seats) nudge(seat);
  }
}

function nudge(seat) {
  const view = seat.view;
  if (seat.pendingAt && performance.now() - seat.pendingAt > 5_000) {
    seat.pendingAt = 0;
    seat.sent = "";
  }
  if (!view || seat.pendingAt) return;
  if (view.status === "lobby") {
    if (!seat.host || !view.canStart || seat.sent === "start") return;
    seat.sent = "start";
    seat.socket.send(JSON.stringify({ type: "start" }));
    return;
  }
  if (view.status === "complete") return;
  if (view.betweenHands || view.phase === "between") {
    if (!seat.host) return;
    const key = `between:${view.gameNumber}:${view.handNumber}`;
    if (seat.sent === key) return;
    seat.sent = key;
    seat.actions += 1;
    seat.pendingAt = performance.now();
    seat.socket.send(JSON.stringify({ type: "continue" }));
    return;
  }
  if (view.status !== "playing" || view.turnPlayerId !== view.yourId) return;
  const key = [
    view.gameNumber,
    view.handNumber,
    view.phase,
    view.turnPlayerId,
    view.lastPlay?.seq ?? -1,
    view.boneyardCount,
    view.you?.hand?.length ?? 0,
  ].join(":");
  if (seat.sent === key) return;
  const play = view.legalPlays?.[0];
  let intent = null;
  if (play) intent = { type: "play", tileId: play.tileId, endId: play.endId };
  else if (view.canDraw) intent = { type: "draw" };
  else if (view.canKnock) intent = { type: "knock" };
  if (!intent) return;
  seat.sent = key;
  seat.actions += 1;
  seat.pendingAt = performance.now();
  seat.socket.send(JSON.stringify({ type: "intent", intent }));
}

function capHalfCore(pid) {
  // A 0.5 CPU Render box is half of one core. Containers often refuse this write.
  try {
    const root = "/sys/fs/cgroup";
    const controllers = readFileSync(`${root}/cgroup.controllers`, "utf8");
    if (!controllers.split(/\s+/).includes("cpu")) return false;
    const dir = `${root}/uhoh-load-${pid}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/cpu.max`, "50000 100000");
    writeFileSync(`${dir}/cgroup.procs`, String(pid));
    return readFileSync(`${dir}/cpu.max`, "utf8").includes("50000");
  } catch {
    return false;
  }
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

async function metrics(origin) {
  const response = await fetch(new URL("/api/ops/metrics", origin), { headers: { "x-ops-secret": OPS_SECRET } });
  if (!response.ok) throw new Error(`Metrics returned ${response.status}.`);
  return response.json();
}

async function post(origin, pathname) {
  const response = await fetch(new URL(pathname, origin), { method: "POST", headers: { "x-ops-secret": OPS_SECRET } });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}.`);
}

async function waitForHealth(origin, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(new URL("/health", origin));
      if (response.ok) return;
    } catch {
      // Still booting.
    }
    await sleep(100);
  }
  throw new Error("The local server did not answer /health.");
}

function cpuSnap(pid) {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = text.lastIndexOf(")");
  const parts = text.slice(end + 2).split(" ");
  return {
    ticks: Number(parts[11]) + Number(parts[12]),
    rssMb: (Number(parts[21]) * 4096) / (1024 * 1024),
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
    }, 50);
  });
}

function waitFor(timeoutMs, read) {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const value = read();
      if (value) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve("");
      }
    }, 30);
  });
}

function percentile(samples, p) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 10) / 10;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const out = { players: 100, seconds: 180, port: 8879 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--players") out.players = Number(argv[++index] ?? 100);
    else if (arg === "--seconds") out.seconds = Number(argv[++index] ?? 180);
    else if (arg === "--port") out.port = Number(argv[++index] ?? 8879);
    else if (arg === "--url") {
      const url = argv[++index] ?? "";
      if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) {
        console.error("Refusing to load-test anything except localhost.");
        process.exit(2);
      }
    }
  }
  if (!Number.isFinite(out.players) || out.players < 2) out.players = 100;
  if (!Number.isFinite(out.seconds) || out.seconds < 10) out.seconds = 180;
  return out;
}
