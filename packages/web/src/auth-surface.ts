/**
 * Google and Apple buttons open a popup by default. iOS Safari and an
 * installed home-screen app often block that popup, so those phones use a
 * full-page redirect instead.
 */
export function prefersRedirectSignIn(input: { userAgent: string; standalone: boolean; iosTouchMac?: boolean }): boolean {
  if (input.standalone) return true;
  if (/iPhone|iPad|iPod/i.test(input.userAgent)) return true;
  return input.iosTouchMac === true;
}

export function prefersRedirectSignInNow(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true ||
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches);
  const iosTouchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return prefersRedirectSignIn({ userAgent: navigator.userAgent, standalone, iosTouchMac });
}
