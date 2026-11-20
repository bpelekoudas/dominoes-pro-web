import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pipCenters } from "./pips.js";
import { SPINNER_DOTS, TILE_SKINS, dotContrast, type TileSkin } from "./spinner-dot.js";

describe("spinner center dot", () => {
  it("paints a contrasting dot for every skin", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const painted: Record<string, { fill: string; ring: string }> = {};
    for (const match of css.matchAll(/\[data-tile-skin="([a-z]+)"\]\s*\{\s*--spinner-dot:\s*(#[0-9a-fA-F]{6});\s*--spinner-ring:\s*(#[0-9a-fA-F]{6});\s*\}/g)) {
      painted[match[1]!] = { fill: match[2]!.toLowerCase(), ring: match[3]!.toLowerCase() };
    }
    expect(Object.keys(painted).sort()).toEqual([...TILE_SKINS].sort());
    for (const skin of TILE_SKINS) {
      const spec = SPINNER_DOTS[skin];
      expect(painted[skin], skin).toEqual({ fill: spec.fill, ring: spec.ring });
      expect(dotContrast(spec, spec.pip), `${skin} pip`).toBeGreaterThanOrEqual(3);
      for (const face of spec.face) {
        expect(dotContrast(spec, face), `${skin} face ${face}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("draws one center dot on the spinner and keeps it off the pips", async () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = fixture(css);
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
      const measured = (await waitForMeasure(page)) as Measure;
      expect(measured.boardDots, "board dots").toBe(1);
      expect(measured.handDots, "hand dots").toBe(0);
      expect(measured.otherDots, "other doubles").toBe(0);
      expect(measured.spinnerDots, "the spinner").toBe(1);
      expect(Math.abs(measured.centerDx), "center x").toBeLessThan(1);
      expect(Math.abs(measured.centerDy), "center y").toBeLessThan(1);
      expect(Math.abs(measured.dotW - measured.dotH), "circle").toBeLessThan(0.6);
      for (const item of measured.tiles) {
        expect(item.dots, item.id).toBe(1);
        expect(Math.abs(item.w - item.h), `${item.id} circle`).toBeLessThan(0.6);
        expect(item.scale, `${item.id} size`).toBeGreaterThan(0.13);
        expect(item.scale, `${item.id} size`).toBeLessThan(0.19);
        expect(Math.abs(item.dx), `${item.id} x`).toBeLessThan(1);
        expect(Math.abs(item.dy), `${item.id} y`).toBeLessThan(1);
        if (item.value > 0) expect(item.gap, `${item.id} pip gap`).toBeGreaterThan(0.4);
        expect(item.fill, `${item.id} fill`).toBe(rgb(SPINNER_DOTS[item.skin].fill));
        expect(item.ring, `${item.id} ring`).toContain(rgb(SPINNER_DOTS[item.skin].ring));
      }
      expect(measured.tiles.length).toBe(TILE_SKINS.length * 7 * 2);
    } finally {
      chrome.kill();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 40_000);
});

interface Measure {
  boardDots: number;
  handDots: number;
  otherDots: number;
  spinnerDots: number;
  centerDx: number;
  centerDy: number;
  dotW: number;
  dotH: number;
  tiles: Array<{
    id: string;
    skin: TileSkin;
    value: number;
    dots: number;
    w: number;
    h: number;
    scale: number;
    dx: number;
    dy: number;
    gap: number;
    fill: string;
    ring: string;
  }>;
}

function rgb(hex: string): string {
  const body = hex.replace("#", "");
  const parts = [0, 2, 4].map((index) => parseInt(body.slice(index, index + 2), 16));
  return `rgb(${parts.join(", ")})`;
}

function fixture(css: string): string {
  const dots: Record<string, Array<{ x: number; y: number }>> = {};
  for (const value of [0, 1, 2, 3, 4, 5, 6]) {
    dots[`${value}-0`] = pipCenters(value, 0);
    dots[`${value}-90`] = pipCenters(value, 90);
  }
  return `<!doctype html><html><head><style>${css}</style>
<style>body{margin:0;background:#16301c}.board{position:relative;width:390px;height:420px}.board-tile{position:absolute}.hand-tile{position:relative}</style>
</head><body><div id="root"></div><script>
const dots = ${JSON.stringify(dots)};
const skins = ${JSON.stringify(TILE_SKINS)};
function half(key) {
  const span = document.createElement("span");
  span.className = "half";
  for (const pip of dots[key]) {
    const mark = document.createElement("i");
    mark.style.left = (pip.x * 100) + "%";
    mark.style.top = (pip.y * 100) + "%";
    span.appendChild(mark);
  }
  return span;
}
function domino(value, turned, spinner) {
  const node = document.createElement("span");
  node.className = "domino" + (turned ? " horizontal" : "") + (spinner ? " spinner" : "");
  const rot = turned ? "90" : "0";
  node.appendChild(half(value + "-" + rot));
  const split = document.createElement("span");
  split.className = "domino-split";
  node.appendChild(split);
  node.appendChild(half(value + "-" + rot));
  if (spinner) {
    const dot = document.createElement("i");
    dot.className = "spinner-dot";
    dot.setAttribute("data-spinner-dot", "");
    node.appendChild(dot);
  }
  return node;
}
const root = document.getElementById("root");
const board = document.createElement("div");
board.className = "board";
board.setAttribute("data-tile-skin", "ivory");
board.dataset.role = "board";
function place(role, value, left, top, turned, spinner, hand) {
  const wrap = document.createElement(hand ? "button" : "div");
  wrap.className = hand ? "hand-tile playable" : "board-tile";
  wrap.dataset.role = role;
  const short = 48, long = 96;
  wrap.style.left = left + "px";
  wrap.style.top = top + "px";
  wrap.style.width = (turned ? long : short) + "px";
  wrap.style.height = (turned ? short : long) + "px";
  if (hand) wrap.style.setProperty("--hand-tile", short + "px");
  const face = domino(value, turned, spinner);
  face.style.width = "100%";
  face.style.height = "100%";
  wrap.appendChild(face);
  board.appendChild(wrap);
}
place("spinner", 6, 40, 40, false, true, false);
place("double", 5, 140, 40, false, false, false);
place("hand", 4, 240, 40, false, false, true);
root.appendChild(board);
for (const skin of skins) {
  for (const value of [0, 1, 2, 3, 4, 5, 6]) {
    for (const turned of [false, true]) {
      const host = document.createElement("div");
      host.setAttribute("data-tile-skin", skin);
      host.dataset.id = skin + "-" + value + "-" + (turned ? "length" : "cross");
      host.dataset.skin = skin;
      host.dataset.value = String(value);
      const short = value % 2 === 0 ? 56 : 30;
      const wrap = document.createElement("div");
      wrap.className = "board-tile";
      wrap.style.position = "relative";
      wrap.style.width = (turned ? short * 2 : short) + "px";
      wrap.style.height = (turned ? short : short * 2) + "px";
      const face = domino(value, turned, true);
      face.style.position = "absolute";
      face.style.inset = "0";
      face.style.width = "auto";
      face.style.height = "auto";
      wrap.appendChild(face);
      host.appendChild(wrap);
      root.appendChild(host);
    }
  }
}
requestAnimationFrame(() => requestAnimationFrame(() => {
  const gapOf = (dot, pip) => {
    const overlapX = Math.min(dot.right, pip.right) - Math.max(dot.left, pip.left);
    const overlapY = Math.min(dot.bottom, pip.bottom) - Math.max(dot.top, pip.top);
    if (overlapX > 0 && overlapY > 0) return -Math.min(overlapX, overlapY);
    const dx = Math.max(dot.left - pip.right, pip.left - dot.right, 0);
    const dy = Math.max(dot.top - pip.bottom, pip.top - dot.bottom, 0);
    return Math.hypot(dx, dy);
  };
  const spinner = board.querySelector("[data-role=spinner] .spinner-dot");
  const spinnerBox = spinner.getBoundingClientRect();
  const spinnerTile = board.querySelector("[data-role=spinner] .domino").getBoundingClientRect();
  const tiles = [];
  for (const host of root.querySelectorAll("[data-skin]")) {
    const face = host.querySelector(".domino");
    const dot = face.querySelector("[data-spinner-dot]");
    const box = face.getBoundingClientRect();
    const mark = dot.getBoundingClientRect();
    let gap = 99;
    for (const pip of face.querySelectorAll(".half i")) gap = Math.min(gap, gapOf(mark, pip.getBoundingClientRect()));
    tiles.push({
      id: host.dataset.id,
      skin: host.dataset.skin,
      value: Number(host.dataset.value),
      dots: face.querySelectorAll("[data-spinner-dot]").length,
      w: mark.width,
      h: mark.height,
      scale: mark.width / Math.min(box.width, box.height),
      dx: (mark.left + mark.right) / 2 - (box.left + box.right) / 2,
      dy: (mark.top + mark.bottom) / 2 - (box.top + box.bottom) / 2,
      gap,
      fill: getComputedStyle(dot).backgroundColor,
      ring: getComputedStyle(dot).boxShadow,
    });
  }
  document.body.dataset.ready = JSON.stringify({
    boardDots: board.querySelectorAll("[data-spinner-dot]").length,
    handDots: board.querySelectorAll(".hand-tile [data-spinner-dot]").length,
    otherDots: board.querySelector("[data-role=double]").querySelectorAll("[data-spinner-dot]").length,
    spinnerDots: board.querySelector("[data-role=spinner]").querySelectorAll("[data-spinner-dot]").length,
    centerDx: (spinnerBox.left + spinnerBox.right) / 2 - (spinnerTile.left + spinnerTile.right) / 2,
    centerDy: (spinnerBox.top + spinnerBox.bottom) / 2 - (spinnerTile.top + spinnerTile.bottom) / 2,
    dotW: spinnerBox.width,
    dotH: spinnerBox.height,
    tiles,
  });
}));
</script></body></html>`;
}

async function launchChrome(): Promise<{ port: number; kill: () => void }> {
  const { spawn } = await import("node:child_process");
  const port = 9700 + Math.floor(Math.random() * 200);
  const child = spawn(
    "/usr/bin/google-chrome",
    ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/spinner-dot-${port}`, "--no-first-run", "--window-size=900,700"],
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
    if (raw) return JSON.parse(raw) as Measure;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("spinner dot measurement did not render");
}
