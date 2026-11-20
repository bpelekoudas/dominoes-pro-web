import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import type { FastifyRequest } from "fastify";
import type { Store } from "./db.js";

/** A player can send this many reports an hour from one seat. */
export const BUGS_PER_PLAYER_HOUR = 8;
/** One address, in case several seats share it. */
export const BUGS_PER_IP_HOUR = 12;
/** Whole server. Stops a flood from filling the disk. */
export const BUGS_PER_HOUR = 120;
export const BUG_DESCRIPTION_MAX = 2_000;
export const BUG_SCREENSHOT_MAX_BYTES = 700_000;
export const BUG_BODY_LIMIT = 1_600_000;
export const CLIENT_LOG_LIMIT = 50;
export const CLIENT_LOG_LINE_MAX = 240;
export const ERRORS_PER_MINUTE = 30;
export const BUG_REPORT_KEEP = 80;
export const BUG_SHOT_KEEP = 20;
export const ERROR_EVENT_KEEP = 500;

const CLIENT_KINDS = new Set(["window.onerror", "unhandledrejection", "ws_disconnect", "ws_reconnect_fail"]);

const errorHits = new Map<string, { at: number; n: number }>();
const recordedFaults = new WeakSet<object>();

let loopDelay: IntervalHistogram | null = null;

export function ensureLoopMonitor(): IntervalHistogram {
  if (!loopDelay) {
    loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
  }
  return loopDelay;
}

export function loopSnapshot(): { p50Ms: number; p95Ms: number; maxMs: number } {
  const histogram = ensureLoopMonitor();
  return {
    p50Ms: roundMs(histogram.percentile(50)),
    p95Ms: roundMs(histogram.percentile(95)),
    maxMs: roundMs(histogram.max),
  };
}

export function resetLoopMonitor(): void {
  loopDelay?.reset();
}

/** Tests start from an empty rate-limit window. */
export function resetOpsLimits(): void {
  errorHits.clear();
}

export function serverBuildSha(): string {
  const raw = (process.env.RENDER_GIT_COMMIT || process.env.BUILD_SHA || "").trim();
  return raw ? raw.slice(0, 64) : "unknown";
}

export function redactText(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function reportIpHash(ip: string): string {
  const salt = (process.env.OPS_SECRET || process.env.SESSION_SECRET || "uhoh-ops").trim() || "uhoh-ops";
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 24);
}

function roundMs(ns: number): number {
  if (!Number.isFinite(ns) || ns < 0) return 0;
  return Math.round((ns / 1e6) * 10) / 10;
}

function cleanToken(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().slice(0, max);
  if (!text || /[\u0000-\u001f]/.test(text)) return null;
  return text;
}

function cleanInt(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) return null;
  return raw;
}

function errorFingerprint(kind: string, message: string, buildSha: string): string {
  return createHash("sha256").update(`${kind}\n${message}\n${buildSha}`).digest("hex").slice(0, 32);
}

export function errorAllowed(ip: string, now = Date.now()): boolean {
  const row = errorHits.get(ip);
  if (!row || now - row.at > 60_000) {
    if (errorHits.size > 2_000) errorHits.clear();
    errorHits.set(ip, { at: now, n: 1 });
    return true;
  }
  row.n += 1;
  return row.n <= ERRORS_PER_MINUTE;
}

export function markOpsFault(request: object): void {
  recordedFaults.add(request);
}

export function opsFaultMarked(request: object): boolean {
  return recordedFaults.has(request);
}

export function roomFromRequest(request: FastifyRequest): string | null {
  const referer = request.headers.referer ?? request.headers.referrer;
  const raw = Array.isArray(referer) ? referer[0] : referer;
  if (!raw) return null;
  const match = /\/r\/([A-Za-z0-9]{2,12})/.exec(raw);
  return match?.[1] ?? null;
}

function decodeScreenshot(raw: unknown): { ok: true; mime: string; bytes: Buffer } | { ok: false; error: string } | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return { ok: false, error: "The picture could not be read." };
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(raw.trim());
  if (!match) return { ok: false, error: "Use a PNG or JPEG screenshot." };
  const bytes = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
  if (bytes.length < 16) return { ok: false, error: "That picture was empty." };
  if (bytes.length > BUG_SCREENSHOT_MAX_BYTES) return { ok: false, error: "That picture is too big." };
  return { ok: true, mime: match[1] === "image/webp" ? "image/webp" : match[1]!, bytes };
}

function cleanLogs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const lines: string[] = [];
  for (const item of raw.slice(-CLIENT_LOG_LIMIT)) {
    const line = redactText(item, CLIENT_LOG_LINE_MAX);
    if (line) lines.push(line);
  }
  return lines;
}

