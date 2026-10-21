import {
  CATALOG,
  TEST_BONES,
  TEST_GOLD,
  canBuy,
  characterItem,
  isWithheldId,
  itemById,
  priceOf,
  type StoreCurrency,
  type StoreItem,
} from "@uhoh/rules";
import type { Store } from "./db.js";

export interface CosmeticLoadout {
  characterId: string | null;
  tileId: string;
  tableId: string;
  frameId: string | null;
  effectId: string;
  trashId: string | null;
  emoteId: string | null;
}

export interface StoreSnapshot {
  testBalance: true;
  bones: number;
  goldBones: number;
  owned: string[];
  loadout: CosmeticLoadout;
  items: readonly StoreItem[];
}

interface WalletRow {
  user_id: string;
  bones: number;
  gold_bones: number;
  created_at: string;
}

interface LoadoutRow {
  user_id: string;
  character_id: string | null;
  tile_id: string | null;
  table_id: string | null;
  frame_id: string | null;
  effect_id: string | null;
  trash_id: string | null;
  emote_id: string | null;
}

const SLOT: Record<StoreItem["category"], keyof LoadoutRow> = {
  character: "character_id",
  tile: "tile_id",
  table: "table_id",
  frame: "frame_id",
  effect: "effect_id",
  trash: "trash_id",
  emote: "emote_id",
};

export class Cosmetics {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  snapshot(userId: string): StoreSnapshot {
    this.ensure(userId);
    const wallet = this.wallet(userId);
    const loadout = this.loadout(userId);
    return {
      testBalance: true,
      bones: wallet?.bones ?? TEST_BONES,
      goldBones: wallet?.gold_bones ?? TEST_GOLD,
      owned: this.owned(userId),
      loadout,
      items: CATALOG,
    };
  }

  buy(userId: string, itemId: string, currency: StoreCurrency): { ok: true; snapshot: StoreSnapshot } | { ok: false; error: string } {
    if (isWithheldId(itemId)) return { ok: false, error: "That item is not available." };
    const item = itemById(itemId);
    if (!item) return { ok: false, error: "That item is not in the store." };
    const price = priceOf(item, currency);
    if (price == null) return { ok: false, error: "That one isn't for sale." };
    this.ensure(userId);
    if (this.owns(userId, item.id)) return { ok: false, error: "You already have this." };
    const wallet = this.wallet(userId);
    if (!wallet) return { ok: false, error: "That profile is gone." };
    const balance = currency === "bones" ? wallet.bones : wallet.gold_bones;
    if (balance < price) return { ok: false, error: currency === "bones" ? "Not enough Bones." : "Not enough Gold Bones." };
    const nextBones = currency === "bones" ? wallet.bones - price : wallet.bones;
    const nextGold = currency === "gold" ? wallet.gold_bones - price : wallet.gold_bones;
    this.store.db.prepare(`UPDATE wallets SET bones = ?, gold_bones = ? WHERE user_id = ?`).run(nextBones, nextGold, userId);
    this.grant(userId, item.id);
    return { ok: true, snapshot: this.snapshot(userId) };
  }

  equip(userId: string, itemId: string): { ok: true; snapshot: StoreSnapshot } | { ok: false; error: string } {
    if (isWithheldId(itemId)) return { ok: false, error: "That item is not available." };
    const item = itemById(itemId);
    if (!item) return { ok: false, error: "That item is not in the store." };
    this.ensure(userId);
    if (!this.owns(userId, item.id)) return { ok: false, error: "Buy it before you wear it." };
    const column = SLOT[item.category];
    this.store.db.prepare(`UPDATE loadouts SET ${column} = ? WHERE user_id = ?`).run(item.id, userId);
    if (item.category === "character" && item.avatarId) {
      this.store.updateUser(userId, { avatar_id: item.avatarId, updated_at: this.stamp() });
    }
    return { ok: true, snapshot: this.snapshot(userId) };
  }

