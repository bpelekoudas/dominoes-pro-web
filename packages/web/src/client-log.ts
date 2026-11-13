import { BUILD_SHA } from "./build-sha";
import { pulse } from "./pulse";

const LIMIT = 50;
const lines: string[] = [];
const sentAt = new Map<string, number>();

export interface ReportContext {
  roomCode: string;
  playerId: string;
  seat: number | null;
  tableSize: number | null;
  handNumber: number;
}

let context: ReportContext = {
  roomCode: "",
  playerId: "",
  seat: null,
  tableSize: null,
  handNumber: 0,
};

export function setReportContext(next: ReportContext): void {
  context = next;
}

export function reportContext(): ReportContext {
  return context;
}

export function resetClientLog(): void {
  lines.length = 0;
  sentAt.clear();
}

/** One line in the ring the bug form attaches. Emails are stripped before they leave the phone. */
export function clientLog(message: string): void {
  const text = `${new Date().toISOString()} ${message}`.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!text) return;
  lines.push(text);
  if (lines.length > LIMIT) lines.splice(0, lines.length - LIMIT);
}

export function clientLogLines(): string[] {
  return lines.slice(-LIMIT);
}

export type ClientFaultKind = "window.onerror" | "unhandledrejection" | "ws_disconnect" | "ws_reconnect_fail";

/** Send a client fault. The same note is quiet for a minute so a reconnect loop does not flood the server. */
export function reportClientFault(kind: ClientFaultKind, message: string, stack?: string): void {
  const note = (message || kind).replace(/\s+/g, " ").trim().slice(0, 500);
  clientLog(`${kind}: ${note}`);
  const key = `${kind}:${note}`.slice(0, 180);
  const now = Date.now();
  const previous = sentAt.get(key) ?? 0;
  if (now - previous < 60_000) return;
  sentAt.set(key, now);
  if (sentAt.size > 200) sentAt.clear();
  pulse("error", note);
  const viewport =
    typeof window === "undefined" ? "" : `${window.innerWidth}x${window.innerHeight}`;
  const body = JSON.stringify({
    kind,
    message: note,
    stack: stack?.slice(0, 1500),
    buildSha: BUILD_SHA,
    roomCode: context.roomCode,
    playerId: context.playerId,
    handNumber: context.handNumber,
    viewport,
    logs: clientLogLines(),
  });
  if (typeof fetch !== "function") return;
  void fetch("/api/ops/error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
