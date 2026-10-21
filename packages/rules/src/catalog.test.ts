import { describe, expect, it } from "vitest";
import { CATALOG, canBuy, isWithheldId, itemById } from "./catalog.js";

describe("store catalog", () => {
  it("ships the sheet without the withheld character", () => {
    expect(CATALOG).toHaveLength(85);
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
    expect(itemById("CHR-011")?.obtain).toBe("gold");
    expect(CATALOG.every((item) => item.art)).toBe(true);
  });
});
