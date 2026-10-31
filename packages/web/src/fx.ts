/**
 * Themed bursts for the UH-OH moment. Every effect starts on the placed
 * tile and grows to about 80% of the viewport, then fades. The banner
 * stays on top.
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
const IMPACT = 220;
const EXPAND = 860;

export const HEAVY_FX = new Set<FxId>(["glass", "fire", "lightning", "quake", "fireworks", "legend"]);

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

/** How far a burst should travel from the tile to cover about 80% of the screen. */
export function peakReach(width: number, height: number, x: number, y: number): number {
  const far = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  return Math.max(140, far * 0.8);
}

interface Bit {
  ang: number;
  far: number;
  delay: number;
  life: number;
  size: number;
  rot: number;
  spin: number;
  kind: number;
  a: number;
  b: number;
  drift: number;
}

interface Bolt {
  pts: Array<[number, number]>;
  delay: number;
  far: number;
}

export interface FxScene {
  id: Exclude<FxId, "glass">;
  bits: Bit[];
  bolts: Bolt[];
  hitX: number;
  hitY: number;
  peak: number;
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
  const hitX = clamp(ox, 8, Math.max(8, width - 8));
  const hitY = clamp(oy, 8, Math.max(8, height - 8));
  const peak = peakReach(width, height, hitX, hitY);
  const bits: Bit[] = [];
  const bolts: Bolt[] = [];
  const push = (bit: Partial<Bit> & Pick<Bit, "ang" | "far">) => {
    bits.push({
      delay: 0,
      life: 1400,
      size: 10,
      rot: rand() * 6,
      spin: (rand() - 0.5) * 4,
      kind: 0,
      a: 0,
      b: 0,
      drift: (rand() - 0.5) * 40,
      ...bit,
    });
  };

