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
import "./i18n";

import { App } from "./app/App";
import { AudienceWindow } from "./features/presentation/AudienceWindow";
import { tauriApi } from "./lib/api";
import { ApiProvider } from "./lib/ApiContext";
import { createTauriUpdater } from "./lib/updater";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// The audience screen of a presentation (v0.18) is a second window of the
// same app showing only the slides.
const audience = new URLSearchParams(window.location.search).get("audience");

createRoot(root).render(
  <StrictMode>
    {audience ? (
      <ApiProvider api={tauriApi}>
        <AudienceWindow presentationId={audience} />
      </ApiProvider>
    ) : (
      <App api={tauriApi} updater={createTauriUpdater()} />
    )}
  </StrictMode>,
);
