import { useEffect, useState, type CSSProperties } from "react";
import { AVATARS } from "../../rules/src/avatars.js";
import { Domino } from "./table";
import { AvatarFace, Portrait } from "./avatars";
import { RankBadge } from "./rank";
import { playUiClick, unlockSound } from "./sound";

export const PREVIEW_COINS = 2450;

type Tab = "characters" | "tiles" | "tables" | "frames" | "effects";
type Obtain = "free" | "coins" | "season";
type Stage = "browse" | "detail" | "confirm" | "congrats" | "loadout" | "packs";
type Filter = "sale" | "owned";

interface Item {
  id: string;
  tab: Tab;
  name: string;
  blurb: string;
  glow: string;
  obtain: Obtain;
  price?: number;
  tierId?: string;
  tierName?: string;
  avatarId?: string;
}

export interface Loadout {
  characters: string;
  tiles: string;
  tables: string;
  frames: string;
  effects: string;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "characters", label: "Characters" },
  { id: "tiles", label: "Tiles" },
  { id: "tables", label: "Tables" },
  { id: "frames", label: "Frames" },
  { id: "effects", label: "Effects" },
];

const CHARACTER_OFFER: Record<string, Partial<Item>> = {
  homescreen: { obtain: "free", glow: "#e31e26", blurb: "The house character. Free, and already yours." },
  barista: { obtain: "free", glow: "#c47a4a", blurb: "Free. An apron and a calm hand." },
  golfer: { obtain: "free", glow: "#3d8f4a", blurb: "Free. A visor and an easy stance." },
  fisherman: { obtain: "coins", price: 500, glow: "#2a8fad", blurb: "A dock, a cap, and a long wait." },
  floridaman: { obtain: "coins", price: 800, glow: "#e07a3d", blurb: "Sunburn and a story." },
  fratbro: { obtain: "coins", price: 400, glow: "#e31e26", blurb: "A loud shirt and a louder line." },
  gaperilla: { obtain: "season", tierId: "shark", tierName: "Shark", glow: "#d5a336", blurb: "The pirate. A Shark season reward. Not for sale." },
  grungerocker: { obtain: "coins", price: 700, glow: "#9b4dff", blurb: "A dim room and a loud amp." },
  hipster: { obtain: "coins", price: 600, glow: "#c47a4a", blurb: "Glasses, a beard, and a strong opinion." },
  lumberjack: { obtain: "coins", price: 900, glow: "#8a5a32", blurb: "Flannel and a heavy tile." },
  mexicancowboy: { obtain: "coins", price: 1200, glow: "#c45a28", blurb: "A hat with a wide brim." },
  nascar: { obtain: "coins", price: 1500, glow: "#e31e26", blurb: "A suit of sponsor patches." },
  retiredman: { obtain: "coins", price: 450, glow: "#d5a336", blurb: "A polo and all the time in the world." },
  scarface: { obtain: "season", tierId: "legend", tierName: "UH-OH Legend", glow: "#efefef", blurb: "A Legend season reward. Not for sale." },
  techmogul: { obtain: "coins", price: 2400, glow: "#7ec8ff", blurb: "A dark coat and a bright watch." },
  "2hot4tv": { obtain: "coins", price: 1800, glow: "#ff4d8d", blurb: "Lights, a smile, and a camera somewhere." },
};

