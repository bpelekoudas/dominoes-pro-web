import { describe, expect, it } from "vitest";
import { CATALOG, canBuy, isWithheldId, itemById } from "./catalog.js";

describe("store catalog", () => {
  it("ships the sheet without the withheld character", () => {
    expect(CATALOG).toHaveLength(91);
    expect(CATALOG.some((item) => item.id === "CHR-015")).toBe(false);
    expect(JSON.stringify(CATALOG).includes("2 Hot")).toBe(false);
    expect(isWithheldId("CHR-015")).toBe(true);
    expect(isWithheldId("2hot4tv")).toBe(true);
    expect(itemById("CHR-015")).toBeNull();
  });

  it("keeps the sheet prices and locks earned and limited items", () => {
    const fire = itemById("FX-002");
    expect(fire?.bones).toBe(10_000);
    expect(fire?.gold).toBe(800);
    expect(canBuy(fire!, "bones")).toBe(true);
    expect(canBuy(fire!, "gold")).toBe(true);
    expect(canBuy(itemById("CHR-006")!, "bones")).toBe(false);
    expect(canBuy(itemById("FRM-011")!, "gold")).toBe(false);
    expect(itemById("FRM-011")?.availableFrom).toBe("2026-12-01");
    expect(itemById("FX-004")?.bones).toBe(50_000);
    expect(itemById("TBL-011")).toMatchObject({ name: "Classic Green Felt", rarity: "Common", bones: 600, gold: null });
    expect(itemById("TBL-012")).toMatchObject({ name: "Walnut Planks", rarity: "Common", bones: 900 });
    expect(itemById("TBL-013")).toMatchObject({ name: "Charcoal Slate", rarity: "Rare", bones: 1500, gold: 200 });
    expect(itemById("TBL-014")).toMatchObject({ name: "Navy Suede", rarity: "Rare", bones: 2000, gold: 250 });
    expect(itemById("TBL-015")).toMatchObject({ name: "Teal Island Boards", rarity: "Rare", bones: 2500, gold: 300 });
    expect(itemById("TBL-016")).toMatchObject({ name: "Burgundy Art Deco", rarity: "Rare", bones: 2500, gold: 300 });
    for (const id of ["TBL-001", "TBL-002", "TBL-003", "TBL-004", "TBL-005", "TBL-006", "TBL-007", "TBL-008", "TBL-009", "TBL-010"]) {
      expect(itemById(id)?.category).toBe("table");
    }
    expect(itemById("CHR-011")?.obtain).toBe("gold");
    expect(CATALOG.every((item) => item.art)).toBe(true);
  });
});
