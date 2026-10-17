import { readFileSync } from "node:fs";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { createMemoryUpdater } from "../support/memoryUpdater";
import { openSettingsSection, renderApp } from "../support/render";

vi.mock("@/features/updates/timing", () => ({ STARTUP_CHECK_DELAY_MS: 0 }));

// v0.16 Windows refinement: Settings stays short, explanations open on
// request, larger tasks open over Settings, and the window is always filled.

function updatesApi() {
  const api = createMemoryApi();
  api.state.info = { ...api.state.info, updatesEnabled: true, version: "0.5.0-dev.34" };
  return api;
}

describe("compact Updates", () => {
  it("shows version, channel and one button, and does not repeat the heading's status", async () => {
    const updater = createMemoryUpdater({ available: null });
    const { user } = await renderApp(updatesApi(), { updater });
    const section = await openSettingsSection(user, "Updates");
    await waitFor(() => expect(updater.checks).toBe(1));
    const toggle = within(section).getByRole("button", { name: "Updates" });
    await waitFor(() => expect(toggle).toHaveAccessibleDescription("Up to date"));
    expect(within(section).getByText("Installed version")).toBeVisible();
    expect(within(section).getByTestId("update-version")).toHaveTextContent("0.5.0-dev.34");
    expect(within(section).getByText("Development / test")).toBeVisible();
    expect(within(section).getAllByRole("button").map((b) => b.textContent)).toEqual(["UpdatesUp to date", "Check for updates"]);
    // "Up to date" is said once, in the heading; the button row stays quiet.
    expect(within(section).getByRole("status")).toHaveClass("sr-only");
    expect(within(section).getByText(/checks only occasionally or when you ask/)).toBeVisible();
  });
});

describe("contextual help", () => {
  it("keeps explanations out of the page until asked, by click, keyboard or hover", async () => {
    const { user } = await renderApp();
    const language = await openSettingsSection(user, "Language");
    const text = within(language).getByText(/Changes the language of menus/);
    expect(text).not.toBeVisible();

    const help = within(language).getByRole("button", { name: "More about: Interface language" });
    expect(help).toHaveAttribute("aria-expanded", "false");
    await user.click(help);
    expect(text).toBeVisible();
    expect(help).toHaveAttribute("aria-expanded", "true");
    // Escape closes only the explanation, not Settings.
    await user.keyboard("{Escape}");
    expect(text).not.toBeVisible();
    expect(help).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    // Keyboard: Enter and Space open and close it.
    await user.keyboard("{Enter}");
    expect(text).toBeVisible();
    await user.keyboard(" ");
    expect(text).not.toBeVisible();

    // Hover shows it while the pointer is there (the pointer is moved away first).
    await user.unhover(help);
    await user.hover(help);
    expect(text).toBeVisible();
    await user.unhover(help);
    expect(text).not.toBeVisible();

    // A tap elsewhere closes one that was opened.
    await user.click(help);
    await user.click(screen.getByRole("heading", { level: 1, name: "Settings" }));
    expect(text).not.toBeVisible();
  });

  it("uses the same help pattern across Settings instead of paragraphs", async () => {
    const { user } = await renderApp();
    for (const [section, name] of [
      ["Appearance", "More about: Workspace layout"],
      ["Appearance", "More about: Background"],
      ["Templates", "More about: Templates"],
      ["About this installation", "More about: Data folder"],
    ] as const) {
      const region = await openSettingsSection(user, section);
      expect(within(region).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/Puts the panes back/)).not.toBeVisible();
  });
});

