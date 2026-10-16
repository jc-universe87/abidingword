import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/app/App";
import i18n from "@/i18n";
import type { PdfEngine } from "@/lib/pdfEngine";
import type { Updater } from "@/lib/updater";
import { createMemoryApi, type MemoryApi } from "./memoryApi";

/** Window width the app sees; a typical desktop unless a test says otherwise. */
export function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

/** Renders the whole app against an in-memory API and waits for the shell. */
export async function renderApp(api: MemoryApi = createMemoryApi(), { width = 1440, updater, pdfEngine }: { width?: number; updater?: Updater; pdfEngine?: PdfEngine } = {}) {
  setWindowWidth(width);
  const user = userEvent.setup();
  render(<App api={api} updater={updater} pdfEngine={pdfEngine} />);
  if (api.state.info.ready) {
    // The Study pane's name is in the interface language.
    await screen.findByRole("main", { name: new RegExp(i18n.t("app.panes.name.study"), "i") });
  }
  return { api, user };
}

/**
 * Opens Settings → one section (by its title). Sections start closed; the
 * section's heading is the button that opens it.
 */
export async function openSettingsSection(user: ReturnType<typeof userEvent.setup>, title: string) {
  if (!screen.queryByRole("heading", { level: 1, name: i18n.t("settings.title") })) {
    await user.click(screen.getByRole("button", { name: i18n.t("app.toolbar.settings") }));
  }
  const region = await screen.findByRole("region", { name: title });
  const toggle = within(region).getByRole("button", { name: title });
  if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
  return region;
}
