const NAMES = new Set(["home", "share", "rematch", "error"]);

export type PulseName = "home" | "share" | "rematch" | "error";

export function pulseName(raw: unknown): PulseName | null {
  return typeof raw === "string" && NAMES.has(raw) ? (raw as PulseName) : null;
}

/** A short crash note. Emails are dropped. Nothing else is stored with it. */
export function cleanPulseNote(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