export type BugAccept =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function acceptBugReport(
  store: Store,
  body: unknown,
  input: { ip: string; userId: string | null; now?: Date },
): BugAccept {
  const now = input.now ?? new Date();
  const payload = (body ?? {}) as Record<string, unknown>;
  const description = redactText(payload.description, BUG_DESCRIPTION_MAX);
  if (description.length < 3) return { ok: false, status: 400, error: "Describe what went wrong." };
  const shot = decodeScreenshot(payload.screenshot);
  if (shot && !shot.ok) return { ok: false, status: 400, error: shot.error };
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  if (store.bugReportCountSince(since) >= BUGS_PER_HOUR) {
    return { ok: false, status: 429, error: "Wait a while before another report." };
  }
  const playerId = cleanToken(payload.playerId, 80);
  if (playerId && store.bugReportCountSince(since, { playerId }) >= BUGS_PER_PLAYER_HOUR) {
    return { ok: false, status: 429, error: "Wait a while before another report." };
  }
  const ipHash = reportIpHash(input.ip || "unknown");
  if (store.bugReportCountSince(since, { ipHash }) >= BUGS_PER_IP_HOUR) {
    return { ok: false, status: 429, error: "Wait a while before another report." };
  }
  const logs = cleanLogs(payload.logs);
  store.insertBugReport({
    id: randomUUID(),
    createdAt: now.toISOString(),
    description,
    buildSha: cleanToken(payload.buildSha, 64),
    roomCode: cleanToken(payload.roomCode, 12),
    seat: cleanInt(payload.seat, 0, 3),
    tableSize: cleanInt(payload.tableSize, 2, 4),
    handNumber: cleanInt(payload.handNumber, 0, 999),
    userAgent: redactText(payload.userAgent, 200) || null,
    viewport: cleanToken(payload.viewport, 32),
    playerId,
    userId: input.userId,
    logsJson: JSON.stringify(logs),
    screenshotMime: shot?.ok ? shot.mime : null,
    screenshot: shot?.ok ? shot.bytes : null,
    ipHash,
  });
  store.pruneBugReports(BUG_REPORT_KEEP, BUG_SHOT_KEEP);
  return { ok: true };
}

export type ErrorAccept = { ok: true; deduped: boolean; n: number } | { ok: false; status: number; error: string };

export function acceptClientError(store: Store, body: unknown, input: { ip: string; now?: Date }): ErrorAccept {
  const payload = (body ?? {}) as Record<string, unknown>;
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  if (!CLIENT_KINDS.has(kind)) return { ok: false, status: 400, error: "That report is not used." };
  if (!errorAllowed(input.ip || "unknown", (input.now ?? new Date()).getTime())) {
    return { ok: false, status: 429, error: "Slow down." };
  }
  const message = redactText(payload.message, 500) || kind;
  const buildSha = cleanToken(payload.buildSha, 64) ?? serverBuildSha();
  const saved = writeError(store, {
    kind,
    message,
    buildSha,
    roomCode: cleanToken(payload.roomCode, 12),
    playerId: cleanToken(payload.playerId, 80),
    detail: redactText(payload.stack, 1_500) || null,
    now: input.now,
  });
  return { ok: true, deduped: !saved.inserted, n: saved.n };
}

export function recordServerFault(
  store: Store,
  input: {
    kind: "server_exception" | "http_5xx" | "uncaught_exception" | "unhandled_rejection";
    message: string;
    stack?: string;
    buildSha?: string;
    roomCode?: string | null;
    playerId?: string | null;
    path?: string;
    now?: Date;
  },
): void {
  try {
    const message = redactText(input.path ? `${input.message} (${input.path})` : input.message, 500) || input.kind;
    writeError(store, {
      kind: input.kind,
      message,
      buildSha: input.buildSha ?? serverBuildSha(),
      roomCode: input.roomCode ?? null,
      playerId: input.playerId ?? null,
      detail: redactText(input.stack, 1_500) || null,
      now: input.now,
    });
  } catch {
    // A stats write must not turn one error into another.
  }
}

function writeError(
  store: Store,
  input: {
    kind: string;
    message: string;
    buildSha: string;
    roomCode: string | null;
    playerId: string | null;
    detail: string | null;
    now?: Date;
  },
): { inserted: boolean; n: number } {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const saved = store.noteErrorEvent({
    id: randomUUID(),
    fingerprint: errorFingerprint(input.kind, input.message, input.buildSha),
    day: at.slice(0, 10),
    kind: input.kind,
    message: input.message,
    buildSha: input.buildSha,
    roomCode: input.roomCode,
    playerId: input.playerId,
    detail: input.detail,
    at,
  });
  if (saved.inserted) {
    const oldest = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    store.pruneErrorEvents(ERROR_EVENT_KEEP, oldest);
  }
  return saved;
}

export function opsAdminAllowed(
  header: string | string[] | undefined,
  session: "none" | "admin" | "stranger",
): "ok" | "missing" | "forbidden" {
  const expected = process.env.OPS_SECRET?.trim() ?? "";
  const token = (Array.isArray(header) ? header[0] : header)?.trim() ?? "";
  if (expected && token === expected) return "ok";
  if (session === "admin") return "ok";
  if (session === "stranger" || token) return "forbidden";
  return "missing";
}

export function bytesToDataUrl(mime: string | null, bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null;
  const type = mime && mime.startsWith("image/") ? mime : "image/jpeg";
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function dayStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
