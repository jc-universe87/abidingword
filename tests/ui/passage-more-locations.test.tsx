import { readFileSync } from "node:fs";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// "More places in this source" is a disclosure: the places beyond the best
// three can be revealed and opened. All text is invented.

const MANY: SourceFixture = {
  title: "A Long Sermon Series",
  format: "text",
  segments: [1, 2, 3, 4, 5, 6].map((n) => ({ text: `Part ${n}: John 15:5.` })),
  mentions: [1, 2, 3, 4, 5, 6].map((n) => ({ segment: n - 1, reference: "JHN.15.5", matchedText: "John 15:5" })),
};

function withLibrary() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  api.installFixtureSource(MANY);
  return api;
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const scripture = () => screen.getByRole("complementary", { name: "Scripture" });
type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function readJohn15(user: User, verse: number) {
  await user.type(within(scripture()).getByLabelText("Go to passage"), "John 15{Enter}");
  await user.click(await within(scripture()).findByRole("button", { name: new RegExp(`^Verse ${verse}\\. Show verse tools`) }));
}

const list = () => within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
const toggle = async (name: RegExp) => within(await list()).getByRole("button", { name });

describe("Expanding more places in a source", () => {
  it("is a button, collapsed at first, and the pane still lists only three places", async () => {
    const api = withLibrary();
    const { user } = await renderApp(api);
    await readJohn15(user, 5);
    const more = await toggle(/3 more places in this source/);
    expect(more).toHaveAttribute("aria-expanded", "false");
    // three places + the control
    expect(within(await list()).getAllByRole("button")).toHaveLength(4);
    expect(api.libraryLocationsCalls).toHaveLength(0);
    await user.click(more);
  });

  it("expands inline, shows the rest, and each place opens its own paragraph", async () => {
    const api = withLibrary();
    const { user } = await renderApp(api);
    await readJohn15(user, 5);
    await user.click(await toggle(/3 more places/));
    const less = await toggle(/Show fewer/);
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(less).toHaveAttribute("aria-controls");
    await waitFor(async () => expect(within(await list()).getAllByRole("button")).toHaveLength(7));
    expect(api.libraryLocationsCalls).toEqual([{ sourceId: expect.any(String), reference: "JHN.15.5" }]);
    // the fourth place is the first one added
    await user.click(within(await list()).getAllByRole("button")[3]!);
    const reader = await within(sourcesPane()).findByRole("region", { name: "A Long Sermon Series" });
    await waitFor(() => expect(reader.querySelector("[data-target]")).toHaveTextContent("Part 4: John 15:5."));
    // Back keeps the pane as it was, expansion included, without asking again
    await user.click(within(sourcesPane()).getByRole("button", { name: "Back to Sources" }));
    expect(await toggle(/Show fewer/)).toHaveAttribute("aria-expanded", "true");
    expect(api.libraryLocationsCalls).toHaveLength(1);
  });

  it("collapses, and expands again from the cache", async () => {
    const api = withLibrary();
    const { user } = await renderApp(api);
    await readJohn15(user, 5);
    await user.click(await toggle(/3 more places/));
    await user.click(await toggle(/Show fewer/));
    const more = await toggle(/3 more places in this source/);
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(within(await list()).getAllByRole("button")).toHaveLength(4);
    await user.click(more);
    await waitFor(async () => expect(within(await list()).getAllByRole("button")).toHaveLength(7));
    expect(api.libraryLocationsCalls).toHaveLength(1);
  });

  it("works from the keyboard, and Escape collapses and keeps focus on the control", async () => {
    const { user } = await renderApp(withLibrary());
    await readJohn15(user, 5);
    (await toggle(/3 more places/)).focus();
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(within(await list()).getAllByRole("button")).toHaveLength(7));
    const less = await toggle(/Show fewer/);
    less.focus();
    await user.keyboard("{Escape}");
    const more = await toggle(/3 more places/);
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();
    await user.keyboard(" ");
    expect(await toggle(/Show fewer/)).toHaveAttribute("aria-expanded", "true");
  });

  it("forgets the expansion when the passage changes", async () => {
    const api = withLibrary();
    const { user } = await renderApp(api);
    await readJohn15(user, 5);
    await user.click(await toggle(/3 more places/));
    await toggle(/Show fewer/);
    await user.click(within(scripture()).getByRole("button", { name: /^Verse 6\. Show verse tools/ }));
    await waitFor(() => expect(within(sourcesPane()).queryByRole("list", { name: "Sources for John 15:5" })).not.toBeInTheDocument());
    await user.click(within(scripture()).getByRole("button", { name: /^Verse 5\. Show verse tools/ }));
    expect(await toggle(/3 more places in this source/)).toHaveAttribute("aria-expanded", "false");
    expect(within(await list()).getAllByRole("button")).toHaveLength(4);
  });
});

describe("Locale keys", () => {
  it("every language has the expand, collapse, loading and failure strings", () => {
    for (const lang of ["en", "de", "ko", "fr", "es", "pt"]) {
      const pane = JSON.parse(readFileSync(`src/i18n/locales/${lang}/library.json`, "utf8")).pane as Record<string, string>;
      expect(Object.keys(pane).some((k) => k.startsWith("moreLocations")), lang).toBe(true);
      for (const key of ["showFewerLocations", "loadingLocations", "locationsFailed"]) {
        expect(pane[key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });
});
