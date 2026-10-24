import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { TEST_GOLD } from "@uhoh/rules";
import { COIN_PACKS, SUPPORT_EMAIL, packByLookup } from "./coins.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";
import { CoinShop, checkoutSessionParams, shopFromEnv, type CheckoutInput, type ShopStripe } from "./stripe-shop.js";

const SECRET = "whsec_test_secret";

function goldOf(store: Store, userId: string): number {
  const row = store.db.prepare(`SELECT gold_bones FROM wallets WHERE user_id = ?`).get(userId) as
    | { gold_bones: number }
    | undefined;
  return row?.gold_bones ?? 0;
}

function seedWallet(store: Store, userId: string, gold = 10): void {
  const existing = store.db.prepare(`SELECT user_id FROM wallets WHERE user_id = ?`).get(userId);
  if (existing) {
    store.db.prepare(`UPDATE wallets SET gold_bones = ? WHERE user_id = ?`).run(gold, userId);
    return;
  }
  store.db
    .prepare(`INSERT INTO wallets (user_id, bones, gold_bones, created_at, earned_today) VALUES (?, 0, ?, ?, 0)`)
    .run(userId, gold, new Date().toISOString());
}

function purchaseCount(store: Store): number {
  const row = store.db.prepare(`SELECT COUNT(*) AS count FROM coin_purchases`).get() as { count: number };
  return row.count;
}

function eventCount(store: Store): number {
  const row = store.db.prepare(`SELECT COUNT(*) AS count FROM stripe_events`).get() as { count: number };
  return row.count;
}

function paidEvent(input: {
  id?: string;
  type?: string;
  sessionId?: string;
  userId: string;
  reference?: string;
  lookupKey?: string;
  paymentStatus?: string;
  subtotal?: number | null;
  currency?: string;
}) {
  const pack = packByLookup(input.lookupKey ?? "coins_099");
  return {
    id: input.id ?? "evt_paid",
    object: "event",
    type: input.type ?? "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId ?? "cs_paid",
        object: "checkout.session",
        payment_status: input.paymentStatus ?? "paid",
        currency: input.currency ?? "usd",
        amount_subtotal: input.subtotal === undefined ? pack?.cents : input.subtotal,
        amount_total: (pack?.cents ?? 0) + 20,
        client_reference_id: input.reference ?? input.userId,
        metadata: {
          user_id: input.userId,
          lookup_key: input.lookupKey ?? "coins_099",
          coins: "999999",
        },
      },
    },
  };
}

async function postEvent(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  event: unknown,
  secret = SECRET,
) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return app.inject({
    method: "POST",
    url: "/api/stripe/webhook",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    payload,
  });
}

async function guest(app: Awaited<ReturnType<typeof createApp>>["app"]) {
  const created = await app.inject({ method: "POST", url: "/api/guest", payload: { displayName: "Ada" } });
  expect(created.statusCode).toBe(200);
  const id = created.json().user.id as string;
  const cookie = String(created.headers["set-cookie"]).split(";")[0] ?? "";
  return { id, cookie };
}

describe("coin packs", () => {
  it("prices four packs and gives more Gold Bones per dollar as the pack gets bigger", () => {
    expect(COIN_PACKS.map((pack) => pack.cents)).toEqual([99, 499, 999, 1999]);
    expect(COIN_PACKS.map((pack) => pack.lookupKey)).toEqual(["coins_099", "coins_499", "coins_999", "coins_1999"]);
    const rates = COIN_PACKS.map((pack) => pack.coins / (pack.cents / 100));
    for (let index = 1; index < rates.length; index += 1) {
      expect(rates[index]).toBeGreaterThan(rates[index - 1] ?? 0);
    }
    const text = JSON.stringify(COIN_PACKS);
    expect(text).not.toContain("CHR-015");
    expect(text.toLowerCase()).not.toContain("2 hot");
    expect(text.toLowerCase()).not.toContain("2hot4tv");
  });
});

