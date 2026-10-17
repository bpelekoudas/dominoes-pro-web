import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/fraunces/700.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/600.css";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
