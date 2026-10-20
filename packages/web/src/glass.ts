/**
 * A pane of glass over the table. Radial cracks and concentric rings
 * split the felt into shards. The shards then tumble away.
 * Drawn with canvas transforms only, so the layout does not change.
 */

export const SLAM_MS = 280;
export const CRACK_MS = 120;

interface Pt {
  x: number;
  y: number;
}

export interface GlassShard {
  local: Pt[];
  cx: number;
  cy: number;
  dist: number;
  vx: number;
  vy: number;
  vr: number;
  tilt: number;
  tiltPhase: number;
  delay: number;
  rgb: [number, number, number];
}

export interface GlassCrack {
  a: Pt;
  b: Pt;
  w: number;
  dist: number;
}

export interface GlassSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  delay: number;
}

export interface GlassScene {
  shards: GlassShard[];
  cracks: GlassCrack[];
  sparks: GlassSpark[];
  maxR: number;
  hitX: number;
  hitY: number;
  width: number;
  height: number;
}

export function buildGlass(width: number, height: number, ox: number, oy: number, seed: number): GlassScene {
  const rand = mulberry(seed * 997 + 13);
  const hitX = clamp(ox, 12, Math.max(12, width - 12));
  const hitY = clamp(oy, 12, Math.max(12, height - 12));
  const far = Math.hypot(Math.max(hitX, width - hitX), Math.max(hitY, height - hitY));
  const maxR = Math.max(140, far * 0.8);
  const rays = 14;
  const rings = 6;
  const radii = ringRadii(maxR, rings, rand);
  const sector = (Math.PI * 2) / rays;
  const spin = rand() * Math.PI * 2;
  const grid: Pt[][] = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const row: Pt[] = [];
    const gap = radii[ring]! - radii[ring - 1]!;
    for (let ray = 0; ray < rays; ray += 1) {
      const stagger = (ray % 2 === 0 ? 1 : -1) * gap * 0.16;
      const rad = radii[ring]! + stagger + (rand() - 0.5) * 6;
      const angle = spin + sector * ray + (rand() - 0.5) * sector * 0.38;
      row.push({ x: hitX + Math.cos(angle) * rad, y: hitY + Math.sin(angle) * rad });
    }
    grid.push(row);
  }

  const shards: GlassShard[] = [];
  const cracks: GlassCrack[] = [];
  const seen = new Set<string>();
  const center = { x: hitX, y: hitY };

  const addEdge = (a: Pt, b: Pt, widthPx: number) => {
    const key = `${a.x.toFixed(1)},${a.y.toFixed(1)}>${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    const back = `${b.x.toFixed(1)},${b.y.toFixed(1)}>${a.x.toFixed(1)},${a.y.toFixed(1)}`;
    if (seen.has(key) || seen.has(back)) return;
    seen.add(key);
    const dist = Math.hypot((a.x + b.x) / 2 - hitX, (a.y + b.y) / 2 - hitY);
    cracks.push({ a, b, w: widthPx, dist });
  };

  const addPoly = (pts: Pt[]) => {
    const clipped = clipPoly(pts, 0, 0, width, height);
    if (clipped.length < 3) return;
    const stats = polyStats(clipped);
    if (Math.abs(stats.area) < 18) return;
    const ordered = stats.area < 0 ? clipped.slice().reverse() : clipped;
    const local = ordered.map((point) => ({ x: point.x - stats.cx, y: point.y - stats.cy }));
    const dist = Math.hypot(stats.cx - hitX, stats.cy - hitY);
    const angle = Math.atan2(stats.cy - hitY, stats.cx - hitX);
    const speed = 160 + rand() * 280 + dist * 0.18;
    const tangent = (rand() - 0.5) * 90;
    shards.push({
      local,
      cx: stats.cx,
      cy: stats.cy,
      dist,
      vx: Math.cos(angle) * speed - Math.sin(angle) * tangent,
      vy: Math.sin(angle) * speed + Math.cos(angle) * tangent - 30 - rand() * 110,
      vr: (rand() - 0.5) * 12,
      tilt: 2.4 + rand() * 5.5,
      tiltPhase: rand() * Math.PI * 2,
      delay: (dist / maxR) * 0.1,
      rgb: [198 + rand() * 36, 214 + rand() * 24, 228 + rand() * 16],
    });
  };

  for (let ray = 0; ray < rays; ray += 1) {
    const next = (ray + 1) % rays;
    const inner = grid[0]!;
    addEdge(center, inner[ray]!, 1.7);
    addEdge(inner[ray]!, inner[next]!, 1.35);
    addPoly([center, inner[ray]!, inner[next]!]);
  }

  for (let ring = 0; ring < rings - 1; ring += 1) {
    const inner = grid[ring]!;
    const outer = grid[ring + 1]!;
    for (let ray = 0; ray < rays; ray += 1) {
      const next = (ray + 1) % rays;
      const a = inner[ray]!;
      const b = inner[next]!;
      const c = outer[next]!;
      const d = outer[ray]!;
      addEdge(a, d, 1.15);
      addEdge(d, c, ring === rings - 2 ? 1.45 : 1.2);
      if (rand() > 0.62) {
        addEdge(a, c, 0.9);
        addPoly([a, b, c]);
        addPoly([a, c, d]);
      } else {
        addPoly([a, b, c, d]);
      }
    }
  }

  const sparks: GlassSpark[] = [];
  for (let i = 0; i < 64; i += 1) {
    const angle = rand() * Math.PI * 2;
    const dist = rand() * maxR * 0.55;
    const speed = 90 + rand() * 420;
    sparks.push({
      x: hitX + Math.cos(angle) * dist,
      y: hitY + Math.sin(angle) * dist,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40 - rand() * 80,
      life: 0.16 + rand() * 0.28,
      size: rand() > 0.72 ? 2.4 : 1.35,
      delay: rand() * 0.1,
    });
  }

  return { shards, cracks, sparks, maxR, hitX, hitY, width, height };
}

export function drawGlass(ctx: CanvasRenderingContext2D, scene: GlassScene, elapsed: number): void {
  if (elapsed < SLAM_MS - 40) return;
  const expandU = clamp((elapsed - (SLAM_MS - 40)) / 820, 0, 1);
  const grow = 1 - (1 - expandU) ** 3;
  const reach = grow * scene.maxR;
  const fly = elapsed > 1180 ? (elapsed - 1180) / 1000 : 0;
  const fade = elapsed > 1750 ? Math.max(0, 1 - (elapsed - 1750) / 650) : 1;

  ctx.save();
  ctx.globalAlpha = fade;
  drawRing(ctx, scene.hitX, scene.hitY, reach, elapsed);

  for (const shard of scene.shards) {
    if (shard.dist > reach + 16 && fly <= 0) continue;
    const age = fly - shard.delay;
    let dx = 0;
    let dy = 0;
    let rot = 0;
    let tilt = 1;
    let alpha = 0.9;
    let flying = false;
    if (age > 0) {
      flying = true;
      dx = shard.vx * age * 0.85;
      dy = shard.vy * age * 0.85 + 520 * age * age;
      rot = shard.vr * age;
      const spin = Math.cos(shard.tiltPhase + shard.tilt * age);
      tilt = Math.sign(spin || 1) * Math.max(0.16, Math.abs(spin));
      alpha = age < 0.28 ? 0.92 : Math.max(0, 0.92 * (1 - (age - 0.28) / 0.85));
    }
    if (alpha < 0.02) continue;
    paintShard(ctx, shard, dx, dy, rot, tilt, alpha, flying);
  }

  const crackAlpha = fly > 0 ? Math.max(0, 1 - fly / 0.34) : 0.95;
  if (crackAlpha > 0.03) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const crack of scene.cracks) {
      if (crack.dist > reach + 8) continue;
      const shown = crack.dist <= reach ? 1 : (reach + 8 - crack.dist) / 8;
      ctx.strokeStyle = `rgba(186, 206, 220, ${0.45 * crackAlpha * shown})`;
      ctx.lineWidth = crack.w + 1.6;
      ctx.beginPath();
      ctx.moveTo(crack.a.x, crack.a.y);
      ctx.lineTo(crack.b.x, crack.b.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(239, 239, 239, ${0.95 * crackAlpha * shown})`;
      ctx.lineWidth = crack.w;
      ctx.stroke();
    }
    ctx.restore();
  }

  if (fly > 0) {
    for (const spark of scene.sparks) {
      const age = fly - spark.delay;
      if (age < 0 || age > spark.life) continue;
      const sparkFade = 1 - age / spark.life;
      const x = spark.x + spark.vx * age;
      const y = spark.y + spark.vy * age + 280 * age * age;
      ctx.fillStyle = `rgba(239, 239, 239, ${sparkFade})`;
      ctx.fillRect(x, y, spark.size, spark.size);
      if (spark.size > 2) {
        ctx.fillStyle = `rgba(214, 230, 242, ${sparkFade * 0.8})`;
        ctx.fillRect(x - spark.size, y + 1, spark.size * 0.7, spark.size * 0.7);
      }
    }
  }
  ctx.restore();
}

