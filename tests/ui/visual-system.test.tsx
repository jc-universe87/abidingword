import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { createMemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

// The desktop visual system (v0.18.5): one set of surfaces, fields, actions
// and selected states across the app. These check the rules that are easy
// to break again without noticing — not pixels.

const css = readFileSync("src/design-system/index.css", "utf8");
const tokens = readFileSync("src/design-system/tokens.css", "utf8");

function sources(dir = "src"): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [{ path, text: readFileSync(path, "utf8") }] : [];
  });
}
const all = sources();

/** Every button on screen has a name a screen reader can say (an icon alone is not one). */
function unnamedButtons(root: HTMLElement = document.body) {
  return within(root)
    .queryAllByRole("button", { name: (name) => !name.trim() })
    .map((b) => b.outerHTML.slice(0, 120));
}

async function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  const prep = await api.teachingCreate({ studyId: study.id, title: "Remain in the vine", kind: "sermon", points: [{ title: "Stay connected" }] });
  await api.teachingUpdate({ id: prep.id, centralMessage: "Fruit comes from remaining." });
  // Invented text.
  api.installFixtureSource({ title: "Notes on the Vine", format: "pdf", language: "English", segments: [{ text: "Abiding is the heart of fruitfulness.", pageNumber: 1 }] });
  return api;
}

describe("the shared primitives", () => {
  it("are defined once: surfaces, interaction tints and status colours in both modes", () => {
    for (const token of ["--aw-hover", "--aw-selected", "--aw-raised", "--aw-backdrop", "--aw-success", "--aw-warning"]) {
      // Defined for Light and again for Dark.
      expect(tokens.split(`${token}:`).length - 1, token).toBeGreaterThanOrEqual(2);
    }
    for (const name of [".aw-input", ".aw-writing", ".aw-readonly", ".aw-choice", ".aw-row", ".aw-tab", ".aw-icon-button", ".aw-popover", ".aw-action-panel", ".type-item", ".type-group"]) {
      expect(css, name).toContain(`${name} {`);
    }
  });

  it("leave no copies of the old one-off treatments behind", () => {
    const offenders = (pattern: RegExp) => all.filter((f) => pattern.test(f.text)).map((f) => f.path);
    // The heavy 2px note field, now .aw-writing.
    expect(offenders(/border-2 border-border bg-bg px-3 py-2/)).toEqual([]);
    // The selection panel chrome, now .aw-action-panel.
    expect(offenders(/border-t-\[4px\] border-border border-t-accent/)).toEqual([]);
    // Hover is one tint, not a different background per screen.
    expect(offenders(/hover:bg-bg-secondary|hover:bg-text-strong\/\[0\.06\]/)).toEqual([]);
    // A class that never existed (a slip in a bulk change once hid the app bar's fields).
    expect(offenders(/aw-input-secondary/)).toEqual([]);
  });

  it("confirm every delete or remove with the danger action, never the primary one", () => {
    const wrong = all.flatMap((f) =>
      [...f.text.matchAll(/role="alertdialog"[\s\S]{0,900}?<\/div>/g)]
        .filter((m) => /<Button variant="primary"/.test(m[0]) || !/<Button variant="danger"/.test(m[0]))
        .map(() => f.path),
    );
    expect(wrong).toEqual([]);
    expect(all.filter((f) => f.text.includes('role="alertdialog"')).length).toBeGreaterThanOrEqual(5);
  });

  it("let a slide row in the editor follow its pane's width, not the window's", () => {
    const editor = readFileSync("src/features/presentation/PresentationView.tsx", "utf8");
    // With all three panes open at 1100 px the words of a slide were squeezed to one letter a line.
    expect(editor).toContain("hidden w-32 shrink-0 @md:block");
    expect(editor).not.toMatch(/hidden w-32 shrink-0 sm:block/);
  });
});

describe("every button has a name", () => {
  it("in the workspace with a Bible Teaching open", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    await user.click(within(await screen.findByRole("list", { name: i18n.t("studies.list.listLabel") })).getByRole("button", { name: /Abiding/ }));
    await user.click(await screen.findByRole("button", { name: "Bible Teaching" }));
    await screen.findByRole("article", { name: "Remain in the vine" });
    expect(unnamedButtons()).toEqual([]);
  });

  it("in the Library, Settings and the AI Assistant settings", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    await user.click(await within(screen.getByRole("complementary", { name: "Sources" })).findByRole("button", { name: "Open library" }));
    await screen.findByRole("heading", { level: 1, name: "Library" });
    expect(unnamedButtons()).toEqual([]);
    await user.click(screen.getByRole("button", { name: i18n.t("library.view.backToWorkspace") }));
    await openSettingsSection(user, i18n.t("settings.sections.assistant"));
    expect(unnamedButtons()).toEqual([]);
  });
});
