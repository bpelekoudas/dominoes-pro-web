import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stampShell } from "./build-stamp";

const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const client = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");

describe("a returning phone picks up a new deploy", () => {
  it("changes the cache name with the build so the worker file itself changes", () => {
    expect(worker).toContain('const CACHE = "uhoh-shell-__BUILD_SHA__"');
    expect(worker).toContain("self.__previous");
    expect(worker).toContain("caches.delete");
    expect(worker).toContain("self.skipWaiting()");
    expect(worker).toContain("self.clients.claim()");
    expect(worker).toContain('cache: "no-store"');
    expect(worker).toContain("if (!response.ok)");
    expect(worker).toContain("client.navigate(client.url)");
    expect(worker).toContain('fetch(request, { cache: "no-store" })');
    expect(worker).toContain('pathname.startsWith("/assets/")');
    expect(worker).toContain("if (cached) return cached;");
    const first = stampShell(worker, "aaaaaaa");
    const second = stampShell(worker, "bbbbbbb");
    expect(first).toContain("uhoh-shell-aaaaaaa");
    expect(second).toContain("uhoh-shell-bbbbbbb");
    expect(first).not.toContain("__BUILD_SHA__");
    expect(first).not.toEqual(second);
  });

  it("keeps hashed files for offline play and reloads only a phone that already had the app", () => {
    expect(worker).toContain("if (previous.length > 0)");
    expect(worker).toContain("Keep the shell this phone already has");
    expect(client).toContain('updateViaCache: "none"');
    expect(client).toContain("hadController");
    expect(client).toContain("controllerchange");
    expect(client).toContain("registration.update()");
    expect(client).toContain("!navigator.onLine");
  });

  it("moves an open tab from build A to build B, and still serves the shell offline", async () => {
    const shell = (sha: string) => stampShell(worker, sha);
    let build: "A" | "B" = "A";
    const pages = {
      A: {
        html: pageHtml("A", "a.js"),
        sw: shell("aaaaaaa"),
        assetPath: "/assets/a.js",
        asset: "self.__asset='a'",
      },
      B: {
        html: pageHtml("B", "b.js"),
        sw: shell("bbbbbbb"),
        assetPath: "/assets/b.js",
        asset: "self.__asset='b'",
      },
    };
    const server = await listen((req, res) => {
      const current = pages[build];
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const headers = { "cache-control": "no-store" };
      if (url.pathname === "/sw.js") {
        res.writeHead(200, { ...headers, "content-type": "application/javascript" });
        res.end(current.sw);
        return;
      }
      if (url.pathname === current.assetPath) {
        res.writeHead(200, { ...headers, "content-type": "application/javascript" });
        res.end(current.asset);
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { ...headers, "content-type": "text/html" });
        res.end(current.html);
        return;
      }
      res.writeHead(404, headers);
      res.end("missing");
    });
    const port = (server.address() as { port: number }).port;
    const chrome = await launchChrome();
    try {
      const page = await connectPage(chrome.port);
      await page.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
      await waitFor(async () => (await evalPage(page, "document.querySelector('#build')?.textContent")) === "A");
      await waitFor(async () => Boolean(await evalPage(page, "Boolean(navigator.serviceWorker.controller)")));
      await evalPage(page, "location.reload()");
      await waitFor(async () => (await evalPage(page, "document.querySelector('#build')?.textContent")) === "A");
      await waitFor(async () => {
        const cached = await evalPage(
          page,
          `caches.open('uhoh-shell-aaaaaaa').then((cache) => cache.match('/assets/a.js').then(Boolean))`,
        );
        return cached === true;
      });
      build = "B";
      await evalPage(page, "navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update())");
      await waitFor(async () => (await evalPage(page, "document.querySelector('#build')?.textContent")) === "B", 20_000);
      const after = (await evalPage(
        page,
        `(async () => {
          const keys = await caches.keys();
          const oldAsset = await caches.match('/assets/a.js');
          return { keys, oldAsset: Boolean(oldAsset) };
        })()`,
      )) as { keys: string[]; oldAsset: boolean };
      expect(after.keys).toEqual(["uhoh-shell-bbbbbbb"]);
      expect(after.oldAsset).toBe(false);
      await page.send("Network.enable");
      await page.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      await evalPage(page, "location.reload()");
      await waitFor(async () => (await evalPage(page, "document.querySelector('#build')?.textContent")) === "B", 15_000);
    } finally {
      chrome.kill();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);
});

function pageHtml(build: string, asset: string): string {
  return `<!doctype html><html><head><title>${build}</title></head><body><h1 id="build">${build}</h1>
<script src="/assets/${asset}"></script>
<script>
const had = Boolean(navigator.serviceWorker.controller);
if (had) navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
</script></body></html>`;
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Server> {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function launchChrome(): Promise<{ port: number; kill: () => void }> {
  const { spawn } = await import("node:child_process");
  const port = 9400 + Math.floor(Math.random() * 400);
  const child = spawn(
    "/usr/bin/google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/sw-chrome-${port}`,
      "--no-first-run",
      "--window-size=412,891",
    ],
    { stdio: "ignore" },
  );
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (version.ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return {
    port,
    kill: () => child.kill("SIGKILL"),
  };
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
  await send("Network.enable");
  return { send };
}

async function evalPage(page: { send: (method: string, params?: object) => Promise<unknown> }, expression: string) {
  const result = (await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "page error");
  return result.result?.value;
}

async function waitFor(check: () => Promise<boolean>, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await check()) return;
    } catch {
      // The page is reloading between builds.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("timed out waiting for the page");
}