const CATALOG: Item[] = [
  ...AVATARS.map((avatar): Item => {
    const special = CHARACTER_OFFER[avatar.id];
    return {
      id: avatar.id,
      tab: "characters",
      name: avatar.name,
      blurb: special?.blurb ?? `${avatar.name} sits down at your table.`,
      glow: special?.glow ?? "#d5a336",
      obtain: special?.obtain ?? "coins",
      price: special?.price,
      tierId: special?.tierId,
      tierName: special?.tierName,
      avatarId: avatar.id,
    };
  }),
  { id: "ivory", tab: "tiles", name: "Ivory", blurb: "Soft white tiles, black pips, a red bar. The house set.", glow: "#efefef", obtain: "free" },
  { id: "gold", tab: "tiles", name: "Gold", blurb: "A warm gold face with dark pips. The spinner still wears a ring.", glow: "#d5a336", obtain: "coins", price: 800 },
  { id: "neon", tab: "tiles", name: "Neon", blurb: "Black tiles, a green pip glow, and a pink bar.", glow: "#39ffb0", obtain: "coins", price: 900 },
  { id: "marble", tab: "tiles", name: "Marble", blurb: "Pale stone with gray veins and a brass bar.", glow: "#d9d3c8", obtain: "coins", price: 1200 },
  { id: "wood", tab: "tiles", name: "Wood", blurb: "Warm grain, dark pips, a stained bar.", glow: "#8a5a32", obtain: "coins", price: 700 },
  { id: "smoked", tab: "tiles", name: "Smoked", blurb: "Charcoal tiles with a smoked face, white pips, and a thin gold edge.", glow: "#e31e26", obtain: "coins", price: 1600 },
  { id: "green", tab: "tables", name: "Classic green", blurb: "The old felt. Quiet, and easy on the tiles.", glow: "#1e6b3a", obtain: "free" },
  { id: "redfelt", tab: "tables", name: "Brand red", blurb: "A deep red felt in the house color.", glow: "#e31e26", obtain: "free" },
  { id: "city", tab: "tables", name: "City night", blurb: "A skyline after dark, with a few windows still on.", glow: "#3d6ea8", obtain: "coins", price: 1400 },
  { id: "desert", tab: "tables", name: "Desert", blurb: "Dunes, a low sun, and a warm table.", glow: "#e07a3d", obtain: "coins", price: 1400 },
  { id: "beach", tab: "tables", name: "Florida beach", blurb: "Sand, a strip of water, and a bright sky.", glow: "#2a8fad", obtain: "coins", price: 1600 },
  { id: "tailgate", tab: "tables", name: "Tailgate", blurb: "Parking-lot stripes and a gold light. A Hustler season reward.", glow: "#d5a336", obtain: "season", tierId: "hustler", tierName: "Hustler" },
  { id: "plain", tab: "frames", name: "Plain", blurb: "No frame. Just the portrait.", glow: "#efefef", obtain: "free" },
  { id: "goldring", tab: "frames", name: "Gold ring", blurb: "A gold circle around the portrait.", glow: "#d5a336", obtain: "coins", price: 500 },
  { id: "redframe", tab: "frames", name: "Red enamel", blurb: "A red ring with a gold hairline.", glow: "#e31e26", obtain: "coins", price: 700 },
  { id: "rookie", tab: "frames", name: "Rookie frame", blurb: "The frame for a Rookie season.", glow: "#efefef", obtain: "season", tierId: "rookie", tierName: "Rookie" },
  { id: "hustler", tab: "frames", name: "Hustler frame", blurb: "The frame for a Hustler season.", glow: "#d5a336", obtain: "season", tierId: "hustler", tierName: "Hustler" },
  { id: "shark", tab: "frames", name: "Shark frame", blurb: "The frame for a Shark season.", glow: "#e31e26", obtain: "season", tierId: "shark", tierName: "Shark" },
  { id: "legend", tab: "frames", name: "Legend frame", blurb: "The frame for an UH-OH Legend season.", glow: "#d5a336", obtain: "season", tierId: "legend", tierName: "UH-OH Legend" },
  { id: "glass", tab: "effects", name: "Glass", blurb: "The house shatter. Cracks, then the pieces fall away.", glow: "#efefef", obtain: "free" },
  { id: "fire", tab: "effects", name: "Fire", blurb: "The same UH-OH, with a burst of flame instead of glass.", glow: "#ff6a1a", obtain: "coins", price: 1000 },
  { id: "money", tab: "effects", name: "Money blast", blurb: "Coins and bills kick out from the scoring tile.", glow: "#3ddc78", obtain: "coins", price: 2000 },
  { id: "lightning", tab: "effects", name: "Lightning", blurb: "A bolt hits the tile. A Shark season reward.", glow: "#7ec8ff", obtain: "season", tierId: "shark", tierName: "Shark" },
];

const STARTER_OWNED = [
  "homescreen", "barista", "golfer",
  "ivory", "gold", "wood",
  "green", "redfelt", "city", "tailgate",
  "plain", "goldring", "rookie", "hustler",
  "glass",
];

const STARTER_LOADOUT: Loadout = {
  characters: "golfer",
  tiles: "gold",
  tables: "city",
  frames: "goldring",
  effects: "glass",
};

