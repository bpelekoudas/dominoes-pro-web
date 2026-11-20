import Stripe from "stripe";
import { TEST_BONES, TEST_GOLD } from "@uhoh/rules";
import type { Store } from "./db.js";
import {
  CHECKOUT_CANCEL_URL,
  CHECKOUT_SUCCESS_URL,
  COIN_PACKS,
  DIGITAL_TAX_CODE,
  PACK_DESCRIPTION,
  STORE_COMING_SOON,
  isTestSecretKey,
  packByLookup,
  type CoinPack,
} from "./coins.js";

/** Stripe sends these. Grant coins only from a verified delivery of one of them. */
export const CHECKOUT_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
] as const;

export const WEBHOOK_PATH = "/api/stripe/webhook";

export interface SavedPrice {
  id: string;
  lookupKey: string;
  cents: number;
  currency: string;
}

export interface CheckoutInput {
  priceId: string;
  userId: string;
  lookupKey: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * The only Stripe calls the shop makes. Tests pass a fake.
 * Managed Payments is the seller of record, so the session must not
 * choose payment methods, tax, or a statement descriptor.
 */
export interface ShopStripe {
  /** A cheap authenticated read. Used at boot so a bad key is not confused with a missing product. */
  checkAuth(): Promise<void>;
  findPrice(lookupKey: string): Promise<SavedPrice | null>;
  savePrice(pack: CoinPack): Promise<SavedPrice>;
  startCheckout(input: CheckoutInput): Promise<{ url: string }>;
}

export type StoreCloseReason =
  | "no_secret_key"
  | "no_webhook_secret"
  | "not_test_key"
  | "live_key"
  | "stripe_auth_failed"
  | "stripe_unreachable"
  | "webhook_secret_invalid"
  | "products_failed";

export interface StoreStatus {
  open: boolean;
  reason?: StoreCloseReason;
  /** Shape only. Never the key. */
  secretKey: "missing" | "test" | "live" | "other";
  secretKeyBytes: number;
  webhookSecretBytes: number;
}

/** A real Stripe webhook secret is `whsec_` plus a long token. Ten bytes is not one. */
const WEBHOOK_SECRET_MIN_BYTES = 24;

export interface ShopCatalog {
  open: boolean;
  packs: Array<{ lookupKey: string; cents: number; coins: number; name: string }>;
}

export interface WebhookResult {
  status: number;
  body: { received?: true; error?: string };
}

export function checkoutSessionParams(input: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    managed_payments: { enabled: true },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.userId,
    metadata: {
      user_id: input.userId,
      lookup_key: input.lookupKey,
    },
  };
}

export function liveStripe(secretKey: string): ShopStripe {
  const stripe = new Stripe(secretKey, { timeout: 8_000, maxNetworkRetries: 0 });
  return {
    async checkAuth() {
      await stripe.balance.retrieve();
    },
    async findPrice(lookupKey) {
      const list = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
      const price = list.data[0];
      if (!price || price.unit_amount == null) return null;
      return { id: price.id, lookupKey, cents: price.unit_amount, currency: price.currency };
    },
    async savePrice(pack) {
      const product = await stripe.products.create({
        name: pack.name,
        description: PACK_DESCRIPTION,
        tax_code: DIGITAL_TAX_CODE,
        metadata: { lookup_key: pack.lookupKey },
      });
      try {
        const price = await stripe.prices.create({
          product: product.id,
          currency: "usd",
          unit_amount: pack.cents,
          lookup_key: pack.lookupKey,
          transfer_lookup_key: true,
        });
        if (price.unit_amount == null) throw new Error("Stripe did not return a price.");
        return { id: price.id, lookupKey: pack.lookupKey, cents: price.unit_amount, currency: price.currency };
      } catch (error) {
        const again = await stripe.prices.list({ lookup_keys: [pack.lookupKey], active: true, limit: 1 });
        const price = again.data[0];
        if (price && price.unit_amount === pack.cents && price.currency === "usd") {
          return { id: price.id, lookupKey: pack.lookupKey, cents: price.unit_amount, currency: price.currency };
        }
        throw error;
      }
    },
    async startCheckout(input) {
      const session = await stripe.checkout.sessions.create(checkoutSessionParams(input));
      if (!session.url) throw new Error("Checkout did not return a URL.");
      return { url: session.url };
    },
  };
}

/**
 * Open the shop only for a test key plus a webhook secret that looks real.
 * A live key is ignored. A missing or short secret leaves the shop closed and grants nothing.
 * The boot always logs a status line. Lengths are logged. The key and the secret are not.
 */
