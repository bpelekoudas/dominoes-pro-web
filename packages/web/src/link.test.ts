import { describe, expect, it } from "vitest";
import { shareText, smsHref, tableLink } from "./link.js";

describe("tableLink", () => {
  it("prefers the public URL over a loopback origin", () => {
    expect(tableLink("AB12CD", "https://uhohdominoes.com/", "http://127.0.0.1:8787")).toBe(
      "https://uhohdominoes.com/r/AB12CD",
    );
  });

  it("falls back to the page origin when no public URL was sent", () => {
    expect(tableLink("AB12CD", "", "http://192.168.1.20:8787")).toBe("http://192.168.1.20:8787/r/AB12CD");
  });

  it("writes a text a friend can send", () => {
    const link = "https://uhohdominoes.com/r/AB12CD";
    expect(shareText(link)).toBe("Play UhOh Dominoes with me: https://uhohdominoes.com/r/AB12CD");
    expect(smsHref(link)).toBe(`sms:?&body=${encodeURIComponent(shareText(link))}`);
  });
});
