import { describe, expect, it } from "vitest";
import { tableLink } from "./link.js";

describe("tableLink", () => {
  it("prefers the public URL over a loopback origin", () => {
    expect(tableLink("AB12CD", "https://uhoh-dominoes.onrender.com/", "http://127.0.0.1:8787")).toBe(
      "https://uhoh-dominoes.onrender.com/r/AB12CD",
    );
  });

  it("falls back to the page origin when no public URL was sent", () => {
    expect(tableLink("AB12CD", "", "http://192.168.1.20:8787")).toBe("http://192.168.1.20:8787/r/AB12CD");
  });
});
