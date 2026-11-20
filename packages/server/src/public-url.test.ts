import { describe, expect, it } from "vitest";
import { aliasRedirect, canonicalPage, publicBase, withCanonical } from "./public-url.js";

describe("publicBase", () => {
  it("uses PUBLIC_URL and drops a trailing slash", () => {
    expect(
      publicBase({
        publicUrl: "https://uhohdominoes.com/",
        proto: "http",
        host: "127.0.0.1:8787",
      }),
    ).toBe("https://uhohdominoes.com");
  });

  it("publishes the canonical address for the custom domain and its aliases", () => {
    expect(publicBase({ proto: "https", host: "uhohdominoes.com" })).toBe("https://uhohdominoes.com");
    expect(publicBase({ proto: "https", host: "www.uhohdominoes.com" })).toBe("https://uhohdominoes.com");
    expect(publicBase({ proto: "http", host: "uhoh-dominoes.onrender.com" })).toBe("https://uhohdominoes.com");
  });

  it("keeps the first forwarded host when it is an alias", () => {
    expect(publicBase({ proto: "https", host: "uhoh-dominoes.onrender.com, internal" })).toBe(
      "https://uhohdominoes.com",
    );
  });

  it("uses the request host for a local table", () => {
    expect(publicBase({ proto: "http", host: "127.0.0.1:8787" })).toBe("http://127.0.0.1:8787");
  });

  it("returns nothing when there is no host to publish", () => {
    expect(publicBase({ proto: "http", host: "  " })).toBe("");
  });
});

describe("alias redirect", () => {
  it("sends the site and a room link to the canonical address", () => {
    expect(aliasRedirect("uhoh-dominoes.onrender.com", "/")).toBe("https://uhohdominoes.com/");
    expect(aliasRedirect("www.uhohdominoes.com", "/r/AB12CD?x=1")).toBe("https://uhohdominoes.com/r/AB12CD?x=1");
    expect(aliasRedirect("uhoh-dominoes.onrender.com", "/config.js")).toBe("https://uhohdominoes.com/config.js");
  });

  it("leaves health, the API, and the socket on the host that was asked", () => {
    expect(aliasRedirect("uhoh-dominoes.onrender.com", "/health")).toBeNull();
    expect(aliasRedirect("uhoh-dominoes.onrender.com", "/api/guest")).toBeNull();
    expect(aliasRedirect("uhoh-dominoes.onrender.com", "/api/soak/cleanup")).toBeNull();
    expect(aliasRedirect("uhoh-dominoes.onrender.com", "/api/stripe/webhook")).toBeNull();
    expect(aliasRedirect("www.uhohdominoes.com", "/ws")).toBeNull();
  });

  it("does not redirect the canonical host or a local host", () => {
    expect(aliasRedirect("uhohdominoes.com", "/")).toBeNull();
    expect(aliasRedirect("127.0.0.1:8787", "/r/AB12CD")).toBeNull();
  });
});

describe("canonical page", () => {
  it("keeps a room on its own address and folds everything else to the home page", () => {
    expect(canonicalPage("/r/ab12cd")).toBe("https://uhohdominoes.com/r/AB12CD");
    expect(canonicalPage("/")).toBe("https://uhohdominoes.com/");
    expect(canonicalPage("/nope")).toBe("https://uhohdominoes.com/");
    expect(canonicalPage("/terms")).toBe("https://uhohdominoes.com/terms");
    expect(canonicalPage("/privacy")).toBe("https://uhohdominoes.com/privacy");
  });

  it("rewrites the canonical link and the Open Graph URL", () => {
    const html = '<link rel="canonical" href="https://uhohdominoes.com/" /><meta property="og:url" content="https://uhohdominoes.com/" />';
    expect(withCanonical(html, "https://uhohdominoes.com/r/AB12CD")).toBe(
      '<link rel="canonical" href="https://uhohdominoes.com/r/AB12CD" /><meta property="og:url" content="https://uhohdominoes.com/r/AB12CD" />',
    );
  });
});
