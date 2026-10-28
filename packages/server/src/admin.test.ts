import { describe, expect, it } from "vitest";
import { Accounts, SESSION_COOKIE } from "./accounts.js";
import { adminEmails, clearAdminCache, emailIsAdmin } from "./admin.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";

const SECRET = "test-secret-value-16";

function cookiePair(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : (header ?? "");
  return raw.split(";")[0] ?? "";
}

describe("admin allowlist", () => {
  it("uses the partner emails when the env var is empty, and replaces them when it is set", () => {
    const defaults = adminEmails({});
    for (const email of [
      "bpelekoudas@gmail.com",
      "uhohdominoes@gmail.com",
      "gipsondre@gmail.com",
      "justinmmichaels@gmail.com",
      "kyleedrington@gmail.com",
    ]) {
      expect(defaults.has(email)).toBe(true);
    }
    expect(emailIsAdmin("Gipsondre@gmail.com", {})).toBe(true);
    expect(emailIsAdmin("bpelekoudas@gmail.com", { ADMIN_EMAILS: "only@example.com" })).toBe(false);
    expect(emailIsAdmin("Only@example.com", { ADMIN_EMAILS: "only@example.com" })).toBe(true);
  });

  it("hides the numbers from everyone who is not on the list", async () => {
    const previous = process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAILS;
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const { app } = await createApp({ store, accounts, serveWeb: false });
    try {
      const signedOut = await app.inject({ method: "GET", url: "/api/admin/stats" });
      expect(signedOut.statusCode).toBe(401);
      expect(signedOut.json()).toEqual({ error: "Sign in to see this." });

      const page = await app.inject({ method: "GET", url: "/admin" });
      expect(page.statusCode).toBe(401);
      expect(page.body).toContain("Sign in");
      expect(page.body).not.toContain("Bones earned");

      const young = await app.inject({ method: "POST", url: "/api/guest", payload: { displayName: "Ada" } });
      expect(young.statusCode).toBe(400);

      const created = await app.inject({
        method: "POST",
        url: "/api/guest",
        payload: { displayName: "Ada", age13: true },
      });
      const pair = cookiePair(created.headers["set-cookie"]);
      expect(pair.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
      const userId = created.json().user.id as string;
      store.db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run("Secret Guest", userId);

      clearAdminCache();
      const stranger = await app.inject({ method: "GET", url: "/api/admin/stats", headers: { cookie: pair } });
      expect(stranger.statusCode).toBe(404);
      expect(JSON.stringify(stranger.json())).not.toContain("Secret Guest");
      const strangerPage = await app.inject({ method: "GET", url: "/admin", headers: { cookie: pair } });
      expect(strangerPage.statusCode).toBe(404);

      store.insertIdentity({
        id: "id-admin",
        user_id: userId,
        provider: "google",
        provider_subject: "bryan",
        email: "BPelekoudas@gmail.com",
        created_at: new Date().toISOString(),
      });
      store.db.prepare(`UPDATE users SET is_guest = 0, age_ok = 1, display_name = ? WHERE id = ?`).run("Bryan", userId);
      clearAdminCache();
      const allowed = await app.inject({ method: "GET", url: "/api/admin/stats", headers: { cookie: pair } });
      expect(allowed.statusCode).toBe(200);
      const body = allowed.json();
      expect(body.players.accounts).toBeGreaterThan(0);
      expect(body.players.recent).toContain("Bryan");
      expect(body.players.recent).not.toContain("Secret Guest");
      expect(body.safety.ageBlocked).toBeGreaterThan(0);
      expect(body.economy.shopMode).not.toBe("LIVE");
      expect(JSON.stringify(body)).not.toContain("@");
      expect(JSON.stringify(body)).not.toContain("sk_");

      const dash = await app.inject({ method: "GET", url: "/admin", headers: { cookie: pair } });
      expect(dash.statusCode).toBe(200);
      expect(dash.body).toContain("Refresh");
      expect(dash.body).not.toContain("Bryan");
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previous;
      clearAdminCache();
      await app.close();
    }
  });
});