const PACKS = [
  { name: "Handful", coins: "500", price: "$0.99" },
  { name: "Stack", coins: "1,200", price: "$1.99" },
  { name: "Vault", coins: "3,000", price: "$3.99" },
];

export function storeDemoRequested(): boolean {
  return new URLSearchParams(location.search).get("demo") === "store";
}

function arrange(items: Item[], equippedId: string): Item[] {
  const wearing = items.filter((item) => item.id === equippedId);
  const rest = items.filter((item) => item.id !== equippedId);
  const priced = rest.filter((item) => item.obtain !== "season").sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const seasons = rest.filter((item) => item.obtain === "season");
  const mixed: Item[] = [];
  const count = Math.max(priced.length, seasons.length);
  for (let index = 0; index < count; index += 1) {
    if (priced[index]) mixed.push(priced[index]);
    if (seasons[index]) mixed.push(seasons[index]);
  }
  return [...wearing, ...mixed];
}

function itemById(id: string): Item {
  return CATALOG.find((item) => item.id === id) ?? CATALOG[0]!;
}

function tap(action: () => void): () => void {
  return () => {
    unlockSound();
    playUiClick();
    action();
  };
}

interface Script {
  tab: Tab;
  filter: Filter;
  stage: Stage;
  selected: string;
  owned: string[];
  loadout: Loadout;
  coins: number;
}

function scriptFor(shot: string | null): Script {
  const base: Script = {
    tab: "characters",
    filter: "sale",
    stage: "browse",
    selected: "fratbro",
    owned: STARTER_OWNED,
    loadout: STARTER_LOADOUT,
    coins: PREVIEW_COINS,
  };
  if (shot === "tiles") return { ...base, tab: "tiles", selected: "neon" };
  if (shot === "tables") return { ...base, tab: "tables", selected: "desert" };
  if (shot === "frames") return { ...base, tab: "frames", selected: "shark" };
  if (shot === "effects") return { ...base, tab: "effects", selected: "fire" };
  if (shot === "owned") return { ...base, filter: "owned", selected: "golfer" };
  if (shot === "detail") return { ...base, tab: "tiles", stage: "detail", selected: "neon" };
  if (shot === "confirm") return { ...base, tab: "tiles", stage: "confirm", selected: "neon" };
  if (shot === "congrats") {
    return { ...base, tab: "tiles", stage: "congrats", selected: "neon", owned: [...STARTER_OWNED, "neon"], coins: PREVIEW_COINS - 900 };
  }
  if (shot === "loadout") return { ...base, stage: "loadout" };
  if (shot === "packs") return { ...base, stage: "packs" };
  return base;
}

export function StorePreview({ onClose, shot = null }: { onClose?: () => void; shot?: string | null }) {
  if (shot === "table") return <EquippedTable />;
  return <StoreScreens onClose={onClose} shot={shot} />;
}

