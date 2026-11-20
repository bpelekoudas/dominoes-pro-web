import { useEffect, useState } from "react";

const DISMISS = "uhoh.install.v2";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Hint = "android" | "ios" | "chrome" | "samsung";

function alreadyInstalled(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS) === "1";
  } catch {
    return false;
  }
}

function rememberDismiss(): void {
  try {
    localStorage.setItem(DISMISS, "1");
  } catch {
    // The line still closes for this visit.
  }
}

function waitInstalled(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("appinstalled", onInstalled);
      resolve(ok);
    };
    const onInstalled = () => finish(true);
    window.addEventListener("appinstalled", onInstalled);
    window.setTimeout(() => finish(false), ms);
  });
}

function manualKind(): "samsung" | "chrome" | null {
  const agent = navigator.userAgent;
  if (!/Android/i.test(agent)) return null;
  return /SamsungBrowser/i.test(agent) ? "samsung" : "chrome";
}

/** A short home-screen offer. It is not shown during a game. */
export function InstallHint() {
  const [kind, setKind] = useState<Hint | null>(null);
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dismissed() || alreadyInstalled()) return;
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      setKind("ios");
      return;
    }
    const fallback = manualKind();
    const timer = window.setTimeout(() => {
      if (!fallback) return;
      setKind((current) => current ?? fallback);
    }, 1500);
    const onOffer = (event: Event) => {
      event.preventDefault();
      window.clearTimeout(timer);
      setOffer(event as InstallPromptEvent);
      setKind("android");
    };
    window.addEventListener("beforeinstallprompt", onOffer);
    const onInstalled = () => {
      rememberDismiss();
      setKind(null);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!kind) return null;

  const dismiss = () => {
    rememberDismiss();
    setKind(null);
  };

  const install = async () => {
    if (!offer || busy) {
      setKind(manualKind() ?? "chrome");
      return;
    }
    setBusy(true);
    const installed = waitInstalled(12_000);
    try {
      await offer.prompt();
      const choice = await offer.userChoice;
      if (choice.outcome !== "accepted") {
        setKind(manualKind() ?? "chrome");
        return;
      }
      if (!(await installed)) setKind(manualKind() ?? "chrome");
    } catch {
      setKind(manualKind() ?? "chrome");
    } finally {
      setBusy(false);
      setOffer(null);
    }
  };

  const help =
    kind === "samsung"
      ? "Open the menu, then Add page to, then Home screen."
      : kind === "chrome"
        ? "Open the menu, then Add to home screen, then Create shortcut."
        : null;

  return (
    <p className="install-hint" data-install={kind}>
      {kind === "ios" ? <span>Tap Share, then Add to Home Screen.</span> : null}
      {kind === "android" ? (
        <button type="button" className="text-button" data-action="install-app" disabled={busy} onClick={() => void install()}>
          Add to Home Screen
        </button>
      ) : null}
      {help ? <span>{help}</span> : null}
      <button type="button" className="text-button" data-action="install-dismiss" onClick={dismiss}>
        Not now
      </button>
    </p>
  );
}
