import { getAudioContext, unlockAudio } from "./audio-context.js";
import { SOUND_FILES, type Cue, type SoundId, cuesForPlay } from "./cues.js";
import { duckMusic } from "./music.js";

const MUTE_KEY = "uhoh.mute";

let decoding: Promise<void> | null = null;

const fetched = new Map<SoundId, Promise<ArrayBuffer>>();
const decoded = new Map<SoundId, AudioBuffer>();
const waiting: Cue[] = [];

export function isMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

function audio(): AudioContext | null {
  if (isMuted()) return null;
  return getAudioContext();
}

/** Fetch the files early so the first play does not wait on the network. */
export function preloadSounds(): void {
  if (typeof fetch !== "function") return;
  for (const id of Object.keys(SOUND_FILES) as SoundId[]) {
    if (fetched.has(id)) continue;
    fetched.set(
      id,
      fetch(`/sounds/${SOUND_FILES[id]}`).then((response) => {
        if (!response.ok) throw new Error(`Missing sound ${id}`);
        return response.arrayBuffer();
      }),
    );
  }
}

/** Call from the first tap so iOS will allow sound later. */
export function unlockSound(): void {
  const ctx = unlockAudio();
  preloadSounds();
  if (!ctx || isMuted()) return;
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  void ensureDecoded(ctx);
}

async function ensureDecoded(ctx: AudioContext): Promise<void> {
  if (decoded.size === Object.keys(SOUND_FILES).length) {
    flush();
    return;
  }
  if (!decoding) {
    decoding = (async () => {
      preloadSounds();
      await Promise.all(
        (Object.keys(SOUND_FILES) as SoundId[]).map(async (id) => {
          if (decoded.has(id)) return;
          const raw = await fetched.get(id);
          if (!raw) return;
          decoded.set(id, await ctx.decodeAudioData(raw.slice(0)));
        }),
      );
    })().finally(() => {
      decoding = null;
    });
  }
  try {
    await decoding;
  } catch {
    return;
  }
  flush();
}

function flush(): void {
  const queued = waiting.splice(0);
  for (const cue of queued) startCue(cue);
}

function startCue(cue: Cue): void {
  const ctx = audio();
  const buffer = decoded.get(cue.id);
  if (!ctx || !buffer) {
    if (ctx) waiting.push(cue);
    return;
  }
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  const spread = cue.vary === "light" ? [0.96, 1.08] : cue.vary === "heavy" ? [0.9, 1.0] : [1, 1];
  source.playbackRate.value = spread[0] + Math.random() * (spread[1] - spread[0]);
  const base = cue.id === "buzz" ? 0.55 : cue.id === "ching" ? 0.8 : 0.95;
  const wobble = cue.vary === "none" ? 1 : 0.86 + Math.random() * 0.28;
  gain.gain.value = base * wobble;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(ctx.currentTime + cue.delay);
}

export function playCues(cues: Cue[]): void {
  const ctx = audio();
  if (!ctx) return;
  for (const cue of cues) startCue(cue);
  if (waiting.length) void ensureDecoded(ctx);
}

/** A short soft click for menus. Mute and the first-tap unlock still apply. */
export function playUiClick(): void {
  const ctx = audio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = 720;
  const start = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.045, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.08);
}

/** Heavy slam, glass, and the cha-ching, in time with the tile landing. */
export function playUhOh(): void {
  duckMusic(2400);
  playCues(cuesForPlay(25, "0-1"));
  if (isMuted() || reducedMotion()) return;
  if (typeof navigator.vibrate === "function") navigator.vibrate([24, 30, 48, 24, 90, 36, 130]);
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

if (typeof window !== "undefined") preloadSounds();
