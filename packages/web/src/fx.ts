/**
 * Themed bursts for the UH-OH moment. They draw into the same table-sized
 * canvas as the glass shatter, for the same two seconds. The banner stays
 * the one already on screen.
 */

export const FX_LIST = [
  { id: "glass", code: "FX-001", name: "Glass shatter" },
  { id: "fire", code: "FX-002", name: "Fire" },
  { id: "lightning", code: "FX-003", name: "Lightning" },
  { id: "money", code: "FX-004", name: "Money blast" },
  { id: "confetti", code: "FX-005", name: "Confetti pop" },
  { id: "tumble", code: "FX-006", name: "Domino tumble" },
  { id: "quake", code: "FX-007", name: "Earthquake" },
  { id: "trophy", code: "FX-008", name: "Trophy rain" },
  { id: "fireworks", code: "FX-009", name: "Fireworks finale" },
  { id: "legend", code: "FX-010", name: "Legend gold burst" },
] as const;

export type FxId = (typeof FX_LIST)[number]["id"];

const FX_IDS = new Set<string>(FX_LIST.map((fx) => fx.id));
const EQUIP_KEY = "uhoh.previewFx";

export function normalizeFx(value: string | null | undefined): FxId {
  if (value && FX_IDS.has(value)) return value as FxId;
  return "glass";
}

export function fxMeta(id: FxId) {
  return FX_LIST.find((fx) => fx.id === id) ?? FX_LIST[0];
}

export function readEquippedFx(): FxId {
  try {
    return normalizeFx(sessionStorage.getItem(EQUIP_KEY));
  } catch {
    return "glass";
  }
}

export function writeEquippedFx(id: FxId): void {
  try {
    sessionStorage.setItem(EQUIP_KEY, id);
  } catch {
    // Preview only. A private window can still play the effect this once.
  }
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  delay: number;
  size: number;
  rot: number;
  spin: number;
  kind: number;
  a: number;
  b: number;
}

interface Bolt {
  pts: Array<[number, number]>;
  delay: number;
  life: number;
}

export interface FxScene {
  id: Exclude<FxId, "glass">;
  bits: Bit[];
  bolts: Bolt[];
  hitX: number;
  hitY: number;
  width: number;
  height: number;
}

