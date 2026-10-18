import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/red-hat-text/400.css";
import "@fontsource/red-hat-text/600.css";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
