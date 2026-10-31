import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const client = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");

describe("a returning phone picks up a new deploy", () => {
  it("activates the new worker and reloads an open page only when the new page can be fetched", () => {
    expect(worker).toContain("self.skipWaiting()");
    expect(worker).toContain("self.clients.claim()");
    expect(worker).toContain('cache: "no-store"');
    expect(worker).toContain("if (!response.ok)");
    expect(worker).toContain("if (!fresh?.ok) return");
    expect(worker).toContain("client.navigate(client.url)");
    expect(worker).toContain('fetch(request, { cache: "no-store" })');
  });

  it("keeps hashed files for offline play and does not reload the first install", () => {
    expect(worker).toContain('pathname.startsWith("/assets/")');
    expect(worker).toContain("if (cached) return cached;");
    expect(worker).toContain("if (!self.__hadShell) return");
    expect(client).toContain('updateViaCache: "none"');
    expect(client).toContain("hadController");
    expect(client).toContain("controllerchange");
    expect(client).toContain("registration.update()");
    expect(client).toContain("!navigator.onLine");
  });
});
