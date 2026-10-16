import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openSettingsSection, renderApp } from "../support/render";

const ORDER = ["Updates", "Appearance", "Bible texts", "Templates", "Language", "Assistant", "About this installation", "Coming in later versions"];

describe("settings", () => {
  it("lists the sections in order, each one line with where it stands, all closed", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toHaveFocus();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(ORDER.map((title) => expect.stringContaining(title)));
    for (const title of ORDER) {
      const toggle = within(screen.getByRole("region", { name: title })).getByRole("button", { name: title });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    // Short summaries say where things stand without opening anything.
    expect(within(screen.getByRole("region", { name: "Appearance" })).getByRole("button", { name: "Appearance" })).toHaveAccessibleDescription("Light");
    expect(within(screen.getByRole("region", { name: "Language" })).getByRole("button", { name: "Language" })).toHaveAccessibleDescription("English");
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Assistant" })).getByRole("button", { name: "Assistant" })).toHaveAccessibleDescription("Off"),
    );
    expect(within(screen.getByRole("region", { name: "Coming in later versions" })).getByRole("button", { name: "Coming in later versions" })).toHaveAccessibleDescription("Sync · Integrations");
  });

  it("shows the version and where data is stored when About is opened", async () => {
    const { user } = await renderApp();
    const about = await openSettingsSection(user, "About this installation");
    expect(within(about).getByText("Abiding Word 0.1.0 (Foundation)")).toBeVisible();
    expect(within(about).getByText("/home/test/.local/share/Abiding Word")).toBeVisible();
  });

  it("opens and closes sections independently, from the keyboard too", async () => {
    const { user } = await renderApp();
    const appearance = await openSettingsSection(user, "Appearance");
    expect(within(appearance).getByRole("radio", { name: /Dark/ })).toBeVisible();
    const language = await openSettingsSection(user, "Language");
    // Opening one does not close another.
    expect(within(appearance).getByRole("radio", { name: /Dark/ })).toBeVisible();
    expect(within(language).getByLabelText("Interface language")).toBeVisible();

    const toggle = within(appearance).getByRole("button", { name: "Appearance" });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(appearance).queryByRole("radio", { name: /Dark/ })).toBeNull();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "settings-appearance-body");
  });

  it("jumps to a section from the list at the top: opens it and moves focus there", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const nav = await screen.findByRole("navigation", { name: "Go to a section" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(ORDER);

    await user.click(within(nav).getByRole("link", { name: "Assistant" }));
    const toggle = within(screen.getByRole("region", { name: "Assistant" })).getByRole("button", { name: "Assistant" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(await screen.findByRole("checkbox", { name: "Use the assistant" })).toBeVisible();
  });

  it("keeps Back in the header that stays at the top", async () => {
    const { user } = await renderApp();
    await openSettingsSection(user, "Templates");
    const back = screen.getByRole("button", { name: "Back to workspace" });
    expect(back.closest("header")).toHaveClass("sticky");
    expect(back.closest("header")).toContainElement(screen.getByRole("navigation", { name: "Go to a section" }));
    await user.click(back);
    expect(await screen.findByRole("main", { name: "Study" })).toBeInTheDocument();
  });

  it("remembers which sections were open", async () => {
    const { user } = await renderApp();
    await openSettingsSection(user, "Templates");
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const templates = await screen.findByRole("region", { name: "Templates" });
    expect(within(templates).getByRole("button", { name: "Templates" })).toHaveAttribute("aria-expanded", "true");
  });

  it("applies and saves the theme choice", async () => {
    const { api, user } = await renderApp();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

    await openSettingsSection(user, "Appearance");
    await user.click(await screen.findByRole("radio", { name: /Dark/ }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(api.state.settings.theme).toBe("dark");
  });

  it("returns to the workspace with Escape", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("main", { name: "Study" })).toBeInTheDocument();
  });

  it("does not advertise keyboard shortcuts", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    expect(screen.queryByRole("heading", { name: "Keyboard shortcuts" })).toBeNull();
    expect(screen.queryByText(/These work while a study is open/)).toBeNull();
    for (const text of [/Alt\+/, /Alt\s*\+\s*[NOQG]/, /New finding/i, /Go to a Scripture passage/i]) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });
});

describe("no global study shortcuts remain", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it("has no shortcut hook, shortcut list or Alt-key listener in the interface code", () => {
    for (const path of files("src")) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/useStudyShortcuts|STUDY_SHORTCUTS|studies\.shortcuts\.|settings\.shortcutsHint/);
      expect(text, path).not.toMatch(/\.altKey/);
    }
  });
});