function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, reach: number, elapsed: number): void {
  const u = clamp((elapsed - 200) / 780, 0, 1);
  if (u <= 0) return;
  const alpha = (1 - u) * 0.85;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(6, reach), 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(239, 248, 255, ${alpha})`;
  ctx.lineWidth = 2 + (1 - u) * 7;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, Math.max(4, reach * 0.62), 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.45})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function paintShard(
  ctx: CanvasRenderingContext2D,
  shard: GlassShard,
  dx: number,
  dy: number,
  rot: number,
  tilt: number,
  alpha: number,
  flying: boolean,
): void {
  const pts = shard.local;
  ctx.save();
  ctx.translate(shard.cx + dx, shard.cy + dy);
  ctx.rotate(rot);
  const tiltScale = Math.abs(tilt);
  ctx.scale(1, tiltScale);
  const shift = 2.4;

  trace(ctx, pts, shift, -1.5);
  ctx.fillStyle = `rgba(150, 188, 214, ${0.14 * alpha})`;
  ctx.fill();

  trace(ctx, pts, 0, 0);
  const [r, g, b] = shard.rgb;
  ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${0.2 * alpha})`;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.15;
  ctx.strokeStyle = `rgba(239, 239, 239, ${(flying ? 0.88 : 0.62) * alpha})`;
  ctx.stroke();

  const bright = lightEdge(pts, rot, tilt);
  const a = pts[bright]!;
  const c = pts[(bright + 1) % pts.length]!;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(c.x, c.y);
  ctx.strokeStyle = `rgba(239, 239, 239, ${0.98 * alpha})`;
  ctx.lineWidth = flying ? 2.6 : 2;
  ctx.stroke();

  const shade = (bright + Math.floor(pts.length / 2)) % pts.length;
  const s0 = pts[shade]!;
  const s1 = pts[(shade + 1) % pts.length]!;
  ctx.beginPath();
  ctx.moveTo(s0.x, s0.y);
  ctx.lineTo(s1.x, s1.y);
  ctx.strokeStyle = `rgba(90, 118, 140, ${0.45 * alpha})`;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  if (flying && tiltScale < 0.42) {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, 0);
    ctx.lineTo(pts[Math.floor(pts.length / 2)]!.x, 0);
    ctx.strokeStyle = `rgba(239, 239, 239, ${0.95 * alpha})`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ctx.restore();
}

