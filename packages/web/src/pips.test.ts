import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allTiles } from "../../rules/src/tiles.js";
import { PIP_DIAMETER, PIP_INSET, PIP_RADIUS, pipCenters, rotatePip, type PipPoint, type PipRotation } from "./pips.js";

const ROTATIONS: PipRotation[] = [0, 90, 180, 270];
/** The face radius is 7px on a half about one short side (36px) across. */
const FACE_RADIUS = 7 / 36;

function circleOnFace(point: PipPoint, radius: number): boolean {
  if (point.x - radius < -1e-6 || point.y - radius < -1e-6) return false;
  if (point.x + radius > 1 + 1e-6 || point.y + radius > 1 + 1e-6) return false;
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const;
  for (const [cx, cy] of corners) {
    const axisX = cx === 0 ? point.x : 1 - point.x;
    const axisY = cy === 0 ? point.y : 1 - point.y;
    if (axisX >= FACE_RADIUS || axisY >= FACE_RADIUS) continue;
    const arcX = cx === 0 ? FACE_RADIUS : 1 - FACE_RADIUS;
    const arcY = cy === 0 ? FACE_RADIUS : 1 - FACE_RADIUS;
    if (Math.hypot(point.x - arcX, point.y - arcY) + radius > FACE_RADIUS + 1e-6) return false;
  }
  return true;
}

function pairDistances(dots: readonly PipPoint[]): number[] {
  const distances: number[] = [];
  for (let i = 0; i < dots.length; i += 1) {
    for (let j = i + 1; j < dots.length; j += 1) {
      distances.push(Math.hypot(dots[i]!.x - dots[j]!.x, dots[i]!.y - dots[j]!.y));
    }
  }
  return distances.sort((a, b) => a - b);
}

function nearestInset(point: PipPoint): number {
  return Math.min(point.x, point.y, 1 - point.x, 1 - point.y);
}

