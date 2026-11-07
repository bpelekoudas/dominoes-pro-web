import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/red-hat-text/400.css";
import "@fontsource/red-hat-text/600.css";
import { MOTION } from "../../rules/src/motion.js";
import { applyA11y } from "./a11y";
import { App } from "./App";
import { pulse } from "./pulse";
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
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") look();
        });
        if (registration.waiting) registration.waiting.postMessage({ type: "skip-waiting" });
      })
      .catch(() => undefined);
  });
}

window.addEventListener("error", (event) => {
  pulse("error", event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  pulse("error", reason instanceof Error ? reason.message : "unhandled");
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing root.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