function lightEdge(pts: Pt[], rot: number, tilt: number): number {
  let best = 0;
  let bestDot = -Infinity;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const ax = p.x * cos - p.y * sin;
    const ay = (p.x * sin + p.y * cos) * tilt;
    const bx = q.x * cos - q.y * sin;
    const by = (q.x * sin + q.y * cos) * tilt;
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const dot = (ey / len) * -0.42 + (-ex / len) * -0.9;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

function trace(ctx: CanvasRenderingContext2D, pts: Pt[], ox: number, oy: number): void {
  const first = pts[0]!;
  ctx.beginPath();
  ctx.moveTo(first.x + ox, first.y + oy);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i]!.x + ox, pts[i]!.y + oy);
  ctx.closePath();
}

function ringRadii(maxR: number, rings: number, rand: () => number): number[] {
  const radii = [0];
  const first = 32 + rand() * 6;
  const outer = maxR * 1.05;
  for (let ring = 1; ring <= rings; ring += 1) {
    const t = ring / rings;
    const base = first + (outer - first) * t ** 1.35;
    const prev = radii[ring - 1]!;
    const jitter = ring === rings ? 0 : (rand() - 0.5) * 8;
    radii.push(Math.max(prev + 20, base + jitter));
  }
  const last = radii.length - 1;
  radii[last] = Math.max(radii[last]!, outer);
  return radii;
}

function clipPoly(poly: Pt[], minX: number, minY: number, maxX: number, maxY: number): Pt[] {
  let output = poly;
  output = clipAgainst(output, (point) => point.x >= minX, (a, b) => hitVertical(a, b, minX));
  output = clipAgainst(output, (point) => point.x <= maxX, (a, b) => hitVertical(a, b, maxX));
  output = clipAgainst(output, (point) => point.y >= minY, (a, b) => hitHorizontal(a, b, minY));
  output = clipAgainst(output, (point) => point.y <= maxY, (a, b) => hitHorizontal(a, b, maxY));
  return output;
}

function clipAgainst(poly: Pt[], inside: (point: Pt) => boolean, cross: (a: Pt, b: Pt) => Pt): Pt[] {
  if (poly.length === 0) return [];
  const out: Pt[] = [];
  let prev = poly[poly.length - 1]!;
  let prevIn = inside(prev);
  for (const curr of poly) {
    const currIn = inside(curr);
    if (currIn) {
      if (!prevIn) out.push(cross(prev, curr));
      out.push(curr);
    } else if (prevIn) out.push(cross(prev, curr));
    prev = curr;
    prevIn = currIn;
  }
  return out;
}

function hitVertical(a: Pt, b: Pt, x: number): Pt {
  const dx = b.x - a.x;
  const t = dx === 0 ? 0 : (x - a.x) / dx;
  return { x, y: a.y + (b.y - a.y) * t };
}

function hitHorizontal(a: Pt, b: Pt, y: number): Pt {
  const dy = b.y - a.y;
  const t = dy === 0 ? 0 : (y - a.y) / dy;
  return { x: a.x + (b.x - a.x) * t, y };
}

function polyStats(pts: Pt[]): { area: number; cx: number; cy: number } {
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const cross = p.x * q.y - q.x * p.y;
    twice += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(twice) < 1e-4) return { area: 0, cx: pts[0]?.x ?? 0, cy: pts[0]?.y ?? 0 };
  return { area: twice / 2, cx: cx / (3 * twice), cy: cy / (3 * twice) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
