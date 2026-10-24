import { getAudioContext, unlockAudio } from "./audio-context.js";

export const MUSIC_TRACKS = [
  {
    id: "rap",
    label: "Rap",
    file: "rap.mp3",
    title: "Lofi Hip Hop Loop",
    artist: "Taylor Harris (omfgdude)",
  },
  {
    id: "rock",
    label: "Rock",
    file: "rock.mp3",
    title: "Rock Theme 3",
    artist: "Umplix",
  },
  {
    id: "edm",
    label: "EDM",
    file: "edm.mp3",
    title: "Synthwave House Loop",
    artist: "Fupi",
  },
  {
    id: "classical",
    label: "Classical",
    file: "classical.mp3",
    title: "Gymnopédie No. 1",
    artist: "Erik Satie, performed by Teknopazzo",
  },
] as const;

export type MusicId = (typeof MUSIC_TRACKS)[number]["id"];
export type MusicChoice = MusicId | "off";

const CHOICE_KEY = "uhoh.music";
const VOLUME_KEY = "uhoh.musicVolume";
const DEFAULT_VOLUME = 0.55;

const files = new Map<MusicId, string>(MUSIC_TRACKS.map((track) => [track.id, track.file]));
const buffers = new Map<MusicId, AudioBuffer>();
const loading = new Map<MusicId, Promise<AudioBuffer | null>>();

let volumeGain: GainNode | null = null;
let duckGain: GainNode | null = null;
let source: AudioBufferSourceNode | null = null;
let startedAt = 0;
let pauseOffset = 0;
let playing: MusicId | null = null;
let gesture = false;
let hidden = false;
let loadToken = 0;

export function parseMusicChoice(raw: string | null): MusicChoice {
  if (raw === "rap" || raw === "rock" || raw === "edm" || raw === "classical") return raw;
  return "off";
}

export function clampMusicVolume(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, number));
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function musicChoice(): MusicChoice {
  return parseMusicChoice(storage()?.getItem(CHOICE_KEY) ?? null);
}

export function musicVolume(): number {
  const raw = storage()?.getItem(VOLUME_KEY);
  if (raw == null || raw === "") return DEFAULT_VOLUME;
  return clampMusicVolume(Number(raw));
}

export function setMusicVolume(value: number): number {
  const next = clampMusicVolume(value);
  storage()?.setItem(VOLUME_KEY, String(next));
  if (volumeGain) volumeGain.gain.value = next;
  return next;
}

function chain(ctx: AudioContext): GainNode {
  if (!volumeGain || !duckGain) {
    volumeGain = ctx.createGain();
    duckGain = ctx.createGain();
    volumeGain.gain.value = musicVolume();
    duckGain.gain.value = 1;
    volumeGain.connect(duckGain);
    duckGain.connect(ctx.destination);
  }
  return volumeGain;
}

function halt(): void {
  if (source) {
    try {
      source.stop();
    } catch {
      // The buffer may already have been stopped.
    }
    source.disconnect();
    source = null;
  }
  playing = null;
}

function rememberOffset(): void {
  const ctx = getAudioContext();
  const buffer = source?.buffer;
  if (!ctx || !buffer || !playing) return;
  const elapsed = ctx.currentTime - startedAt;
  pauseOffset = ((elapsed % buffer.duration) + buffer.duration) % buffer.duration;
}

function playBuffer(id: MusicId, buffer: AudioBuffer, offset: number): void {
  const ctx = getAudioContext();
  if (!ctx || hidden || musicChoice() !== id) return;
  halt();
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  node.connect(chain(ctx));
  const start = ((offset % buffer.duration) + buffer.duration) % buffer.duration;
  node.start(ctx.currentTime, start);
  source = node;
  startedAt = ctx.currentTime - start;
  pauseOffset = start;
  playing = id;
}

async function fetchBuffer(ctx: AudioContext, id: MusicId): Promise<AudioBuffer | null> {
  const cached = buffers.get(id);
  if (cached) return cached;
  const pending = loading.get(id);
  if (pending) return pending;
  const file = files.get(id);
  if (!file) return null;
  const task = (async () => {
    const response = await fetch(`/music/${file}`);
    if (!response.ok) return null;
    const raw = await response.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    buffers.set(id, decoded);
    return decoded;
  })().finally(() => {
    loading.delete(id);
  });
  loading.set(id, task);
  try {
    return await task;
  } catch {
    return null;
  }
}

async function startChoice(id: MusicId, offset: number): Promise<void> {
  const token = ++loadToken;
  const ctx = getAudioContext();
  if (!ctx) return;
  const buffer = await fetchBuffer(ctx, id);
  if (!buffer || token !== loadToken || hidden || musicChoice() !== id) return;
  playBuffer(id, buffer, offset);
}

export function setMusicChoice(choice: MusicChoice): void {
  storage()?.setItem(CHOICE_KEY, choice);
  gesture = true;
  unlockAudio();
  if (choice === "off") {
    loadToken += 1;
    halt();
    pauseOffset = 0;
    return;
  }
  pauseOffset = 0;
  if (gesture) void startChoice(choice, 0);
}

/** The first tap. A saved track starts here, never on page load. */
export function primeMusic(): void {
  gesture = true;
  unlockAudio();
  if (hidden) return;
  const choice = musicChoice();
  if (choice === "off") return;
  if (playing === choice) return;
  void startChoice(choice, pauseOffset);
}

/** Dip under the UH-OH slam, then come back. */
export function duckMusic(ms = 2400): void {
  const ctx = getAudioContext();
  if (!ctx || !duckGain || !playing) return;
  const now = ctx.currentTime;
  const gain = duckGain.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(Math.max(0.0001, gain.value), now);
  gain.linearRampToValueAtTime(0.35, now + 0.06);
  gain.linearRampToValueAtTime(1, now + Math.max(0.4, ms / 1000));
}

function onVisibility(): void {
  hidden = document.hidden;
  if (hidden) {
    rememberOffset();
    halt();
    return;
  }
  if (!gesture) return;
  const choice = musicChoice();
  if (choice === "off") return;
  void startChoice(choice, pauseOffset);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", onVisibility);
}
