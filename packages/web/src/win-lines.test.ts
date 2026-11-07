import { describe, expect, it } from "vitest";
import { GENERIC_WIN_LINE, WIN_LINE_PACKS, matchLineSeed, winLineFor } from "./win-lines.js";

describe("match win lines", () => {
  it("keeps a pack per character and never a withheld id", () => {
    const ids = WIN_LINE_PACKS.map((pack) => pack.avatarId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("gaperilla");
    expect(ids).toContain("grungerocker");
    expect(ids).toContain("2hot4tv");
    expect(ids).not.toContain("gasparilla");
    expect(ids).not.toContain("CHR-015");
    expect(WIN_LINE_PACKS.every((pack) => pack.lines.length === 2)).toBe(true);
    expect(WIN_LINE_PACKS.every((pack) => pack.id === `${pack.avatarId}-default`)).toBe(true);
  });

  it("picks a stable line, and both of a character's lines are reachable", () => {
    const rocker = WIN_LINE_PACKS.find((pack) => pack.avatarId === "grungerocker")!;
    expect(winLineFor("grungerocker", 0)).toBe(rocker.lines[0]);
    expect(winLineFor("grungerocker", 1)).toBe(rocker.lines[1]);
    const seed = matchLineSeed("WINFX", 1, 4, "rio");
    expect(winLineFor("grungerocker", seed)).toBe(winLineFor("grungerocker", seed));
    expect(rocker.lines).toContain(winLineFor("grungerocker", seed));
  });

  it("maps the pirate slug onto gaperilla and keeps a line for the starter", () => {
    const pirate = WIN_LINE_PACKS.find((pack) => pack.avatarId === "gaperilla")!;
    expect(pirate.lines[0]).toBe("Yo ho ho, hand over the bones!");
    const host = WIN_LINE_PACKS.find((pack) => pack.avatarId === "2hot4tv")!;
    expect(host.lines).toEqual([
      "Uh-Oh, you KNOW!",
      "From Philly to Okinawa, I own all you!",
    ]);
    expect(winLineFor("2hot4tv", 0)).toBe(host.lines[0]);
    expect(winLineFor("2hot4tv", 1)).toBe(host.lines[1]);
    expect(winLineFor("homescreen", 0)).toBe(GENERIC_WIN_LINE);
    expect(winLineFor(null, 4)).toBe(GENERIC_WIN_LINE);
  });
});