export function createFxScene(
  id: Exclude<FxId, "glass">,
  width: number,
  height: number,
  ox: number,
  oy: number,
  seed: number,
): FxScene {
  const rand = mulberry(seed * 997 + id.length * 17);
  const hitX = clamp(ox, 16, Math.max(16, width - 16));
  const hitY = clamp(oy, 16, Math.max(16, height - 16));
  const bits: Bit[] = [];
  const bolts: Bolt[] = [];
  const push = (bit: Partial<Bit> & Pick<Bit, "x" | "y">) => {
    bits.push({
      vx: 0,
      vy: 0,
      life: 900,
      delay: 280,
      size: 8,
      rot: 0,
      spin: 0,
      kind: 0,
      a: 0,
      b: 0,
      ...bit,
    });
  };

  if (id === "fire") {
    for (let i = 0; i < 36; i += 1) {
      const rise = i < 24;
      const angle = rise ? -Math.PI / 2 + (rand() - 0.5) * 1.5 : Math.PI / 2 + (rand() - 0.5) * 1.1;
      const speed = rise ? 180 + rand() * 220 : 90 + rand() * 120;
      push({
        x: hitX + (rand() - 0.5) * 36,
        y: hitY + (rand() - 0.5) * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 900 + rand() * 500,
        delay: 220 + rand() * 280,
        size: 16 + rand() * 22,
        rot: rand() * 6,
        spin: (rand() - 0.5) * 2,
        kind: rand() < 0.28 ? 1 : 0,
      });
    }
  } else if (id === "lightning") {
    const span = Math.min(width, height) * 0.46;
    for (let n = 0; n < 6; n += 1) {
      const angle = -Math.PI / 2 + (n / 6) * Math.PI * 2;
      const reach = span * (0.85 + rand() * 0.35);
      const tip = (ang: number, dist: number): [number, number] => [
        clamp(hitX + Math.cos(ang) * dist, 10, width - 10),
        clamp(hitY + Math.sin(ang) * dist, 10, height - 10),
      ];
      const [x1, y1] = tip(angle, reach);
      const [x2, y2] = tip(angle + 0.4, reach * 0.72);
      bolts.push({
        pts: jagged(hitX, hitY, x1, y1, rand),
        delay: 220 + n * 140,
        life: 280,
      });
      bolts.push({
        pts: jagged(hitX, hitY, x2, y2, rand),
        delay: 300 + n * 140,
        life: 200,
      });
    }
  } else if (id === "money") {
    for (let i = 0; i < 22; i += 1) {
      const bill = i < 12;
      const angle = -Math.PI / 2 + (rand() - 0.5) * 2.2;
      const speed = 220 + rand() * 260;
      push({
        x: hitX,
        y: hitY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1200 + rand() * 300,
        delay: 220 + rand() * 120,
        size: bill ? 28 : 18,
        rot: rand() * 6,
        spin: (rand() - 0.5) * 5,
        kind: bill ? 0 : 1,
      });
    }
  } else if (id === "confetti") {
    for (let i = 0; i < 54; i += 1) {
      const angle = -Math.PI / 2 + (rand() - 0.5) * 2.4;
      const speed = 240 + rand() * 280;
      push({
        x: hitX + (rand() - 0.5) * 20,
        y: hitY - 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1300,
        delay: 220 + rand() * 80,
        size: 8 + rand() * 8,
        rot: rand() * 6,
        spin: (rand() - 0.5) * 8,
        kind: i % 5,
      });
    }
  } else if (id === "tumble") {
    const count = 9;
    const span = Math.min(width * 0.78, 320);
    for (let i = 0; i < count; i += 1) {
      push({
        x: hitX - span / 2 + (span / (count - 1)) * i,
        y: hitY - 150,
        life: 1500,
        delay: 240 + i * 80,
        size: 26,
        rot: 0,
        spin: 1,
        kind: i % 2,
        a: (i * 2) % 7,
        b: (i + 3) % 7,
      });
    }
  } else if (id === "quake") {
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const up = Math.sin(angle) < 0.2;
      push({
        x: hitX + Math.cos(angle) * 36,
        y: hitY + Math.sin(angle) * 20,
        vx: Math.cos(angle) * (up ? 40 : 70),
        vy: up ? -280 - rand() * 80 : 40 + rand() * 40,
        life: 1100,
        delay: 260,
        size: 22,
        rot: rand(),
        spin: (rand() - 0.5) * 7,
        kind: 0,
        a: i % 7,
        b: (i * 3) % 7,
      });
    }
  } else if (id === "trophy") {
    for (let i = 0; i < 16; i += 1) {
      push({
        x: hitX + (rand() - 0.5) * Math.min(width * 0.82, 320),
        y: hitY - 210 - rand() * 70,
        vx: (rand() - 0.5) * 24,
        vy: 110 + rand() * 90,
        life: 1400,
        delay: 200 + rand() * 420,
        size: 18 + rand() * 12,
        rot: (rand() - 0.5) * 0.5,
        spin: (rand() - 0.5) * 1.2,
      });
    }
  } else if (id === "fireworks") {
    const bursts = [
      { x: hitX, y: hitY - 168 },
      { x: hitX - 108, y: hitY - 120 },
      { x: hitX + 108, y: hitY - 128 },
      { x: hitX, y: hitY + 150 },
    ];
    bursts.forEach((burst, index) => {
      for (let i = 0; i < 16; i += 1) {
        const angle = (i / 16) * Math.PI * 2;
        const speed = 70 + rand() * 90;
        push({
          x: burst.x,
          y: burst.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 780,
          delay: 260 + index * 240,
          size: 4 + rand() * 3,
          kind: index % 3,
        });
      }
    });
  } else if (id === "legend") {
    for (let i = 0; i < 28; i += 1) {
      const angle = (i / 28) * Math.PI * 2;
      const speed = 80 + rand() * 160;
      push({
        x: hitX,
        y: hitY - 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1000,
        delay: 240,
        size: 5 + rand() * 5,
        kind: i % 2,
      });
    }
  }

  return { id, bits, bolts, hitX, hitY, width, height };
}

