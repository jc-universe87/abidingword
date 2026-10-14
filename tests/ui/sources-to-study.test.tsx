import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { createMemoryApi, type MemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// From Sources to Study (v0.15): what is read in a source is added to the open Study as a
// finding, with the source's words and where they are kept as its citation. All text is invented.
const SERMON: SourceFixture = {
  title: "The True Vine",
  author: "J. Example",
  format: "markdown",
  language: "English",
  segments: [
    { text: "Abide in me, and I in you.", sectionPath: "The Vine" },
    { text: "As the branch cannot bear fruit by itself, neither can you.", sectionPath: "The Vine" },
    { text: "By this my Father is glorified, that you bear much fruit.", sectionPath: "Fruit" },
  ],
};

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function setup({ studies = ["Abiding"], parts = ["Group questions", "Sunday notes"] }: { studies?: string[]; parts?: string[] } = {}) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  api.installFixtureSource(SERMON);
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const ids: string[] = [];
  for (const title of studies) {
    const made = await api.studyCreate({ projectId: project.id, title });
    for (const part of parts) await api.studySectionCreate({ studyId: made.study.id, title: part });
    ids.push(made.study.id);
  }
  return { api, studyIds: ids };
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const studyPane = () => screen.getByRole("main", { name: "Study" });

async function openStudy(user: User, title: string) {
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: new RegExp(title) }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
}

async function openSource(user: User) {
  await user.click(await within(sourcesPane()).findByRole("button", { name: /The True Vine/ }));
  const reader = await within(sourcesPane()).findByRole("region", { name: "The True Vine" });
  await within(reader).findByText(/Abide in me/);
  return reader;
}

const paragraph = (reader: HTMLElement, start: string) => [...reader.querySelectorAll<HTMLElement>("[data-segment-id]")].find((p) => p.textContent?.startsWith(start))!;

