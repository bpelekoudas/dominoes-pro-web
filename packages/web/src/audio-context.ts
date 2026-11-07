let context: AudioContext | null = null;
let unlocked = false;
let master: GainNode | null = null;
let tap: MediaStreamAudioDestinationNode | null = null;

function createContext(): AudioContext | null {
  if (context) return context;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  context = new Ctx();
  return context;
}

/** The shared context. Null until the first tap, which is what phones require. */
export function getAudioContext(): AudioContext | null {
  if (!unlocked) return null;
  const ctx = createContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture so later sound and music are allowed to play. */
export function unlockAudio(): AudioContext | null {
  unlocked = true;
  return getAudioContext();
}

/** Game effects share this node, so a recording tap hears the same clock as the speakers. */
export function masterOut(ctx: AudioContext): GainNode {
  if (!master || master.context !== ctx) {
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    tap = null;
  }
  return master;
}

/** A copy of the game-effect bus. Music stays on the speakers only. */
export function attachAudioTap(ctx: AudioContext): MediaStream {
  const output = masterOut(ctx);
  if (!tap || tap.context !== ctx) {
    tap = ctx.createMediaStreamDestination();
    output.connect(tap);
  }
  return tap.stream;
}
