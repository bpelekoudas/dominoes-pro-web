const MUTE_KEY = "uhoh.mute";

let context: AudioContext | null = null;
let unlocked = false;

export function isMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

function audio(): AudioContext | null {
  if (isMuted() || !unlocked) return null;
  if (!context) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    context = new Ctx();
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

/** Call from the first tap so iOS will allow sound later. */
export function unlockSound(): void {
  unlocked = true;
  const ctx = audio();
  if (!ctx) return;
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}

function tone(frequency: number, duration: number, type: OscillatorType, gainValue: number, delay = 0): void {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playTile(): void {
  tone(520, 0.05, "square", 0.04);
  tone(780, 0.04, "triangle", 0.03, 0.02);
}

export function playScore(): void {
  tone(880, 0.08, "square", 0.05);
  tone(1320, 0.12, "square", 0.05, 0.09);
}

/** Slam, glass, and a short crowd hit, layered over the cha-ching. */
export function playUhOh(): void {
  playScore();
  const ctx = audio();
  if (ctx) {
    noiseBurst(ctx, 0, 0.09, 0.35, 240, "lowpass");
    tone(110, 0.14, "sine", 0.28);
    tone(70, 0.22, "sine", 0.18, 0.04);
    noiseBurst(ctx, 0.08, 0.12, 0.16, 2400, "highpass");
    noiseBurst(ctx, 0.14, 0.16, 0.12, 3800, "bandpass");
    noiseBurst(ctx, 0.22, 0.18, 0.08, 1800, "highpass");
    crowd(ctx);
  }
  if (isMuted() || reducedMotion()) return;
  if (typeof navigator.vibrate === "function") navigator.vibrate([24, 30, 48, 24, 90, 36, 130]);
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function noiseBurst(
  ctx: AudioContext,
  delay: number,
  duration: number,
  gainValue: number,
  frequency: number,
  type: BiquadFilterType,
): void {
  const start = ctx.currentTime + delay;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, start);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function crowd(ctx: AudioContext): void {
  const start = ctx.currentTime + 0.06;
  for (const frequency of [150, 190, 230]) {
    const oscillator = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, start + 0.42);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.035, start + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.48);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.52);
  }
}

export function playBuzz(): void {
  tone(180, 0.16, "sawtooth", 0.05);
  tone(140, 0.18, "square", 0.03, 0.05);
  if (!isMuted() && typeof navigator.vibrate === "function") navigator.vibrate(180);
}
