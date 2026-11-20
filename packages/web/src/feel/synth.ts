import { getAudioContext, masterOut } from "../audio-context.js";
import { isMuted } from "../sound.js";
import type { FeelSound } from "./ladder.js";

function ctx(): AudioContext | null {
  if (isMuted()) return null;
  return getAudioContext();
}

function tone(context: AudioContext, freq: number, at: number, dur: number, type: OscillatorType, peak: number): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(masterOut(context));
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function noise(context: AudioContext, at: number, dur: number, peak: number, freq: number): void {
  const length = Math.max(1, Math.floor(context.sampleRate * dur));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    const env = 1 - index / length;
    data[index] = (index % 7) / 7 * 2 - 1;
    data[index] *= env * env;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterOut(context));
  source.start(at);
  source.stop(at + dur + 0.02);
}

/** Synthesized, not a sample. Mute uses the same switch as the other effects. */
export function playFeel(sound: FeelSound, silenceMs = 0): void {
  const context = ctx();
  if (!context) return;
  const start = context.currentTime + Math.max(0, silenceMs) / 1000;
  try {
    if (sound === "place") {
      noise(context, start, 0.05, 0.18, 900);
      tone(context, 180, start, 0.06, "sine", 0.05);
      return;
    }
    if (sound === "place-heavy") {
      noise(context, start, 0.08, 0.28, 420);
      tone(context, 90, start, 0.12, "sine", 0.1);
      return;
    }
    if (sound === "knock") {
      // Contacts match the seat knock: down at 80ms, again at 240ms.
      noise(context, start + 0.08, 0.07, 0.34, 280);
      tone(context, 140, start + 0.08, 0.08, "sine", 0.08);
      noise(context, start + 0.24, 0.07, 0.3, 240);
      tone(context, 120, start + 0.24, 0.09, "sine", 0.07);
      return;
    }
    if (sound === "score") {
      tone(context, 523.25, start, 0.16, "triangle", 0.07);
      tone(context, 659.25, start + 0.05, 0.18, "triangle", 0.05);
      return;
    }
    if (sound === "score-strong") {
      tone(context, 392, start, 0.18, "triangle", 0.08);
      tone(context, 523.25, start + 0.06, 0.2, "triangle", 0.07);
      tone(context, 784, start + 0.12, 0.22, "triangle", 0.05);
      return;
    }
    if (sound === "score-rare") {
      tone(context, 196, start, 0.22, "sine", 0.1);
      tone(context, 392, start + 0.08, 0.24, "triangle", 0.08);
      tone(context, 587.33, start + 0.16, 0.26, "triangle", 0.06);
      return;
    }
    if (sound === "domino") {
      tone(context, 220, start, 0.2, "triangle", 0.1);
      tone(context, 277.18, start + 0.08, 0.22, "triangle", 0.08);
      tone(context, 440, start + 0.16, 0.28, "triangle", 0.07);
      return;
    }
    if (sound === "hand") {
      tone(context, 220, start, 0.16, "triangle", 0.08);
      tone(context, 330, start + 0.1, 0.2, "triangle", 0.08);
      tone(context, 440, start + 0.2, 0.26, "triangle", 0.07);
      return;
    }
    if (sound === "lock") {
      tone(context, 110, start, 0.28, "sine", 0.1);
      tone(context, 164.81, start + 0.18, 0.3, "triangle", 0.06);
      return;
    }
    if (sound === "game") {
      tone(context, 174.61, start, 0.24, "triangle", 0.1);
      tone(context, 220, start + 0.12, 0.26, "triangle", 0.09);
      tone(context, 349.23, start + 0.24, 0.32, "triangle", 0.08);
      tone(context, 440, start + 0.38, 0.36, "triangle", 0.06);
      return;
    }
    tone(context, 130.81, start, 0.22, "triangle", 0.1);
    tone(context, 196, start + 0.1, 0.24, "triangle", 0.09);
    tone(context, 261.63, start + 0.22, 0.28, "triangle", 0.08);
    tone(context, 392, start + 0.36, 0.4, "triangle", 0.07);
  } catch {
    return;
  }
}