/** Selects `words` inside one paragraph, as a user would. */
async function select(element: HTMLElement, words: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[data-aw-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const node = walker.nextNode()!;
  const at = node.textContent!.indexOf(words);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + words.length);
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

const panel = () => screen.findByRole("region", { name: /^Add to Study/ });
const findingsOf = (api: MemoryApi, studyId: string) => api.state.findings.filter((f) => f.studyId === studyId);

afterEach(async () => {
  window.localStorage.clear();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("selected text → Study", () => {
  it("adds the selected words to the open Study as a quotation, with their source, and the Study shows it", async () => {
    const { api, studyIds } = await setup();
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const reader = await openSource(user);
    await select(paragraph(reader, "As the branch"), "bear fruit by itself");
    const strip = await within(reader).findByRole("group", { name: "Mark the selected text" });
    await user.click(within(strip).getByRole("button", { name: "Add to Study" }));

    const add = await panel();
    expect(within(add).getByRole("heading", { name: "Add to Study: Abiding" })).toBeInTheDocument();
    expect(within(add).getByText("bear fruit by itself")).toBeInTheDocument();
    expect(within(add).getByText(/— J\. Example, The True Vine, The Vine/)).toBeInTheDocument();
    expect(within(add).getByRole("radio", { name: "Quotation" })).toHaveAttribute("aria-checked", "true");
    expect(within(add).getByRole("combobox", { name: "In" })).toHaveValue("");
    await waitFor(() => expect(within(add).getByRole("textbox", { name: "Your note (optional)" })).toHaveFocus());
    // Nothing is created yet: highlighting or opening the panel never changes a Study.
    expect(findingsOf(api, studyIds[0]!)).toHaveLength(0);
    expect(api.state.library.annotations).toHaveLength(0);

    await user.click(within(add).getByRole("button", { name: "Add to Study" }));
    await waitFor(() => expect(findingsOf(api, studyIds[0]!)).toHaveLength(1));
    const finding = findingsOf(api, studyIds[0]!)[0]!;
    expect(finding).toMatchObject({ findingType: "quotation", content: "bear fruit by itself", sectionId: null });
    expect(finding.sources[0]).toMatchObject({ quote: "bear fruit by itself", title: "The True Vine", author: "J. Example", section: "The Vine" });
    // No highlight was made along the way.
    expect(api.state.library.annotations).toHaveLength(0);
    // Said politely, and the Study shows the new note without reopening.
    expect(await within(reader).findByTestId("reader-notice")).toHaveTextContent("Added to Abiding · Whole study.");
    await waitFor(() => expect(within(studyPane()).getAllByText("bear fruit by itself").length).toBeGreaterThan(0));
    // Focus comes back to the text the words were in.
    await waitFor(() => expect(paragraph(reader, "As the branch")).toHaveFocus());
  });

  it("starts as an observation once the person writes, and goes into the part last worked in", async () => {
    const { api, studyIds } = await setup();
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    // Working in "Sunday notes" makes it the part new things go into.
    const part = within(studyPane()).getByRole("heading", { level: 2, name: "Sunday notes" }).closest("section")!;
    await act(async () => {
      within(part).getAllByRole("button")[0]!.focus();
    });
    const reader = await openSource(user);
    await select(paragraph(reader, "Abide in me"), "Abide in me");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "Add to Study" }));
    const add = await panel();
    const parts = within(add).getByRole("combobox", { name: "In" });
    await waitFor(() => expect(parts).toHaveDisplayValue("Sunday notes"));
    await user.type(within(add).getByRole("textbox", { name: "Your note (optional)" }), "Remaining is receiving.");
    expect(within(add).getByRole("radio", { name: "Observation" })).toHaveAttribute("aria-checked", "true");
    // Another part, chosen in the panel.
    await user.selectOptions(parts, "Group questions");
    // Another kind, chosen with the arrow keys.
    within(add).getByRole("radio", { name: "Observation" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(add).getByRole("radio", { name: "Interpretation" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(findingsOf(api, studyIds[0]!)).toHaveLength(1));
    const finding = findingsOf(api, studyIds[0]!)[0]!;
    const observations = api.state.sections.find((s) => s.studyId === studyIds[0] && s.title === "Group questions")!;
    expect(finding).toMatchObject({ findingType: "interpretation", content: "Remaining is receiving.", sectionId: observations.id });
    // What the person wrote and what the source said are kept apart.
    expect(finding.sources[0]!.quote).toBe("Abide in me");
  });

  it("adds nothing on Cancel or Escape", async () => {
    const { api, studyIds } = await setup();
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const reader = await openSource(user);
    await select(paragraph(reader, "Abide in me"), "Abide");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "Add to Study" }));
    await user.click(within(await panel()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /^Add to Study/ })).toBeNull());
    await select(paragraph(reader, "Abide in me"), "Abide");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "Add to Study" }));
    await panel();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: /^Add to Study/ })).toBeNull());
    await waitFor(() => expect(paragraph(reader, "Abide in me")).toHaveFocus());
    expect(findingsOf(api, studyIds[0]!)).toHaveLength(0);
  });

  it("keeps the keyboard in the note after Add to Study from the selection strip, and Escape closes only the panel", async () => {
    const { api, studyIds } = await setup();
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const reader = await openSource(user);
    await select(paragraph(reader, "Abide in me"), "Abide");
    within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "Add to Study" }).focus();
    await user.keyboard("{Enter}");
    const form = await panel();
    const note = within(form).getByRole("textbox", { name: "Your note (optional)" });
    await waitFor(() => expect(note).toHaveFocus());
    // Focus is not taken back by the strip as it closes.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(note).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: /^Add to Study/ })).toBeNull());
    expect(within(sourcesPane()).getByRole("region", { name: "The True Vine" })).toBeInTheDocument();
    expect(findingsOf(api, studyIds[0]!)).toHaveLength(0);
  });

  it("asks which Study when none is open, and says so plainly when there is none", async () => {
    const { api, studyIds } = await setup({ studies: ["Abiding", "Fruitfulness"] });
    const { user } = await renderApp(api);
    const reader = await openSource(user);
    await select(paragraph(reader, "By this"), "much fruit");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "Add to Study" }));
    const add = await panel();
    expect(within(add).getByRole("heading", { name: "Add to Study" })).toBeInTheDocument();
    const which = await within(add).findByRole("combobox", { name: "Study" });
    await user.selectOptions(which, "Fruitfulness");
    await waitFor(() => expect(within(add).getByRole("combobox", { name: "In" })).toBeInTheDocument());
    await user.click(within(add).getByRole("button", { name: "Add to Study" }));
    await waitFor(() => expect(findingsOf(api, studyIds[1]!)).toHaveLength(1));
    expect(findingsOf(api, studyIds[0]!)).toHaveLength(0);
  });

  it("offers no way to add when there is no Study at all", async () => {
    const { api } = await setup({ studies: [] });
    const { user } = await renderApp(api);
    const reader = await openSource(user);
    await select(paragraph(reader, "By this"), "much fruit");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "Add to Study" }));
    const add = await panel();
    expect(await within(add).findByText(/There is no study yet/)).toBeInTheDocument();
    expect(within(add).queryByRole("button", { name: "Add to Study" })).toBeNull();
    await user.click(within(add).getByRole("button", { name: "Cancel" }));
    expect(api.state.findings).toHaveLength(0);
  });
});

