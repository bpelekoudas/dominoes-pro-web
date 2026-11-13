import { describe, expect, it } from "vitest";
import { Accounts, BRIDGE_COOKIE, SESSION_COOKIE, bridgeCookie } from "./accounts.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";

const SECRET = "test-secret-value-16";

function cookiePair(header: string | string[] | undefined, name: string): string {
  const lines = Array.isArray(header) ? header : header ? [header] : [];
  for (const line of lines) {
    const pair = line.split(";")[0] ?? "";
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return "";
}

describe("redirect sign-in", () => {
  it("sends a https bridge cookie that a cross-site post can carry", () => {
    expect(bridgeCookie("abc", true)).toContain("SameSite=None");
    expect(bridgeCookie("abc", true)).toContain("Secure");
    expect(bridgeCookie("abc", false)).toContain("SameSite=Lax");
    expect(bridgeCookie("abc", false)).not.toContain("SameSite=None");
  });

  it("rejects a Google redirect whose csrf cookie does not match", async () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET, googleClientId: "google-client" });
    const { app } = await createApp({ store, accounts, serveWeb: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/google/redirect",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: "g_csrf_token=one" },
        payload: "credential=fake&g_csrf_token=two",
      });
      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toContain("auth=error");
    } finally {
      await app.close();
    }
  });

  it("keeps the guest when Google redirects back with the bridge cookie", async () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, {
      secret: SECRET,
      googleClientId: "google-client",
      verifyGoogle: async () => ({ sub: "google-sub-1", email: "ada@example.com" }),
    });
    const { app } = await createApp({ store, accounts, serveWeb: false });
    try {
      const guest = await app.inject({
        method: "POST",
        url: "/api/guest",
        payload: { displayName: "Ada", age13: true },
      });
      expect(guest.statusCode).toBe(200);
      const session = cookiePair(guest.headers["set-cookie"], SESSION_COOKIE);
      const prepared = await app.inject({
        method: "POST",
        url: "/api/auth/prepare-redirect",
        headers: { cookie: session },
      });
      expect(prepared.statusCode).toBe(200);
      const bridge = cookiePair(prepared.headers["set-cookie"], BRIDGE_COOKIE);
      expect(bridge.startsWith(`${BRIDGE_COOKIE}=`)).toBe(true);
      const landed = await app.inject({
        method: "POST",
        url: "/api/auth/google/redirect",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `g_csrf_token=match; ${bridge}`,
        },
        payload: "credential=fake-token&g_csrf_token=match",
      });
      expect(landed.statusCode).toBe(303);
      expect(landed.headers.location).toBe("/");
      const signedIn = cookiePair(landed.headers["set-cookie"], SESSION_COOKIE);
      const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: signedIn } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.id).toBe(guest.json().user.id);
      expect(me.json().user.guest).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("rejects an Apple redirect with the wrong state", async () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, {
      secret: SECRET,
      apple: { clientId: "app.example", teamId: "TEAM", keyId: "KEY", privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" },
    });
    const { app } = await createApp({ store, accounts, serveWeb: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/apple/redirect",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: "uhoh_apple_state=one" },
        payload: "id_token=fake&state=two",
      });
      expect(response.statusCode).toBe(303);
      expect(String(response.headers.location)).toContain("auth=error");
    } finally {
      await app.close();
    }
  });
});
