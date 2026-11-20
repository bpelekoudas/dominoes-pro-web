import { describe, expect, it } from "vitest";
import { CATALOG, itemById } from "@uhoh/rules";
import { Accounts } from "./accounts.js";
import { createApp } from "./app.js";
import { Cosmetics } from "./cosmetics.js";
import { Store } from "./db.js";
import { emotesEnabled } from "./emotes.js";

function guest() {
  const store = new Store(":memory:");
  const accounts = new Accounts(store, { secret: "test-secret-value-16", devMagicLink: true });
  const created = accounts.createGuest("Ada", null);
  if (created.outcome !== "ok") throw new Error("guest");
  return { store, accounts, user: created.user, cosmetics: new Cosmetics(store) };
}

describe("store cosmetics", () => {
  it("gives a labeled test balance and free items, then spends Bones", () => {
    const { cosmetics, user } = guest();
    const first = cosmetics.snapshot(user.id);
    expect(first.testBalance).toBe(true);
    expect(first.bones).toBe(100_000);
    expect(first.goldBones).toBe(5_000);
    expect(first.owned).toContain("FX-001");
    expect(first.owned).toContain("CHR-015");
    expect(first.owned).not.toContain("FX-002");
    expect(first.loadout.characterId).toBe("CHR-015");
    expect(first.items.some((item) => item.id === "CHR-015")).toBe(true);

    const bought = cosmetics.buy(user.id, "FX-002", "bones");
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.snapshot.bones).toBe(90_000);
    expect(bought.snapshot.owned).toContain("FX-002");

    const worn = cosmetics.equip(user.id, "FX-002");
    expect(worn.ok).toBe(true);
    if (!worn.ok) return;
    expect(worn.snapshot.loadout.effectId).toBe("FX-002");
  });

  it("does not sell the starter, earned items, limited items, or a short balance", () => {
    const { cosmetics, user, accounts } = guest();
    expect(cosmetics.buy(user.id, "CHR-015", "bones").ok).toBe(false);
    expect(cosmetics.equip(user.id, "CHR-015").ok).toBe(true);
    expect(cosmetics.buy(user.id, "2hot4tv", "gold").ok).toBe(false);
    expect(cosmetics.buy(user.id, "CHR-006", "bones").ok).toBe(false);
    expect(cosmetics.buy(user.id, "FRM-011", "gold").ok).toBe(false);
    expect(accounts.setAvatar(user.id, "2hot4tv").outcome).toBe("ok");
    expect(accounts.setAvatar(user.id, "CHR-015").outcome).toBe("invalid");
    expect(accounts.setAvatar(user.id, "floridaman").outcome).toBe("invalid");
    const gold = cosmetics.buy(user.id, "CHR-011", "gold");
    expect(gold.ok).toBe(true);
    if (!gold.ok) return;
    expect(gold.snapshot.goldBones).toBe(4_200);
    expect(cosmetics.buy(user.id, "CHR-014", "gold").ok).toBe(true);
    expect(cosmetics.buy(user.id, "TIL-005", "gold").ok).toBe(true);
    expect(cosmetics.buy(user.id, "FX-004", "gold").ok).toBe(false);
    const equipped = cosmetics.equip(user.id, "CHR-011");
    expect(equipped.ok).toBe(true);
    expect(accounts.userFromCookieHeader(undefined)).toBeNull();
    expect(cosmetics.snapshot(user.id).loadout.characterId).toBe("CHR-011");
  });

  it("keeps emote rows in the catalog and out of a new loadout while the flag is off", () => {
    expect(emotesEnabled({})).toBe(false);
    expect(emotesEnabled({ EMOTES_ENABLED: "false" })).toBe(false);
    expect(emotesEnabled({ EMOTES_ENABLED: "true" })).toBe(true);
    expect(CATALOG.filter((item) => item.category === "emote").map((item) => item.id)).toEqual([
      "EMO-001",
      "EMO-002",
      "EMO-003",
      "EMO-004",
      "EMO-005",
      "EMO-006",
    ]);
    expect(itemById("EMO-001")).toMatchObject({ name: "Thumbs up emote", obtain: "free" });

    const { cosmetics, user, store } = guest();
    const first = cosmetics.snapshot(user.id);
    expect(first.emotesEnabled).toBe(false);
    expect(first.items.some((item) => item.category === "emote")).toBe(false);
    expect(first.items.some((item) => item.category === "trash")).toBe(true);
    expect(first.owned).not.toContain("EMO-001");
    expect(first.loadout.emoteId).toBeNull();
    expect(first.loadout.trashId).toBe("TT-001");
    expect(first.bones).toBe(100_000);

    const bought = cosmetics.buy(user.id, "EMO-002", "bones");
    expect(bought.ok).toBe(false);
    expect(cosmetics.snapshot(user.id).bones).toBe(100_000);
    expect(cosmetics.snapshot(user.id).owned).not.toContain("EMO-002");
    expect(cosmetics.buy(user.id, "EMO-004", "gold").ok).toBe(false);
    expect(cosmetics.equip(user.id, "EMO-001").ok).toBe(false);

    store.db.prepare(`INSERT INTO owned_items (user_id, item_id, acquired_at) VALUES (?, 'EMO-001', ?)`).run(user.id, new Date().toISOString());
    store.db.prepare(`UPDATE loadouts SET emote_id = 'EMO-001' WHERE user_id = ?`).run(user.id);
    const kept = cosmetics.snapshot(user.id);
    expect(kept.owned).toContain("EMO-001");
    expect(kept.loadout.emoteId).toBe("EMO-001");
    expect(kept.items.some((item) => item.id === "EMO-001")).toBe(false);
    expect(cosmetics.equip(user.id, "EMO-001").ok).toBe(false);
    expect(cosmetics.wornLines(user.id).map((line) => line.id)).toEqual(["TT-001"]);

    const trash = cosmetics.buy(user.id, "TT-004", "bones");
    expect(trash.ok).toBe(true);
    if (!trash.ok) return;
    expect(trash.snapshot.owned).toContain("TT-004");
    expect(trash.snapshot.items.some((item) => item.id === "TT-004")).toBe(true);
  });

  it("grants the starter emote again when the flag is on", () => {
    const store = new Store(":memory:");
    const now = new Date().toISOString();
    store.insertUser({
      id: "ada-on",
      display_name: "Ada",
      avatar_id: "homescreen",
      created_at: now,
      updated_at: now,
      is_guest: 1,
    });
    const cosmetics = new Cosmetics(store, () => new Date(), true);
    const snap = cosmetics.snapshot("ada-on");
    expect(snap.emotesEnabled).toBe(true);
    expect(snap.items.some((item) => item.id === "EMO-001")).toBe(true);
    expect(snap.owned).toContain("EMO-001");
    expect(snap.loadout.emoteId).toBe("EMO-001");
    const bought = cosmetics.buy("ada-on", "EMO-002", "bones");
    expect(bought.ok).toBe(true);
  });
});

