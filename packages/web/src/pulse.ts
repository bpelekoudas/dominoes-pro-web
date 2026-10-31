export type PulseName = "home" | "share" | "rematch" | "error";

/** Count a visit or a crash on our server. No name, no email, no room code. */
export function pulse(name: PulseName, message?: string): void {
  if (name === "home" || name === "error") {
    try {
      const key = name === "home" ? "uhoh.pulse.home" : `uhoh.pulse.err.${(message ?? "").slice(0, 80)}`;
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Private mode can refuse the write. One extra count is fine.
    }
  }
  const body = JSON.stringify({ name, message: message?.slice(0, 160) });
  void fetch("/api/pulse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
