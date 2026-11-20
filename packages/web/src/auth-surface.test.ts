import { describe, expect, it } from "vitest";
import { prefersRedirectSignIn } from "./auth-surface";

describe("sign-in surface", () => {
  it("uses a redirect on iPhone Safari and in a home-screen app", () => {
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(prefersRedirectSignIn({ userAgent: iphone, standalone: false })).toBe(true);
    expect(prefersRedirectSignIn({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/130.0.0.0 Mobile", standalone: true })).toBe(true);
    expect(prefersRedirectSignIn({ userAgent: "Mozilla/5.0 (Macintosh)", standalone: false, iosTouchMac: true })).toBe(true);
  });

  it("keeps the popup on Android Chrome in a normal tab", () => {
    const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    expect(prefersRedirectSignIn({ userAgent: android, standalone: false })).toBe(false);
  });
});
