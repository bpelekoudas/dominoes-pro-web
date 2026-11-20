import { describe, expect, it } from "vitest";
import { Accounts } from "./accounts.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";
import { cleanPulseNote, pulseName } from "./pulse.js";

describe("pulse", () => {
  it("names the four counts and strips an email from a crash note", () => {
    expect(pulseName("home")).toBe("home");
    expect(pulseName("share")).toBe("share");
    expect(pulseName("rank")).toBeNull();
    expect(cleanPulseNote("broke for ada@example.com")).toBe("broke for [email]");
  });

  it("counts a visit and stores a crash without the email", async () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: "test-secret-value-16" });
    const { app } = await createApp({ store, accounts, serveWeb: false });
    const day = new Date().toISOString().slice(0, 10);

    const home = await app.inject({ method: "POST", url: "/api/pulse", payload: { name: "home" } });
    expect(home.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: "/api/pulse", payload: { name: "home" } });
    expect(again.statusCode).toBe(200);
    expect(store.pulseCounts()).toEqual([{ day, name: "home", n: 2 }]);

    const crash = await app.inject({
      method: "POST",
      url: "/api/pulse",
      payload: { name: "error", message: "failed for ada@example.com" },
    });
    expect(crash.statusCode).toBe(200);
    expect(store.clientErrors().map((row) => row.message)).toEqual(["failed for [email]"]);

    const refused = await app.inject({ method: "POST", url: "/api/pulse", payload: { name: "rank" } });
    expect(refused.statusCode).toBe(400);

    const privacy = await app.inject({ method: "GET", url: "/privacy" });
    expect(privacy.body).toContain("third-party tracker");
    expect(privacy.body).toContain("nickname");
    await app.close();
  });
});