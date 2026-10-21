import { useEffect, useState } from "react";
import type { StoreItem } from "../../rules/src/catalog.js";
import { playUiClick } from "./sound";

const TABS: Array<{ id: StoreItem["category"]; label: string }> = [
  { id: "character", label: "Characters" },
  { id: "tile", label: "Tiles" },
  { id: "table", label: "Tables" },
  { id: "frame", label: "Frames" },
  { id: "effect", label: "UH-OH Effects" },
  { id: "trash", label: "Trash Talk" },
  { id: "emote", label: "Emotes" },
];

interface Loadout {
  characterId: string | null;
  tileId: string;
  tableId: string;
  frameId: string | null;
  effectId: string;
  trashId: string | null;
  emoteId: string | null;
}

interface StoreState {
  testBalance: true;
  bones: number;
  goldBones: number;
  owned: string[];
  loadout: Loadout;
  items: StoreItem[];
}

export function StoreScreen({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [state, setState] = useState<StoreState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<StoreItem["category"]>("character");
  const [picked, setPicked] = useState<StoreItem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch("/api/store");
      if (response.status === 401 && attempt < 5) {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        continue;
      }
      if (!response.ok) {
        setError("Sign in or continue as a guest, then open the store.");
        return;
      }
      setState((await response.json()) as StoreState);
      setError(null);
      return;
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as StoreState & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "That didn't go through.");
        return;
      }
      setState(payload);
      onChanged();
    } catch {
      setError("The store didn't answer.");
    } finally {
      setBusy(false);
    }
  };

  const items = state?.items.filter((item) => item.category === tab) ?? [];
  return (
    <section className="store-screen" role="dialog" aria-label="Store" data-screen="store">
      <header className="store-bar">
        <button type="button" className="capsule capsule-back" onClick={press(onClose)}>
          Back
        </button>
        <h2>Store</h2>
      </header>
      <p className="store-balance" data-test-balance="true">
        <span>Test balance</span>
        <strong>{format(state?.bones)} Bones</strong>
        <strong>{format(state?.goldBones)} Gold Bones</strong>
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      <div className="store-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            type="button"
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            onClick={press(() => {
              setTab(entry.id);
              setPicked(null);
            })}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="store-grid">
        {items.map((item) => {
          const owned = state?.owned.includes(item.id) ?? false;
          const wearing = state ? wearingItem(state.loadout, item) : false;
          return (
            <button
              type="button"
              key={item.id}
              className={`store-card${wearing ? " wearing" : ""}`}
              data-item={item.id}
              onClick={press(() => setPicked(item))}
            >
              <ItemArt item={item} />
              <span className="store-name">{item.name}</span>
              <span className={`rarity rarity-${item.rarity.toLowerCase()}`}>{item.rarity}</span>
              <Badges item={item} />
              <Price item={item} owned={owned} wearing={wearing} />
            </button>
          );
        })}
      </div>
      {picked && state ? (
        <ItemDetail
          item={picked}
          owned={state.owned.includes(picked.id)}
          wearing={wearingItem(state.loadout, picked)}
          busy={busy}
          onClose={() => setPicked(null)}
          onBuy={(currency) => void act("/api/store/buy", { itemId: picked.id, currency })}
          onEquip={() => void act("/api/store/equip", { itemId: picked.id })}
        />
      ) : null}
    </section>
  );
}

