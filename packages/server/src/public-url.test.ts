import { describe, expect, it } from "vitest";
import { publicBase } from "./public-url.js";

describe("publicBase", () => {
  it("uses PUBLIC_URL and drops a trailing slash", () => {
    expect(
      publicBase({
        publicUrl: "https://uhoh-dominoes.onrender.com/",
        proto: "http",
        host: "127.0.0.1:8787",
      }),
    ).toBe("https://uhoh-dominoes.onrender.com");
  });

  it("uses the request host when PUBLIC_URL is unset", () => {
    expect(publicBase({ publicUrl: "", proto: "https", host: "uhoh-dominoes.onrender.com" })).toBe(
      "https://uhoh-dominoes.onrender.com",
    );
  });

  it("keeps the first forwarded host", () => {
    expect(publicBase({ proto: "https", host: "uhoh-dominoes.onrender.com, internal" })).toBe(
      "https://uhoh-dominoes.onrender.com",
    );
  });

  it("returns nothing when there is no host to publish", () => {
    expect(publicBase({ proto: "http", host: "  " })).toBe("");
  });
});
