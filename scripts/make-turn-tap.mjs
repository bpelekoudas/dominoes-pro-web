/**
 * A quiet wooden tap for "your turn."
 * Low body, a soft contact, no bright tone. The file itself is already quiet.
 */
import { writeFileSync } from "node:fs";

const sampleRate = 22050;
const seconds = 0.16;
const count = Math.floor(sampleRate * seconds);
const samples = new Float32Array(count);

let seed = 0x51a7;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

let low = 0;
const mix = 1 - Math.exp((-2 * Math.PI * 650) / sampleRate);
for (let i = 0; i < count; i += 1) {
  const t = i / sampleRate;
  low += mix * (rand() * 2 - 1 - low);
  const contact = low * Math.exp(-t * 48);
  const body = Math.sin(2 * Math.PI * 156 * t) * Math.exp(-t * 24);
  const wood = Math.sin(2 * Math.PI * 88 * t) * Math.exp(-t * 16);
  samples[i] = (contact * 0.16 + body * 0.22 + wood * 0.14) * 0.42;
}

let peak = 0;
for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
const scale = peak > 0 ? 0.32 / peak : 1;

const data = Buffer.alloc(44 + count * 2);
data.write("RIFF", 0);
data.writeUInt32LE(36 + count * 2, 4);
data.write("WAVE", 8);
data.write("fmt ", 12);
data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20);
data.writeUInt16LE(1, 22);
data.writeUInt32LE(sampleRate, 24);
data.writeUInt32LE(sampleRate * 2, 28);
data.writeUInt16LE(2, 32);
data.writeUInt16LE(16, 34);
data.write("data", 36);
data.writeUInt32LE(count * 2, 40);
for (let i = 0; i < count; i += 1) {
  const value = Math.max(-1, Math.min(1, samples[i] * scale));
  data.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}

writeFileSync(new URL("../packages/web/public/sounds/tap.wav", import.meta.url), data);
console.log(`tap.wav ${seconds}s peak ${peak.toFixed(3)} bytes ${data.length}`);