export function drawFx(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const fade = t > 1500 ? Math.max(0, 1 - (t - 1500) / 500) : 1;
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  if (scene.id === "fire") drawFire(ctx, scene, t);
  else if (scene.id === "lightning") drawLightning(ctx, scene, t);
  else if (scene.id === "money") drawMoney(ctx, scene, t);
  else if (scene.id === "confetti") drawConfetti(ctx, scene, t);
  else if (scene.id === "tumble") drawTumble(ctx, scene, t);
  else if (scene.id === "quake") drawQuake(ctx, scene, t);
  else if (scene.id === "trophy") drawTrophy(ctx, scene, t);
  else if (scene.id === "fireworks") drawFireworks(ctx, scene, t);
  else drawLegend(ctx, scene, t);
  ctx.restore();
}

function ageOf(bit: Bit, t: number): number {
  return (t - bit.delay) / 1000;
}

function drawFire(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bit of scene.bits) {
    const age = ageOf(bit, t);
    if (age < 0 || age > bit.life / 1000) continue;
    const p = age / (bit.life / 1000);
    const x = bit.x + bit.vx * age;
    const y = bit.y + bit.vy * age - 80 * age * age;
    const h = bit.size * (1.4 - p);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(age * 8 + bit.rot) * 0.3);
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.quadraticCurveTo(h * 0.7, 0, 0, h * 0.45);
    ctx.quadraticCurveTo(-h * 0.7, 0, 0, -h);
    ctx.fillStyle = bit.kind === 1 ? "#fff4d2" : p < 0.45 ? "#ffd25a" : "#ff6a1a";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1a0a04";
    ctx.stroke();
    ctx.restore();
  }
}

function drawLightning(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bolt of scene.bolts) {
    const age = t - bolt.delay;
    if (age < 0 || age > bolt.life) continue;
    const alpha = 1 - age / bolt.life;
    ctx.beginPath();
    bolt.pts.forEach((pt, index) => (index === 0 ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1])));
    ctx.strokeStyle = `rgba(12, 18, 48, ${alpha})`;
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.strokeStyle = `rgba(126, 200, 255, ${alpha})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = `rgba(239, 248, 255, ${alpha})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

function drawMoney(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bit of scene.bits) {
    const age = ageOf(bit, t);
    if (age < 0 || age > bit.life / 1000) continue;
    const x = bit.x + bit.vx * age;
    const y = bit.y + bit.vy * age + 420 * age * age;
    const rot = bit.rot + bit.spin * age;
    if (bit.kind === 0) boneBill(ctx, x, y, bit.size, rot);
    else boneCoin(ctx, x, y, bit.size, rot);
  }
}

function drawConfetti(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const colors = ["#e31e26", "#d5a336", "#efefef", "#4aa3ff", "#3ddc78"];
  for (const bit of scene.bits) {
    const age = ageOf(bit, t);
    if (age < 0 || age > bit.life / 1000) continue;
    const x = bit.x + bit.vx * age + Math.sin(age * 9 + bit.rot) * 10;
    const y = bit.y + bit.vy * age + 280 * age * age;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bit.rot + bit.spin * age);
    ctx.fillStyle = colors[bit.kind] ?? "#efefef";
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = 1.2;
    ctx.fillRect(-bit.size / 2, -3, bit.size, 6);
    ctx.strokeRect(-bit.size / 2, -3, bit.size, 6);
    ctx.restore();
  }
}

function drawTumble(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bit of scene.bits) {
    const age = t - bit.delay;
    if (age < -40) continue;
    const fall = clamp(age / 220, 0, 1);
    const rot = fall * (Math.PI / 2);
    const x = bit.x + Math.sin(rot) * (bit.size * 0.45);
    const y = bit.y + (1 - Math.cos(rot)) * (bit.size * 0.9);
    const alpha = t > 1600 ? Math.max(0, 1 - (t - 1600) / 400) : 1;
    ctx.save();
    ctx.globalAlpha *= alpha;
    miniDomino(ctx, x, y, rot, bit.a, bit.b, bit.size / 16);
    ctx.restore();
  }
}