export async function shopFromEnv(
  store: Store,
  env: { secretKey?: string | null; webhookSecret?: string | null },
  stripeFactory: (secretKey: string) => ShopStripe = liveStripe,
): Promise<CoinShop> {
  const secretKey = unwrapEnv(env.secretKey);
  const webhookSecret = unwrapEnv(env.webhookSecret);
  const shape = secretKeyShape(secretKey);
  const keyBytes = secretKey.length;
  const webhookBytes = webhookSecret.length;
  console.info(`Store boot: secretKey=${shape} secretKeyBytes=${keyBytes} webhookSecretBytes=${webhookBytes}`);

  const finish = (reason: StoreCloseReason | undefined, stripe: ShopStripe | null, secret: string | null) => {
    if (reason) console.warn(`Store closed: ${reason}`);
    const shop = new CoinShop(store, stripe, secret);
    shop.note(reason, shape, keyBytes, webhookBytes);
    return shop;
  };

  if (shape === "missing") return finish("no_secret_key", null, null);
  if (shape === "live") return finish("live_key", null, null);
  if (shape !== "test") return finish("not_test_key", null, null);

  const client = stripeFactory(secretKey);
  try {
    await client.checkAuth();
    console.info("Store Stripe auth ok");
  } catch (error) {
    const reason = isAuthError(error) ? "stripe_auth_failed" : "stripe_unreachable";
    console.warn(`Store closed: ${reason} ${stripeErrorCode(error)}`);
    const shop = new CoinShop(store, null, null);
    shop.note(reason, shape, keyBytes, webhookBytes);
    return shop;
  }

  if (webhookBytes === 0) return finish("no_webhook_secret", null, null);
  if (!webhookSecretOk(webhookSecret)) return finish("webhook_secret_invalid", null, null);

  const shop = new CoinShop(store, client, webhookSecret);
  shop.note(undefined, shape, keyBytes, webhookBytes);
  try {
    await shop.sync();
    return shop;
  } catch (error) {
    console.warn(`Store closed: products_failed ${stripeErrorCode(error)}`);
    shop.note("products_failed", shape, keyBytes, webhookBytes);
    return shop;
  }
}

export class CoinShop {
  private priceIds = new Map<string, string>();
  private ready = false;
  private reason: StoreCloseReason | undefined;
  private keyShape: StoreStatus["secretKey"] = "missing";
  private keyBytes = 0;
  private webhookBytes: number;

  constructor(
    private readonly store: Store,
    private readonly stripe: ShopStripe | null,
    private readonly webhookSecret: string | null,
  ) {
    this.webhookBytes = webhookSecret?.length ?? 0;
    this.reason = webhookSecret ? undefined : "no_webhook_secret";
  }

  get open(): boolean {
    return this.ready;
  }

  note(
    reason: StoreCloseReason | undefined,
    shape: StoreStatus["secretKey"],
    keyBytes: number,
    webhookBytes: number,
  ): void {
    this.reason = reason;
    this.keyShape = shape;
    this.keyBytes = keyBytes;
    this.webhookBytes = webhookBytes;
    if (reason) this.ready = false;
  }

  /** Public, non-secret snapshot of why the shop is open or closed. */
  statusReport(): StoreStatus {
    const body: StoreStatus = {
      open: this.ready,
      secretKey: this.keyShape,
      secretKeyBytes: this.keyBytes,
      webhookSecretBytes: this.webhookBytes,
    };
    if (!this.ready && this.reason) body.reason = this.reason;
    return body;
  }

  catalog(): ShopCatalog {
    if (!this.ready) return { open: false, packs: [] };
    return {
      open: true,
      packs: COIN_PACKS.map((pack) => ({
        lookupKey: pack.lookupKey,
        cents: pack.cents,
        coins: pack.coins,
        name: pack.name,
      })),
    };
  }

  async sync(): Promise<void> {
    if (!this.stripe) return;
    const ids = new Map<string, string>();
    for (const pack of COIN_PACKS) {
      const found = await this.stripe.findPrice(pack.lookupKey);
      const price =
        found && found.cents === pack.cents && found.currency === "usd" ? found : await this.stripe.savePrice(pack);
      if (price.cents !== pack.cents || price.currency !== "usd" || !price.id) {
        throw new Error(`The price for ${pack.lookupKey} does not match the server config.`);
      }
      ids.set(pack.lookupKey, price.id);
      console.info(`Store price ready: ${pack.lookupKey}`);
    }
    this.priceIds = ids;
    this.ready = ids.size === COIN_PACKS.length;
    if (this.ready) {
      this.reason = undefined;
      console.info("Store open");
    }
  }

  async startCheckout(userId: string, lookupKey: string): Promise<{ url: string } | { error: string; status: number }> {
    if (!this.ready || !this.stripe) return { error: STORE_COMING_SOON, status: 503 };
    const user = this.store.user(userId);
    if (!user || user.is_bot === 1) {
      return { error: "Sign in or continue as a guest, then buy Gold Bones.", status: 401 };
    }
    const pack = packByLookup(lookupKey);
    if (!pack) return { error: "That pack isn't for sale.", status: 400 };
    const priceId = this.priceIds.get(pack.lookupKey);
    if (!priceId) return { error: STORE_COMING_SOON, status: 503 };
    try {
      const session = await this.stripe.startCheckout({
        priceId,
        userId: user.id,
        lookupKey: pack.lookupKey,
        successUrl: CHECKOUT_SUCCESS_URL,
        cancelUrl: CHECKOUT_CANCEL_URL,
      });
      if (!session.url.startsWith("https://")) return { error: STORE_COMING_SOON, status: 503 };
      return { url: session.url };
    } catch (error) {
      console.warn(`Checkout did not start. ${safeReason(error)}`);
      return { error: STORE_COMING_SOON, status: 503 };
    }
  }