function StoreScreens({ onClose, shot }: { onClose?: () => void; shot: string | null }) {
  const script = scriptFor(shot);
  const [tab, setTab] = useState<Tab>(script.tab);
  const [filter, setFilter] = useState<Filter>(script.filter);
  const [stage, setStage] = useState<Stage>(script.stage);
  const [selectedId, setSelectedId] = useState(script.selected);
  const [owned, setOwned] = useState<string[]>(script.owned);
  const [loadout, setLoadout] = useState<Loadout>(script.loadout);
  const [coins, setCoins] = useState(script.coins);
  const selected = itemById(selectedId);
  const visible = arrange(CATALOG.filter((item) => item.tab === tab).filter((item) =>
    filter === "owned" ? owned.includes(item.id) : !owned.includes(item.id),
  ), loadout[tab]);
  useEffect(() => {
    document.querySelector(`.store-tabs [data-tab="${tab}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);

  const open = (item: Item) => {
    setSelectedId(item.id);
    setStage("detail");
  };

  const equip = (item: Item) => {
    setLoadout((current) => ({ ...current, [item.tab]: item.id }));
    setStage("browse");
    setFilter("owned");
    setTab(item.tab);
  };

  const buy = () => {
    if (selected.obtain !== "coins" || selected.price == null) return;
    if (coins < selected.price) {
      setStage("packs");
      return;
    }
    setCoins((value) => value - selected.price!);
    setOwned((list) => (list.includes(selected.id) ? list : [...list, selected.id]));
    setStage("congrats");
  };

  return (
    <main className="store-app" data-screen="store" data-store-shot={shot ?? stage}>
      {stage === "congrats" ? (
        <Congrats item={selected} onEquip={() => equip(selected)} onClose={() => setStage("browse")} />
      ) : stage === "loadout" ? (
        <LoadoutView loadout={loadout} onBack={() => setStage("browse")} />
      ) : (
        <>
          <header className="store-bar">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>Store</h2>
            </div>
            <button type="button" className="coin-chip" onClick={tap(() => setStage("packs"))} aria-label={`${coins.toLocaleString()} coins`}>
              <CoinMark />
              <span>{coins.toLocaleString()}</span>
              <span className="coin-plus" aria-hidden="true">+</span>
            </button>
          </header>

          {stage === "detail" || stage === "confirm" ? (
            <Detail
              item={selected}
              owned={owned.includes(selected.id)}
              equipped={loadout[selected.tab] === selected.id}
              coins={coins}
              onBack={() => setStage("browse")}
              onEquip={() => equip(selected)}
              onBuy={() => setStage("confirm")}
              onPacks={() => setStage("packs")}
            />
          ) : (
            <>
              <div className="store-switch" role="tablist" aria-label="For sale or owned">
                <button type="button" aria-pressed={filter === "sale"} onClick={tap(() => setFilter("sale"))}>For sale</button>
                <button type="button" aria-pressed={filter === "owned"} onClick={tap(() => setFilter("owned"))}>Owned</button>
              </div>
              <div className="store-tabs" role="tablist" aria-label="Store sections">
                {TABS.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    data-tab={entry.id}
                    aria-pressed={tab === entry.id}
                    onClick={tap(() => setTab(entry.id))}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="store-rail" data-store-rail="true">
                {visible.length === 0 ? <p className="hint">Nothing in this case.</p> : null}
                {visible.map((item) => (
                  <article key={item.id} className="store-card" style={{ "--glow": item.glow } as CSSProperties} data-item={item.id}>
                    <button type="button" className="store-card-open" onClick={tap(() => open(item))}>
                      <span className="store-glow" />
                      <span className="store-art"><ItemArt item={item} /></span>
                      <span className="store-name">{item.name}</span>
                    </button>
                    <CardTag item={item} owned={owned.includes(item.id)} equipped={loadout[item.tab] === item.id} />
                  </article>
                ))}
              </div>
              <div className="store-foot">
                <button type="button" className="capsule" data-action="loadout" onClick={tap(() => setStage("loadout"))}>Loadout</button>
                {onClose ? (
                  <button type="button" className="capsule capsule-back" onClick={tap(onClose)}>Back</button>
                ) : null}
              </div>
            </>
          )}
          {stage === "confirm" ? (
            <Confirm item={selected} coins={coins} onYes={tap(buy)} onNo={tap(() => setStage("detail"))} />
          ) : null}
          {stage === "packs" ? <Packs onClose={tap(() => setStage("browse"))} /> : null}
        </>
      )}
    </main>
  );
}

function CardTag({ item, owned, equipped }: { item: Item; owned: boolean; equipped: boolean }) {
  if (equipped) return <span className="store-tag tag-wear">Wearing</span>;
  if (owned) return <span className="store-tag tag-own">Apply</span>;
  if (item.obtain === "season") {
    return (
      <span className="store-tag tag-season">
        <RankBadge tier={item.tierId ?? "rookie"} />
        {item.tierName}
      </span>
    );
  }
  return (
    <span className="store-tag tag-price">
      <CoinMark />
      {item.price?.toLocaleString()}
    </span>
  );
}

function Detail({
  item,
  owned,
  equipped,
  coins,
  onBack,
  onEquip,
  onBuy,
  onPacks,
}: {
  item: Item;
  owned: boolean;
  equipped: boolean;
  coins: number;
  onBack: () => void;
  onEquip: () => void;
  onBuy: () => void;
  onPacks: () => void;
}) {
  const price = item.price ?? 0;
  const short = item.obtain === "coins" && !owned && coins < price;
  return (
    <section className="store-detail" data-screen="store-detail">
      <button type="button" className="text-button" onClick={tap(onBack)}>Back</button>
      <div className="detail-art" style={{ "--glow": item.glow } as CSSProperties}>
        <span className="store-glow" />
        <ItemArt item={item} large />
      </div>
      <h2>{item.name}</h2>
      <p>{item.blurb}</p>
      {item.obtain === "season" && !owned ? (
        <p className="store-tag tag-season">
          <RankBadge tier={item.tierId ?? "rookie"} />
          Unlocks at {item.tierName}
        </p>
      ) : null}
      <div className="store-foot">
        {equipped ? (
          <button type="button" className="capsule" disabled>Wearing</button>
        ) : owned ? (
          <button type="button" className="capsule" data-action="apply" onClick={tap(onEquip)}>Apply</button>
        ) : item.obtain === "season" ? (
          <button type="button" className="capsule" disabled>Season reward</button>
        ) : short ? (
          <button type="button" className="capsule capsule-red" onClick={tap(onPacks)}>Need {price.toLocaleString()} coins</button>
        ) : (
          <button type="button" className="capsule" data-action="buy" onClick={tap(onBuy)}>
            Buy for {price.toLocaleString()}
          </button>
        )}
      </div>
    </section>
  );
}

function Confirm({ item, coins, onYes, onNo }: { item: Item; coins: number; onYes: () => void; onNo: () => void }) {
  const price = item.price ?? 0;
  return (
    <div className="store-scrim" data-screen="store-confirm">
      <section className="store-dialog" role="dialog" aria-label="Confirm purchase">
        <p className="eyebrow">Confirm</p>
        <h2>Buy {item.name}?</h2>
        <div className="confirm-art"><ItemArt item={item} /></div>
        <p>
          {price.toLocaleString()} coins. You have {coins.toLocaleString()}. After this, {(coins - price).toLocaleString()}.
        </p>
        <button type="button" className="capsule" data-action="confirm-buy" onClick={onYes}>Confirm</button>
        <button type="button" className="capsule capsule-back" onClick={onNo}>Not now</button>
      </section>
    </div>
  );
}

function Congrats({ item, onEquip, onClose }: { item: Item; onEquip: () => void; onClose: () => void }) {
  return (
    <section className="store-congrats" data-screen="store-congrats">
      <span className="confetti" aria-hidden="true" />
      <p className="eyebrow">It's yours</p>
      <h2>Congratulations</h2>
      <div className="detail-art congrats-art" style={{ "--glow": item.glow } as CSSProperties}>
        <ItemArt item={item} large />
      </div>
      <p>{item.name} is in your collection.</p>
      <button type="button" className="capsule" data-action="equip-now" onClick={tap(onEquip)}>Apply</button>
      <button type="button" className="capsule capsule-back" onClick={tap(onClose)}>Keep looking</button>
    </section>
  );
}

function LoadoutView({ loadout, onBack }: { loadout: Loadout; onBack: () => void }) {
  const rows: Array<{ label: string; id: string }> = [
    { label: "Character", id: loadout.characters },
    { label: "Tiles", id: loadout.tiles },
    { label: "Table", id: loadout.tables },
    { label: "Frame", id: loadout.frames },
    { label: "UH-OH effect", id: loadout.effects },
  ];
  return (
    <section className="store-loadout" data-screen="store-loadout">
      <p className="eyebrow">Wearing now</p>
      <h2>Loadout</h2>
      <ul>
        {rows.map((row) => {
          const item = itemById(row.id);
          return (
            <li key={row.label}>
              <span className="loadout-art"><ItemArt item={item} /></span>
              <span>
                <small>{row.label}</small>
                <strong>{item.name}</strong>
              </span>
              <em>Wearing</em>
            </li>
          );
        })}
      </ul>
      <button type="button" className="capsule capsule-back" onClick={tap(onBack)}>Back to the store</button>
    </section>
  );
}

function Packs({ onClose }: { onClose: () => void }) {
  return (
    <div className="store-scrim" data-screen="store-packs">
      <section className="store-dialog" role="dialog" aria-label="Coin packs">
        <p className="eyebrow">Drawing only</p>
        <h2>Coin packs</h2>
        <p>Real money is not connected. Nothing on this phone can be charged.</p>
        <ul className="pack-list">
          {PACKS.map((pack) => (
            <li key={pack.name}>
              <span>{pack.name}</span>
              <span>{pack.coins} coins</span>
              <span className="pack-price">{pack.price}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="capsule" disabled>Not for sale</button>
        <button type="button" className="capsule capsule-back" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}

function ItemArt({ item, large = false }: { item: Item; large?: boolean }) {
  if (item.tab === "characters") return <Portrait id={item.avatarId} size={large ? "hero" : "grid"} />;
  if (item.tab === "tiles") return <TileSample skin={item.id} chain={large} />;
  if (item.tab === "tables") return <Scene id={item.id} />;
  if (item.tab === "frames") return <Framed frame={item.id} large={large} />;
  return <EffectStill id={item.id} />;
}

function TileSample({ skin, chain }: { skin: string; chain: boolean }) {
  return (
    <div className={`mini-board skin-${skin}${chain ? " chain" : ""}`}>
      {chain ? (
        <>
          <Domino a={6} b={6} orientation="horizontal" spinner />
          <Domino a={6} b={3} orientation="horizontal" />
          <Domino a={3} b={1} orientation="horizontal" />
        </>
      ) : (
        <Domino a={6} b={5} orientation="vertical" />
      )}
    </div>
  );
}

function Framed({ frame, large }: { frame: string; large: boolean }) {
  return (
    <span className={`wear-frame frame-${frame}${large ? " wear-large" : ""}`}>
      <AvatarFace id="golfer" />
    </span>
  );
}

function Scene({ id }: { id: string }) {
  return (
    <div className={`scene scene-${id}`} aria-hidden="true">
      {id === "city" ? (
        <span className="skyline">
          {[46, 70, 38, 88, 54, 76, 42, 64].map((height, index) => (
            <i key={index} style={{ height: `${height}%` }} />
          ))}
        </span>
      ) : null}
      {id === "desert" ? (
        <>
          <span className="sun" />
          <span className="dune dune-a" />
          <span className="dune dune-b" />
        </>
      ) : null}
      {id === "beach" ? <span className="sun" /> : null}
      {id === "tailgate" ? <span className="tail-light" /> : null}
    </div>
  );
}

function EffectStill({ id }: { id: string }) {
  if (id === "fire") {
    return (
      <span className="effect-still effect-fire" aria-hidden="true">
        <i /><i /><i />
      </span>
    );
  }
  if (id === "money") {
    return (
      <span className="effect-still effect-money" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </span>
    );
  }
  if (id === "lightning") {
    return (
      <span className="effect-still effect-bolt" aria-hidden="true">
        <svg viewBox="0 0 64 96">
          <path d="M38 2 L14 46 H30 L22 94 L54 40 H36 Z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="effect-still effect-glass" aria-hidden="true">
      <svg viewBox="0 0 80 80">
        <path d="M40 40 L70 12 M40 40 L12 22 M40 40 L68 58 M40 40 L18 70 M40 40 L40 8 M40 40 L8 46" />
      </svg>
    </span>
  );
}

function CoinMark() {
  return (
    <svg className="coin-mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EquippedTable() {
  return (
    <main className="scene-stage scene-city" data-screen="store-table" data-tile-skin="gold" data-table-scene="city">
      <header className="scene-caption">
        <p>City night</p>
        <p>Gold tiles</p>
      </header>
      <span className="skyline" aria-hidden="true">
        {[40, 62, 34, 80, 48, 70, 36, 58, 44].map((height, index) => (
          <i key={index} style={{ height: `${height}%` }} />
        ))}
      </span>
      <div className="scene-oval" />
      <div className="scene-seats">
        <span className="seat-chip">
          <span className="wear-frame frame-plain">
            <AvatarFace id="barista" />
          </span>
          <span className="chip-text">
            <span className="chip-name">Sam</span>
            <span className="chip-meta"><strong>70</strong></span>
          </span>
        </span>
        <span className="seat-chip you">
          <span className="wear-frame frame-goldring">
            <AvatarFace id="golfer" />
          </span>
          <span className="chip-text">
            <span className="chip-name">You</span>
            <span className="chip-meta"><strong>95</strong></span>
          </span>
        </span>
      </div>
      <div className="scene-chain skin-gold">
        <Domino a={6} b={6} orientation="horizontal" spinner />
        <Domino a={6} b={2} orientation="horizontal" />
        <Domino a={2} b={5} orientation="horizontal" />
      </div>
    </main>
  );
}
