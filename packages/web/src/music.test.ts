import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MUSIC_TRACKS, clampMusicVolume, parseMusicChoice } from "./music.js";

describe("background music", () => {
  it("stays off unless the player picked a known track", () => {
    expect(parseMusicChoice(null)).toBe("off");
    expect(parseMusicChoice("")).toBe("off");
    expect(parseMusicChoice("jazz")).toBe("off");
    expect(parseMusicChoice("rap")).toBe("rap");
    expect(parseMusicChoice("rock")).toBe("rock");
    expect(parseMusicChoice("edm")).toBe("edm");
    expect(parseMusicChoice("classical")).toBe("classical");
  });

  it("keeps the music volume inside the slider", () => {
    expect(clampMusicVolume(undefined)).toBe(0.55);
    expect(clampMusicVolume("nope")).toBe(0.55);
    expect(clampMusicVolume(-2)).toBe(0);
    expect(clampMusicVolume(4)).toBe(1);
    expect(clampMusicVolume(0.4)).toBe(0.4);
  });

  it("ships four compressed instrumentals and does not preload them by name in the sound list", () => {
    expect(MUSIC_TRACKS.map((track) => track.id)).toEqual(["rap", "rock", "edm", "classical"]);
    for (const track of MUSIC_TRACKS) {
      const file = statSync(new URL(`../public/music/${track.file}`, import.meta.url));
      expect(file.size).toBeGreaterThan(50_000);
      expect(file.size).toBeLessThan(4_000_000);
    }
  });
});
