import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/red-hat-text/400.css";
import "@fontsource/red-hat-text/600.css";
import { applyA11y } from "./a11y";
import { App } from "./App";
import { pulse } from "./pulse";
import "./styles.css";

applyA11y();

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