describe("pip positions", () => {
  it("places every tile's pips at all four orientations, round and evenly spaced", () => {
    expect(allTiles()).toHaveLength(28);
    expect(PIP_DIAMETER).toBe(PIP_RADIUS * 2);
    expect(PIP_DIAMETER).toBeGreaterThanOrEqual(0.17);
    expect(PIP_DIAMETER).toBeLessThanOrEqual(0.2);
    expect(PIP_INSET).toBeGreaterThanOrEqual(0.22);
    expect(PIP_INSET).toBeLessThanOrEqual(0.25);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.half i \{[^}]*width:\s*18cqmin;\s*height:\s*18cqmin;/);
    expect(css).not.toMatch(/\.hand-tile \.half i \{[^}]*width:/);
    let checked = 0;
    for (const tile of allTiles()) {
      for (const rotation of ROTATIONS) {
        for (const value of [tile.low, tile.high]) {
          const dots = pipCenters(value, rotation);
          expect(dots, `${tile.id} ${value} @${rotation}`).toHaveLength(value);
          if (value > 0) {
            const cx = dots.reduce((sum, dot) => sum + dot.x, 0) / dots.length;
            const cy = dots.reduce((sum, dot) => sum + dot.y, 0) / dots.length;
            expect(cx, `${tile.id} ${value} @${rotation} x`).toBeCloseTo(0.5, 5);
            expect(cy, `${tile.id} ${value} @${rotation} y`).toBeCloseTo(0.5, 5);
          }
          expect(dots).toEqual(pipCenters(value, 0).map((dot) => rotatePip(dot, rotation)));
          for (let i = 0; i < dots.length; i += 1) {
            expect(circleOnFace(dots[i]!, PIP_RADIUS), `${tile.id} ${value} @${rotation}`).toBe(true);
          }
          const distances = pairDistances(dots);
          for (const distance of distances) {
            expect(distance, `${tile.id} ${value} @${rotation} overlap`).toBeGreaterThan(PIP_DIAMETER + 0.04);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(28 * 4 * 2);

    for (const rotation of ROTATIONS) {
      const six = pipCenters(6, rotation);
      const xs = [...new Set(six.map((dot) => dot.x.toFixed(4)))];
      const ys = [...new Set(six.map((dot) => dot.y.toFixed(4)))];
      const wide = Math.max(xs.length, ys.length);
      const narrow = Math.min(xs.length, ys.length);
      expect(wide, `six @${rotation} rows`).toBe(3);
      expect(narrow, `six @${rotation} columns`).toBe(2);
    }
  });

  it("sits corner pips a short way in from each edge", () => {
    for (const rotation of ROTATIONS) {
      for (const value of [2, 3, 4, 5, 6]) {
        const dots = pipCenters(value, rotation);
        const corners = dots.filter((dot) => nearestInset(dot) < 0.4);
        expect(corners.length, `${value} @${rotation}`).toBeGreaterThanOrEqual(2);
        for (const dot of corners) {
          const inset = nearestInset(dot);
          expect(inset, `${value} @${rotation}`).toBeGreaterThanOrEqual(0.22);
          expect(inset, `${value} @${rotation}`).toBeLessThanOrEqual(0.25);
        }
      }
    }
    const four = pipCenters(4, 0);
    for (const dot of four) {
      expect(Math.min(dot.x, 1 - dot.x)).toBeCloseTo(PIP_INSET, 5);
      expect(Math.min(dot.y, 1 - dot.y)).toBeCloseTo(PIP_INSET, 5);
    }
  });

  it("measures the rendered dot on the board and in the hand at 56px and 30px", async () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = renderFixture(css);
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      void req;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    const chrome = await launchChrome();
    try {
      const page = await connectPage(chrome.port);
      await page.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
      const measured = (await waitForMeasure(page)) as Measure[];
      expect(measured.length).toBeGreaterThan(0);
      for (const item of measured) {
        expect(item.diameter, `${item.id} diameter`).toBeGreaterThanOrEqual(0.17);
        expect(item.diameter, `${item.id} diameter`).toBeLessThanOrEqual(0.2);
        expect(item.cornerInset, `${item.id} inset`).toBeGreaterThanOrEqual(0.22);
        expect(item.cornerInset, `${item.id} inset`).toBeLessThanOrEqual(0.25);
        expect(Math.abs(item.dotW - item.dotH), `${item.id} circle`).toBeLessThan(0.4);
      }
      for (const size of [56, 30]) {
        for (const turn of ["up", "turned"]) {
          const board = measured.find((item) => item.id === `board-${size}-${turn}`);
          const hand = measured.find((item) => item.id === `hand-${size}-${turn}`);
          expect(board && hand, `${size} ${turn}`).toBeTruthy();
          expect(Math.abs(board!.diameter - hand!.diameter), `${size} ${turn} diameter`).toBeLessThan(0.015);
          expect(Math.abs(board!.cornerInset - hand!.cornerInset), `${size} ${turn} inset`).toBeLessThan(0.02);
        }
      }
    } finally {
      chrome.kill();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 40_000);
});

interface Measure {
  id: string;
  diameter: number;
  cornerInset: number;
  dotW: number;
  dotH: number;
}

function renderFixture(css: string): string {
  return `<!doctype html><html><head><style>${css}</style>
<style>body{margin:0;background:#111}.row{display:flex;gap:8px;padding:8px}.board-tile{position:relative}</style>
</head><body>
<div id="root"></div>
<script>
const inset = ${PIP_INSET};
const faces = {
  4: [[inset, inset], [1-inset, inset], [inset, 1-inset], [1-inset, 1-inset]]
};
function half(value) {
  const span = document.createElement("span");
  span.className = "half";
  for (const [x, y] of faces[value]) {
    const dot = document.createElement("i");
    dot.style.left = (x * 100) + "%";
    dot.style.top = (y * 100) + "%";
    span.appendChild(dot);
  }
  return span;
}
function tile(kind, size, turned) {
  const wrap = document.createElement(kind === "board" ? "div" : "button");
  wrap.className = kind === "board" ? "board-tile" : "hand-tile playable";
  const long = size * 2;
  if (kind === "board") {
    wrap.style.position = "relative";
    wrap.style.width = (turned ? long : size) + "px";
    wrap.style.height = (turned ? size : long) + "px";
  } else {
    wrap.style.setProperty("--hand-tile", size + "px");
    if (turned) wrap.style.width = long + "px";
  }
  const domino = document.createElement("div");
  domino.className = "domino" + (turned ? " horizontal" : "");
  domino.style.width = (turned ? long : size) + "px";
  domino.style.height = (turned ? size : long) + "px";
  domino.appendChild(half(4));
  const split = document.createElement("span");
  split.className = "domino-split";
  domino.appendChild(split);
  domino.appendChild(half(4));
  wrap.appendChild(domino);
  wrap.dataset.id = kind + "-" + size + "-" + (turned ? "turned" : "up");
  return wrap;
}
const root = document.getElementById("root");
for (const size of [56, 30]) {
  for (const turned of [false, true]) {
    root.appendChild(tile("board", size, turned));
    root.appendChild(tile("hand", size, turned));
  }
}
requestAnimationFrame(() => {
  const out = [];
  for (const wrap of root.children) {
    const face = wrap.querySelector(".half");
    const dot = face.querySelector("i");
    const hr = face.getBoundingClientRect();
    const dr = dot.getBoundingClientRect();
    const cx = (dr.left + dr.right) / 2;
    const cy = (dr.top + dr.bottom) / 2;
    out.push({
      id: wrap.dataset.id,
      diameter: dr.width / hr.width,
      cornerInset: Math.min((cx - hr.left) / hr.width, (cy - hr.top) / hr.height),
      dotW: dr.width,
      dotH: dr.height,
    });
  }
  document.body.dataset.ready = JSON.stringify(out);
});
</script></body></html>`;
}

async function launchChrome(): Promise<{ port: number; kill: () => void }> {
  const { spawn } = await import("node:child_process");
  const port = 9600 + Math.floor(Math.random() * 300);
  const child = spawn(
    "/usr/bin/google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/pip-test-${port}`,
      "--no-first-run",
      "--window-size=900,700",
    ],
    { stdio: "ignore" },
  );
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (version.ok) return { port, kill: () => child.kill("SIGKILL") };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill("SIGKILL");
  throw new Error("Chrome did not start");
}

async function connectPage(port: number) {
  const list = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const target = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) throw new Error("Chrome did not open a page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  async function send(method: string, params: object = {}) {
    const id = ++seq;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
  await send("Page.enable");
  await send("Runtime.enable");
  return { send };
}

async function waitForMeasure(page: { send: (method: string, params?: object) => Promise<unknown> }) {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const result = (await page.send("Runtime.evaluate", {
      expression: "document.body.dataset.ready || ''",
      returnByValue: true,
    })) as { result?: { value?: string } };
    const raw = result.result?.value;
    if (raw) return JSON.parse(raw) as Measure[];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("pip measurement did not render");
}