describe("source marks → Study", () => {
  async function marked() {
    const { api, studyIds } = await setup();
    const seg = (start: string) => api.state.library.segments.find((x) => x.text.startsWith(start))!;
    const branch = seg("As the branch");
    const at = branch.text.indexOf("cannot bear fruit");
    const highlight = await api.sourceAnnotationCreate({ sourceId: branch.sourceId, kind: "highlight", color: "green", start: { segmentId: branch.id, offset: at }, end: { segmentId: branch.id, offset: at + 17 }, quote: "cannot bear fruit" });
    const abide = seg("Abide");
    const note = await api.sourceAnnotationCreate({ sourceId: abide.sourceId, kind: "note", content: "Remain, do not strive.", start: { segmentId: abide.id, offset: 0 }, end: { segmentId: abide.id, offset: 11 }, quote: "Abide in me" });
    const fruit = seg("By this");
    const placeNote = await api.sourceAnnotationCreate({ sourceId: fruit.sourceId, kind: "note", content: "Glory is the goal.", place: { segmentId: fruit.id } });
    await api.sourceAnnotationCreate({ sourceId: fruit.sourceId, kind: "bookmark", place: { segmentId: abide.id } });
    return { api, studyIds, highlight, note, placeNote };
  }

  it("adds a highlight from its paragraph's marks, leaves the mark as it was, and gives focus back", async () => {
    const { api, studyIds, highlight } = await marked();
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const reader = await openSource(user);
    await user.click(within(paragraph(reader, "As the branch")).getByRole("button", { name: "1 mark here: Highlight" }));
    const marks = await within(reader).findByRole("region", { name: "Marks here" });
    const add = within(marks).getByRole("button", { name: "Add to Study" });
    await user.click(add);
    const form = await panel();
    expect(within(form).getByText("cannot bear fruit")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Add to Study" }));
    await waitFor(() => expect(findingsOf(api, studyIds[0]!)).toHaveLength(1));
    const finding = findingsOf(api, studyIds[0]!)[0]!;
    expect(finding.sources[0]).toMatchObject({ quote: "cannot bear fruit", annotationId: highlight.id });
    expect(api.state.library.annotations.find((a) => a.id === highlight.id)).toMatchObject({ kind: "highlight", color: "green", deleted: false });
    await waitFor(() => expect(add).toHaveFocus());
  });

  it("starts a note on words from the note, with the words as the quote", async () => {
    const { api, studyIds, note } = await marked();
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const reader = await openSource(user);
    await user.click(within(paragraph(reader, "Abide")).getByRole("button", { name: /marks? here/ }));
    const marks = await within(reader).findByRole("region", { name: "Marks here" });
    await user.click(within(marks).getAllByRole("button", { name: "Add to Study" })[0]!);
    const form = await panel();
    expect(within(form).getByRole("textbox", { name: "Your note (optional)" })).toHaveValue("Remain, do not strive.");
    expect(within(form).getByRole("radio", { name: "Observation" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(form).getByRole("button", { name: "Add to Study" }));
    await waitFor(() => expect(findingsOf(api, studyIds[0]!)).toHaveLength(1));
    expect(findingsOf(api, studyIds[0]!)[0]).toMatchObject({ findingType: "observation", content: "Remain, do not strive." });
    expect(findingsOf(api, studyIds[0]!)[0]!.sources[0]).toMatchObject({ quote: "Abide in me", annotationId: note.id });
  });

  it("adds a note on a place from the reader's Marks list, with its place and no quote", async () => {
    const { api, studyIds, placeNote } = await marked();
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const reader = await openSource(user);
    await user.click(within(reader).getByRole("button", { name: "Marks" }));
    const list = await screen.findByRole("region", { name: "Marks in The True Vine" });
    const row = within(list).getByText("Glory is the goal.").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "More actions" }));
    await user.click(within(row).getByRole("menuitem", { name: "Add to Study" }));
    const form = await panel();
    expect(within(form).getByRole("textbox", { name: "Your note (optional)" })).toHaveValue("Glory is the goal.");
    // A place has no words: the note is what is added, so it may not be emptied.
    await user.clear(within(form).getByRole("textbox", { name: "Your note (optional)" }));
    expect(within(form).getByRole("button", { name: "Add to Study" })).toBeDisabled();
    await user.type(within(form).getByRole("textbox", { name: "Your note (optional)" }), "Why glory?");
    await user.click(within(form).getByRole("button", { name: "Add to Study" }));
    await waitFor(() => expect(findingsOf(api, studyIds[0]!)).toHaveLength(1));
    expect(findingsOf(api, studyIds[0]!)[0]!.sources[0]).toMatchObject({ quote: null, annotationId: placeNote.id, section: "Fruit" });
  });

  it("never offers a bookmark to a Study", async () => {
    const { api } = await marked();
    const { user } = await renderApp(api);
    const reader = await openSource(user);
    await user.click(within(paragraph(reader, "Abide")).getByRole("button", { name: /marks? here/ }));
    const marks = await within(reader).findByRole("region", { name: "Marks here" });
    // Two marks there (a note and a bookmark): one Add to Study, for the note.
    expect(within(marks).getAllByRole("button", { name: "Add to Study" })).toHaveLength(1);
  });

  it("works from the keyboard alone: marker, Add to Study, the note, Ctrl+Enter", async () => {
    const { api, studyIds } = await marked();
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const reader = await openSource(user);
    within(paragraph(reader, "As the branch")).getByRole("button", { name: "1 mark here: Highlight" }).focus();
    await user.keyboard("{Enter}");
    const marks = await within(reader).findByRole("region", { name: "Marks here" });
    within(marks).getByRole("button", { name: "Add to Study" }).focus();
    await user.keyboard("{Enter}");
    const form = await panel();
    await waitFor(() => expect(within(form).getByRole("textbox", { name: "Your note (optional)" })).toHaveFocus());
    await user.keyboard("Fruit needs the vine.{Control>}{Enter}{/Control}");
    await waitFor(() => expect(findingsOf(api, studyIds[0]!)).toHaveLength(1));
    expect(findingsOf(api, studyIds[0]!)[0]).toMatchObject({ content: "Fruit needs the vine.", findingType: "observation" });
  });
});

