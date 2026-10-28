import { createHmac, randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Store } from "./db.js";
import { cleanName, cleanSoakRun, isSoakName } from "./hub.js";
import { blockedSpeech } from "./language.js";
import { isAvatarId, isWithheldId, resolveAvatar } from "@uhoh/rules";
import { Cosmetics } from "./cosmetics.js";
import { mergeDaily } from "./daily.js";
import { describePlayer, type PublicStanding } from "./ranking.js";

export type ProviderName = "google" | "apple" | "email" | "guest";

export interface PublicUser extends PublicStanding {
  id: string;
  displayName: string;
  avatarId: string | null;
  guest: boolean;
  providers: ProviderName[];
  /** True after the player confirms they are 13 or older. */
  ageOk: boolean;
}

export interface VerifiedIdentity {
  sub: string;
  email: string | null;
}

export type SignInResult =
  | { outcome: "ok"; user: PublicUser; token: string | null }
  | { outcome: "already-claimed"; current: PublicUser | null; existing: PublicUser }
  | { outcome: "not-configured"; error: string }
  | { outcome: "invalid"; error: string }
  | { outcome: "limited"; error: string };

export interface AppleConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

export interface AccountOptions {
  secret: string;
  now?: () => Date;
  googleClientId?: string | null;
  apple?: AppleConfig | null;
  resendApiKey?: string | null;
  emailFrom?: string | null;
  /** When Resend is unset, return the link and log it so a test table can sign in. */
  devMagicLink?: boolean;
  verifyGoogle?: (idToken: string, clientId: string) => Promise<VerifiedIdentity>;
  verifyApple?: (idToken: string, clientId: string) => Promise<VerifiedIdentity>;
  sendEmail?: (to: string, link: string) => Promise<void>;
}

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_MS = 15 * 60 * 1000;
export const SESSION_COOKIE = "uhoh_session";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(idToken, googleKeys, {
    audience: clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (!payload.sub) throw new Error("Google token has no subject.");
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

export async function verifyAppleIdToken(idToken: string, clientId: string): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(idToken, appleKeys, {
    audience: clientId,
    issuer: "https://appleid.apple.com",
  });
  if (!payload.sub) throw new Error("Apple token has no subject.");
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

export function scoreMathEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.SHOW_SCORE_MATH ?? "").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

/** Dev, or the live test table with score math on, can see a magic link before Resend is set. */
export function magicLinkDevMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  return scoreMathEnabled(env);
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 200) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function signToken(token: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(token).digest("base64url");
  return `v1.${token}.${sig}`;
}

function openToken(cookieValue: string, secret: string): string | null {
  const parts = cookieValue.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return null;
  const expected = createHmac("sha256", secret).update(parts[1]).digest("base64url");
  const left = Buffer.from(parts[2]);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return parts[1];
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean, maxAge: number): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

