import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allTiles } from "../../rules/src/tiles.js";
import { PIP_COL_INSET, PIP_DIAMETER, PIP_END_INSET, PIP_PITCH, PIP_RADIUS, pipCenters, rotatePip, type PipPoint, type PipRotation } from "./pips.js";

const TILE_SKINS = ["ivory", "wood", "neon", "marble", "charcoal", "gold", "sky", "cherry", "boss", "ice", "candy"];

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
    expect(PIP_DIAMETER).toBeCloseTo(0.2, 5);
    expect(PIP_COL_INSET).toBeCloseTo(0.2, 5);
    expect(PIP_END_INSET).toBeCloseTo(0.19, 5);
    expect(PIP_PITCH).toBeCloseTo(0.31, 5);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.half i \{[^}]*width:\s*20cqmin;\s*height:\s*20cqmin;/);
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
            expect(distance, `${tile.id} ${value} @${rotation} overlap`).toBeGreaterThan(PIP_DIAMETER + 0.05);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(28 * 4 * 2);

    for (const rotation of ROTATIONS) {
      const six = pipCenters(6, rotation);
      const distances = pairDistances(six);
      const along = distances.filter((distance) => Math.abs(distance - PIP_PITCH) < 1e-6);
      const across = distances.filter((distance) => Math.abs(distance - (1 - 2 * PIP_COL_INSET)) < 1e-6);
      expect(along.length + across.length, `six @${rotation}`).toBe(7);
      const xs = [...new Set(six.map((dot) => dot.x.toFixed(4)))];
      const ys = [...new Set(six.map((dot) => dot.y.toFixed(4)))];
      expect(Math.max(xs.length, ys.length), `six @${rotation}`).toBe(3);
      expect(Math.min(xs.length, ys.length), `six @${rotation}`).toBe(2);
    }
  });

  it("sits corner pips a short way in from each edge", () => {
    for (const rotation of ROTATIONS) {
      const four = pipCenters(4, rotation);
      for (const dot of four) {
        const xs = [Math.min(dot.x, 1 - dot.x), Math.min(dot.y, 1 - dot.y)].sort((a, b) => a - b);
        expect(xs[0], `4 @${rotation} end`).toBeCloseTo(Math.min(PIP_END_INSET, PIP_COL_INSET), 5);
        expect(xs[1], `4 @${rotation} side`).toBeCloseTo(Math.max(PIP_END_INSET, PIP_COL_INSET), 5);
      }
      const six = pipCenters(6, rotation);
      const outer = Math.min(...six.map((dot) => nearestInset(dot)));
      expect(outer, `6 @${rotation}`).toBeCloseTo(PIP_END_INSET, 5);
      const gaps = pairDistances(six).filter((distance) => distance < PIP_PITCH + 0.05);
      for (const gap of gaps) expect(gap, `6 @${rotation} gap`).toBeCloseTo(PIP_PITCH, 5);
      expect(PIP_PITCH - PIP_DIAMETER, "6 row gap").toBeGreaterThan(0.05);
      const five = pipCenters(5, rotation);
      const centre = five.find((dot) => Math.abs(dot.x - 0.5) < 1e-6 && Math.abs(dot.y - 0.5) < 1e-6)!;
      const corner = five.find((dot) => dot !== centre)!;
      const reach = Math.hypot(corner.x - centre.x, corner.y - centre.y);
      expect(reach - PIP_DIAMETER, `5 @${rotation} centre gap`).toBeGreaterThan(0.05);
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
        expect(item.diameter, `${item.id} diameter`).toBeGreaterThan(0.18);
        expect(item.diameter, `${item.id} diameter`).toBeLessThan(0.23);
        expect(item.cornerInset, `${item.id} inset`).toBeGreaterThan(0.16);
        expect(item.cornerInset, `${item.id} inset`).toBeLessThan(0.23);
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

  it("renders every double round, at a regular tile's size, crosswise and lengthwise", async () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/data-cross="closed"\]::before/);
    const html = doubleFixture(css);
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
      const measured = (await waitForMeasure(page)) as unknown as DoubleMeasure[];
      expect(measured.length).toBeGreaterThan(50);
      for (const item of measured) {
        expect(Math.abs(item.dominoW - item.regularW), `${item.id} width`).toBeLessThan(0.6);
        expect(Math.abs(item.dominoH - item.regularH), `${item.id} height`).toBeLessThan(0.6);
        const long = Math.max(item.dominoW, item.dominoH);
        const short = Math.min(item.dominoW, item.dominoH);
        expect(long / short, `${item.id} aspect`).toBeGreaterThan(1.9);
        expect(long / short, `${item.id} aspect`).toBeLessThan(2.1);
        expect(item.pips, `${item.id} pip count`).toBe(item.value * 2);
        for (const pip of item.pipShapes) {
          expect(Math.abs(pip.w - pip.h), `${item.id} circle`).toBeLessThan(0.6);
          expect(pip.w, `${item.id} pip size`).toBeGreaterThan(2);
          expect(pip.clipped, `${item.id} clipped`).toBe(false);
        }
      }
      const closed = measured.find((item) => item.id === "closed-6");
      expect(closed?.bar, "closed spinner draws no bar over the pips").toBe("none");
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

interface DoubleMeasure {
  id: string;
  value: number;
  dominoW: number;
  dominoH: number;
  regularW: number;
  regularH: number;
  pips: number;
  pipShapes: Array<{ w: number; h: number; clipped: boolean }>;
  bar: string;
}

function doubleFixture(css: string): string {
  const dots: Record<string, PipPoint[]> = {};
  for (const value of [0, 1, 2, 3, 4, 5, 6]) {
    dots[`${value}-0`] = pipCenters(value, 0);
    dots[`${value}-90`] = pipCenters(value, 90);
  }
  dots["regular-0"] = pipCenters(3, 0);
  dots["regular-b-0"] = pipCenters(4, 0);
  dots["regular-90"] = pipCenters(3, 90);
  dots["regular-b-90"] = pipCenters(4, 90);
  return `<!doctype html><html><head><style>${css}</style>
<style>body{margin:0;background:#16301c}.board-tile{position:relative !important}button{border:0;padding:0;background:none}</style>
</head><body><div id="root"></div><script>
const dots = ${JSON.stringify(dots)};
const skins = ${JSON.stringify(TILE_SKINS)};
function half(key) {
  const span = document.createElement("span");
  span.className = "half";
  for (const pip of dots[key]) {
    const dot = document.createElement("i");
    dot.style.left = (pip.x * 100) + "%";
    dot.style.top = (pip.y * 100) + "%";
    span.appendChild(dot);
  }
  return span;
}
function face(node, keyA, keyB) {
  node.appendChild(half(keyA));
  const split = document.createElement("span");
  split.className = "domino-split";
  node.appendChild(split);
  node.appendChild(half(keyB));
}
function pair(skin, value, turned, surface) {
  const host = document.createElement("div");
  host.setAttribute("data-tile-skin", skin);
  const long = 96, short = 48;
  const make = (kind) => {
    const wrap = document.createElement(surface === "hand" ? "button" : "div");
    wrap.className = surface === "hand" ? "hand-tile playable" : "board-tile";
    if (surface === "hand") {
      wrap.style.setProperty("--hand-tile", short + "px");
      wrap.style.width = short + "px";
    } else {
      wrap.style.width = (turned ? long : short) + "px";
      wrap.style.height = (turned ? short : long) + "px";
    }
    const domino = document.createElement("span");
    domino.className = "domino" + (surface === "board" && turned ? " horizontal" : "");
    const rot = surface === "board" && turned ? "90" : "0";
    if (kind === "double") face(domino, value + "-" + rot, value + "-" + rot);
    else face(domino, "regular-" + rot, "regular-b-" + rot);
    wrap.appendChild(domino);
    return wrap;
  };
  const tile = make("double");
  const regular = make("regular");
  host.appendChild(tile);
  host.appendChild(regular);
  host.dataset.id = skin + "-" + surface + "-" + value + "-" + (turned ? "length" : "cross");
  host.dataset.value = String(value);
  return host;
}
const root = document.getElementById("root");
for (const skin of skins) {
  for (const value of [0, 1, 2, 3, 4, 5, 6]) {
    root.appendChild(pair(skin, value, false, "board"));
    root.appendChild(pair(skin, value, true, "board"));
    root.appendChild(pair(skin, value, false, "hand"));
  }
}
const closed = pair("wood", 6, false, "board");
closed.dataset.id = "closed-6";
closed.querySelector(".board-tile").setAttribute("data-cross", "closed");
root.appendChild(closed);
requestAnimationFrame(() => requestAnimationFrame(() => {
  const out = [];
  for (const host of root.children) {
    const tiles = host.querySelectorAll(".board-tile, .hand-tile");
    const tile = tiles[0];
    const regular = tiles[1];
    const domino = tile.querySelector(".domino");
    const regularDomino = regular.querySelector(".domino");
    const dr = domino.getBoundingClientRect();
    const rr = regularDomino.getBoundingClientRect();
    const shapes = [];
    for (const pip of domino.querySelectorAll(".half i")) {
      const pr = pip.getBoundingClientRect();
      const half = pip.parentElement.getBoundingClientRect();
      shapes.push({
        w: pr.width,
        h: pr.height,
        clipped: pr.left < half.left - 0.5 || pr.top < half.top - 0.5 || pr.right > half.right + 0.5 || pr.bottom > half.bottom + 0.5,
      });
    }
    const before = getComputedStyle(tile, "::before");
    out.push({
      id: host.dataset.id,
      value: Number(host.dataset.value),
      dominoW: dr.width,
      dominoH: dr.height,
      regularW: rr.width,
      regularH: rr.height,
      pips: shapes.length,
      pipShapes: shapes,
      bar: before.content,
    });
  }
  document.body.dataset.ready = JSON.stringify(out);
}));
</script></body></html>`;
}

function renderFixture(css: string): string {
  return `<!doctype html><html><head><style>${css}</style>
<style>body{margin:0;background:#111}.row{display:flex;gap:8px;padding:8px}.board-tile{position:relative}</style>
</head><body>
<div id="root"></div>
<script>
const col = ${PIP_COL_INSET};
const end = ${PIP_END_INSET};
const faces = {
  4: [[col, end], [1-col, end], [col, 1-end], [1-col, 1-end]]
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
