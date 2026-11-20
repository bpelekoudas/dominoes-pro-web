import { describe, expect, it, beforeEach } from "vitest";
import { Accounts } from "./accounts.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";
import {
  BUGS_PER_IP_HOUR,
  BUGS_PER_PLAYER_HOUR,
  ERRORS_PER_MINUTE,
  resetOpsLimits,
} from "./ops.js";

const SECRET = "test-secret-value-16";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function cookiePair(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : (header ?? "");
  return raw.split(";")[0] ?? "";
}

async function guestApp() {
  const store = new Store(":memory:");
  const accounts = new Accounts(store, { secret: SECRET });
  const { app } = await createApp({ store, accounts, serveWeb: false });
  const created = await app.inject({
    method: "POST",
    url: "/api/guest",
    payload: { displayName: "Ada", age13: true },
  });
  return { store, app, cookie: cookiePair(created.headers["set-cookie"]), userId: created.json().user.id as string };
}

function bug(playerId: string, description = "The tile jumped off the table.") {
  return {
    description,
    playerId,
    buildSha: "abc1234",
    roomCode: "ROOM",
    seat: 0,
    tableSize: 4,
    handNumber: 2,
    userAgent: "TestPhone",
    viewport: "390x844",
    logs: ["one", "two"],
    screenshot: PNG,
  };
}

