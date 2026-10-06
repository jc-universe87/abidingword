import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLanguage } from "@/i18n";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Source suggestion quality (v0.9, sub-phase 3): what the Sources pane puts
// first, how a source reads as one entry, and what the reader says about why.
// All text is invented.

const COMMENTARY: SourceFixture = {
  title: "Vine Commentary",
  author: "P. Example",
  format: "markdown",
  language: "English",
  segments: [
    { text: "The vine is the picture the passage rests on.", sectionPath: "Vine Commentary › John 15:1–11 — The True Vine" },
    { text: "A branch cannot bear fruit by itself.", sectionPath: "Vine Commentary › John 15:1–11 — The True Vine" },
    { text: "Remaining is dependence, as John 15:5 says and John 15:5 repeats.", sectionPath: "Vine Commentary › John 15:1–11 — The True Vine" },
    { text: "Compare John 15:16 on being chosen.", sectionPath: "Vine Commentary › Closing" },
  ],
  sections: [{ segment: 0, reference: "JHN.15.1-JHN.15.11", matchedText: "John 15:1–11", heading: "John 15:1–11 — The True Vine", through: 2 }],
  mentions: [
    { segment: 2, reference: "JHN.15.5", matchedText: "John 15:5" },
    { segment: 2, reference: "JHN.15.5", matchedText: "John 15:5" },
    { segment: 3, reference: "JHN.15.16", matchedText: "John 15:16" },
  ],
};

const SERMON: SourceFixture = {
  title: "Sermon Manuscript",
  format: "markdown",
  sourceType: "sermon",
  language: "English",
  segments: [{ text: "Open with a garden story.", sectionPath: "Sermon › John 15:1–8 — Remain" }],
  sections: [{ segment: 0, reference: "JHN.15.1-JHN.15.8", matchedText: "John 15:1–8", heading: "John 15:1–8 — Remain" }],
};

const NOTES: SourceFixture = {
  title: "Personal Notes",
  format: "text",
  language: "English",
  segments: [{ text: "Dependence: John 15:5 says apart from me nothing." }],
  mentions: [{ segment: 0, reference: "JHN.15.5", matchedText: "John 15:5" }],
};

const LOVE: SourceFixture = {
  title: "Notes on Love",
  format: "markdown",
  language: "English",
  segments: [{ text: "Friends keep the command.", sectionPath: "Love › John 15:12–17" }],
  sections: [{ segment: 0, reference: "JHN.15.12-JHN.15.17", matchedText: "John 15:12–17", heading: "John 15:12–17" }],
};

const KOREAN: SourceFixture = {
  title: "요한복음 묵상",
  format: "markdown",
  language: "한국어",
  segments: [{ text: "포도나무는 이 본문 전체의 그림입니다.", sectionPath: "묵상 › 요한복음 15:1–11" }],
  sections: [{ segment: 0, reference: "JHN.15.1-JHN.15.11", matchedText: "요한복음 15:1–11", heading: "요한복음 15:1–11" }],
};