describe("copying a quotation with its citation", () => {
  it("copies selected words as “…” — Author, Title, place", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const reader = await openSource(user);
    await select(paragraph(reader, "By this"), "that you bear much fruit");
    const strip = await within(reader).findByRole("group", { name: "Mark the selected text" });
    await user.click(within(strip).getByRole("button", { name: "More actions" }));
    await user.click(within(strip).getByRole("menuitem", { name: "Copy quotation with citation" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("“that you bear much fruit”\n— J. Example, The True Vine, Fruit"));
    expect(await within(reader).findByTestId("reader-notice")).toHaveTextContent("Quotation copied with its citation.");
  });

  it("uses the interface language's quotation marks and leaves out what is not known", async () => {
    const { api } = await setup();
    api.installFixtureSource({ title: "Anonyme Predigt", format: "pdf", language: "Deutsch", segments: [{ text: "Bleibt in mir.", pageNumber: 42 }] });
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    const segment = api.state.library.segments.find((x) => x.text === "Bleibt in mir.")!;
    await api.sourceAnnotationCreate({ sourceId: segment.sourceId, kind: "highlight", color: "amber", start: { segmentId: segment.id, offset: 0 }, end: { segmentId: segment.id, offset: 13 }, quote: "Bleibt in mir" });
    const { user } = await renderApp(api);
    await user.click(await within(screen.getByRole("complementary", { name: "Quellen" })).findByRole("button", { name: /Anonyme Predigt/ }));
    const reader = await within(screen.getByRole("complementary", { name: "Quellen" })).findByRole("region", { name: "Anonyme Predigt" });
    await user.click(await within(reader).findByRole("button", { name: "1 Anmerkung hier: Markierung" }));
    const marks = await within(reader).findByRole("region", { name: "Anmerkungen hier" });
    await user.click(within(marks).getByRole("button", { name: "Weitere Aktionen" }));
    await user.click(within(marks).getByRole("menuitem", { name: "Zitat mit Quellenangabe kopieren" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("„Bleibt in mir“\n— Anonyme Predigt, S. 42"));
  });
});

describe("a source-backed finding in the Study", () => {
  /** A study with one finding from selected words, made through the same call the panel uses. */
  async function withFinding(content: string, findingType = "observation") {
    const { api, studyIds } = await setup();
    const branch = api.state.library.segments.find((x) => x.text.startsWith("As the branch"))!;
    const at = branch.text.indexOf("bear fruit by itself");
    const finding = await api.findingCreateFromSource({
      studyId: studyIds[0]!,
      findingType,
      content,
      sourceId: branch.sourceId,
      start: { segmentId: branch.id, offset: at },
      end: { segmentId: branch.id, offset: at + "bear fruit by itself".length },
      quote: "bear fruit by itself",
    });
    return { api, studyIds, finding, branch };
  }

  it("shows the person's text first, the source's words quietly, and the citation; it opens the source at the words", async () => {
    const { api, branch } = await withFinding("Fruit needs the vine.");
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const study = studyPane();
    expect(within(study).getByDisplayValue("Fruit needs the vine.")).toBeInTheDocument();
    const quote = within(study).getByLabelText("Quoted from the source");
    expect(quote).toHaveTextContent("“bear fruit by itself”");
    const citation = within(study).getByRole("button", { name: "J. Example, The True Vine, The Vine" });
    await user.click(citation);
    // Beside the Study, at the paragraph, with the cited words marked.
    const reader = await within(sourcesPane()).findByRole("region", { name: "The True Vine" });
    const marked = await waitFor(() => {
      const found = reader.querySelector("[data-quoted]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(marked).toHaveTextContent("bear fruit by itself");
    expect(marked.closest("[data-segment-id]")).toHaveAttribute("data-segment-id", branch.id);
    // The Study is still there.
    expect(within(studyPane()).getByDisplayValue("Fruit needs the vine.")).toBeInTheDocument();
  });

  it("shows a quotation's words once when they are the finding's own text", async () => {
    const { api } = await withFinding("", "quotation");
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    expect(within(studyPane()).getByDisplayValue("bear fruit by itself")).toBeInTheDocument();
    expect(within(studyPane()).queryByLabelText("Quoted from the source")).toBeNull();
  });

  it("keeps the finding, its quote and citation when the source is removed, and offers no way to open it", async () => {
    const { api, branch } = await withFinding("Fruit needs the vine.");
    await api.libraryRemoveSource(branch.sourceId);
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const study = studyPane();
    expect(within(study).getByDisplayValue("Fruit needs the vine.")).toBeInTheDocument();
    expect(within(study).getByLabelText("Quoted from the source")).toHaveTextContent("bear fruit by itself");
    expect(within(study).getByText(/J\. Example, The True Vine, The Vine/)).toBeInTheDocument();
    expect(within(study).getByText("(removed from library)")).toBeInTheDocument();
    expect(within(study).queryByRole("button", { name: "J. Example, The True Vine, The Vine" })).toBeNull();
    // Copying still works from what was kept.
    await user.click(within(study).getByRole("button", { name: "Copy quotation with citation" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("“bear fruit by itself”\n— J. Example, The True Vine, The Vine"));
  });

  it("does not disturb a note being written in the Study when a finding arrives from a source", async () => {
    const { api } = await withFinding("An earlier note.");
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const field = within(studyPane()).getByDisplayValue("An earlier note.");
    await user.clear(field);
    await user.type(field, "Half-written thought");
    const reader = await openSource(user);
    await select(paragraph(reader, "Abide in me"), "Abide in me");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "Add to Study" }));
    await user.click(within(await panel()).getByRole("button", { name: "Add to Study" }));
    await waitFor(() => expect(within(studyPane()).getByDisplayValue("Abide in me")).toBeInTheDocument());
    expect(within(studyPane()).getByDisplayValue("Half-written thought")).toBeInTheDocument();
  });
});

describe("source marks in the Marks view", () => {
  it("offers Add to Study, Copy and Open on a source mark, and nothing new on Bible marks", async () => {
    const { api, studyIds } = await setup();
    const branch = api.state.library.segments.find((x) => x.text.startsWith("As the branch"))!;
    await api.sourceAnnotationCreate({ sourceId: branch.sourceId, kind: "highlight", color: "blue", start: { segmentId: branch.id, offset: 0 }, end: { segmentId: branch.id, offset: 13 }, quote: "As the branch" });
    await api.annotationCreate({ reference: "PSA.23.1", kind: "bookmark" });
    const { user } = await renderApp(api);
    await openStudy(user, "Abiding");
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    await user.click(within(scripture).getByRole("button", { name: "Marks" }));
    await within(scripture).findByRole("heading", { level: 3, name: "In your sources" });
    // Bible marks have no menu.
    const bible = within(scripture).getByRole("heading", { level: 3, name: "In the Bible" }).parentElement!;
    expect(within(bible).queryByRole("button", { name: "More actions" })).toBeNull();
    const card = within(scripture).getByRole("button", { name: /The True Vine.*Highlight/ });
    const row = card.closest("li")!;
    await user.click(within(row).getByRole("button", { name: "More actions" }));
    expect(within(row).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Add to Study", "Copy quotation with citation", "Open source"]);
    await user.click(within(row).getByRole("menuitem", { name: "Copy quotation with citation" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("“As the branch”\n— J. Example, The True Vine, The Vine"));
    await user.click(within(row).getByRole("button", { name: "More actions" }));
    await user.click(within(row).getByRole("menuitem", { name: "Add to Study" }));
    const form = await within(row).findByRole("region", { name: "Add to Study: Abiding" });
    await user.click(within(form).getByRole("button", { name: "Add to Study" }));
    await waitFor(() => expect(findingsOf(api, studyIds[0]!)).toHaveLength(1));
    expect(await within(scripture).findByText("Added to Abiding · Whole study.")).toBeInTheDocument();
    await waitFor(() => expect(within(row).getByRole("button", { name: "More actions" })).toHaveFocus());
  });
});