describe("bug reports and errors", () => {
  beforeEach(() => {
    resetOpsLimits();
    delete process.env.OPS_SECRET;
  });

  it("stores a report and hides it from anyone who is not an admin", async () => {
    const previousAdmins = process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAILS;
    const { store, app, cookie, userId } = await guestApp();
    try {
      const sent = await app.inject({
        method: "POST",
        url: "/api/ops/bug",
        headers: { cookie },
        payload: bug("player-1", "Broke for ada@example.com"),
      });
      expect(sent.statusCode).toBe(200);
      const listed = store.listBugReports(10);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.description).toBe("Broke for [email]");
      expect(listed[0]?.build_sha).toBe("abc1234");
      expect(listed[0]?.room_code).toBe("ROOM");
      expect(listed[0]?.seat).toBe(0);
      expect(listed[0]?.table_size).toBe(4);
      expect(listed[0]?.hand_number).toBe(2);
      expect(listed[0]?.player_id).toBe("player-1");
      expect(listed[0]?.user_id).toBe(userId);
      expect(listed[0]?.has_screenshot).toBe(1);
      expect(JSON.stringify(listed)).not.toContain("iVBORw");

      const hidden = await app.inject({ method: "GET", url: "/api/admin/ops" });
      expect(hidden.statusCode).toBe(401);

      const stranger = await app.inject({ method: "GET", url: "/api/admin/ops", headers: { cookie } });
      expect(stranger.statusCode).toBe(403);
      expect(JSON.stringify(stranger.json())).not.toContain("Broke");

      store.insertIdentity({
        id: "id-admin",
        user_id: userId,
        provider: "google",
        provider_subject: "bryan",
        email: "bpelekoudas@gmail.com",
        created_at: new Date().toISOString(),
      });
      const ops = await app.inject({ method: "GET", url: "/api/admin/ops", headers: { cookie } });
      expect(ops.statusCode).toBe(200);
      expect(ops.json().bugs[0].description).toContain("[email]");
      expect(ops.json().bugs[0].hasScreenshot).toBe(true);
      expect(JSON.stringify(ops.json())).not.toContain("iVBORw");

      const detail = await app.inject({
        method: "GET",
        url: `/api/admin/ops/bugs/${listed[0]!.id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().screenshot).toContain("data:image/png;base64,");
      expect(detail.json().logs).toEqual(["one", "two"]);
      expect(JSON.stringify(detail.json())).not.toContain("@");

      const dash = await app.inject({ method: "GET", url: "/admin", headers: { cookie } });
      expect(dash.body).toContain("Bug reports");
      expect(dash.body).toContain("/api/admin/ops");
    } finally {
      if (previousAdmins === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previousAdmins;
      await app.close();
    }
  });

  it("reads reports with OPS_SECRET and refuses a wrong secret", async () => {
    const { app } = await guestApp();
    process.env.OPS_SECRET = "shell-secret-value";
    try {
      const sent = await app.inject({ method: "POST", url: "/api/ops/bug", payload: bug("player-9") });
      expect(sent.statusCode).toBe(200);
      const wrong = await app.inject({
        method: "GET",
        url: "/api/admin/ops",
        headers: { "x-ops-secret": "nope" },
      });
      expect(wrong.statusCode).toBe(403);
      const ok = await app.inject({
        method: "GET",
        url: "/api/admin/ops",
        headers: { "x-ops-secret": "shell-secret-value" },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().bugs).toHaveLength(1);
    } finally {
      delete process.env.OPS_SECRET;
      await app.close();
    }
  });

  it("caps the picture and rate-limits reports from one seat and one address", async () => {
    const { app } = await guestApp();
    try {
      const huge = await app.inject({
        method: "POST",
        url: "/api/ops/bug",
        payload: { ...bug("player-cap"), screenshot: `data:image/png;base64,${"A".repeat(1_000_000)}` },
      });
      expect(huge.statusCode).toBe(400);
      expect(huge.json().error).toMatch(/too big/i);

      const empty = await app.inject({ method: "POST", url: "/api/ops/bug", payload: { description: "no" } });
      expect(empty.statusCode).toBe(400);

      for (let i = 0; i < BUGS_PER_PLAYER_HOUR; i += 1) {
        const sent = await app.inject({
          method: "POST",
          url: "/api/ops/bug",
          payload: bug("same-seat", `Problem number ${i} on the board.`),
        });
        expect(sent.statusCode).toBe(200);
      }
      const limited = await app.inject({
        method: "POST",
        url: "/api/ops/bug",
        payload: bug("same-seat", "One more problem on the board."),
      });
      expect(limited.statusCode).toBe(429);

      for (let i = BUGS_PER_PLAYER_HOUR; i < BUGS_PER_IP_HOUR; i += 1) {
        const sent = await app.inject({
          method: "POST",
          url: "/api/ops/bug",
          payload: bug(`seat-${i}`, `Another seat saw problem ${i} today.`),
        });
        expect(sent.statusCode).toBe(200);
      }
      const address = await app.inject({
        method: "POST",
        url: "/api/ops/bug",
        payload: bug("fresh-seat", "The address itself is out of reports."),
      });
      expect(address.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("dedupes client errors and stops a flood", async () => {
    const { store, app } = await guestApp();
    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/ops/error",
        payload: {
          kind: "window.onerror",
          message: "broke for ada@example.com",
          buildSha: "abc1234",
          roomCode: "ROOM",
          playerId: "player-1",
          stack: "Error: broke\n at play",
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().deduped).toBe(false);
      const again = await app.inject({
        method: "POST",
        url: "/api/ops/error",
        payload: {
          kind: "window.onerror",
          message: "broke for ada@example.com",
          buildSha: "abc1234",
          roomCode: "NEXT",
          playerId: "player-1",
        },
      });
      expect(again.statusCode).toBe(200);
      expect(again.json().deduped).toBe(true);
      const rows = store.listErrorEvents(10);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.n).toBe(2);
      expect(rows[0]?.message).toBe("broke for [email]");
      expect(rows[0]?.build_sha).toBe("abc1234");
      expect(rows[0]?.room_code).toBe("NEXT");
      expect(rows[0]?.kind).toBe("window.onerror");

      const odd = await app.inject({ method: "POST", url: "/api/ops/error", payload: { kind: "nope", message: "x" } });
      expect(odd.statusCode).toBe(400);

      for (let i = 0; i < ERRORS_PER_MINUTE - 2; i += 1) {
        const sent = await app.inject({
          method: "POST",
          url: "/api/ops/error",
          payload: { kind: "ws_disconnect", message: `socket closed ${i}`, buildSha: "abc1234", roomCode: "ROOM" },
        });
        expect(sent.statusCode).toBe(200);
      }
      const flooded = await app.inject({
        method: "POST",
        url: "/api/ops/error",
        payload: { kind: "ws_reconnect_fail", message: "reconnect failed", buildSha: "abc1234" },
      });
      expect(flooded.statusCode).toBe(429);

      const summary = store.errorSummarySince("2000-01-01");
      const today = summary.find((row) => row.kind === "window.onerror");
      expect(today?.n).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("records a server exception with the build and keeps /health as it was", async () => {
    const previous = process.env.BUILD_SHA;
    process.env.BUILD_SHA = "abc1234";
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const { app } = await createApp({ store, accounts, serveWeb: false, faultProbe: true });
    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ ok: true });

      const missing = await app.inject({ method: "GET", url: "/api/ops/metrics" });
      expect(missing.statusCode).toBe(401);
      process.env.OPS_SECRET = "shell-secret-value";
      const metrics = await app.inject({
        method: "GET",
        url: "/api/ops/metrics",
        headers: { "x-ops-secret": "shell-secret-value" },
      });
      expect(metrics.statusCode).toBe(200);
      expect(metrics.json().eventLoop.p95Ms).toEqual(expect.any(Number));
      expect(metrics.json().build).toBe("abc1234");

      const fault = await app.inject({ method: "GET", url: "/api/ops/test-fault" });
      expect(fault.statusCode).toBe(500);
      expect(fault.json()).toEqual({ error: "Something went wrong." });
      const rows = store.listErrorEvents(10);
      expect(rows.some((row) => row.kind === "server_exception" && row.message.includes("probe failed"))).toBe(true);
      expect(rows.some((row) => row.build_sha === "abc1234")).toBe(true);

      const quiet = new Store(":memory:");
      const quietAccounts = new Accounts(quiet, { secret: SECRET });
      const quietApp = await createApp({ store: quiet, accounts: quietAccounts, serveWeb: false });
      const absent = await quietApp.app.inject({ method: "GET", url: "/api/ops/test-fault" });
      expect(absent.statusCode).toBe(404);
      await quietApp.app.close();
    } finally {
      if (previous === undefined) delete process.env.BUILD_SHA;
      else process.env.BUILD_SHA = previous;
      delete process.env.OPS_SECRET;
      await app.close();
    }
  });

  it("drops a player's bug reports when the account is deleted", async () => {
    const { store, app, cookie, userId } = await guestApp();
    try {
      const sent = await app.inject({
        method: "POST",
        url: "/api/ops/bug",
        headers: { cookie },
        payload: bug("player-1"),
      });
      expect(sent.statusCode).toBe(200);
      expect(store.erasePersonalData(userId, new Date().toISOString())).toBe(true);
      expect(store.listBugReports(10)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
