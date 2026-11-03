import { describe, expect, it } from "vitest";
import { Accounts, SESSION_COOKIE } from "./accounts.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";

const SECRET = "test-secret-value-16";

function cookiePair(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : (header ?? "");
  return raw.split(";")[0] ?? "";
}

describe("public player card", () => {
  it("shows public stats and hides email, sign-in, and block lists", async () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const { app } = await createApp({ store, accounts, serveWeb: false });
    const created = await app.inject({ method: "POST", url: "/api/guest", payload: { displayName: "Ada", age13: true } });
    const userId = created.json().user.id as string;
    const cookie = cookiePair(created.headers["set-cookie"]);
    store.insertIdentity({
      id: "id-email",
      user_id: userId,
      provider: "email",
      provider_subject: "ada@example.com",
      email: "ada@example.com",
      created_at: new Date().toISOString(),
    });
    store.blockUser(userId, "00000000-0000-4000-8000-000000000001", new Date().toISOString());

    const card = await app.inject({ method: "GET", url: `/api/card/${userId}` });
    expect(card.statusCode).toBe(200);
    const body = card.json() as { card: Record<string, unknown> };
    expect(body.card.kind).toBe("account");
    expect(body.card.name).toBe("Ada");
    expect(body.card.guest).toBe(true);
    expect(body.card.rating).toBe(1200);
    expect(body.card.provisional).toBe(true);
    expect(body.card.gamesPlayed).toBe(0);
    expect(body.card.rankedWins).toBe(0);
    expect(body.card.rankedLosses).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(/ada@example.com|email|provider|blocked|ageOk/);
    expect(cookie.startsWith(SESSION_COOKIE)).toBe(true);

    const missing = await app.inject({ method: "GET", url: "/api/card/not-an-id" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("slows a flood of lookups", async () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const { app } = await createApp({ store, accounts, serveWeb: false });
    let limited = 0;
    for (let index = 0; index < 65; index += 1) {
      const response = await app.inject({ method: "GET", url: "/api/card/00000000-0000-4000-8000-000000000099" });
      if (response.statusCode === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    await app.close();
  });
});