function drawQuake(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const grow = clamp((t - 260) / 700, 0, 1);
  const reach = Math.min(scene.width, scene.height) * 0.46;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1a1204";
  ctx.lineWidth = 8;
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.2;
    const len = 28 + grow * reach;
    ctx.beginPath();
    ctx.moveTo(scene.hitX, scene.hitY);
    ctx.lineTo(scene.hitX + Math.cos(angle) * len, scene.hitY + Math.sin(angle) * len * 0.72);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(213, 163, 54, ${0.95 * (1 - grow * 0.25)})`;
  ctx.lineWidth = 4;
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.2;
    const len = 20 + grow * reach;
    ctx.beginPath();
    ctx.moveTo(scene.hitX, scene.hitY);
    ctx.lineTo(scene.hitX + Math.cos(angle) * len, scene.hitY + Math.sin(angle) * len * 0.65);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(scene.hitX, scene.hitY, 16 + grow * reach, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(227, 30, 38, ${1 - grow})`;
  ctx.lineWidth = 4;
  ctx.stroke();
  for (const bit of scene.bits) {
    const age = ageOf(bit, t);
    if (age < 0 || age > bit.life / 1000) continue;
    const y = bit.y + bit.vy * age + 520 * age * age;
    miniDomino(ctx, bit.x + bit.vx * age, y, bit.rot + bit.spin * age, bit.a, bit.b, bit.size / 16);
  }
}

function drawTrophy(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bit of scene.bits) {
    const age = ageOf(bit, t);
    if (age < 0 || age > bit.life / 1000) continue;
    const x = bit.x + bit.vx * age;
    const y = bit.y + bit.vy * age;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bit.rot + bit.spin * age);
    const s = bit.size;
    ctx.fillStyle = "#d5a336";
    ctx.strokeStyle = "#1a1204";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-s * 0.45, -s * 0.2);
    ctx.lineTo(-s * 0.3, s * 0.35);
    ctx.lineTo(s * 0.3, s * 0.35);
    ctx.lineTo(s * 0.45, -s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-s * 0.45, 0, s * 0.22, Math.PI * 0.2, Math.PI * 1.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s * 0.45, 0, s * 0.22, -Math.PI * 0.4, Math.PI * 0.8);
    ctx.stroke();
    ctx.fillRect(-s * 0.28, s * 0.4, s * 0.56, s * 0.16);
    ctx.strokeRect(-s * 0.28, s * 0.4, s * 0.56, s * 0.16);
    ctx.restore();
  }
}

