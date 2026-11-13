/**
 * Primary lockup: UH, a red domino, OH, then DOMINOES.
 * Letterforms are the stand-in display face. See the note in styles.css.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={compact ? "logo logo-compact" : "logo"}
      viewBox="0 0 268 118"
      role="img"
      aria-label="Uh Oh Dominoes"
    >
      <title>Uh Oh Dominoes</title>
      <text className="logo-mark" x="0" y="66" fontSize="72" textLength="104" lengthAdjust="spacingAndGlyphs">
        UH
      </text>
      <g transform="translate(116,6)">
        <rect width="34" height="60" rx="5" fill="#E31E26" />
        <rect x="5" y="28.5" width="24" height="3" fill="#EFEFEF" />
        <circle cx="17" cy="15" r="3.1" fill="#EFEFEF" />
        <circle cx="11" cy="45" r="3.1" fill="#EFEFEF" />
        <circle cx="23" cy="45" r="3.1" fill="#EFEFEF" />
      </g>
      <text className="logo-mark" x="162" y="66" fontSize="72" textLength="104" lengthAdjust="spacingAndGlyphs">
        OH
      </text>
      <text className="logo-sub" x="0" y="108" fontSize="28" textLength="266" lengthAdjust="spacingAndGlyphs">
        DOMINOES
      </text>
    </svg>
  );
}
