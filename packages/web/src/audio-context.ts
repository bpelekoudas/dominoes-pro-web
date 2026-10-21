let context: AudioContext | null = null;
let unlocked = false;

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
