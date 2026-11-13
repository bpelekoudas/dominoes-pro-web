import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/red-hat-text/400.css";
import "@fontsource/red-hat-text/600.css";
import { MOTION } from "../../rules/src/motion.js";
import { applyA11y } from "./a11y";
import { App } from "./App";
import { PortraitOverlay } from "./portrait";
import { reportClientFault } from "./client-log";
import "./styles.css";

applyA11y();
document.documentElement.style.setProperty("--motion", String(MOTION));

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  const reloadForUpdate = () => {
    if (refreshing || !navigator.onLine) return;
    refreshing = true;
    window.location.reload();
  };
  // The first install has no previous page to replace. A later deploy does.
  if (hadController) {
    navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        const look = () => {
          void registration.update();
        };
        // An open table used to wait until the app was backgrounded. Check
        // now, and again while the tab stays up, so a stale shell is replaced.
        look();
        window.setInterval(look, 15_000);
        window.addEventListener("pageshow", look);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") look();
        });
        if (registration.waiting) registration.waiting.postMessage({ type: "skip-waiting" });
      })
      .catch(() => undefined);
  });
}

window.addEventListener("error", (event) => {
  const error = event.error;
  reportClientFault("window.onerror", event.message || "error", error instanceof Error ? error.stack : undefined);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : "unhandled";
  reportClientFault("unhandledrejection", message, reason instanceof Error ? reason.stack : undefined);
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing root.");
createRoot(root).render(
  <StrictMode>
    <App />
    <PortraitOverlay />
  </StrictMode>,
);
