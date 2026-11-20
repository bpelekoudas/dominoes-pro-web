import { useEffect, useState } from "react";
import { lockPortrait, needsPortraitOverlay } from "./portrait-lock";

function viewport(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Covers a phone in landscape. The game underneath keeps running. */
export function PortraitOverlay() {
  const [box, setBox] = useState(viewport);

  useEffect(() => {
    const read = () => setBox(viewport());
    read();
    lockPortrait();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    // A lock is often allowed only after a tap, and only once the app is installed.
    window.addEventListener("pointerdown", lockPortrait);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
      window.removeEventListener("pointerdown", lockPortrait);
    };
  }, []);

  if (!needsPortraitOverlay(box.width, box.height)) return null;
  return (
    <div className="portrait-lock" data-portrait-lock="true" role="alertdialog" aria-modal="true" aria-labelledby="portrait-lock-title">
      <div className="portrait-lock-card">
        <svg className="portrait-phone" viewBox="0 0 80 80" aria-hidden="true">
          <rect x="30" y="10" width="20" height="40" rx="4" fill="none" stroke="#d5a336" strokeWidth="2.4" transform="rotate(90 40 40)" />
          <path d="M16 62c6 10 22 16 36 8" fill="none" stroke="#efefef" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M48 64l8 2-2 8" fill="none" stroke="#efefef" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h1 id="portrait-lock-title">Rotate your phone</h1>
        <p>Turn it upright to portrait. Your game stays right where you left it.</p>
      </div>
    </div>
  );
}
