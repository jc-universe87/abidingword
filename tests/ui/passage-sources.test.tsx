import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLanguage } from "@/i18n";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Passage-aware sources (v0.9). All text is invented.

/** A commentary whose headings name the passage each section is about. */
const COMMENTARY: SourceFixture = {
  title: "A Synthetic Commentary",
  author: "P. Example",
  format: "markdown",
  language: "English",
  segments: [
    { text: "Opening paragraph about the vine.", sectionPath: "A Synthetic Commentary › John 15:1–11 — The True Vine" },
    { text: "A second paragraph about branches.", sectionPath: "A Synthetic Commentary › John 15:1–11 — The True Vine" },
    { text: "A third paragraph about fruit.", sectionPath: "A Synthetic Commentary › John 15:1–11 — The True Vine" },
    { text: "A paragraph about love.", sectionPath: "A Synthetic Commentary › John 15:12–17 — Love One Another" },
  ],
  sections: [
    { segment: 0, reference: "JHN.15.1-JHN.15.11", matchedText: "John 15:1–11", heading: "John 15:1–11 — The True Vine", through: 2 },
    { segment: 3, reference: "JHN.15.12-JHN.15.17", matchedText: "John 15:12–17", heading: "John 15:12–17 — Love One Another" },
  ],
};

/** Sermon notes that mention one verse in every paragraph. */
const SERMON: SourceFixture = {
  title: "Abiding Sermon Notes",
  format: "text",
  sourceType: "sermon",
  language: "English",
  segments: [1, 2, 3, 4, 5].map((n) => ({ text: `Point ${n}. Remain, as John 15:5 says.` })),
  mentions: [1, 2, 3, 4, 5].map((n) => ({ segment: n - 1, reference: "JHN.15.5", matchedText: "John 15:5" })),
};

function withLibrary(...fixtures: SourceFixture[]) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  for (const fixture of fixtures) api.installFixtureSource(fixture);
  return api;
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const scripture = () => screen.getByRole("complementary", { name: "Scripture" });

/** Reads John 15 with verse `verse` selected. */
async function readJohn15(user: Awaited<ReturnType<typeof renderApp>>["user"], verse?: number) {
  await user.type(within(scripture()).getByLabelText("Go to passage"), "John 15{Enter}");
  if (verse) await user.click(await within(scripture()).findByRole("button", { name: new RegExp(`^Verse ${verse}\\. Show verse tools`) }));
}

