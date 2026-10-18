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

export function playBuzz(): void {
  tone(180, 0.16, "sawtooth", 0.05);
  tone(140, 0.18, "square", 0.03, 0.05);
  if (!isMuted() && typeof navigator.vibrate === "function") navigator.vibrate(180);
}
