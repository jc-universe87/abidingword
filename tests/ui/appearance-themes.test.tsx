import { readFileSync } from "node:fs";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { APP_PALETTES } from "@/design-system/palettes";
import { createMemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

// Appearance (v0.18.2): six background families, each with a light and a
// dark variant. The choice stays one of six; the variant follows the theme in
// effect — Light, Dark, or the computer's setting as it changes.

const FAMILIES = ["parchment", "cream", "sage", "stone", "mist", "clear"] as const;
const css = readFileSync("src/design-system/tokens.css", "utf8");

function channel(c: number) {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
}

/** The tokens in force for one family in one mode, resolved as the cascade does. */
function tokens(family: string, mode: "light" | "dark"): Record<string, string> {
  const blocks: string[] = [];
  const add = (selector: string) => {
    const escaped = selector.replace(/[[\]"=]/g, (c) => `\\${c}`);
    for (const m of css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, "g"))) blocks.push(m[1]!);
  };
  add(":root");
  if (mode === "dark") add('[data-theme="dark"]');
  add(`[data-theme="${mode}"][data-paper="${family}"]`);
  const raw: Record<string, string> = {};
  for (const block of blocks) {
    for (const m of block.matchAll(/(--aw-[\w-]+):\s*([^;]+);/g)) raw[m[1]!] = m[2]!.trim();
  }
  const resolve = (value: string, depth = 0): string => {
    const ref = /^var\((--aw-[\w-]+)\)$/.exec(value);
    return ref && depth < 5 ? resolve(raw[ref[1]!] ?? value, depth + 1) : value;
  };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v)]));
}

/** A matchMedia whose "dark" answer the test changes, as the computer would. */
function fakeComputer(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => query });
  return {
    set(next: boolean) {
      dark = next;
      for (const fn of listeners) fn();
    },
  };
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.paper;
});