describe("Sources for the passage being read", () => {
  it("shows a commentary section as one entry, with the heading's passage as the reason", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(1);
    const open = within(list).getByRole("button", { name: /A Synthetic Commentary/ });
    // Not ten near-identical cards: the section's opening place and why it fits.
    expect(open).toHaveTextContent("P. Example");
    expect(open).toHaveTextContent("Section on John 15:1–11");
    expect(open).not.toHaveTextContent("Within section");
    expect(within(list).getAllByRole("button")).toHaveLength(1);
  });

  it("opens the section where it begins, in the Sources pane, and says why it is linked", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    await user.click(within(list).getByRole("button", { name: /A Synthetic Commentary/ }));
    const reader = await within(sourcesPane()).findByRole("region", { name: "A Synthetic Commentary" });
    await waitFor(() => expect(reader.querySelector("[data-target]")).toHaveTextContent("Opening paragraph about the vine."));
    expect(await within(reader).findByText("Section on John 15:1–11")).toBeInTheDocument();
    // The study and Scripture stay where they were.
    expect(screen.getByRole("main", { name: "Study" })).toBeInTheDocument();
  });

  it("names a place inside a section as within it, and a literal mention as a mention", async () => {
    const api = withLibrary(COMMENTARY);
    const { user } = await renderApp(api);
    // A search hit inside the section opens that paragraph, not the section's start.
    await user.selectOptions(screen.getByLabelText("Search in"), "library");
    await user.type(screen.getByLabelText("Search the library"), "fruit{Enter}");
    await user.click(await within(await screen.findByRole("list", { name: "Library search results" })).findByRole("button", { name: /Synthetic Commentary/ }));
    await waitFor(() => expect(document.querySelector("[data-target]")).toHaveTextContent("A third paragraph about fruit."));
    expect(await screen.findByText("Within section on John 15:1–11")).toBeInTheDocument();
    expect(screen.queryByText("Mentions John 15:1–11")).not.toBeInTheDocument();
  });

  it("shows an explicit mention as a mention", async () => {
    const { user } = await renderApp(withLibrary(SERMON));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Mentions John 15:5");
  });

  it("groups many places in one source: the best few, and a count of the rest", async () => {
    const { user } = await renderApp(withLibrary(SERMON));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    expect(within(list).getAllByRole("listitem").filter((li) => li.parentElement === list)).toHaveLength(1);
    // three places (the best one on the title, two beneath), not five cards
    expect(within(list).getAllByRole("button")).toHaveLength(4);
    expect(within(list).getByRole("button", { name: "2 more places in this source" })).toBeInTheDocument();
  });

  it("puts a section about the passage before mentions of it, and never lets a source appear twice", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY, SERMON));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    const titles = within(list)
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    // the commentary's section contains the verse and is about it; the sermon only cites it
    expect(titles[0]).toContain("A Synthetic Commentary");
    expect(titles.some((t) => t.includes("Abiding Sermon Notes"))).toBe(true);
    expect(titles.filter((t) => t.includes("A Synthetic Commentary"))).toHaveLength(1);
  });

  it("offers nothing for a source that only has places elsewhere in the chapter", async () => {
    const early: SourceFixture = {
      title: "Notes on the Early Verses",
      format: "markdown",
      segments: [{ text: "Remarks on the opening of the chapter.", sectionPath: "Notes › John 15:1–3" }],
      sections: [{ segment: 0, reference: "JHN.15.1-JHN.15.3", matchedText: "John 15:1–3", heading: "John 15:1–3" }],
    };
    const { user } = await renderApp(withLibrary(early));
    await readJohn15(user, 6);
    // sharing a chapter number is not enough: the pane says so plainly instead of inventing relevance
    expect(await within(sourcesPane()).findByText("No source in your library is linked to this passage.")).toBeInTheDocument();
    expect(within(sourcesPane()).queryByText(/Notes on the Early Verses/, { selector: "cite" })).not.toBeInTheDocument();
    expect(within(sourcesPane()).queryByRole("list", { name: "Elsewhere in John 15" })).not.toBeInTheDocument();
    expect(within(sourcesPane()).queryByText("Elsewhere in John 15")).not.toBeInTheDocument();
  });

  it("says plainly when no source fits", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY));
    await user.type(within(scripture()).getByLabelText("Go to passage"), "Psalm 23{Enter}");
    expect(await within(sourcesPane()).findByText("No source in your library is linked to this passage.")).toBeInTheDocument();
  });

  it("never offers a removed source", async () => {
    const api = withLibrary(COMMENTARY);
    const { user } = await renderApp(api);
    await readJohn15(user, 5);
    await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    const id = api.state.library.sources[0]!.id;
    await act(async () => {
      await api.libraryRemoveSource(id);
    });
    await user.click(within(scripture()).getByRole("button", { name: /^Verse 6\. Show verse tools/ }));
    expect(await within(sourcesPane()).findByText("No source in your library is linked to this passage.")).toBeInTheDocument();
  });

  it("is written in the interface language", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY));
    await readJohn15(user, 5);
    await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    // the pane's own name is translated too, so keep hold of it across the switch
    const pane = sourcesPane();
    await act(() => setLanguage("de"));
    const list = await within(pane).findByRole("list", { name: /^Quellen zu / });
    expect(within(list).getByRole("button", { name: /A Synthetic Commentary/ })).toHaveTextContent(/Abschnitt zu .*15/);
    await act(() => setLanguage("ko"));
    expect(await within(pane).findByRole("list", { name: /관련 자료$/ })).toBeInTheDocument();
  });
});
