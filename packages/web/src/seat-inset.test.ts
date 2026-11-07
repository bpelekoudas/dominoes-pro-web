import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("the west stack stays on screen after a play", () => {
  it("the table column cannot pan when a tile is tapped", () => {
    expect(css).toMatch(/\.felt-column \{[^}]*overflow:\s*clip/);
    expect(css).toMatch(/\.felt-app \{[^}]*overflow:\s*clip/);
    expect(css).not.toMatch(/\.felt-column \{[^}]*overflow:\s*hidden/);
    expect(css).not.toMatch(/\.felt-app \{[^}]*max-height:\s*100dvh[^}]*overflow:\s*hidden/);
  });

  it("every corner stack keeps a few pixels of screen margin", () => {
    expect(css).toMatch(/\.corner-bar \{[^}]*padding:\s*0 6px 4px/);
    expect(css).toMatch(/\.hand-tray > \.opponent-chip\[data-edge="right"\] \{[^}]*right:\s*6px/);
  });
});