  if (id === "fire") {
    for (let i = 0; i < 42; i += 1) {
      const big = i < 16;
      push({
        ang: -Math.PI / 2 + (rand() - 0.5) * 2.35,
        far: big ? 0.62 + rand() * 0.36 : 0.22 + rand() * 0.55,
        delay: rand() * (big ? 120 : 260),
        life: 1500 + rand() * 400,
        size: big ? 120 + rand() * 80 : 36 + rand() * 40,
        kind: 0,
        spin: 6 + rand() * 10,
      });
    }
    for (let i = 0; i < 36; i += 1) {
      push({
        ang: -Math.PI / 2 + (rand() - 0.5) * 1.7,
        far: 0.25 + rand() * 0.7,
        delay: 40 + rand() * 280,
        life: 900 + rand() * 400,
        size: 1.4 + rand() * 2.2,
        kind: 1,
        spin: rand() * 8,
      });
    }
    for (let i = 0; i < 10; i += 1) {
      push({
        ang: -Math.PI / 2 + (rand() - 0.5) * 1.2,
        far: 0.45 + rand() * 0.45,
        delay: 80 + rand() * 200,
        life: 1200,
        size: 16 + rand() * 18,
        kind: 2,
      });
    }
  } else if (id === "lightning") {
    for (let n = 0; n < 9; n += 1) {
      const ang = -Math.PI / 2 + (n / 9) * Math.PI * 2 + (rand() - 0.5) * 0.2;
      const far = n < 5 ? 0.72 + rand() * 0.28 : 0.34 + rand() * 0.28;
      const endX = hitX + Math.cos(ang) * peak * far;
      const endY = hitY + Math.sin(ang) * peak * far;
      bolts.push({
        pts: jagged(hitX, hitY, endX, endY, rand),
        delay: n * 70 + rand() * 40,
        far,
      });
      if (n < 5) {
        const fork = ang + (rand() - 0.5) * 0.7;
        bolts.push({
          pts: jagged(hitX, hitY, hitX + Math.cos(fork) * peak * far * 0.62, hitY + Math.sin(fork) * peak * far * 0.62, rand),
          delay: 120 + n * 80,
          far: far * 0.62,
        });
      }
    }
  } else if (id === "money") {
    for (let i = 0; i < 26; i += 1) {
      const big = i < 8;
      push({
        ang: rand() * Math.PI * 2,
        far: big ? 0.62 + rand() * 0.34 : 0.28 + rand() * 0.45,
        delay: rand() * 140,
        life: 1500,
        size: big ? 30 + rand() * 8 : i % 3 === 0 ? 16 : 22,
        kind: i % 3 === 0 ? 1 : 0,
        spin: (rand() - 0.5) * 8,
      });
    }
  } else if (id === "confetti") {
    for (let i = 0; i < 70; i += 1) {
      const big = i % 5 === 0;
      push({
        ang: rand() * Math.PI * 2,
        far: big ? 0.7 + rand() * 0.28 : 0.3 + rand() * 0.5,
        delay: rand() * 160,
        life: 1500,
        size: big ? 12 + rand() * 6 : 5 + rand() * 5,
        kind: i % 5,
        spin: (rand() - 0.5) * 10,
      });
    }
  } else if (id === "tumble") {
    const count = 11;
    for (let i = 0; i < count; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const step = Math.floor(i / 2) / 5;
      push({
        ang: side > 0 ? 0 : Math.PI,
        far: 0.16 + step * 0.78,
        delay: step * 36,
        life: 1600,
        size: 22,
        kind: 0,
        a: (i * 2) % 7,
        b: (i + 3) % 7,
        spin: side,
      });
    }
  } else if (id === "quake") {
    for (let i = 0; i < 10; i += 1) {
      push({
        ang: (i / 10) * Math.PI * 2,
        far: 0.35 + rand() * 0.5,
        delay: 40,
        life: 1300,
        size: i < 4 ? 26 : 16,
        kind: 0,
        a: i % 7,
        b: (i * 3) % 7,
        spin: (rand() - 0.5) * 8,
      });
    }
  } else if (id === "trophy") {
    for (let i = 0; i < 20; i += 1) {
      const big = i < 6;
      push({
        ang: -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.35,
        far: big ? 0.6 + rand() * 0.35 : 0.25 + rand() * 0.5,
        delay: rand() * 260,
        life: 1600,
        size: big ? 26 + rand() * 10 : 14 + rand() * 8,
        spin: (rand() - 0.5) * 2,
      });
    }
  } else if (id === "fireworks") {
    const shells = 5;
    for (let s = 0; s < shells; s += 1) {
      const ang = -Math.PI / 2 + ((s - (shells - 1) / 2) / shells) * 2.4;
      const far = 0.62 + (s % 2) * 0.22 + rand() * 0.12;
      push({ ang, far, delay: s * 90, life: 700, size: 3, kind: 3, a: s });
      for (let i = 0; i < 16; i += 1) {
        const big = i % 4 === 0;
        push({
          ang: (i / 16) * Math.PI * 2,
          far: far,
          delay: 280 + s * 160,
          life: 800,
          size: big ? 4.5 : 2.2,
          kind: s % 3,
          a: s,
          b: i,
          spin: 0.35 + rand() * 0.35,
        });
      }
    }
  } else if (id === "legend") {
    for (let i = 0; i < 36; i += 1) {
      const big = i < 10;
      push({
        ang: (i / 36) * Math.PI * 2,
        far: big ? 0.72 + rand() * 0.26 : 0.3 + rand() * 0.4,
        delay: rand() * 80,
        life: 1200,
        size: big ? 7 + rand() * 4 : 3 + rand() * 2,
        kind: i % 2,
      });
    }
  }

  return { id, bits, bolts, hitX, hitY, peak, width, height };
}

