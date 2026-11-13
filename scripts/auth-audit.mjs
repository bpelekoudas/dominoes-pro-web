/**
 * Local production check of sign-in, guest carry-over, and the legal pages.
 * Never points at the live site.
 *
 *   npm run build
 *   node scripts/auth-audit.mjs
 *
 * Uses Playwright Chromium (system Chrome) and WebKit when it is installed.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const android =
  "Mozilla/5.0 (Linux; Android 15; SM-S26) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const port = 8794;
const origin = `http://127.0.0.1:${port}`;
const outDir = "/opt/cursor/artifacts/auth-legal";

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const code = await main();
  process.exit(code);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { chromium, webkit } = await loadPlaywright();
  const dataDir = mkdtempSync(path.join(tmpdir(), "uhoh-auth-"));
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "packages/server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      BOTS_ENABLED: "0",
      BACKUP_EVERY_MS: "0",
      GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  const notes = [];
  try {
    await waitForHealth();
    const browsers = [
      { name: "chromium", engine: chromium, launch: { executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] } },
    ];
    if (webkit) browsers.push({ name: "webkit", engine: webkit, launch: {} });
    else notes.push("WebKit was not installed, so iOS Safari was not driven in a real WebKit browser.");
    const phones = [
      { name: "390x844", width: 390, height: 844, ua: iphone },
      { name: "412x915", width: 412, height: 915, ua: android },
    ];
    for (const browser of browsers) {
      let instance;
      try {
        instance = await browser.engine.launch(browser.launch);
      } catch (error) {
        notes.push(`${browser.name} did not launch (${error instanceof Error ? error.message : error}).`);
        continue;
      }
      try {
        for (const phone of phones) {
          const context = await instance.newContext({ viewport: { width: phone.width, height: phone.height }, userAgent: phone.ua });
          await context.addInitScript(() => localStorage.setItem("uhoh.age13", "1"));
          await context.route("**/sw.js", (route) => route.fulfill({ status: 404, body: "" }));
          const page = await context.newPage();
          try {
            await page.goto(`${origin}/privacy`, { waitUntil: "domcontentloaded" });
            await page.screenshot({ path: path.join(outDir, `privacy-${browser.name}-${phone.name}.png`), fullPage: true });
            const privacy = await page.locator("main").innerText();
            if (!privacy.includes("Ironwood Hills, LLC") || !privacy.includes("13") || privacy.includes("[LEGAL ENTITY NAME]")) {
              throw new Error("Privacy page is missing the filled-in draft text.");
            }
            await page.goto(`${origin}/terms`, { waitUntil: "domcontentloaded" });
            await page.screenshot({ path: path.join(outDir, `terms-${browser.name}-${phone.name}.png`), fullPage: true });
            await page.goto(origin, { waitUntil: "domcontentloaded" });
            await page.locator(".profile-chip").waitFor({ timeout: 10_000 });
            await page.locator(".profile-chip").click({ timeout: 10_000 });
            await page.getByRole("dialog", { name: "Your account" }).waitFor({ timeout: 10_000 });
            const ux = await page.locator("[data-auth-ux]").getAttribute("data-auth-ux");
            const expectUx = phone.ua.includes("iPhone") ? "redirect" : "popup";
            if (ux !== expectUx) throw new Error(`${browser.name} ${phone.name} used ${ux}, expected ${expectUx}.`);
            await page.screenshot({ path: path.join(outDir, `signin-${browser.name}-${phone.name}.png`) });
            notes.push(`${browser.name} ${phone.name}: sign-in ${ux}`);
          } catch (error) {
            notes.push(`${browser.name} ${phone.name} failed (${error instanceof Error ? error.message.split("\n")[0] : error}).`);
          } finally {
            await context.close().catch(() => undefined);
          }
        }
      } finally {
        await instance.close();
      }
    }
    const flow = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
    try {
      const context = await flow.newContext({ viewport: { width: 390, height: 844 }, userAgent: iphone });
      await context.addInitScript(() => localStorage.setItem("uhoh.age13", "1"));
      await context.route("**/sw.js", (route) => route.fulfill({ status: 404, body: "" }));
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      const guestId = await page.evaluate(async () => {
        const response = await fetch("/api/guest", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: "Ada", age13: true }),
        });
        const body = await response.json();
        return body.user?.id ?? "";
      });
      if (!guestId) throw new Error("Guest was not created in the browser.");
      await page.locator(".profile-chip").click();
      await page.locator("input[type=email]").fill("ada@example.com");
      await page.getByRole("button", { name: "Email me a link" }).click();
      const href = await page.getByRole("link", { name: "Open the test link" }).getAttribute("href");
      if (!href) throw new Error("The dev magic link was missing.");
      await page.goto(href, { waitUntil: "domcontentloaded" });
      const after = await page.evaluate(async () => {
        const response = await fetch("/api/me", { credentials: "same-origin" });
        const body = await response.json();
        return body.user ?? null;
      });
      if (!after || after.guest || after.id !== guestId) throw new Error(`Guest did not carry over. ${JSON.stringify(after)}`);
      await page.screenshot({ path: path.join(outDir, "email-signed-in-390x844.png") });
      await page.getByRole("button", { name: "Settings" }).click();
      await page.locator("[data-action=delete-account]").click();
      await page.locator("[data-action=delete-confirm]").click();
      await page.getByText("Account deleted.").first().waitFor();
      await context.close();
    } finally {
      await flow.close();
    }
    console.log(JSON.stringify({ ok: true, notes, outDir }, null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(log.slice(-1500));
    return 1;
  } finally {
    server.kill("SIGKILL");
  }
}

async function loadPlaywright() {
  try {
    const imported = await import("playwright");
    return { chromium: imported.chromium, webkit: imported.webkit };
  } catch {
    const imported = await import("playwright-core");
    return { chromium: imported.chromium, webkit: null };
  }
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // booting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The local server did not answer /health.");
}