export function useMatchCosmetics(): { skin: string; tableArt: string | null } {
  const [wear, setWear] = useState<{ skin: string; tableArt: string | null }>({ skin: "ivory", tableArt: null });
  useEffect(() => {
    let stopped = false;
    void fetch("/api/store")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: StoreState | null) => {
        if (stopped || !body) return;
        const tile = body.items.find((item) => item.id === body.loadout.tileId);
        setWear({
          skin: tile?.skin || "ivory",
          tableArt: body.loadout.tableId ? `/store/${body.loadout.tableId}.webp` : null,
        });
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, []);
  return wear;
}

function ItemDetail({
  item,
  owned,
  wearing,
  busy,
  onClose,
  onBuy,
  onEquip,
}: {
  item: StoreItem;
  owned: boolean;
  wearing: boolean;
  busy: boolean;
  onClose: () => void;
  onBuy: (currency: "bones" | "gold") => void;
  onEquip: () => void;
}) {
  const sale = forSale(item);
  return (
    <div className="store-detail" role="dialog" aria-label={item.name} data-item-detail={item.id}>
      <ItemArt item={item} />
      <h3>{item.name}</h3>
      <p className={`rarity rarity-${item.rarity.toLowerCase()}`}>{item.rarity}</p>
      <Badges item={item} />
      {item.description ? <p>{item.description}</p> : null}
      {item.unlock ? <p className="hint">{item.unlock}</p> : null}
      <Price item={item} owned={owned} wearing={wearing} />
      {owned ? (
        <button type="button" className="capsule" disabled={busy || wearing} data-action="equip" onClick={press(onEquip)}>
          {wearing ? "Wearing" : "Equip"}
        </button>
      ) : sale ? (
        <div className="store-buy">
          {item.bones ? (
            <button type="button" className="capsule" disabled={busy} data-action="buy-bones" onClick={press(() => onBuy("bones"))}>
              Buy · {format(item.bones)} Bones
            </button>
          ) : null}
          {item.gold ? (
            <button type="button" className="capsule capsule-red" disabled={busy} data-action="buy-gold" onClick={press(() => onBuy("gold"))}>
              Buy · {format(item.gold)} Gold Bones
            </button>
          ) : null}
        </div>
      ) : (
        <p className="hint">{item.limited ? "Limited time. Not for sale right now." : "Not for sale."}</p>
      )}
      <button type="button" className="capsule capsule-back" onClick={press(onClose)}>
        Close
      </button>
    </div>
  );
}

function ItemArt({ item }: { item: StoreItem }) {
  const src = artSrc(item);
  if (!src) {
    return (
      <span className="store-art missing" aria-hidden="true">
        {item.name.slice(0, 1)}
      </span>
    );
  }
  return <img className="store-art" src={src} alt="" draggable={false} />;
}

function Badges({ item }: { item: StoreItem }) {
  const badges: string[] = [];
  if (item.obtain === "season") badges.push("Season reward");
  if (item.obtain === "achievement" || item.obtain === "tournament") badges.push("Earned");
  if (item.limited && item.availableFrom && item.availableUntil) badges.push(`Limited ${item.availableFrom} – ${item.availableUntil}`);
  else if (item.limited) badges.push("Limited");
  if (badges.length === 0) return null;
  return (
    <span className="store-badges">
      {badges.map((badge) => (
        <em key={badge}>{badge}</em>
      ))}
    </span>
  );
}

function Price({ item, owned, wearing }: { item: StoreItem; owned: boolean; wearing: boolean }) {
  if (wearing) return <span className="store-price">Wearing</span>;
  if (owned) return <span className="store-price">Owned</span>;
  if (!forSale(item)) return <span className="store-price">Not for sale</span>;
  return (
    <span className="store-price">
      {item.bones ? <span>{format(item.bones)} Bones</span> : null}
      {item.gold ? <span>{format(item.gold)} Gold</span> : null}
    </span>
  );
}

function artSrc(item: StoreItem): string | null {
  if (!item.art) return null;
  if (item.avatarId) return `/avatars/${item.avatarId}.webp`;
  return `/store/${item.id}.webp`;
}

function forSale(item: StoreItem): boolean {
  if (item.limited) return false;
  if (item.obtain === "bones") return (item.bones ?? 0) > 0 || (item.gold ?? 0) > 0;
  if (item.obtain === "gold") return (item.gold ?? 0) > 0;
  return false;
}

function wearingItem(loadout: Loadout, item: StoreItem): boolean {
  if (item.category === "character") return loadout.characterId === item.id;
  if (item.category === "tile") return loadout.tileId === item.id;
  if (item.category === "table") return loadout.tableId === item.id;
  if (item.category === "frame") return loadout.frameId === item.id;
  if (item.category === "effect") return loadout.effectId === item.id;
  if (item.category === "trash") return loadout.trashId === item.id;
  return loadout.emoteId === item.id;
}

function format(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function press(action: () => void): () => void {
  return () => {
    playUiClick();
    action();
  };
}