class RateLimit {
  private readonly hits = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs: number, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export class Accounts {
  private readonly now: () => Date;
  private readonly limit = new RateLimit();

  constructor(
    private readonly store: Store,
    private readonly options: AccountOptions,
  ) {
    if (options.secret.length < 16) throw new Error("SESSION_SECRET must be at least 16 characters.");
    this.now = options.now ?? (() => new Date());
  }

  config(): { googleClientId: string | null; appleClientId: string | null } {
    return {
      googleClientId: this.options.googleClientId?.trim() || null,
      appleClientId: this.options.apple?.clientId ?? null,
    };
  }

  createGuest(
    displayName: string,
    current: PublicUser | null,
    soakRun: string | null = null,
    age13: boolean | null = null,
  ): SignInResult {
    const name = cleanName(displayName);
    if (!name) return { outcome: "invalid", error: "Use a name, up to 16 letters." };
    if (blockedSpeech(name)) return { outcome: "invalid", error: "Pick a different name." };
    const runId = isSoakName(name) ? cleanSoakRun(soakRun) : null;
    const aged = age13 === true || age13 === null || Boolean(runId);
    if (!aged && !current?.ageOk) return { outcome: "invalid", error: "Confirm you are 13 or older." };
    if (current) {
      if (current.displayName !== name) {
        const renamed = this.rename(current.id, name);
        if (renamed.outcome !== "ok") return renamed;
      }
      if (runId) this.store.setSoakRun(current.id, runId);
      if (aged) this.store.markAge(current.id, this.stamp());
      return { outcome: "ok", user: this.present(current.id)!, token: null };
    }
    const user = this.insertUser(name, true);
    if (runId) this.store.setSoakRun(user.id, runId);
    if (aged) this.store.markAge(user.id, this.stamp());
    const stamp = this.stamp();
    this.store.insertIdentity({
      id: randomUUID(),
      user_id: user.id,
      provider: "guest",
      provider_subject: user.id,
      email: null,
      created_at: stamp,
    });
    return { outcome: "ok", user: this.present(user.id)!, token: this.issue(user.id) };
  }

  setAvatar(userId: string, avatarId: string): SignInResult {
    if (isWithheldId(avatarId)) return { outcome: "invalid", error: "That character is not available." };
    if (!isAvatarId(avatarId)) return { outcome: "invalid", error: "Pick one of the characters." };
    if (!new Cosmetics(this.store, this.now).avatarAllowed(userId, avatarId)) {
      return { outcome: "invalid", error: "Buy that character in the store first." };
    }
    const user = this.store.user(userId);
    if (!user) return { outcome: "invalid", error: "That profile is gone." };
    this.store.updateUser(userId, { avatar_id: avatarId, updated_at: this.stamp() });
    return { outcome: "ok", user: this.present(userId)!, token: null };
  }

  rename(userId: string, displayName: string): SignInResult {
    const name = cleanName(displayName);
    if (!name) return { outcome: "invalid", error: "Use a name, up to 16 letters." };
    if (blockedSpeech(name)) return { outcome: "invalid", error: "Pick a different name." };
    const user = this.store.user(userId);
    if (!user) return { outcome: "invalid", error: "That profile is gone." };
    this.store.updateUser(userId, { display_name: name, updated_at: this.stamp() });
    if (isSoakName(name)) this.store.markSoak(userId);
    return { outcome: "ok", user: this.present(userId)!, token: null };
  }

  userFromCookieHeader(header: string | undefined): PublicUser | null {
    const raw = readCookie(header, SESSION_COOKIE);
    if (!raw) return null;
    return this.userFromCookieValue(raw);
  }

  userFromCookieValue(value: string): PublicUser | null {
    const token = openToken(value, this.options.secret);
    if (!token) return null;
    const row = this.store.sessionByHash(sha256(token));
    if (!row) return null;
    if (Date.parse(row.expires_at) <= this.now().getTime()) {
      this.store.deleteSessionByHash(row.token_hash);
      return null;
    }
    this.store.touchSession(row.id, this.stamp());
    return this.present(row.user_id);
  }

  logout(cookieHeader: string | undefined): void {
    const raw = readCookie(cookieHeader, SESSION_COOKIE);
    if (!raw) return;
    const token = openToken(raw, this.options.secret);
    if (!token) return;
    this.store.deleteSessionByHash(sha256(token));
  }

  async signInGoogle(
    idToken: string,
    currentUserId: string | null,
    confirm: boolean,
    age13: boolean | null = null,
  ): Promise<SignInResult> {
    const clientId = this.options.googleClientId?.trim();
    if (!clientId) return { outcome: "not-configured", error: "Google sign-in is not configured yet." };
    if (!idToken) return { outcome: "invalid", error: "Google did not send a sign-in." };
    try {
      const verify = this.options.verifyGoogle ?? verifyGoogleIdToken;
      const identity = await verify(idToken, clientId);
      return this.finishIdentity({
        provider: "google",
        subject: identity.sub,
        email: normalizeEmail(identity.email),
        currentUserId,
        confirm,
        age13,
      });
    } catch {
      return { outcome: "invalid", error: "That Google sign-in could not be checked." };
    }
  }

  async signInApple(
    idToken: string,
    currentUserId: string | null,
    confirm: boolean,
    age13: boolean | null = null,
  ): Promise<SignInResult> {
    if (!this.options.apple) return { outcome: "not-configured", error: "Apple sign-in is not configured yet." };
    if (!idToken) return { outcome: "invalid", error: "Apple did not send a sign-in." };
    try {
      const verify = this.options.verifyApple ?? verifyAppleIdToken;
      const identity = await verify(idToken, this.options.apple.clientId);
      return this.finishIdentity({
        provider: "apple",
        subject: identity.sub,
        email: normalizeEmail(identity.email),
        currentUserId,
        confirm,
        age13,
      });
    } catch {
      return { outcome: "invalid", error: "That Apple sign-in could not be checked." };
    }
  }

  async requestMagicLink(input: {
    email: string;
    currentUserId: string | null;
    ip: string;
    origin: string;
    age13?: boolean | null;
  }): Promise<{ ok: true; devLink?: string } | { ok: false; error: string; status: number }> {
    const email = normalizeEmail(input.email);
    if (!email) return { ok: false, error: "Use a real email address.", status: 400 };
    const current = input.currentUserId ? this.present(input.currentUserId) : null;
    const owner = this.store.userByEmail(email);
    const aged = input.age13 === true || input.age13 == null || current?.ageOk || owner?.age_ok === 1;
    if (!aged) return { ok: false, error: "Confirm you are 13 or older.", status: 400 };
    const now = this.now().getTime();
    if (!this.limit.allow(`email:${email}`, 5, MAGIC_MS, now) || !this.limit.allow(`ip:${input.ip}`, 20, MAGIC_MS, now)) {
      return { ok: false, error: "Wait a few minutes, then ask for another link.", status: 429 };
    }
    const token = randomBytes(32).toString("base64url");
    const stamp = this.stamp();
    this.store.insertMagicLink({
      id: randomUUID(),
      email,
      token_hash: sha256(token),
      user_id: input.currentUserId,
      expires_at: new Date(now + MAGIC_MS).toISOString(),
      used_at: null,
      created_at: stamp,
      age_ok: 1,
    });
    const link = `${input.origin.replace(/\/$/, "")}/?email-token=${encodeURIComponent(token)}`;
    const sender = this.options.sendEmail ?? (this.options.resendApiKey && this.options.emailFrom ? this.resend.bind(this) : null);
    if (sender) {
      try {
        await sender(email, link);
      } catch {
        // A refused send (the domain is not verified yet, or the provider is down)
        // is our outage. 502 makes Render and the browser treat it as a dead edge.
        return {
          ok: false,
          error: "Email sign-in is temporarily unavailable, try Google or play as guest",
          status: 503,
        };
      }
      return { ok: true };
    }
    if (this.options.devMagicLink) {
      console.info(`Magic link for ${email}: ${link}`);
      return { ok: true, devLink: link };
    }
    return { ok: false, error: "Email sign-in is not available yet.", status: 503 };
  }

  async consumeMagicLink(
    token: string,
    currentUserId: string | null,
    confirm: boolean,
    age13: boolean | null = null,
  ): Promise<SignInResult> {
    if (!token || token.length < 20) return { outcome: "invalid", error: "That link is not valid." };
    const row = this.store.magicLinkByHash(sha256(token));
    if (!row || row.used_at || Date.parse(row.expires_at) <= this.now().getTime()) {
      return { outcome: "invalid", error: "That link has expired. Ask for a new one." };
    }
    const result = this.finishIdentity({
      provider: "email",
      subject: row.email,
      email: row.email,
      currentUserId: currentUserId ?? row.user_id,
      preferredUserId: row.user_id,
      confirm,
      age13: age13 === true || age13 === null || row.age_ok === 1 ? true : false,
    });
    if (result.outcome === "ok") this.store.markMagicLinkUsed(row.id, this.stamp());
    return result;
  }

  cookieFor(token: string): string {
    return signToken(token, this.options.secret);
  }

  private finishIdentity(input: {
    provider: "google" | "apple" | "email";
    subject: string;
    email: string | null;
    currentUserId: string | null;
    preferredUserId?: string | null;
    confirm: boolean;
    age13?: boolean | null;
  }): SignInResult {
    const byProvider = this.store.identity(input.provider, input.subject);
    if (byProvider) {
      if (input.email && !byProvider.email) this.store.setIdentityEmail(byProvider.id, input.email);
      const gate = this.allowAge(byProvider.user_id, input.age13);
      if (gate) return gate;
      return this.useExisting(byProvider.user_id, input.currentUserId, input.confirm);
    }
    const emailOwner = input.email ? this.store.userByEmail(input.email) : null;
    // A magic link belongs to the guest who asked for it, even if another guest opens it.
    const target = input.preferredUserId ?? input.currentUserId ?? null;
    if (emailOwner && emailOwner.id !== target) {
      const gate = this.allowAge(emailOwner.id, input.age13);
      if (gate) return gate;
      const switched = this.useExisting(emailOwner.id, input.currentUserId, input.confirm);
      if (switched.outcome === "ok") this.attach(emailOwner.id, input.provider, input.subject, input.email);
      return switched;
    }
    const creating = !target;
    if (creating && input.age13 === false) return { outcome: "invalid", error: "Confirm you are 13 or older." };
    const targetId = target ?? this.insertUser(nameFromEmail(input.email), false).id;
    if (target) {
      const gate = this.allowAge(targetId, input.age13);
      if (gate) return gate;
    } else this.store.markAge(targetId, this.stamp());
    this.attach(targetId, input.provider, input.subject, input.email);
    return { outcome: "ok", user: this.present(targetId)!, token: this.issue(targetId) };
  }

  /** Existing accounts confirm once. A missing flag on a direct call counts as confirmed. */
  private allowAge(userId: string, age13: boolean | null | undefined): SignInResult | null {
    const aged = age13 === true || age13 == null || this.present(userId)?.ageOk === true;
    if (!aged) return { outcome: "invalid", error: "Confirm you are 13 or older." };
    if (age13 === true || age13 == null) this.store.markAge(userId, this.stamp());
    return null;
  }

  /**
   * An identity that already belongs to someone else stays on that account.
   * The phone keeps the guest until the player confirms they want to switch.
   */
  private useExisting(ownerId: string, currentUserId: string | null, confirm: boolean): SignInResult {
    if (currentUserId && currentUserId !== ownerId && !confirm) {
      return {
        outcome: "already-claimed",
        current: this.present(currentUserId),
        existing: this.present(ownerId)!,
      };
    }
    if (currentUserId && currentUserId !== ownerId && confirm) mergeDaily(this.store, currentUserId, ownerId, this.now());
    return { outcome: "ok", user: this.present(ownerId)!, token: this.issue(ownerId) };
  }

  private attach(userId: string, provider: ProviderName, subject: string, email: string | null): void {
    if (this.store.identity(provider, subject)) return;
    this.store.insertIdentity({
      id: randomUUID(),
      user_id: userId,
      provider,
      provider_subject: subject,
      email,
      created_at: this.stamp(),
    });
    if (provider !== "guest") this.store.updateUser(userId, { is_guest: 0, updated_at: this.stamp() });
  }

  private insertUser(displayName: string, guest: boolean): { id: string } {
    const stamp = this.stamp();
    const id = randomUUID();
    this.store.insertUser({
      id,
      display_name: displayName,
      avatar_id: "2hot4tv",
      created_at: stamp,
      updated_at: stamp,
      is_guest: guest ? 1 : 0,
      is_soak: isSoakName(displayName) ? 1 : 0,
    });
    return { id };
  }

  private issue(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    const stamp = this.stamp();
    this.store.insertSession({
      id: randomUUID(),
      user_id: userId,
      token_hash: sha256(token),
      expires_at: new Date(this.now().getTime() + SESSION_MS).toISOString(),
      created_at: stamp,
      last_seen_at: stamp,
    });
    return this.cookieFor(token);
  }

  private present(userId: string): PublicUser | null {
    new Cosmetics(this.store, this.now).loadout(userId);
    const user = this.store.user(userId);
    if (!user) return null;
    const providers = this.store.identitiesForUser(userId).map((row) => row.provider as ProviderName);
    const standing = describePlayer(this.store, userId, this.now());
    if (!standing) return null;
    return {
      id: user.id,
      displayName: user.display_name,
      avatarId: resolveAvatar(user.avatar_id),
      guest: user.is_guest === 1,
      providers,
      ageOk: user.age_ok === 1 || user.is_bot === 1 || user.is_soak === 1,
      ...standing,
    };
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private async resend(to: string, link: string): Promise<void> {
    const key = this.options.resendApiKey;
    const from = this.options.emailFrom;
    if (!key || !from) throw new Error("Email is not configured.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Your Uh Oh Dominoes sign-in link",
        text: `Tap this link to sign in. It works once and expires in 15 minutes.\n\n${link}\n`,
      }),
    });
    if (!response.ok) throw new Error("Email was refused.");
  }
}

function nameFromEmail(email: string | null): string {
  const local = email?.split("@")[0]?.replace(/[^a-zA-Z0-9 ]/g, " ").trim() || "Player";
  const name = cleanName(local.slice(0, 16)) ?? "Player";
  return blockedSpeech(name) ? "Player" : name;
}

export function appleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppleConfig | null {
  const clientId = env.APPLE_CLIENT_ID?.trim() ?? "";
  const teamId = env.APPLE_TEAM_ID?.trim() ?? "";
  const keyId = env.APPLE_KEY_ID?.trim() ?? "";
  const privateKey = env.APPLE_PRIVATE_KEY?.trim() ?? "";
  if (!clientId || !teamId || !keyId || !privateKey) return null;
  if (!privateKey.includes("PRIVATE KEY")) return null;
  return { clientId, teamId, keyId, privateKey };
}
