/**
 * Ink for the spinner's center dot.
 * The fill is the disk. The ring is a thin inset circle.
 * A light pip or a busy face uses the other color so both stay readable.
 * `face` is the color under the middle of that skin (the middle of a gradient).
 * `pip` is that skin's pip ink.
 */
export const TILE_SKINS = ["ivory", "wood", "neon", "marble", "charcoal", "gold", "sky", "cherry", "boss", "ice", "candy"] as const;

export type TileSkin = (typeof TILE_SKINS)[number];

export interface SpinnerDotPaint {
  fill: string;
  ring: string;
  face: readonly string[];
  pip: string;
}

export const SPINNER_DOTS: Record<TileSkin, SpinnerDotPaint> = {
  ivory: { fill: "#e31e26", ring: "#141414", face: ["#efefef"], pip: "#141414" },
  wood: { fill: "#ffffff", ring: "#1a1008", face: ["#b87f43"], pip: "#1a1008" },
  neon: { fill: "#e31e26", ring: "#f4f4f4", face: ["#071018"], pip: "#39f3ff" },
  marble: { fill: "#d80000", ring: "#141414", face: ["#cfcfcf"], pip: "#141414" },
  charcoal: { fill: "#ffffff", ring: "#141414", face: ["#2a2a2a"], pip: "#ff7a3c" },
  gold: { fill: "#141414", ring: "#ffffff", face: ["#d6ad4b"], pip: "#2a1c04" },
  sky: { fill: "#141414", ring: "#ffffff", face: ["#7ec8e3"], pip: "#ffffff" },
  cherry: { fill: "#141414", ring: "#ffffff", face: ["#c41e3a"], pip: "#ffffff" },
  boss: { fill: "#141414", ring: "#ffffff", face: ["#111111"], pip: "#d5a336" },
  ice: { fill: "#e31e26", ring: "#141414", face: ["#ffffff", "#bae6fd"], pip: "#141414" },
  candy: { fill: "#141414", ring: "#ffe14a", face: ["#ffffff", "#e31e26"], pip: "#1a1a1a" },
};

function channel(hex: string, index: number): number {
  const body = hex.replace("#", "");
  return parseInt(body.slice(index * 2, index * 2 + 2), 16);
}

function linear(channelValue: number): number {
  const unit = channelValue / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  return 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
}

/** WCAG contrast ratio. 1 is identical, 21 is black on white. */
export function contrastRatio(a: string, b: string): number {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The stronger of the disk and the ring against one color. */
export function dotContrast(paint: SpinnerDotPaint, other: string): number {
  return Math.max(contrastRatio(paint.fill, other), contrastRatio(paint.ring, other));
}