const GERMAN: SourceFixture = {
  title: "Johanneskommentar",
  format: "markdown",
  language: "Deutsch",
  segments: [{ text: "Ein Absatz über Joh 15,5 und das Bleiben." }],
  mentions: [{ segment: 0, reference: "JHN.15.5", matchedText: "Joh 15,5" }],
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

async function readJohn15(user: Awaited<ReturnType<typeof renderApp>>["user"], verse?: number) {
  await user.type(within(scripture()).getByLabelText("Go to passage"), "John 15{Enter}");
  if (verse) await user.click(await within(scripture()).findByRole("button", { name: new RegExp(`^Verse ${verse}\\. Show verse tools`) }));
}

/** The titles of a list's entries, in order. */
const entryTitles = (list: HTMLElement) =>
  within(list)
    .getAllByRole("group")
    .map((g) => g.querySelector("cite")?.textContent ?? "");

describe("Suggestion quality in the Sources pane", () => {
  it("lists what fits John 15:5 under 'Sources for', and nothing that only shares the chapter", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY, NOTES, LOVE));
    await readJohn15(user, 5);
    const direct = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    // a section that contains the verse, then a neutral mention of it
    expect(entryTitles(direct)).toEqual(["Vine Commentary", "Personal Notes"]);
    // John 15:12–17 only shares the chapter: no "Elsewhere" list, no entry
    expect(within(sourcesPane()).queryByRole("list", { name: "Elsewhere in John 15" })).not.toBeInTheDocument();
    expect(within(direct).queryByText("Notes on Love")).not.toBeInTheDocument();
  });

  it("puts a cross-reference from another passage's section below sources about the passage", async () => {
    const xref: SourceFixture = {
      title: "Cross-references Study Bible",
      format: "markdown",
      segments: [{ text: "Compare John 15:5.", sectionPath: "Study Bible › Cross-references for Matthew 13:23" }],
      sections: [{ segment: 0, reference: "MAT.13.23", matchedText: "Matthew 13:23", heading: "Cross-references for Matthew 13:23" }],
      mentions: [{ segment: 0, reference: "JHN.15.5", matchedText: "John 15:5" }],
    };
    const broad: SourceFixture = {
      title: "Second Half of John",
      format: "markdown",
      segments: [{ text: "From the raising of Lazarus.", sectionPath: "John › John 11–21" }],
      sections: [{ segment: 0, reference: "JHN.11-JHN.21", matchedText: "John 11–21", heading: "John 11–21" }],
    };
    const { user } = await renderApp(withLibrary(xref, broad, SERMON, NOTES));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    // a section on John 15:1–8, then a neutral mention, then the cross-reference, then the book-scale range
    expect(entryTitles(list)).toEqual(["Sermon Manuscript", "Personal Notes", "Cross-references Study Bible", "Second Half of John"]);
    // plain words only
    expect(within(list).getByRole("group", { name: "Cross-references Study Bible" })).toHaveTextContent("Mentions John 15:5");
    expect(list.textContent).not.toMatch(/cross-reference tier|about|score|specific/i);
  });

  it("puts a section on the exact verse first, then sections that contain it (nearest first), then mentions", async () => {
    const exactSection: SourceFixture = {
      title: "A Verse Study",
      format: "markdown",
      segments: [{ text: "On abiding.", sectionPath: "Study › John 15:5" }],
      sections: [{ segment: 0, reference: "JHN.15.5", matchedText: "John 15:5", heading: "John 15:5" }],
    };
    const { user } = await renderApp(withLibrary(SERMON, COMMENTARY, NOTES, exactSection));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    expect(entryTitles(list)).toEqual(["A Verse Study", "Sermon Manuscript", "Vine Commentary", "Personal Notes"]);
  });

  it("says why each source fits, in plain words", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY, NOTES, SERMON));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    const entry = (title: string) => within(list).getByRole("group", { name: title });
    expect(entry("Personal Notes")).toHaveTextContent("Mentions John 15:5");
    expect(entry("Sermon Manuscript")).toHaveTextContent("Section on John 15:1–8");
    expect(list.textContent).not.toMatch(/origin|inherited|candidate|match/i);
  });

  it("shows a source once, and repeated mentions inside its section do not add places", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    expect(within(list).getAllByRole("group")).toHaveLength(1);
    // the paragraph that cites John 15:5 twice is one place, and the section it lies in is another
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(within(list).queryByText(/more places? in this source/)).not.toBeInTheDocument();
  });

  it("counts the places beyond the best three", async () => {
    const many: SourceFixture = {
      title: "A Long Sermon Series",
      format: "text",
      segments: [1, 2, 3, 4, 5, 6].map((n) => ({ text: `Part ${n}: John 15:5.` })),
      mentions: [1, 2, 3, 4, 5, 6].map((n) => ({ segment: n - 1, reference: "JHN.15.5", matchedText: "John 15:5" })),
    };
    const { user } = await renderApp(withLibrary(many));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    expect(within(list).getAllByRole("button")).toHaveLength(3);
    expect(within(list).getByText("3 more places in this source")).toBeInTheDocument();
  });

  it("opens a section where it begins", async () => {
    const { user } = await renderApp(withLibrary(SERMON));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    await user.click(within(list).getByRole("button", { name: /Sermon Manuscript/ }));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Sermon Manuscript" });
    await waitFor(() => expect(reader.querySelector("[data-target]")).toHaveTextContent("Open with a garden story."));
  });

  it("opens an explicit mention at that very paragraph, says why, and Back returns to the list", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    // the source's first place is where its section opens; the second is the paragraph that cites the verse
    await user.click(within(list).getAllByRole("button")[1]!);
    const reader = await within(sourcesPane()).findByRole("region", { name: "Vine Commentary" });
    await waitFor(() => expect(reader.querySelector("[data-target]")).toHaveTextContent("Remaining is dependence"));
    // a paragraph that cites John 15:5 twice is explained once; its section follows
    const note = await within(reader).findByText("Mentions John 15:5");
    expect(within(reader).getAllByText("Mentions John 15:5")).toHaveLength(1);
    expect(note.closest("[data-passage-note]")).toHaveTextContent("Within section on John 15:1–11");
    await user.click(within(sourcesPane()).getByRole("button", { name: "Back to Sources" }));
    expect(await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" })).toBeInTheDocument();
    // opening again lands in the same place
    await user.click(within(await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" })).getAllByRole("button")[1]!);
    const again = await within(sourcesPane()).findByRole("region", { name: "Vine Commentary" });
    await waitFor(() => expect(again.querySelector("[data-target]")).toHaveTextContent("Remaining is dependence"));
  });

  it("is usable in a narrow window", async () => {
    const { user } = await renderApp(withLibrary(COMMENTARY, NOTES), { width: 1100 });
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    expect(entryTitles(list)).toEqual(["Vine Commentary", "Personal Notes"]);
    // every entry is a real button, reachable by keyboard
    for (const button of within(list).getAllByRole("button")) expect(button).not.toHaveAttribute("tabindex", "-1");
  });

  it("lists a source in another language like any other, with the reason in the interface language", async () => {
    const { user } = await renderApp(withLibrary(KOREAN, GERMAN, NOTES));
    await readJohn15(user, 5);
    const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" });
    expect(entryTitles(list)).toEqual(["요한복음 묵상", "Johanneskommentar", "Personal Notes"]);
    expect(within(list).getByRole("group", { name: "요한복음 묵상" })).toHaveTextContent("Section on John 15:1–11");
    expect(within(list).getByRole("group", { name: "Johanneskommentar" })).toHaveTextContent("Mentions John 15:5");
  });

  it("keeps the same order when the interface language changes", async () => {
    const { user } = await renderApp(withLibrary(KOREAN, GERMAN, NOTES, SERMON, COMMENTARY));
    await readJohn15(user, 5);
    const english = entryTitles(await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:5" }));
    const pane = sourcesPane();
    await act(() => setLanguage("ko"));
    const korean = entryTitles(await within(pane).findByRole("list", { name: /관련 자료$/ }));
    await act(() => setLanguage("de"));
    const german = entryTitles(await within(pane).findByRole("list", { name: /^Quellen zu / }));
    expect(korean).toEqual(english);
    expect(german).toEqual(english);
    await act(() => setLanguage("ko"));
    expect(within(pane).getByRole("group", { name: "Sermon Manuscript" })).toHaveTextContent("15:1–8에 관한 부분");
  });
});