export function drawFx(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const fade = t > 1800 ? Math.max(0, 1 - (t - 1800) / 600) : 1;
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  drawShock(ctx, scene, t);
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

function spot(scene: FxScene, bit: Bit, t: number): { x: number; y: number; u: number } | null {
  const start = IMPACT + bit.delay;
  if (t < start) return null;
  const u = clamp((t - start) / EXPAND, 0, 1);
  const eased = easeOutBack(u);
  const dist = scene.peak * bit.far * eased;
  const extra = u >= 1 ? (t - start - EXPAND) / 1000 : 0;
  return {
    x: scene.hitX + Math.cos(bit.ang) * dist + Math.cos(bit.ang + 1.2) * bit.drift * extra,
    y: scene.hitY + Math.sin(bit.ang) * dist + (bit.kind === 1 ? -70 : Math.sin(bit.ang) * bit.drift) * extra,
    u: eased,
  };
}

function drawShock(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const u = clamp((t - IMPACT) / EXPAND, 0, 1);
  if (u <= 0) return;
  const r = 10 + scene.peak * easeOutBack(u);
  const alpha = Math.max(0, 1 - u) * 0.9;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.arc(scene.hitX, scene.hitY, r, 0, Math.PI * 2);
  ctx.strokeStyle = scene.id === "legend" || scene.id === "quake" ? "#fff4c8" : "#ffffff";
  ctx.lineWidth = 3 + (1 - u) * 10;
  ctx.stroke();
  const glow = ctx.createRadialGradient(scene.hitX, scene.hitY, 0, scene.hitX, scene.hitY, 70 + (1 - u) * 40);
  glow.addColorStop(0, `rgba(255,255,255,${0.35 * (1 - u)})`);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(scene.hitX, scene.hitY, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFire(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const heat = clamp((t - IMPACT) / 400, 0, 1) * (t > 1600 ? Math.max(0, 1 - (t - 1600) / 600) : 1);
  if (heat > 0.02) {
    const glow = ctx.createRadialGradient(scene.hitX, scene.hitY, 8, scene.hitX, scene.hitY, scene.peak * 0.42);
    glow.addColorStop(0, `rgba(255, 236, 180, ${0.55 * heat})`);
    glow.addColorStop(0.35, `rgba(255, 90, 10, ${0.22 * heat})`);
    glow.addColorStop(1, "rgba(120, 20, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(scene.hitX, scene.hitY, scene.peak * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const bit of scene.bits) {
    if (bit.kind !== 0) continue;
    const at = spot(scene, bit, t);
    if (!at) continue;
    const age = (t - IMPACT - bit.delay) / bit.life;
    if (age < 0 || age > 1) continue;
    const envelope = age < 0.1 ? age / 0.1 : age > 0.72 ? Math.max(0, 1 - (age - 0.72) / 0.28) : 1;
    const flicker = 0.78 + Math.sin(t * 0.031 * bit.spin + bit.rot) * 0.22;
    const len = bit.size * flicker * envelope;
    const wobble = Math.sin(t * 0.023 + bit.rot) * len * 0.18 + Math.sin(t * 0.011 + bit.ang) * 8;
    flame(ctx, at.x, at.y, len, Math.max(7, bit.size * 0.16), wobble, envelope);
  }
  for (const bit of scene.bits) {
    if (bit.kind !== 1) continue;
    const at = spot(scene, bit, t);
    if (!at) continue;
    const age = (t - IMPACT - bit.delay) / bit.life;
    if (age < 0 || age > 1) continue;
    ctx.save();
    ctx.globalAlpha *= 1 - age;
    ctx.fillStyle = age < 0.4 ? "#fff6d0" : "#ffb03a";
    ctx.beginPath();
    ctx.arc(at.x, at.y - age * 36, bit.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  for (const bit of scene.bits) {
    if (bit.kind !== 2) continue;
    const at = spot(scene, bit, t);
    if (!at) continue;
    const age = (t - IMPACT - bit.delay) / bit.life;
    if (age < 0.2 || age > 1) continue;
    ctx.save();
    ctx.globalAlpha *= (1 - age) * 0.35;
    ctx.fillStyle = "#2a2424";
    ctx.beginPath();
    ctx.ellipse(at.x, at.y - bit.size, bit.size * 0.8, bit.size * 0.45, bit.rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function flame(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, wobble: number, alpha: number): void {
  if (alpha < 0.02 || len < 4) return;
  ctx.beginPath();
  ctx.moveTo(x - wid, y);
  ctx.bezierCurveTo(x - wid * 0.15, y - len * 0.32, x + wobble - wid * 0.05, y - len * 0.68, x + wobble * 0.35, y - len);
  ctx.bezierCurveTo(x + wobble + wid * 0.2, y - len * 0.6, x + wid * 0.4, y - len * 0.26, x + wid * 0.45, y);
  ctx.closePath();
  const g = ctx.createLinearGradient(x, y, x + wobble * 0.3, y - len);
  g.addColorStop(0, `rgba(255, 252, 240, ${alpha})`);
  g.addColorStop(0.16, `rgba(255, 214, 70, ${alpha * 0.95})`);
  g.addColorStop(0.42, `rgba(255, 102, 12, ${alpha * 0.82})`);
  g.addColorStop(0.7, `rgba(176, 22, 8, ${alpha * 0.4})`);
  g.addColorStop(1, "rgba(40, 32, 32, 0)");
  ctx.fillStyle = g;
  ctx.fill();
}

function drawLightning(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bolt of scene.bolts) {
    const start = IMPACT + bolt.delay;
    const age = t - start;
    if (age < 0 || age > 980) continue;
    const grow = easeOutBack(clamp(age / 180, 0, 1));
    const alpha = age < 640 ? 1 : Math.max(0, 1 - (age - 640) / 340);
    const count = Math.max(2, Math.ceil(bolt.pts.length * Math.min(1, grow)));
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    bolt.pts.slice(0, count).forEach((pt, index) => (index === 0 ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1])));
    ctx.strokeStyle = "rgba(8, 16, 48, 0.9)";
    ctx.lineWidth = bolt.far > 0.6 ? 10 : 5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(150, 210, 255, 0.95)";
    ctx.lineWidth = bolt.far > 0.6 ? 4 : 2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(245, 252, 255, 1)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawMoney(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bit of scene.bits) {
    const at = spot(scene, bit, t);
    if (!at) continue;
    const fall = Math.max(0, (t - IMPACT - bit.delay - 500) / 1000);
    const y = at.y + 260 * fall * fall;
    const rot = bit.rot + bit.spin * ((t - IMPACT) / 1000);
    if (bit.kind === 0) boneBill(ctx, at.x, y, bit.size, rot);
    else boneCoin(ctx, at.x, y, bit.size, rot);
  }
}

function drawConfetti(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const colors = ["#e31e26", "#d5a336", "#efefef", "#4aa3ff", "#3ddc78"];
  for (const bit of scene.bits) {
    const at = spot(scene, bit, t);
    if (!at) continue;
    const fall = Math.max(0, (t - IMPACT - bit.delay - 420) / 1000);
    const x = at.x + Math.sin(t * 0.01 + bit.rot) * 10;
    const y = at.y + 220 * fall * fall;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bit.rot + bit.spin * ((t - IMPACT) / 1000));
    ctx.fillStyle = colors[bit.kind] ?? "#efefef";
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = 1.2;
    ctx.fillRect(-bit.size / 2, -bit.size / 5, bit.size, bit.size / 2.4);
    ctx.strokeRect(-bit.size / 2, -bit.size / 5, bit.size, bit.size / 2.4);
    ctx.restore();
  }
}

function drawTumble(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bit of scene.bits) {
    const at = spot(scene, bit, t);
    if (!at) continue;
    const tip = clamp((t - IMPACT - bit.delay - 500) / 280, 0, 1);
    const rot = tip * (Math.PI / 2) * (bit.spin < 0 ? -1 : 1);
    const y = at.y + (1 - Math.cos(Math.abs(rot))) * bit.size;
    miniDomino(ctx, at.x, y, rot, bit.a, bit.b, bit.size / 16);
  }
}

function drawQuake(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const grow = 1 - (1 - clamp((t - IMPACT) / EXPAND, 0, 1)) ** 3;
  ctx.lineCap = "round";
  for (let i = 0; i < 8; i += 1) {
    const ang = (i / 8) * Math.PI * 2 + 0.2;
    const len = scene.peak * (0.35 + (i % 3) * 0.18) * grow;
    const endX = scene.hitX + Math.cos(ang) * len;
    const endY = scene.hitY + Math.sin(ang) * len;
    ctx.beginPath();
    ctx.moveTo(scene.hitX, scene.hitY);
    ctx.lineTo(scene.hitX + (endX - scene.hitX) * 0.45 + Math.sin(ang) * 10, scene.hitY + (endY - scene.hitY) * 0.45);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = "#1a1204";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = i % 2 === 0 ? "#d5a336" : "#ff5a1a";
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }
  for (const bit of scene.bits) {
    const at = spot(scene, bit, t);
    if (!at) continue;
    const fall = Math.max(0, (t - IMPACT - 400) / 1000);
    miniDomino(ctx, at.x, at.y - 40 + 420 * fall * fall, bit.rot + bit.spin * fall, bit.a, bit.b, bit.size / 16);
  }
}

function drawTrophy(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bit of scene.bits) {
    const at = spot(scene, bit, t);
    if (!at) continue;
    const fall = Math.max(0, (t - IMPACT - bit.delay - 360) / 1000);
    trophy(ctx, at.x, at.y + 300 * fall * fall, bit.size, bit.rot + bit.spin * fall);
  }
}

function drawFireworks(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  const colors = ["#e31e26", "#efefef", "#3d6ea8"];
  for (const bit of scene.bits) {
    if (bit.kind !== 3) continue;
    const start = IMPACT + bit.delay;
    const u = clamp((t - start) / 280, 0, 1);
    if (u <= 0 || t > start + 360) continue;
    const dist = scene.peak * bit.far * (1 - (1 - u) ** 3);
    ctx.strokeStyle = "#fff6d0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(scene.hitX, scene.hitY);
    ctx.lineTo(scene.hitX + Math.cos(bit.ang) * dist, scene.hitY + Math.sin(bit.ang) * dist);
    ctx.stroke();
  }
  for (const bit of scene.bits) {
    if (bit.kind === 3) continue;
    const start = IMPACT + bit.delay;
    const age = (t - start) / bit.life;
    if (age < 0 || age > 1) continue;
    const shell = scene.bits.find((item) => item.kind === 3 && item.a === bit.a);
    const originX = scene.hitX + Math.cos(shell?.ang ?? 0) * scene.peak * bit.far;
    const originY = scene.hitY + Math.sin(shell?.ang ?? 0) * scene.peak * bit.far;
    const dist = (16 + bit.spin * scene.peak * 0.34) * easeOutBack(clamp(age / 0.45, 0, 1));
    const x = originX + Math.cos(bit.ang) * dist;
    const y = originY + Math.sin(bit.ang) * dist + 30 * age * age;
    ctx.save();
    ctx.globalAlpha *= 1 - age;
    ctx.fillStyle = colors[bit.kind] ?? "#efefef";
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, bit.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, scene: FxScene, t: number): void {
  for (const bit of scene.bits) {
    const at = spot(scene, bit, t);
    if (!at) continue;
    const age = (t - IMPACT - bit.delay) / bit.life;
    if (age < 0 || age > 1) continue;
    ctx.save();
    ctx.globalAlpha *= 1 - age * 0.85;
    ctx.fillStyle = bit.kind === 0 ? "#d5a336" : "#fff4d2";
    ctx.strokeStyle = "#1a1204";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(at.x, at.y, bit.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  const u = clamp((t - 360) / 280, 0, 1);
  const scale = easeOutBack(u);
  const alpha = u * (t > 1800 ? Math.max(0, 1 - (t - 1800) / 500) : 1);
  ctx.save();
  ctx.globalAlpha *= alpha;
  crest(ctx, scene.hitX, scene.hitY - 36 * scale, 48 * scale);
  ctx.restore();
}

function trophy(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "#d5a336";
  ctx.strokeStyle = "#1a1204";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, -s * 0.15);
  ctx.lineTo(-s * 0.26, s * 0.32);
  ctx.lineTo(s * 0.26, s * 0.32);
  ctx.lineTo(s * 0.42, -s * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-s * 0.42, 0, s * 0.2, Math.PI * 0.15, Math.PI * 1.35);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s * 0.42, 0, s * 0.2, -Math.PI * 0.35, Math.PI * 0.85);
  ctx.stroke();
  ctx.fillRect(-s * 0.24, s * 0.38, s * 0.48, s * 0.14);
  ctx.strokeRect(-s * 0.24, s * 0.38, s * 0.48, s * 0.14);
  ctx.restore();
}

function boneBill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rot: number): void {
  const h = w * 0.52;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  round(ctx, -w / 2, -h / 2, w, h, 3);
  ctx.fillStyle = "#efefef";
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#141414";
  ctx.stroke();
  ctx.strokeStyle = "#e31e26";
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 3, 0);
  ctx.lineTo(w / 2 - 3, 0);
  ctx.stroke();
  ctx.fillStyle = "#141414";
  ctx.beginPath();
  ctx.arc(0, -h * 0.22, 1.5, 0, Math.PI * 2);
  ctx.arc(-2.2, h * 0.22, 1.3, 0, Math.PI * 2);
  ctx.arc(2.2, h * 0.22, 1.3, 0, Math.PI * 2);
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
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = "#1a1204";
  ctx.stroke();
  ctx.fillStyle = "#1a1204";
  ctx.beginPath();
  ctx.arc(0, -1.6, 1.2, 0, Math.PI * 2);
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
  if (s < 4) return;
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
  ctx.lineWidth = Math.max(2, s * 0.08);
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
  const steps = 6;
  for (let i = 1; i < steps; i += 1) {
    const u = i / steps;
    pts.push([x0 + (x1 - x0) * u + (rand() - 0.5) * 22, y0 + (y1 - y0) * u + (rand() - 0.5) * 22]);
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

function easeOutBack(x: number): number {
  const c1 = 1.15;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
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
