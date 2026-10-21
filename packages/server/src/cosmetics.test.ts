import { describe, expect, it } from "vitest";
import { Accounts } from "./accounts.js";
import { Cosmetics } from "./cosmetics.js";
import { Store } from "./db.js";

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
    expect(first.owned).not.toContain("FX-002");
    expect(first.items.some((item) => item.id === "CHR-015")).toBe(false);

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

  it("rejects the withheld character, earned items, limited items, and a short balance", () => {
    const { cosmetics, user, accounts } = guest();
    expect(cosmetics.buy(user.id, "CHR-015", "bones").ok).toBe(false);
    expect(cosmetics.equip(user.id, "CHR-015").ok).toBe(false);
    expect(cosmetics.buy(user.id, "2hot4tv", "gold").ok).toBe(false);
    expect(cosmetics.buy(user.id, "CHR-006", "bones").ok).toBe(false);
    expect(cosmetics.buy(user.id, "FRM-011", "gold").ok).toBe(false);
    expect(accounts.setAvatar(user.id, "2hot4tv").outcome).toBe("invalid");
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
});
