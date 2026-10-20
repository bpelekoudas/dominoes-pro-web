import { useEffect, useState, type CSSProperties } from "react";
import { AVATARS } from "../../rules/src/avatars.js";
import { Domino } from "./table";
import { AvatarFace, Portrait } from "./avatars";
import { RankBadge } from "./rank";
import { playUiClick, unlockSound } from "./sound";
import { normalizeFx, readEquippedFx, writeEquippedFx, type FxId } from "./fx.js";
import { FxBoard } from "./moment.js";

export const PREVIEW_COINS = 1840;
export const PREVIEW_GEMS = 180;

type Tab = "characters" | "tiles" | "tables" | "frames" | "effects";
type Obtain = "coins" | "gems" | "earned";
type Rarity = "common" | "rare" | "epic" | "legendary";
type Stage = "browse" | "detail" | "confirm" | "congrats" | "loadout" | "packs" | "pass" | "play";
type Filter = "sale" | "owned";

interface Item {
  id: string;
  tab: Tab;
  name: string;
  blurb: string;
  glow: string;
  rarity: Rarity;
  obtain: Obtain;
  price?: number;
  limited?: boolean;
  tierId?: string;
  earnNote?: string;
  avatarId?: string;
  fx?: FxId;
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
  homescreen: { rarity: "common", obtain: "earned", earnNote: "Included", glow: "#e31e26", blurb: "The house character. Included with the game. Not sold." },
  barista: { rarity: "common", obtain: "earned", earnNote: "Included", glow: "#c47a4a", blurb: "Included. An apron and a calm hand." },
  golfer: { rarity: "common", obtain: "earned", earnNote: "Included", glow: "#3d8f4a", blurb: "Included. A visor and an easy stance." },
  fisherman: { rarity: "common", obtain: "coins", price: 500, glow: "#2a8fad", blurb: "Common. A dock, a cap, and a long wait. About two days of play." },
  floridaman: { rarity: "rare", obtain: "coins", price: 2500, glow: "#e07a3d", blurb: "Rare. Sunburn and a story. About a week or two of play." },
  fratbro: { rarity: "common", obtain: "coins", price: 500, glow: "#e31e26", blurb: "Common. A loud shirt and a louder line." },
  gaperilla: { rarity: "epic", obtain: "earned", tierId: "shark", earnNote: "Shark", glow: "#d5a336", blurb: "Epic. The pirate. Earned at Shark. Never sold." },
  grungerocker: { rarity: "rare", obtain: "coins", price: 2500, glow: "#9b4dff", blurb: "Rare. A dim room and a loud amp." },
  hipster: { rarity: "common", obtain: "coins", price: 500, glow: "#c47a4a", blurb: "Common. Glasses, a beard, and a strong opinion." },
  lumberjack: { rarity: "rare", obtain: "coins", price: 2500, glow: "#8a5a32", blurb: "Rare. Flannel and a heavy tile." },
  mexicancowboy: { rarity: "epic", obtain: "coins", price: 10000, glow: "#c45a28", blurb: "Epic. A hat with a wide brim. About a month of play." },
  nascar: { rarity: "legendary", obtain: "coins", price: 35000, glow: "#e31e26", blurb: "Legendary. A suit of sponsor patches. A few months of steady play." },
  retiredman: { rarity: "common", obtain: "coins", price: 500, glow: "#d5a336", blurb: "Common. A polo and all the time in the world." },
  scarface: { rarity: "legendary", obtain: "earned", tierId: "legend", earnNote: "UH-OH Legend", glow: "#efefef", blurb: "Legendary. Earned at UH-OH Legend. Never sold." },
  techmogul: { rarity: "legendary", obtain: "gems", price: 1500, limited: true, glow: "#7ec8ff", blurb: "Legendary. A dark coat and a bright watch. Premium, limited, cosmetic only." },
  "2hot4tv": { rarity: "epic", obtain: "gems", price: 800, limited: true, glow: "#ff4d8d", blurb: "Epic. Lights and a smile. Premium, limited, cosmetic only." },
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
      rarity: special?.rarity ?? "common",
      obtain: special?.obtain ?? "coins",
      price: special?.price,
      limited: special?.limited,
      tierId: special?.tierId,
      earnNote: special?.earnNote,
      avatarId: avatar.id,
    };
  }),
  { id: "ivory", tab: "tiles", name: "Ivory", blurb: "Common. Soft white tiles, black pips, a red bar. Included.", glow: "#efefef", rarity: "common", obtain: "earned", earnNote: "Included" },
  { id: "gold", tab: "tiles", name: "Gold", blurb: "Rare. A warm gold face with dark pips. The spinner still wears a ring.", glow: "#d5a336", rarity: "rare", obtain: "coins", price: 2500 },
  { id: "neon", tab: "tiles", name: "Neon", blurb: "Common. Black tiles, a green pip glow, and a pink bar. About two days of play.", glow: "#39ffb0", rarity: "common", obtain: "coins", price: 500 },
  { id: "marble", tab: "tiles", name: "Marble", blurb: "Rare. Pale stone with gray veins and a brass bar.", glow: "#d9d3c8", rarity: "rare", obtain: "coins", price: 2500 },
  { id: "wood", tab: "tiles", name: "Wood", blurb: "Common. Warm grain, dark pips, a stained bar.", glow: "#8a5a32", rarity: "common", obtain: "coins", price: 500 },
  { id: "smoked", tab: "tiles", name: "Smoked", blurb: "Epic. Charcoal tiles, a smoked face, white pips, and a thin gold edge. About a month of play.", glow: "#e31e26", rarity: "epic", obtain: "coins", price: 10000 },
  { id: "green", tab: "tables", name: "Classic green", blurb: "Common. The old felt. Included.", glow: "#1e6b3a", rarity: "common", obtain: "earned", earnNote: "Included" },
  { id: "redfelt", tab: "tables", name: "Brand red", blurb: "Common. A deep red felt in the house color. Included.", glow: "#e31e26", rarity: "common", obtain: "earned", earnNote: "Included" },
  { id: "city", tab: "tables", name: "City night", blurb: "Epic. A skyline after dark, with a few windows still on.", glow: "#3d6ea8", rarity: "epic", obtain: "coins", price: 10000 },
  { id: "desert", tab: "tables", name: "Desert", blurb: "Rare. Dunes, a low sun, and a warm table.", glow: "#e07a3d", rarity: "rare", obtain: "coins", price: 2500 },
  { id: "beach", tab: "tables", name: "Florida beach", blurb: "Epic. Sand, a strip of water, and a bright sky. Premium and limited.", glow: "#2a8fad", rarity: "epic", obtain: "gems", price: 500, limited: true },
  { id: "tailgate", tab: "tables", name: "Tailgate", blurb: "Rare. Parking-lot stripes and a gold light. Earned at Hustler. Never sold.", glow: "#d5a336", rarity: "rare", obtain: "earned", tierId: "hustler", earnNote: "Hustler" },
  { id: "plain", tab: "frames", name: "Plain", blurb: "Common. No frame. Just the portrait. Included.", glow: "#efefef", rarity: "common", obtain: "earned", earnNote: "Included" },
  { id: "goldring", tab: "frames", name: "Gold ring", blurb: "Common. A gold circle around the portrait.", glow: "#d5a336", rarity: "common", obtain: "coins", price: 500 },
  { id: "redframe", tab: "frames", name: "Red enamel", blurb: "Rare. A red ring with a gold hairline. Premium and limited.", glow: "#e31e26", rarity: "rare", obtain: "gems", price: 300, limited: true },
  { id: "rookie", tab: "frames", name: "Rookie frame", blurb: "Common. Earned when a season starts at Rookie. Never sold.", glow: "#efefef", rarity: "common", obtain: "earned", tierId: "rookie", earnNote: "Rookie" },
  { id: "hustler", tab: "frames", name: "Hustler frame", blurb: "Rare. Earned at Hustler. Never sold.", glow: "#d5a336", rarity: "rare", obtain: "earned", tierId: "hustler", earnNote: "Hustler" },
  { id: "shark", tab: "frames", name: "Shark frame", blurb: "Epic. Earned at Shark. Never sold.", glow: "#e31e26", rarity: "epic", obtain: "earned", tierId: "shark", earnNote: "Shark" },
  { id: "legend", tab: "frames", name: "Legend frame", blurb: "Legendary. Earned at UH-OH Legend. Never sold.", glow: "#d5a336", rarity: "legendary", obtain: "earned", tierId: "legend", earnNote: "UH-OH Legend" },
  { id: "century", tab: "frames", name: "Century", blurb: "Epic. Earned at 100 UH-OHs. Never sold.", glow: "#b06bff", rarity: "epic", obtain: "earned", earnNote: "100 UH-OHs" },
  { id: "series", tab: "frames", name: "World Series", blurb: "Legendary. The World Series trophy. Earned by winning it. Never sold.", glow: "#d5a336", rarity: "legendary", obtain: "earned", earnNote: "World Series" },
  { id: "glass", tab: "effects", name: "Glass shatter", blurb: "Common. The house shatter. Included.", glow: "#efefef", rarity: "common", obtain: "earned", earnNote: "Included", fx: "glass" },
  { id: "fire", tab: "effects", name: "Fire", blurb: "Rare. Tiles burst into flames around the same UH-OH.", glow: "#ff6a1a", rarity: "rare", obtain: "coins", price: 2500, fx: "fire" },
  { id: "lightning", tab: "effects", name: "Lightning", blurb: "Epic. Blue-white bolts crackle around the winning tiles. Earned at Shark. Never sold.", glow: "#7ec8ff", rarity: "epic", obtain: "earned", tierId: "shark", earnNote: "Shark", fx: "lightning" },
  { id: "money", tab: "effects", name: "Money blast", blurb: "Epic. A cannon of bone bills and gold coins. Cosmetic only. Premium and limited.", glow: "#d5a336", rarity: "epic", obtain: "gems", price: 1200, limited: true, fx: "money" },
  { id: "confetti", tab: "effects", name: "Confetti pop", blurb: "Common. A confetti cannon around the same UH-OH. About two days of play.", glow: "#e31e26", rarity: "common", obtain: "coins", price: 500, fx: "confetti" },
  { id: "tumble", tab: "effects", name: "Domino tumble", blurb: "Rare. A short wall of tiles tips across the scoring play.", glow: "#efefef", rarity: "rare", obtain: "coins", price: 2500, fx: "tumble" },
  { id: "quake", tab: "effects", name: "Earthquake", blurb: "Epic. Glowing cracks and a shockwave toss nearby tiles. About a month of play.", glow: "#d5a336", rarity: "epic", obtain: "coins", price: 10000, fx: "quake" },
  { id: "trophy", tab: "effects", name: "Trophy rain", blurb: "Epic. Mini trophies fall around the UH-OH. Premium and limited.", glow: "#d5a336", rarity: "epic", obtain: "gems", price: 800, limited: true, fx: "trophy" },
  { id: "fireworks", tab: "effects", name: "Fireworks finale", blurb: "Epic. A short red, white, and blue finale. Premium and limited.", glow: "#e31e26", rarity: "epic", obtain: "gems", price: 1500, limited: true, fx: "fireworks" },
  { id: "goldburst", tab: "effects", name: "Legend gold burst", blurb: "Legendary. A gold shockwave and the UH-OH Legend crest. A few months of steady play.", glow: "#d5a336", rarity: "legendary", obtain: "coins", price: 35000, fx: "legend" },
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