  /**
   * Verify the Stripe signature, then grant Gold Bones once per session.
   * A missing secret refuses before any read of the body is trusted.
   */
  receive(raw: Buffer, signature: string | undefined): WebhookResult {
    if (!this.webhookSecret) return { status: 503, body: { error: STORE_COMING_SOON } };
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(raw, signature ?? "", this.webhookSecret);
    } catch {
      return { status: 400, body: { error: "The signature did not match." } };
    }
    if (!isCheckoutEvent(event.type)) return { status: 200, body: { received: true } };
    try {
      this.grant(event);
    } catch (error) {
      console.warn(`A Stripe event could not be recorded. ${event.id}. ${safeReason(error)}`);
      return { status: 500, body: { error: "The payment could not be recorded." } };
    }
    return { status: 200, body: { received: true } };
  }

  private grant(event: Stripe.Event): void {
    const session = sessionOf(event);
    const sessionId = session?.id ?? "";
    const lookupKey = session?.metadata?.lookup_key ?? "";
    const userId = session?.metadata?.user_id ?? "";
    const reference = session?.client_reference_id ?? "";
    const pack = packByLookup(lookupKey);
    const paid = session?.payment_status === "paid";
    const amountOk = Boolean(
      pack && session?.currency?.toLowerCase() === "usd" && session.amount_subtotal === pack.cents,
    );
    const user = userId && userId === reference ? this.store.user(userId) : null;
    const canGrant = Boolean(paid && amountOk && pack && user && user.is_bot !== 1 && sessionId && event.id);
    const db = this.store.db;
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const seenEvent = db.prepare(`SELECT event_id FROM stripe_events WHERE event_id = ?`).get(event.id) as
        | { event_id: string }
        | undefined;
      if (seenEvent) {
        db.exec("COMMIT");
        return;
      }
      const seenSession = sessionId
        ? (db.prepare(`SELECT session_id FROM coin_purchases WHERE session_id = ?`).get(sessionId) as
            | { session_id: string }
            | undefined)
        : undefined;
      if (!canGrant || seenSession || !pack) {
        db.prepare(
          `INSERT INTO stripe_events (event_id, event_type, session_id, created_at) VALUES (?, ?, ?, ?)`,
        ).run(event.id, event.type, sessionId || null, now);
        db.exec("COMMIT");
        return;
      }
      const existing = db.prepare(`SELECT gold_bones FROM wallets WHERE user_id = ?`).get(userId) as
        | { gold_bones: number }
        | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO wallets (user_id, bones, gold_bones, created_at, earned_today) VALUES (?, ?, ?, ?, 0)`,
        ).run(userId, TEST_BONES, TEST_GOLD + pack.coins, now);
      } else {
        db.prepare(`UPDATE wallets SET gold_bones = gold_bones + ? WHERE user_id = ?`).run(pack.coins, userId);
      }
      db.prepare(
        `INSERT INTO coin_purchases (session_id, event_id, user_id, lookup_key, coins, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(sessionId, event.id, userId, pack.lookupKey, pack.coins, now);
      db.prepare(
        `INSERT INTO stripe_events (event_id, event_type, session_id, created_at) VALUES (?, ?, ?, ?)`,
      ).run(event.id, event.type, sessionId, now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function isCheckoutEvent(type: string): boolean {
  return (CHECKOUT_EVENT_TYPES as readonly string[]).includes(type);
}

function sessionOf(event: Stripe.Event): Stripe.Checkout.Session | null {
  const object = event.data?.object as { object?: string } | undefined;
  if (!object || object.object !== "checkout.session") return null;
  return event.data.object as Stripe.Checkout.Session;
}

function unwrapEnv(value: string | null | undefined): string {
  let text = value?.trim() ?? "";
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function secretKeyShape(key: string): StoreStatus["secretKey"] {
  if (!key) return "missing";
  if (key.startsWith("sk_live_")) return "live";
  if (isTestSecretKey(key)) return "test";
  return "other";
}

function webhookSecretOk(secret: string): boolean {
  return secret.startsWith("whsec_") && secret.length >= WEBHOOK_SECRET_MIN_BYTES;
}

function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { statusCode?: unknown; type?: unknown };
  const status = typeof record.statusCode === "number" ? record.statusCode : 0;
  const type = typeof record.type === "string" ? record.type : "";
  return status === 401 || status === 403 || type === "StripeAuthenticationError" || type === "StripePermissionError";
}

/** Type, code, and HTTP status only. Stripe messages can echo part of a key. */
function stripeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const record = error as { type?: unknown; code?: unknown; statusCode?: unknown };
  const parts = [record.type, record.code, record.statusCode].filter(
    (part) => typeof part === "string" || typeof part === "number",
  );
  return parts.join(" ") || "unknown";
}

function safeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return message
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_redacted")
    .replace(/whsec_[A-Za-z0-9]+/g, "whsec_redacted");
}
