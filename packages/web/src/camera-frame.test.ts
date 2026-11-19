import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Headless Chrome with the CPU slowed 4x. A glide may only write one transform,
 * so no frame during the move should take longer than 24ms.
 */
describe("camera frame time", () => {
  it("keeps every glide frame under 24ms at 4x CPU throttle", async () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = frameFixture(css);
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
      const readyAt = Date.now();
      let started = false;
      while (Date.now() - readyAt < 8_000) {
        const probe = (await page.send("Runtime.evaluate", {
          expression: "typeof window.__start",
          returnByValue: true,
        })) as { result?: { value?: string } };
        if (probe.result?.value === "function") {
          started = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!started) throw new Error("glide page did not load");
      await page.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.send("Runtime.evaluate", { expression: "window.__start()", returnByValue: true });
      const frames = (await waitForFrames(page)) as number[];
      const sorted = [...frames].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))] ?? 0;
      const max = sorted[sorted.length - 1] ?? 0;
      console.log(`camera frames=${frames.length} p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`);
      expect(frames.length, "glide frames").toBeGreaterThan(30);
      expect(max, `p95 ${p95.toFixed(2)}ms max ${max.toFixed(2)}ms`).toBeLessThanOrEqual(24);
    } finally {
      chrome.kill();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 40_000);
});

function frameFixture(css: string): string {
  return `<!doctype html><html><head><style>${css}</style>
<style>html,body{margin:0;background:#16301c}.felt{position:relative;width:904px;height:1060px;overflow:hidden}
.board-stage{position:absolute;left:452px;top:530px;width:400px;height:700px;transform-origin:0 0;will-change:transform}</style>
</head><body><div class="felt"><div class="board-stage" id="stage"></div></div><script>
const stage = document.getElementById("stage");
for (let n = 0; n < 24; n += 1) {
  const tile = document.createElement("div");
  tile.className = "board-tile";
  tile.style.position = "absolute";
  tile.style.left = (20 + (n % 6) * 60) + "px";
  tile.style.top = (20 + Math.floor(n / 6) * 120) + "px";
  tile.style.width = "48px";
  tile.style.height = "96px";
  const domino = document.createElement("span");
  domino.className = "domino";
  for (let halfIndex = 0; halfIndex < 2; halfIndex += 1) {
    const half = document.createElement("span");
    half.className = "half";
    for (let pip = 0; pip < 6; pip += 1) {
      const dot = document.createElement("i");
      dot.style.left = (pip % 2 === 0 ? 20 : 80) + "%";
      dot.style.top = (15 + Math.floor(pip / 2) * 35) + "%";
      half.appendChild(dot);
    }
    domino.appendChild(half);
  }
  tile.appendChild(domino);
  stage.appendChild(tile);
}
function ease(t) { return t * t * (3 - 2 * t); }
window.__start = () => {
  const frames = [];
  let last = 0;
  let glide = 0;
  let start = performance.now();
  const glides = 6;
  const step = (now) => {
    if (last) frames.push(now - last);
    last = now;
    const t = Math.min(1, (now - start) / 400);
    const e = ease(t);
    const scale = 1.35 + (0.62 - 1.35) * e;
    const x = -120 * e;
    const y = 70 * e;
    stage.style.transform = "translate3d(" + x + "px," + y + "px,0) scale(" + scale + ")";
    if (t < 1) requestAnimationFrame(step);
    else if (glide < glides - 1) {
      glide += 1;
      start = now;
      requestAnimationFrame(step);
    } else document.body.dataset.ready = JSON.stringify(frames);
  };
  requestAnimationFrame(step);
};
</script></body></html>`;
}

async function launchChrome(): Promise<{ port: number; kill: () => void }> {
  const { spawn } = await import("node:child_process");
  const port = 9700 + Math.floor(Math.random() * 300);
  const child = spawn(
    "/usr/bin/google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/cam-frame-${port}`,
      "--no-first-run",
      "--window-size=904,1060",
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

async function waitForFrames(page: { send: (method: string, params?: object) => Promise<unknown> }) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const result = (await page.send("Runtime.evaluate", {
      expression: "document.body.dataset.ready || ''",
      returnByValue: true,
    })) as { result?: { value?: string } };
    const raw = result.result?.value;
    if (raw) return JSON.parse(raw) as number[];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("glide frames were not recorded");
}