describe("stripe webhook", () => {
  it("grants the configured coins once for a signed paid session, and ignores a client coin count", async () => {
    const store = new Store(":memory:");
    const shop = new CoinShop(store, null, SECRET);
    const { app } = await createApp({ store, shop, serveWeb: false });
    try {
      const buyer = await guest(app);
      seedWallet(store, buyer.id, 10);
      const pack = packByLookup("coins_099");
      const event = paidEvent({ userId: buyer.id });
      const first = await postEvent(app, event);
      const second = await postEvent(app, event);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(goldOf(store, buyer.id)).toBe(10 + (pack?.coins ?? 0));
      expect(goldOf(store, buyer.id)).not.toBe(10 + 999999);
      expect(purchaseCount(store)).toBe(1);
      expect(eventCount(store)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("opens a missing wallet at the starter balance plus the pack", async () => {
    const store = new Store(":memory:");
    const shop = new CoinShop(store, null, SECRET);
    const { app } = await createApp({ store, shop, serveWeb: false });
    try {
      const buyer = await guest(app);
      store.db.prepare(`DELETE FROM wallets WHERE user_id = ?`).run(buyer.id);
      const pack = packByLookup("coins_099");
      const response = await postEvent(app, paidEvent({ id: "evt_new_wallet", sessionId: "cs_new_wallet", userId: buyer.id }));
      expect(response.statusCode).toBe(200);
      expect(goldOf(store, buyer.id)).toBe(TEST_GOLD + (pack?.coins ?? 0));
    } finally {
      await app.close();
    }
  });

  it("does not grant again when a second event arrives for the same session", async () => {
    const store = new Store(":memory:");
    const shop = new CoinShop(store, null, SECRET);
    const { app } = await createApp({ store, shop, serveWeb: false });
    try {
      const buyer = await guest(app);
      seedWallet(store, buyer.id, 10);
      const pack = packByLookup("coins_499");
      const completed = await postEvent(
        app,
        paidEvent({ id: "evt_done", sessionId: "cs_same", userId: buyer.id, lookupKey: "coins_499" }),
      );
      const asyncPaid = await postEvent(
        app,
        paidEvent({
          id: "evt_async",
          type: "checkout.session.async_payment_succeeded",
          sessionId: "cs_same",
          userId: buyer.id,
          lookupKey: "coins_499",
        }),
      );
      expect(completed.statusCode).toBe(200);
      expect(asyncPaid.statusCode).toBe(200);
      expect(goldOf(store, buyer.id)).toBe(10 + (pack?.coins ?? 0));
      expect(purchaseCount(store)).toBe(1);
      expect(eventCount(store)).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("grants from async_payment_succeeded after an unpaid completed event", async () => {
    const store = new Store(":memory:");
    const shop = new CoinShop(store, null, SECRET);
    const { app } = await createApp({ store, shop, serveWeb: false });
    try {
      const buyer = await guest(app);
      seedWallet(store, buyer.id, 10);
      const pack = packByLookup("coins_099");
      const unpaid = await postEvent(
        app,
        paidEvent({ id: "evt_unpaid", sessionId: "cs_later", userId: buyer.id, paymentStatus: "unpaid" }),
      );
      expect(unpaid.statusCode).toBe(200);
      expect(goldOf(store, buyer.id)).toBe(10);
      const paid = await postEvent(
        app,
        paidEvent({
          id: "evt_later",
          type: "checkout.session.async_payment_succeeded",
          sessionId: "cs_later",
          userId: buyer.id,
        }),
      );
      expect(paid.statusCode).toBe(200);
      expect(goldOf(store, buyer.id)).toBe(10 + (pack?.coins ?? 0));
      expect(purchaseCount(store)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("rejects a bad signature and grants nothing", async () => {
    const store = new Store(":memory:");
    const shop = new CoinShop(store, null, SECRET);
    const { app } = await createApp({ store, shop, serveWeb: false });
    try {
      const buyer = await guest(app);
      seedWallet(store, buyer.id, 10);
      const payload = JSON.stringify(paidEvent({ userId: buyer.id }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
      const response = await app.inject({
        method: "POST",
        url: "/api/stripe/webhook",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: payload.replace("coins_099", "coins_1999"),
      });
      expect(response.statusCode).toBe(400);
      expect(goldOf(store, buyer.id)).toBe(10);
      expect(purchaseCount(store)).toBe(0);
      expect(eventCount(store)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("grants nothing and stays closed when the webhook secret is missing", async () => {
    const store = new Store(":memory:");
    const { app } = await createApp({ store, serveWeb: false });
    try {
      const buyer = await guest(app);
      seedWallet(store, buyer.id, 10);
      const response = await postEvent(app, paidEvent({ userId: buyer.id }));
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe("Store coming soon");
      expect(goldOf(store, buyer.id)).toBe(10);
      expect(purchaseCount(store)).toBe(0);
      const shop = await app.inject({ method: "GET", url: "/api/shop", headers: { cookie: buyer.cookie } });
      expect(shop.statusCode).toBe(200);
      expect(shop.json()).toEqual({ open: false, packs: [] });
      const checkout = await app.inject({
        method: "POST",
        url: "/api/shop/checkout",
        headers: { cookie: buyer.cookie },
        payload: { lookupKey: "coins_099", coins: 1 },
      });
      expect(checkout.statusCode).toBe(503);
      expect(checkout.json().error).toBe("Store coming soon");
    } finally {
      await app.close();
    }
  });

  it("does not grant when the paid amount does not match the pack", async () => {
    const store = new Store(":memory:");
    const shop = new CoinShop(store, null, SECRET);
    const { app } = await createApp({ store, shop, serveWeb: false });
    try {
      const buyer = await guest(app);
      seedWallet(store, buyer.id, 10);
      const response = await postEvent(app, paidEvent({ userId: buyer.id, subtotal: 1 }));
      expect(response.statusCode).toBe(200);
      expect(goldOf(store, buyer.id)).toBe(10);
      expect(purchaseCount(store)).toBe(0);
      expect(eventCount(store)).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe("checkout", () => {
  it("sends the server price to Checkout and does not take a coin count from the client", async () => {
    const store = new Store(":memory:");
    const calls: CheckoutInput[] = [];
    const stripe: ShopStripe = {
      async checkAuth() {
        return undefined;
      },
      async findPrice() {
        return null;
      },
      async savePrice(pack) {
        return { id: `price_${pack.lookupKey}`, lookupKey: pack.lookupKey, cents: pack.cents, currency: "usd" };
      },
      async startCheckout(input) {
        calls.push(input);
        return { url: "https://checkout.stripe.com/c/pay/cs_test_shop" };
      },
    };
    const shop = new CoinShop(store, stripe, SECRET);
    await shop.sync();
    const { app } = await createApp({ store, shop, serveWeb: false });
    try {
      const buyer = await guest(app);
      const response = await app.inject({
        method: "POST",
        url: "/api/shop/checkout",
        headers: { cookie: buyer.cookie },
        payload: { lookupKey: "coins_999", coins: 1, cents: 1 },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().url).toBe("https://checkout.stripe.com/c/pay/cs_test_shop");
      const pack = packByLookup("coins_999");
      expect(calls).toEqual([
        {
          priceId: "price_coins_999",
          userId: buyer.id,
          lookupKey: "coins_999",
          successUrl: "https://uhohdominoes.com/?checkout=success",
          cancelUrl: "https://uhohdominoes.com/?checkout=cancel",
        },
      ]);
      const params = checkoutSessionParams(calls[0]!);
      expect(params.mode).toBe("payment");
      expect(params.managed_payments).toEqual({ enabled: true });
      expect(params.line_items).toEqual([{ price: "price_coins_999", quantity: 1 }]);
      expect(params.metadata).toEqual({ user_id: buyer.id, lookup_key: "coins_999" });
      expect(params).not.toHaveProperty("payment_method_types");
      expect(params).not.toHaveProperty("automatic_tax");
      expect(JSON.stringify(params)).not.toContain(String(pack?.coins));
      const catalog = await app.inject({ method: "GET", url: "/api/shop", headers: { cookie: buyer.cookie } });
      expect(catalog.json()).toEqual({
        open: true,
        packs: COIN_PACKS.map((item) => ({
          lookupKey: item.lookupKey,
          cents: item.cents,
          coins: item.coins,
          name: item.name,
        })),
      });
      const stranger = await app.inject({ method: "POST", url: "/api/shop/checkout", payload: { lookupKey: "coins_099" } });
      expect(stranger.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("ignores a live key and does not call Stripe", async () => {
    const store = new Store(":memory:");
    let called = false;
    const shop = await shopFromEnv(store, { secretKey: "sk_live_secret", webhookSecret: SECRET }, () => {
      called = true;
      throw new Error("live key must not build a client");
    });
    expect(called).toBe(false);
    expect(shop.open).toBe(false);
    expect(shop.statusReport()).toMatchObject({ open: false, reason: "live_key", secretKey: "live", secretKeyBytes: "sk_live_secret".length });
    expect(shop.receive(Buffer.from("{}"), "signed").status).toBe(503);
  });

  it("checks Stripe auth, then reports a missing, short, or rejected setup without creating prices", async () => {
    const store = new Store(":memory:");
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      let saved = 0;
      const authError = Object.assign(new Error("Invalid API Key provided: sk_test_abcdefghijklmnopqrstuvwxyz"), {
        type: "StripeAuthenticationError",
        statusCode: 401,
        code: "api_key_expired",
      });
      const rejected = await shopFromEnv(store, { secretKey: "sk_test_abc", webhookSecret: "whsec_short" }, () => ({
        async checkAuth() {
          throw authError;
        },
        async findPrice() {
          return null;
        },
        async savePrice(pack) {
          saved += 1;
          return { id: pack.lookupKey, lookupKey: pack.lookupKey, cents: pack.cents, currency: "usd" };
        },
        async startCheckout() {
          return { url: "https://checkout.stripe.com/c/pay/cs_test" };
        },
      }));
      expect(saved).toBe(0);
      expect(rejected.statusReport()).toEqual({
        open: false,
        reason: "stripe_auth_failed",
        secretKey: "test",
        secretKeyBytes: "sk_test_abc".length,
        webhookSecretBytes: "whsec_short".length,
      });
      expect(warnings.join("\n")).toContain("stripe_auth_failed");
      expect(warnings.join("\n")).not.toContain("sk_test_abc");

      let authed = 0;
      const short = await shopFromEnv(store, { secretKey: '"sk_test_only"', webhookSecret: "xxxxxxxxxx" }, () => ({
        async checkAuth() {
          authed += 1;
        },
        async findPrice() {
          return null;
        },
        async savePrice() {
          saved += 1;
          throw new Error("prices must not be created");
        },
        async startCheckout() {
          return { url: "https://checkout.stripe.com/c/pay/cs_test" };
        },
      }));
      expect(authed).toBe(1);
      expect(saved).toBe(0);
      expect(short.statusReport().reason).toBe("webhook_secret_invalid");
      expect(short.statusReport().webhookSecretBytes).toBe(10);

      const missingSecret = await shopFromEnv(store, { secretKey: "sk_test_only", webhookSecret: "" }, () => ({
        async checkAuth() {
          authed += 1;
        },
        async findPrice() {
          return null;
        },
        async savePrice() {
          saved += 1;
          throw new Error("prices must not be created");
        },
        async startCheckout() {
          return { url: "https://checkout.stripe.com/c/pay/cs_test" };
        },
      }));
      expect(missingSecret.statusReport().reason).toBe("no_webhook_secret");
      expect(saved).toBe(0);

      const brokenPrices = await shopFromEnv(
        store,
        { secretKey: "sk_test_only", webhookSecret: `whsec_${"a".repeat(30)}` },
        () => ({
          async checkAuth() {
            return undefined;
          },
          async findPrice() {
            return null;
          },
          async savePrice() {
            const error = Object.assign(new Error("sk_test_only leaked"), { type: "StripeAPIError", statusCode: 400, code: "parameter_invalid" });
            throw error;
          },
          async startCheckout() {
            return { url: "https://checkout.stripe.com/c/pay/cs_test" };
          },
        }),
      );
      expect(brokenPrices.statusReport().reason).toBe("products_failed");
      expect(brokenPrices.open).toBe(false);
      expect(warnings.join("\n")).toContain("products_failed");
      expect(warnings.join("\n")).not.toContain("sk_test_only");

      const { app } = await createApp({ store, shop: rejected, serveWeb: false });
      const status = await app.inject({ method: "GET", url: "/api/store/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json().reason).toBe("stripe_auth_failed");
      await app.close();
    } finally {
      console.warn = original;
    }
  });
});

describe("legal pages", () => {
  it("names the company, the refund window, and the support email", async () => {
    const store = new Store(":memory:");
    const { app } = await createApp({ store, serveWeb: false });
    try {
      const terms = await app.inject({ method: "GET", url: "/terms" });
      const privacy = await app.inject({ method: "GET", url: "/privacy" });
      expect(terms.statusCode).toBe(200);
      expect(privacy.statusCode).toBe(200);
      for (const body of [terms.body, privacy.body]) {
        expect(body).toContain("Ironwood Hills, LLC");
        expect(body).toContain("Nevada");
        expect(body).toContain("UhOh Dominoes");
        expect(body).toContain(SUPPORT_EMAIL);
        expect(body).toContain("13");
        expect(body.toLowerCase()).not.toContain("gambl");
        expect(body.toLowerCase()).not.toContain("prize");
        expect(body.toLowerCase()).not.toContain("paypal");
        expect(body.toLowerCase()).not.toContain("venmo");
      }
      expect(terms.body).toContain("14 days");
      expect(terms.body).toContain("no cash value");
      expect(terms.body).toContain("not redeemable for money");
      expect(privacy.body).toContain("card number");
      expect(privacy.body).toContain("nickname");
    } finally {
      await app.close();
    }
  });
});