describe("store API", () => {
  it("returns no emote items and rejects buying one while emotes are off", async () => {
    const store = new Store(":memory:");
    const { app } = await createApp({ store, serveWeb: false });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/guest",
        payload: { displayName: "Ada", age13: true },
      });
      expect(created.statusCode).toBe(200);
      const cookie = String(created.headers["set-cookie"]).split(";")[0] ?? "";
      const catalog = await app.inject({ method: "GET", url: "/api/store", headers: { cookie } });
      expect(catalog.statusCode).toBe(200);
      const body = catalog.json() as {
        emotesEnabled: boolean;
        bones: number;
        owned: string[];
        items: Array<{ id: string; category: string }>;
      };
      expect(body.emotesEnabled).toBe(false);
      expect(body.items.some((item) => item.category === "emote" || item.id.startsWith("EMO-"))).toBe(false);
      expect(body.items.some((item) => item.category === "trash")).toBe(true);
      expect(body.owned).not.toContain("EMO-001");
      expect(itemById("EMO-002")?.category).toBe("emote");

      const buy = await app.inject({
        method: "POST",
        url: "/api/store/buy",
        headers: { cookie },
        payload: { itemId: "EMO-002", currency: "bones" },
      });
      expect(buy.statusCode).toBe(400);
      expect(buy.json().error).toBe("That item is not available.");

      const after = await app.inject({ method: "GET", url: "/api/store", headers: { cookie } });
      const next = after.json() as { bones: number; owned: string[]; items: Array<{ category: string }> };
      expect(next.bones).toBe(body.bones);
      expect(next.owned).not.toContain("EMO-002");
      expect(next.items.some((item) => item.category === "emote")).toBe(false);
    } finally {
      await app.close();
    }
  });
});
