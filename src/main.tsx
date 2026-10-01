import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Fonts are bundled with the app (not fetched online) so it works offline.
// Only the weights the brand type scale uses are included.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/noto-serif/400.css";
import "@fontsource/noto-serif/400-italic.css";
import "@fontsource/noto-serif/600.css";
import "./design-system/index.css";

import { App } from "./app/App";
import { tauriApi } from "./lib/api";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App api={tauriApi} />
  </StrictMode>,
);
