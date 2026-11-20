/**
 * The matched half has to sit against the tile it was played on.
 * Playwright's WebKit is the check we can run here. iOS Safari once painted a
 * horizontal flex row backwards; the domino is a grid now so the first half
 * stays on the left, or on the top.
 *
 * Skips when playwright-core or the WebKit browser is not installed
 * (`npx playwright-core install webkit`).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";

const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

const css = readFileSync(new URL("../packages/web/src/styles.css", import.meta.url), "utf8");

function half(value) {
  return `<span class="half"><b class="pip-num">${value}</b></span>`;
}

function tile(id, a, b, orientation, style) {
  return `<div class="board-tile" data-id="${id}" style="position:absolute;${style}"><span class="domino ${orientation}">${half(a)}<span class="domino-split"></span>${half(b)}</span></div>`;
}

const html = `<!doctype html>
<meta name="viewport" content="width=390">
<style>${css}</style>
<div data-tile-skin="ivory">
  ${tile("5-5", 5, 5, "vertical spinner", "left:200px;top:180px;width:40px;height:80px")}
  ${tile("0-5", 0, 5, "horizontal", "left:112px;top:200px;width:80px;height:40px")}
  ${tile("1-5", 5, 1, "horizontal", "left:248px;top:200px;width:80px;height:40px")}
  ${tile("5-6", 6, 5, "vertical", "left:200px;top:92px;width:40px;height:80px")}
  ${tile("3-5", 5, 3, "vertical", "left:200px;top:268px;width:40px;height:80px")}
  ${tile("0-2", 2, 0, "horizontal", "left:24px;top:200px;width:80px;height:40px")}
  ${tile("2-3", 3, 2, "horizontal", "left:-64px;top:200px;width:80px;height:40px")}
  ${tile("3-4", 3, 4, "vertical", "left:-64px;top:248px;width:40px;height:80px")}
</div>`;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("webkit puts the matched half against the tile it joins", async (t) => {
  let playwright;
  try {
    playwright = await import("playwright-core");
  } catch {
    t.skip("playwright-core is not installed");
    return;
  }
  let browser;
  try {
    browser = await playwright.webkit.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    t.skip(`WebKit did not launch (${message.split("\n")[0]})`);
    return;
  }
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });
  const port = await listen(server);
  try {
    const page = await browser.newPage(IPHONE);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    const joins = await page.evaluate(() => {
      const box = (id) => document.querySelector(`[data-id="${id}"]`).getBoundingClientRect();
      const closer = (id, otherId) => {
        const other = box(otherId);
        const cx = other.left + other.width / 2;
        const cy = other.top + other.height / 2;
        return [...document.querySelector(`[data-id="${id}"]`).querySelectorAll(".half")]
          .map((half) => {
            const rect = half.getBoundingClientRect();
            return {
              n: half.querySelector(".pip-num").textContent,
              d: Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy),
            };
          })
          .sort((a, b) => a.d - b.d)[0].n;
      };
      return {
        west: closer("0-5", "5-5"),
        east: closer("1-5", "5-5"),
        north: closer("5-6", "5-5"),
        south: closer("3-5", "5-5"),
        follow: closer("0-2", "0-5"),
        turn: closer("3-4", "2-3"),
      };
    });
    assert.equal(joins.west, "5", "the west 5 touches the spinner");
    assert.equal(joins.east, "5", "the east 5 touches the spinner");
    assert.equal(joins.north, "5", "the north 5 touches the spinner");
    assert.equal(joins.south, "5", "the south 5 touches the spinner");
    assert.equal(joins.follow, "0", "the following 0 touches the 0");
    assert.equal(joins.turn, "3", "the turned 3 touches the 3");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
