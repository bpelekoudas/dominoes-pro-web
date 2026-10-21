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
        <span className="balance-kicker">Test balance</span>
        <span className="balance-chips">
          <strong>
            <i className="bone-pip" aria-hidden="true" />
            {format(state?.bones)}
          </strong>
          <strong>
            <i className="gold-pip" aria-hidden="true" />
            {format(state?.goldBones)}
          </strong>
        </span>
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
        {state === null
          ? Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="store-card skeleton" aria-hidden="true">
                <span className="store-art-frame" />
                <span className="store-name skel"> </span>
                <span className="skel"> </span>
              </div>
            ))
          : items.map((item) => {
              const owned = state.owned.includes(item.id);
              const wearing = wearingItem(state.loadout, item);
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`store-card${wearing ? " wearing" : ""}`}
                  data-item={item.id}
                  onClick={press(() => setPicked(item))}
                >
                  <span className="store-art-frame">
                    <ItemArt item={item} />
                  </span>
                  <span className="store-name">{item.name}</span>
                  <span className={`rarity-badge rarity-${item.rarity.toLowerCase()}`}>{item.rarity}</span>
                  <Badges item={item} owned={owned} wearing={wearing} />
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
          tableArt: body.loadout.tableId ? `/store/${body.loadout.tableId}.webp?v=6` : null,
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
      <span className="store-art-frame">
        <ItemArt item={item} />
      </span>
      <h3>{item.name}</h3>
      <p className={`rarity-badge rarity-${item.rarity.toLowerCase()}`}>{item.rarity}</p>
      <Badges item={item} owned={owned} wearing={wearing} />
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
  const [failed, setFailed] = useState(false);
  const src = artSrc(item);
  if (!src || failed) {
    return (
      <span className="store-art missing" aria-hidden="true">
        {item.name.slice(0, 1)}
      </span>
    );
  }
  return <img className="store-art" src={src} alt="" draggable={false} onError={() => setFailed(true)} />;
}

function Badges({ item, owned, wearing }: { item: StoreItem; owned: boolean; wearing: boolean }) {
  const badges: Array<{ key: string; label: string; className?: string }> = [];
  if (wearing) badges.push({ key: "equipped", label: "Equipped", className: "equipped" });
  else if (owned) badges.push({ key: "owned", label: "Owned", className: "owned" });
  if (item.obtain === "season") badges.push({ key: "season", label: "Season" });
  if (item.obtain === "achievement" || item.obtain === "tournament") badges.push({ key: "earned", label: "Earned only" });
  if (item.limited) badges.push({ key: "limited", label: "Limited" });
  if (badges.length === 0) return null;
  return (
    <span className="store-badges">
      {badges.map((badge) => (
        <em key={badge.key} className={badge.className}>
          {badge.label}
        </em>
      ))}
    </span>
  );
}

function Price({ item, owned, wearing }: { item: StoreItem; owned: boolean; wearing: boolean }) {
  if (wearing || owned) return null;
  if (!forSale(item)) return <span className="store-price">Not for sale</span>;
  return (
    <span className="price-row">
      {item.bones ? (
        <span className="price-chip">
          <i className="bone-pip" aria-hidden="true" />
          {format(item.bones)}
        </span>
      ) : null}
      {item.gold ? (
        <span className="price-chip">
          <i className="gold-pip" aria-hidden="true" />
          {format(item.gold)}
        </span>
      ) : null}
    </span>
  );
}

function artSrc(item: StoreItem): string | null {
  if (!item.art) return null;
  if (item.avatarId) return `/avatars/${item.avatarId}.webp`;
  if (item.category === "table") return `/store/${item.id}.webp?v=6`;
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