function drawFireworks(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const colors = ["#e31e26", "#efefef", "#3d6ea8"];
  for (const bit of scene.bits) {
    const age = ageOf(bit, t);
    if (age < 0 || age > bit.life / 1000) continue;
    const p = age / (bit.life / 1000);
    const x = bit.x + bit.vx * age;
    const y = bit.y + bit.vy * age + 40 * age * age;
    ctx.save();
    ctx.globalAlpha *= 1 - p;
    ctx.strokeStyle = colors[bit.kind] ?? "#efefef";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - bit.vx * 0.05, y - bit.vy * 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, bit.size + 1.2, 0, Math.PI * 2);
    ctx.fillStyle = colors[bit.kind] ?? "#efefef";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#141414";
    ctx.stroke();
    ctx.restore();
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const grow = clamp((t - 260) / 500, 0, 1);
  const reach = Math.min(scene.width, scene.height) * 0.48;
  ctx.beginPath();
  ctx.arc(scene.hitX, scene.hitY, 12 + grow * reach, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(213, 163, 54, ${1 - grow})`;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(scene.hitX, scene.hitY, 8 + grow * reach * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(239, 239, 239, ${(1 - grow) * 0.8})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  for (const bit of scene.bits) {
    const age = ageOf(bit, t);
    if (age < 0 || age > bit.life / 1000) continue;
    const p = age / (bit.life / 1000);
    ctx.save();
    ctx.globalAlpha *= (1 - p) * 0.95;
    ctx.fillStyle = bit.kind === 0 ? "#d5a336" : "#fff4d2";
    ctx.strokeStyle = "#1a1204";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(bit.x + bit.vx * age, bit.y + bit.vy * age, bit.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  const crestAlpha = clamp((t - 360) / 200, 0, 1) * (t > 1600 ? Math.max(0, 1 - (t - 1600) / 400) : 1);
  ctx.save();
  ctx.globalAlpha *= crestAlpha;
  crest(ctx, scene.hitX, scene.hitY - Math.min(158, scene.height * 0.2), 52);
  ctx.restore();
}

function boneBill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rot: number): void {
  const h = w * 0.55;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  round(ctx, -w / 2, -h / 2, w, h, 3);
  ctx.fillStyle = "#efefef";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#141414";
  ctx.stroke();
  ctx.strokeStyle = "#e31e26";
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 2, 0);
  ctx.lineTo(w / 2 - 2, 0);
  ctx.stroke();
  ctx.fillStyle = "#141414";
  ctx.beginPath();
  ctx.arc(0, -h * 0.22, 1.4, 0, Math.PI * 2);
  ctx.arc(-2, h * 0.22, 1.2, 0, Math.PI * 2);
  ctx.arc(2, h * 0.22, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function boneCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.arc(0, 0, r / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#d5a336";
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#1a1204";
  ctx.stroke();
  ctx.fillStyle = "#1a1204";
  ctx.beginPath();
  ctx.arc(0, -1.5, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function miniDomino(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, a: number, b: number, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  round(ctx, -8, -16, 16, 32, 3);
  ctx.fillStyle = "#efefef";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "#141414";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(6, 0);
  ctx.strokeStyle = "#e31e26";
  ctx.stroke();
  pips(ctx, 0, -8, a);
  pips(ctx, 0, 8, b);
  ctx.restore();
}

const PIP: Record<number, Array<[number, number]>> = {
  0: [],
  1: [[0, 0]],
  2: [[-2, -2], [2, 2]],
  3: [[-2, -2], [0, 0], [2, 2]],
  4: [[-2, -2], [2, -2], [-2, 2], [2, 2]],
  5: [[-2, -2], [2, -2], [0, 0], [-2, 2], [2, 2]],
  6: [[-2, -2], [2, -2], [-2, 0], [2, 0], [-2, 2], [2, 2]],
};

function pips(ctx: CanvasRenderingContext2D, x: number, y: number, value: number): void {
  ctx.fillStyle = "#141414";
  for (const [dx, dy] of PIP[value] ?? []) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, 1.05, 0, Math.PI * 2);
    ctx.fill();
  }
}

function crest(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.85, -s * 0.45);
  ctx.lineTo(s * 0.7, s * 0.75);
  ctx.lineTo(0, s);
  ctx.lineTo(-s * 0.7, s * 0.75);
  ctx.lineTo(-s * 0.85, -s * 0.45);
  ctx.closePath();
  ctx.fillStyle = "#d5a336";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1a1204";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.35);
  for (let i = 0; i < 5; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    ctx.lineTo(Math.cos(angle) * s * 0.28, Math.sin(angle) * s * 0.28 + s * 0.05);
    const inner = angle + Math.PI / 5;
    ctx.lineTo(Math.cos(inner) * s * 0.12, Math.sin(inner) * s * 0.12 + s * 0.05);
  }
  ctx.closePath();
  ctx.fillStyle = "#e31e26";
  ctx.fill();
  ctx.restore();
}

function jagged(x0: number, y0: number, x1: number, y1: number, rand: () => number): Array<[number, number]> {
  const pts: Array<[number, number]> = [[x0, y0]];
  const steps = 5;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t + (rand() - 0.5) * 16;
    const y = y0 + (y1 - y0) * t + (rand() - 0.5) * 16;
    pts.push([x, y]);
  }
  pts.push([x1, y1]);
  return pts;
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