  /** A character the account does not own cannot be saved as their portrait. */
  avatarAllowed(userId: string, avatarId: string): boolean {
    if (isWithheldId(avatarId)) return false;
    const item = characterItem(avatarId);
    if (!item) return true;
    if (item.obtain === "free") return true;
    this.ensure(userId);
    return this.owns(userId, item.id);
  }

  loadout(userId: string): CosmeticLoadout {
    this.ensure(userId);
    const row = this.store.db.prepare(`SELECT * FROM loadouts WHERE user_id = ?`).get(userId) as LoadoutRow | undefined;
    return {
      characterId: row?.character_id ?? null,
      tileId: row?.tile_id || "TIL-001",
      tableId: row?.table_id || "TBL-001",
      frameId: row?.frame_id ?? null,
      effectId: row?.effect_id || "FX-001",
      trashId: row?.trash_id ?? null,
      emoteId: row?.emote_id ?? null,
    };
  }

  wornLines(userId: string | null): Array<{ packId: "worn"; id: string; text: string }> {
    if (!userId) return [];
    const row = this.store.db.prepare(`SELECT * FROM loadouts WHERE user_id = ?`).get(userId) as LoadoutRow | undefined;
    if (!row) return [];
    const lines = [];
    for (const id of [row.trash_id, row.emote_id]) {
      if (!id || !this.owns(userId, id)) continue;
      const item = itemById(id);
      if (!item) continue;
      lines.push({ packId: "worn" as const, id: item.id, text: item.name });
    }
    return lines;
  }

  private ensure(userId: string): void {
    const user = this.store.user(userId);
    if (!user) return;
    const stamp = this.stamp();
    if (!this.wallet(userId)) {
      this.store.db
        .prepare(`INSERT INTO wallets (user_id, bones, gold_bones, created_at) VALUES (?, ?, ?, ?)`)
        .run(userId, TEST_BONES, TEST_GOLD, stamp);
    }
    for (const item of CATALOG) {
      if (item.obtain === "free") this.grant(userId, item.id);
    }
    const worn = characterItem(user.avatar_id);
    if (worn) this.grant(userId, worn.id);
    const existing = this.store.db.prepare(`SELECT user_id FROM loadouts WHERE user_id = ?`).get(userId) as
      | { user_id: string }
      | undefined;
    if (!existing) {
      const character = worn?.id ?? null;
      this.store.db
        .prepare(
          `INSERT INTO loadouts (user_id, character_id, tile_id, table_id, frame_id, effect_id, trash_id, emote_id)
           VALUES (?, ?, 'TIL-001', 'TBL-001', NULL, 'FX-001', 'TT-001', 'EMO-001')`,
        )
        .run(userId, character);
    }
  }

  private grant(userId: string, itemId: string): void {
    if (isWithheldId(itemId) || !itemById(itemId)) return;
    this.store.db
      .prepare(`INSERT INTO owned_items (user_id, item_id, acquired_at) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO NOTHING`)
      .run(userId, itemId, this.stamp());
  }

  private owns(userId: string, itemId: string): boolean {
    const row = this.store.db
      .prepare(`SELECT item_id FROM owned_items WHERE user_id = ? AND item_id = ?`)
      .get(userId, itemId) as { item_id: string } | undefined;
    return Boolean(row);
  }

  private owned(userId: string): string[] {
    const rows = this.store.db.prepare(`SELECT item_id FROM owned_items WHERE user_id = ? ORDER BY item_id`).all(userId) as Array<{
      item_id: string;
    }>;
    return rows.map((row) => row.item_id);
  }

  private wallet(userId: string): WalletRow | null {
    return (this.store.db.prepare(`SELECT * FROM wallets WHERE user_id = ?`).get(userId) as WalletRow | undefined) ?? null;
  }

  private stamp(): string {
    return this.now().toISOString();
  }
}