const GEM_PACKS = [
  { name: "Chip", gems: "100", price: "$0.99" },
  { name: "Stack", gems: "550", price: "$4.99" },
  { name: "Vault", gems: "2,500", price: "$19.99" },
];

const RARITY_NAME: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export function storeDemoRequested(): boolean {
  return new URLSearchParams(location.search).get("demo") === "store";
}

function arrange(items: Item[], equippedId: string): Item[] {
  const wearing = items.filter((item) => item.id === equippedId);
  const rest = items.filter((item) => item.id !== equippedId);
  const coins = rest.filter((item) => item.obtain === "coins").sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const gems = rest.filter((item) => item.obtain === "gems").sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const earned = rest.filter((item) => item.obtain === "earned");
  const mixed: Item[] = [];
  const count = Math.max(coins.length, gems.length, earned.length);
  for (let index = 0; index < count; index += 1) {
    if (coins[index]) mixed.push(coins[index]);
    if (earned[index]) mixed.push(earned[index]);
    if (gems[index]) mixed.push(gems[index]);
  }
  return [...wearing, ...mixed];
}

function itemById(id: string): Item {
  return CATALOG.find((item) => item.id === id) ?? CATALOG[0]!;
}

function fxOf(item: Item): FxId {
  return normalizeFx(item.fx ?? item.id);
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
  gems: number;
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
    gems: PREVIEW_GEMS,
  };
  if (shot === "tiles") return { ...base, tab: "tiles", selected: "neon" };
  if (shot === "tables") return { ...base, tab: "tables", selected: "desert" };
  if (shot === "frames") return { ...base, tab: "frames", selected: "shark" };
  if (shot === "effects") return { ...base, tab: "effects", selected: "fire" };
  if (shot === "owned") return { ...base, filter: "owned", selected: "golfer" };
  if (shot === "detail") return { ...base, tab: "tiles", stage: "detail", selected: "smoked" };
  if (shot === "confirm") return { ...base, tab: "tiles", stage: "confirm", selected: "neon" };
  if (shot === "congrats") {
    return { ...base, tab: "tiles", stage: "congrats", selected: "neon", owned: [...STARTER_OWNED, "neon"], coins: PREVIEW_COINS - 500 };
  }
  if (shot === "loadout") return { ...base, stage: "loadout" };
  if (shot === "packs") return { ...base, stage: "packs" };
  if (shot === "pass") return { ...base, stage: "pass" };
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
  const [gems, setGems] = useState(script.gems);
  const [wornFx, setWornFx] = useState<FxId>(readEquippedFx());
  const selected = itemById(selectedId);
  const visible = arrange(CATALOG.filter((item) => item.tab === tab).filter((item) =>
    filter === "owned" ? owned.includes(item.id) : !owned.includes(item.id),
  ), loadout[tab]);
  useEffect(() => {
    document.querySelector(`.store-tabs [data-tab="${tab}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);

  const open = (item: Item) => {
    setSelectedId(item.id);
    setStage(item.tab === "effects" ? "play" : "detail");
  };

  const equip = (item: Item) => {
    setLoadout((current) => ({ ...current, [item.tab]: item.id }));
    if (item.tab === "effects") {
      const fx = fxOf(item);
      writeEquippedFx(fx);
      setWornFx(fx);
    }
    setStage("browse");
    setFilter("owned");
    setTab(item.tab);
  };

  const wearFx = (item: Item) => {
    const fx = fxOf(item);
    writeEquippedFx(fx);
    setWornFx(fx);
    if (owned.includes(item.id)) {
      setLoadout((current) => ({ ...current, effects: item.id }));
    }
  };

  const buy = () => {
    if (selected.obtain === "earned" || selected.price == null) return;
    if (selected.obtain === "gems") {
      if (gems < selected.price) {
        setStage("packs");
        return;
      }
      setGems((value) => value - selected.price!);
    } else {
      if (coins < selected.price) {
        setStage("packs");
        return;
      }
      setCoins((value) => value - selected.price!);
    }
    setOwned((list) => (list.includes(selected.id) ? list : [...list, selected.id]));
    setStage("congrats");
  };

  return (
    <main className="store-app" data-screen="store" data-store-shot={shot ?? stage}>
      {stage === "play" && selected.tab === "effects" ? (
        <EffectPlay
          item={selected}
          worn={wornFx === fxOf(selected)}
          onWear={() => wearFx(selected)}
          onDetails={() => setStage("detail")}
          onBack={() => setStage("browse")}
        />
      ) : stage === "congrats" ? (
        <Congrats item={selected} onEquip={() => equip(selected)} onClose={() => setStage("browse")} />
      ) : stage === "loadout" ? (
        <LoadoutView loadout={loadout} onBack={() => setStage("browse")} />
      ) : stage === "pass" ? (
        <SeasonPass onBack={() => setStage(shot === "pass" ? "browse" : "packs")} />
      ) : (
        <>
          <header className="store-bar">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>Store</h2>
            </div>
            <div className="wallet">
              <button type="button" className="coin-chip" onClick={tap(() => setStage("packs"))} aria-label={`${coins.toLocaleString()} Bones`}>
                <BoneMark />
                <span>{coins.toLocaleString()}</span>
              </button>
              <button type="button" className="gold-chip" onClick={tap(() => setStage("packs"))} aria-label={`${gems.toLocaleString()} Gold Bones`}>
                <BoneMark gold />
                <span>{gems.toLocaleString()}</span>
                <span className="coin-plus" aria-hidden="true">+</span>
              </button>
            </div>
          </header>

          {stage === "detail" || stage === "confirm" ? (
            <Detail
              item={selected}
              owned={owned.includes(selected.id)}
              equipped={loadout[selected.tab] === selected.id}
              coins={coins}
              gems={gems}
              onBack={() => setStage(selected.tab === "effects" ? "play" : "browse")}
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
                  <article key={item.id} className={`store-card rarity-${item.rarity}`} style={{ "--glow": item.glow } as CSSProperties} data-item={item.id} data-rarity={item.rarity}>
                    <button type="button" className="store-card-open" onClick={tap(() => open(item))}>
                      <span className={`rarity-pill rarity-${item.rarity}`}>{RARITY_NAME[item.rarity]}</span>
                      <span className="store-glow" />
                      <span className="store-art"><ItemArt item={item} /></span>
                      <span className="store-name">{item.name}</span>
                      {item.obtain === "earned" && item.earnNote !== "Included" ? <span className="earned-badge">Earned only</span> : null}
                      {item.limited ? <span className="limited-pill">Limited</span> : null}
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
            <Confirm item={selected} coins={coins} gems={gems} onYes={tap(buy)} onNo={tap(() => setStage("detail"))} />
          ) : null}
          {stage === "packs" ? <Packs onClose={tap(() => setStage("browse"))} onPass={tap(() => setStage("pass"))} /> : null}
        </>
      )}
    </main>
  );
}

function payName(item: Item): string {
  return item.obtain === "gems" ? "Gold Bones" : "Bones";
}

function CardTag({ item, owned, equipped }: { item: Item; owned: boolean; equipped: boolean }) {
  if (equipped) return <span className="store-tag tag-wear">Wearing</span>;
  if (owned) return <span className="store-tag tag-own">Apply</span>;
  if (item.obtain === "earned") {
    return (
      <span className="store-tag tag-earned">
        {item.tierId ? <RankBadge tier={item.tierId} /> : null}
        {item.earnNote}
      </span>
    );
  }
  return (
    <span className={`store-tag tag-price${item.obtain === "gems" ? " tag-gold" : ""}`}>
      <BoneMark gold={item.obtain === "gems"} />
      {item.price?.toLocaleString()}
    </span>
  );
}

function Detail({
  item,
  owned,
  equipped,
  coins,
  gems,
  onBack,
  onEquip,
  onBuy,
  onPacks,
}: {
  item: Item;
  owned: boolean;
  equipped: boolean;
  coins: number;
  gems: number;
  onBack: () => void;
  onEquip: () => void;
  onBuy: () => void;
  onPacks: () => void;
}) {
  const price = item.price ?? 0;
  const wallet = item.obtain === "gems" ? gems : coins;
  const short = item.obtain !== "earned" && !owned && wallet < price;
  return (
    <section className="store-detail" data-screen="store-detail" data-rarity={item.rarity}>
      <button type="button" className="text-button" onClick={tap(onBack)}>Back</button>
      <div className={`detail-art rarity-${item.rarity}`} style={{ "--glow": item.glow } as CSSProperties}>
        <span className="store-glow" />
        <ItemArt item={item} large />
      </div>
      <p className="rarity-line">
        <span className={`rarity-pill rarity-${item.rarity}`}>{RARITY_NAME[item.rarity]}</span>
        {item.obtain === "earned" ? <span className="earned-badge">Earned only</span> : null}
        {item.limited ? <span className="limited-pill">Limited</span> : null}
      </p>
      <h2>{item.name}</h2>
      <p>{item.blurb}</p>
      {item.obtain === "earned" && !owned ? (
        <p className="store-tag tag-earned">
          {item.tierId ? <RankBadge tier={item.tierId} /> : null}
          {item.earnNote}
        </p>
      ) : null}
      <div className="store-foot">
        {equipped ? (
          <button type="button" className="capsule" disabled>Wearing</button>
        ) : owned ? (
          <button type="button" className="capsule" data-action="apply" onClick={tap(onEquip)}>Apply</button>
        ) : item.obtain === "earned" ? (
          <button type="button" className="capsule" disabled>Earned only</button>
        ) : short ? (
          <button type="button" className="capsule capsule-red" onClick={tap(onPacks)}>
            Need {price.toLocaleString()} {payName(item)}
          </button>
        ) : (
          <button type="button" className="capsule" data-action="buy" onClick={tap(onBuy)}>
            Buy for {price.toLocaleString()} {payName(item)}
          </button>
        )}
      </div>
    </section>
  );
}

function Confirm({
  item,
  coins,
  gems,
  onYes,
  onNo,
}: {
  item: Item;
  coins: number;
  gems: number;
  onYes: () => void;
  onNo: () => void;
}) {
  const price = item.price ?? 0;
  const have = item.obtain === "gems" ? gems : coins;
  return (
    <div className="store-scrim" data-screen="store-confirm">
      <section className="store-dialog" role="dialog" aria-label="Confirm purchase">
        <p className="eyebrow">Confirm</p>
        <h2>Buy {item.name}?</h2>
        <div className="confirm-art"><ItemArt item={item} /></div>
        <p>
          {price.toLocaleString()} {payName(item)}. You have {have.toLocaleString()}. After this, {(have - price).toLocaleString()}.
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

function Packs({ onClose, onPass }: { onClose: () => void; onPass: () => void }) {
  return (
    <div className="store-scrim" data-screen="store-packs">
      <section className="store-dialog" role="dialog" aria-label="Gold Bones packs">
        <p className="eyebrow">Drawing only</p>
        <h2>Gold Bones packs</h2>
        <p>Real money, on paper only. Nothing on this phone can be charged.</p>
        <ul className="pack-list">
          {GEM_PACKS.map((pack) => (
            <li key={pack.name}>
              <span>{pack.name}</span>
              <span className="pack-gems"><BoneMark gold /> {pack.gems}</span>
              <span>{pack.price}</span>
            </li>
          ))}
        </ul>
        <p>100 Gold Bones become 500 Bones, one way. Neither pays out as cash.</p>
        <button type="button" className="capsule" data-action="season-pass" onClick={onPass}>Season pass · $4.99</button>
        <button type="button" className="capsule" disabled>Not for sale</button>
        <button type="button" className="capsule capsule-back" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}

function SeasonPass({ onBack }: { onBack: () => void }) {
  return (
    <section className="store-loadout store-pass" data-screen="store-pass">
      <p className="eyebrow">Idea · not for sale</p>
      <h2>Season pass</h2>
      <p className="pass-price">$4.99 for the season</p>
      <p>Every reward is listed here. No loot box and no random draw.</p>
      <ul className="pass-list">
        <li>1,500 Bones, the day you start</li>
        <li>Fire, the UH-OH effect</li>
        <li>Desert table</li>
      </ul>
      <p>The free path stays earned: season tiers, the World Series, and achievements such as 100 UH-OHs. Those are not on this pass, and they are not for sale.</p>
      <button type="button" className="capsule" disabled>Not for sale</button>
      <button type="button" className="capsule capsule-back" onClick={tap(onBack)}>Back</button>
    </section>
  );
}

function EffectPlay({
  item,
  worn,
  onWear,
  onDetails,
  onBack,
}: {
  item: Item;
  worn: boolean;
  onWear: () => void;
  onDetails: () => void;
  onBack: () => void;
}) {
  const [run, setRun] = useState(1);
  const fx = fxOf(item);
  return (
    <section className="fx-play" data-screen="store-fx" data-fx={fx}>
      <FxBoard effect={fx} token={`store-${item.id}-${run}`} />
      <div className="uhoh-preview-bar">
        <button type="button" className="primary" data-action="replay-fx" onClick={tap(() => setRun((value) => value + 1))}>
          Play again
        </button>
        <button type="button" className="capsule" data-action="wear-fx" onClick={tap(onWear)} disabled={worn}>
          {worn ? "Wearing" : "Wear in preview"}
        </button>
        <button
          type="button"
          className="text-button"
          data-action="score-fx"
          onClick={tap(() => {
            onWear();
            location.assign(`/?demo=uhoh&fx=${fx}`);
          })}
        >
          See it on a score
        </button>
        <button type="button" className="text-button" onClick={tap(onDetails)}>Details</button>
        <button type="button" className="text-button" onClick={tap(onBack)}>Back</button>
      </div>
    </section>
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
  const fx = id === "goldburst" ? "legend" : id;
  if (fx === "fire") {
    return (
      <span className="effect-still effect-fire" aria-hidden="true">
        <i /><i /><i />
      </span>
    );
  }
  if (fx === "money") {
    return (
      <span className="effect-still effect-money" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </span>
    );
  }
  if (fx === "lightning") {
    return (
      <span className="effect-still effect-bolt" aria-hidden="true">
        <svg viewBox="0 0 64 96">
          <path d="M38 2 L14 46 H30 L22 94 L54 40 H36 Z" />
        </svg>
      </span>
    );
  }
  if (fx === "confetti" || fx === "trophy" || fx === "fireworks" || fx === "tumble") {
    return (
      <span className={`effect-still effect-${fx}`} aria-hidden="true">
        <i /><i /><i /><i /><i />
      </span>
    );
  }
  if (fx === "quake" || fx === "legend") {
    return (
      <span className={`effect-still effect-${fx}`} aria-hidden="true">
        <i />
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

export function BoneMark({ gold = false }: { gold?: boolean }) {
  return (
    <svg className={gold ? "bone-mark bone-gold" : "bone-mark"} viewBox="0 0 16 28" aria-hidden="true">
      <rect x="1" y="1" width="14" height="26" rx="3" />
      <line x1="2.5" y1="14" x2="13.5" y2="14" />
      <circle cx="8" cy="7.2" r="1.6" />
      <circle cx="6.1" cy="20.6" r="1.45" />
      <circle cx="9.9" cy="20.6" r="1.45" />
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