describe("twelve calm palettes", () => {
  it.each(FAMILIES.flatMap((f) => [[f, "light"] as const, [f, "dark"] as const]))("%s (%s): text, links, errors, focus and borders keep their contrast", (family, mode) => {
    const t = tokens(family, mode);
    for (const name of ["--aw-bg", "--aw-bg-secondary", "--aw-surface", "--aw-border", "--aw-border-subtle", "--aw-text", "--aw-text-muted"]) {
      expect(t[name], `${family} ${mode} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
    const [bg, secondary, surface] = [t["--aw-bg"]!, t["--aw-bg-secondary"]!, t["--aw-surface"]!];
    // Body text, strong text, muted text in the side panes.
    expect(contrast(t["--aw-text"]!, bg)).toBeGreaterThan(11);
    expect(contrast(t["--aw-text"]!, surface)).toBeGreaterThan(9);
    expect(contrast(t["--aw-text-strong"]!, bg)).toBeGreaterThan(11);
    expect(contrast(t["--aw-text-muted"]!, secondary)).toBeGreaterThan(5);
    // Links and errors (AA for normal text), on cards too.
    expect(contrast(t["--aw-link"]!, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--aw-danger"]!, surface)).toBeGreaterThanOrEqual(4.5);
    // The focus ring stands out from what it surrounds (WCAG 1.4.11).
    expect(contrast(t["--aw-focus-ring"]!, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t["--aw-focus-ring"]!, secondary)).toBeGreaterThanOrEqual(3);
    // Selection, notes and the primary button keep their text readable.
    expect(contrast(t["--aw-text"]!, t["--aw-selection"]!)).toBeGreaterThan(7);
    expect(contrast(t["--aw-text"]!, t["--aw-note"]!)).toBeGreaterThan(7);
    expect(contrast(t["--aw-on-primary"]!, t["--aw-primary"]!)).toBeGreaterThan(7);
    // Borders of inputs and cards are visible against both surfaces; hover
    // (the secondary colour) differs from the page.
    expect(contrast(t["--aw-border"]!, bg)).toBeGreaterThan(1.3);
    expect(contrast(t["--aw-border"]!, surface)).toBeGreaterThan(1.2);
    expect(secondary).not.toBe(bg);
    if (mode === "dark") {
      // Calm, never pure black.
      for (const colour of [bg, secondary, surface]) {
        expect(colour).not.toBe("#000000");
        expect(luminance(colour)).toBeGreaterThan(0.005);
      }
    }
  });

  it("the swatches and the Presenter View use exactly these colours", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const family of FAMILIES) {
        const t = tokens(family, mode);
        expect(APP_PALETTES[mode][family], `${family} ${mode}`).toEqual({
          background: t["--aw-bg"],
          secondary: t["--aw-bg-secondary"],
          text: t["--aw-text"],
          muted: t["--aw-text-muted"],
          accent: t["--aw-link"],
        });
      }
    }
  });

  it.each(FAMILIES.flatMap((f) => [[f, "light"] as const, [f, "dark"] as const]))(
    "%s (%s): the work pane leads, Scripture one step back, Sources two, all readable (v0.18.4)",
    (family, mode) => {
      const t = tokens(family, mode);
      const [work, scripture, sources, field] = ["--aw-pane-work", "--aw-pane-scripture", "--aw-pane-sources", "--aw-field"].map((n) => {
        expect(t[n], `${family} ${mode} ${n}`).toMatch(/^#[0-9a-f]{6}$/);
        return t[n]!;
      }) as [string, string, string, string];
      // The work has the most contrast with the text: brightest in Light, deepest in Dark.
      const order = [work, scripture, sources].map(luminance);
      if (mode === "light") expect(order[0]! > order[1]! && order[1]! > order[2]!).toBe(true);
      else expect(order[0]! < order[1]! && order[1]! < order[2]!).toBe(true);
      // Each step is visible but calm (no strong panels).
      for (const [a, b] of [[work, scripture], [scripture, sources]] as const) {
        expect(contrast(a, b), `${family} ${mode} step`).toBeGreaterThan(1.04);
        expect(contrast(a, b), `${family} ${mode} step`).toBeLessThan(1.25);
      }
      // Text, muted text, links and the focus ring keep their contrast on every pane.
      for (const pane of [work, scripture, sources]) {
        expect(contrast(t["--aw-text"]!, pane)).toBeGreaterThan(9);
        expect(contrast(t["--aw-text-muted"]!, pane)).toBeGreaterThan(5);
        expect(contrast(t["--aw-link"]!, pane)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["--aw-focus-ring"]!, pane)).toBeGreaterThanOrEqual(3);
      }
      // A field is one step back from the work it sits in, and its text reads as well as body text.
      expect(field).toBe(scripture);
      expect(contrast(t["--aw-text"]!, field)).toBeGreaterThan(9);
    },
  );

  it("each family's dark variant is its own (not one shared dark)", () => {
    const darks = FAMILIES.map((f) => tokens(f, "dark")["--aw-bg"]);
    expect(new Set(darks).size).toBe(FAMILIES.length);
  });
});

describe("the background follows the theme in effect", () => {
  it("Match my computer changes light ↔ dark while the app runs, keeping the chosen family", async () => {
    const computer = fakeComputer(false);
    const api = createMemoryApi();
    api.state.settings.theme = "system";
    const { user } = await renderApp(api);
    expect(document.documentElement.dataset.theme).toBe("light");
    const appearance = await openSettingsSection(user, "Appearance");
    const group = within(appearance).getByRole("radiogroup", { name: "Background" });
    await user.click(within(group).getByRole("radio", { name: "Sage" }));
    expect(document.documentElement.dataset.paper).toBe("sage");
    const swatch = () => (within(group).getByRole("radio", { name: "Sage" }).nextElementSibling as HTMLElement).style.background;
    expect(swatch()).toMatch(/#eef1e9|rgb\(238, 241, 233\)/); // light sage

    act(() => computer.set(true));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.documentElement.dataset.paper).toBe("sage");
    expect(swatch()).toMatch(/#1a201c|rgb\(26, 32, 28\)/); // dark sage
    // Still six choices; no "light only" note.
    expect(within(group).getAllByRole("radio")).toHaveLength(6);
    expect(screen.queryByText(/apply to the light theme/)).toBeNull();

    act(() => computer.set(false));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  });

  it("an explicit Dark ignores the computer; Light likewise", async () => {
    const computer = fakeComputer(false);
    const api = createMemoryApi();
    const { user } = await renderApp(api);
    const appearance = await openSettingsSection(user, "Appearance");
    await user.click(within(appearance).getByRole("radio", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    act(() => computer.set(false));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(within(appearance).getByRole("radio", { name: "Light" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    act(() => computer.set(true));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