describe("Appearance backgrounds", () => {
  it("offers a few calm backgrounds as swatches and remembers the choice", async () => {
    const { user } = await renderApp();
    const appearance = await openSettingsSection(user, "Appearance");
    const group = within(appearance).getByRole("group", { name: /Background/ });
    expect(within(group).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["Parchment", "Cream", "Sage", "Stone", "Mist", "Neutral"]);
    expect(within(group).getByRole("radio", { name: "Parchment" })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: "Sage" }));
    expect(document.documentElement.dataset.paper).toBe("sage");
    expect(window.localStorage.getItem("abiding-word.appearance.background")).toBe(JSON.stringify("sage"));
    expect(within(appearance).getByRole("button", { name: "Appearance" })).toHaveAccessibleDescription("Light · Sage");
  });

  it("defines every background with readable text", () => {
    const css = readFileSync("src/design-system/tokens.css", "utf8");
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = (h: string) => {
      const [r, g, b] = hex(h);
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x! + 0.05) / (y! + 0.05);
    };
    for (const paper of ["cream", "sage", "stone", "mist", "clear"]) {
      const block = new RegExp(`\\[data-paper="${paper}"\\] \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      const bg = /--aw-bg: (#[0-9a-f]{6})/.exec(block)![1]!;
      const secondary = /--aw-bg-secondary: (#[0-9a-f]{6})/.exec(block)![1]!;
      expect(contrast("#2b2b2b", bg), paper).toBeGreaterThan(11); // body text
      expect(contrast("#5f5c56", secondary), paper).toBeGreaterThan(5); // muted text on the side panes
    }
  });
});

describe("tasks over Settings", () => {
  it("opens Add a Bible over Settings and comes back to the same place", async () => {
    const { user } = await renderApp();
    const bibles = await openSettingsSection(user, "Bible texts");
    await openSettingsSection(user, "Language");
    const add = within(bibles).getByRole("button", { name: "Add a Bible…" });
    await user.click(add);
    const sheet = await screen.findByRole("dialog", { name: "Add a Bible" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    // Settings is still there behind it.
    expect(screen.getByRole("heading", { level: 1, name: "Settings", hidden: true })).toBeInTheDocument();
    await waitFor(() => expect(within(sheet).getByRole("heading", { level: 1, name: "Add a Bible" })).toHaveFocus());

    // Tab stays inside the sheet.
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(sheet).toContainElement(document.activeElement as HTMLElement);
    }

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a Bible" })).toBeNull());
    expect(add).toHaveFocus();
    // Sections stay open as they were.
    expect(within(screen.getByRole("region", { name: "Language" })).getByRole("button", { name: "Language" })).toHaveAttribute("aria-expanded", "true");
    expect(within(bibles).getByRole("button", { name: "Bible texts" })).toHaveAttribute("aria-expanded", "true");
  });

  it("edits a template over Settings, closes with Escape or Back, and keeps Settings as it was", async () => {
    const { user } = await renderApp();
    const templates = await openSettingsSection(user, "Templates");
    const create = within(templates).getByRole("button", { name: "New template…" });
    await user.click(create);
    const sheet = await screen.findByRole("dialog", { name: "New template" });
    expect(within(sheet).getByRole("button", { name: /Back/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(create).toHaveFocus();
    expect(within(templates).getByRole("button", { name: "Templates" })).toHaveAttribute("aria-expanded", "true");

    await user.click(create);
    const again = await screen.findByRole("dialog", { name: "New template" });
    await user.click(within(again).getByRole("button", { name: /Back/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });
});

describe("the window is filled", () => {
  it("pins the app to the window and lets each pane scroll inside itself", async () => {
    await renderApp();
    const shell = screen.getByTestId("app-shell");
    expect(shell).toHaveClass("fixed", "inset-0", "flex", "flex-col", "overflow-hidden");
    const css = readFileSync("src/design-system/index.css", "utf8");
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{\s*height: 100%;/);
    expect(css).not.toMatch(/100vh/);
    for (const name of ["Scripture", "Sources"]) {
      expect(screen.getByRole("complementary", { name })).toHaveClass("flex", "flex-col");
    }
    expect(screen.getByRole("main", { name: "Study" })).toHaveClass("flex-1", "flex-col");
    // Every pane's scroll area grows to the bottom of its pane.
    for (const pane of ["pane-scripture", "pane-study", "pane-sources"]) {
      const scroller = document.querySelector(`#${pane} .overflow-y-auto`);
      expect(scroller, pane).toHaveClass("min-h-0", "flex-1");
    }
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(conf.app.windows[0].backgroundColor).toBe("#f6f1e6");
  });
});
