/**
 * Gold Bone packs sold through Stripe Checkout.
 * Change the numbers here. The server is the only place that knows them.
 * Each larger pack gives more Gold Bones per dollar than the one before it.
 */
export interface CoinPack {
  lookupKey: string;
  /** Price in US cents. */
  cents: number;
  /** Gold Bones granted after Stripe confirms the payment. */
  coins: number;
  name: string;
}

export const SUPPORT_EMAIL = "uhohdominoes@gmail.com";
export const PUBLIC_NAME = "UhOh Dominoes";
export const LEGAL_ENTITY = "Ironwood Hills, LLC";

/** Streamed video game, non-subscription, limited rights. */
export const DIGITAL_TAX_CODE = "txcd_10201003";

export const PACK_DESCRIPTION =
  "Optional digital items for UhOh Dominoes. They have no cash value and cannot be redeemed for money.";

export const CHECKOUT_SUCCESS_URL = "https://uhohdominoes.com/?checkout=success";
export const CHECKOUT_CANCEL_URL = "https://uhohdominoes.com/?checkout=cancel";

export const STORE_COMING_SOON = "Store coming soon";

export const COIN_PACKS: readonly CoinPack[] = [
  { lookupKey: "coins_099", cents: 99, coins: 100, name: "100 Gold Bones" },
  { lookupKey: "coins_499", cents: 499, coins: 600, name: "600 Gold Bones" },
  { lookupKey: "coins_999", cents: 999, coins: 1400, name: "1,400 Gold Bones" },
  { lookupKey: "coins_1999", cents: 1999, coins: 3200, name: "3,200 Gold Bones" },
];

export function packByLookup(lookupKey: string): CoinPack | null {
  return COIN_PACKS.find((pack) => pack.lookupKey === lookupKey) ?? null;
}

export function isTestSecretKey(key: string | null | undefined): key is string {
  return typeof key === "string" && key.startsWith("sk_test_") && key.length > "sk_test_".length;
}
