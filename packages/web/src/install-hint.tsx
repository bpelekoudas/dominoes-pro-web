import { useEffect, useState } from "react";

const DISMISS = "uhoh.install.dismissed";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function alreadyInstalled(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

/** A short home-screen offer. It is not shown during a game. */
export function InstallHint() {
  const [kind, setKind] = useState<"android" | "ios" | null>(null);
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS) === "1") return;
    } catch {
      return;
    }
    if (alreadyInstalled()) return;
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      setKind("ios");
      return;
    }
    const onOffer = (event: Event) => {
      event.preventDefault();
      setOffer(event as InstallPromptEvent);
      setKind("android");
    };
    window.addEventListener("beforeinstallprompt", onOffer);
    return () => window.removeEventListener("beforeinstallprompt", onOffer);
  }, []);

  if (!kind) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS, "1");
    } catch {
      // The line still closes for this visit.
    }
    setKind(null);
  };

  return (
    <p className="install-hint" data-install={kind}>
      {kind === "ios" ? (
        <span>Tap Share, then Add to Home Screen.</span>
      ) : (
        <button
          type="button"
          className="text-button"
          data-action="install-app"
          onClick={() => {
            void offer?.prompt();
            dismiss();
          }}
        >
          Add to Home Screen
        </button>
      )}
      <button type="button" className="text-button" data-action="install-dismiss" onClick={dismiss}>
        Not now
      </button>
    </p>
  );
}
