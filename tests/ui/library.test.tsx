import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// All library text here is invented for the tests.
const VINE_NOTES: SourceFixture = {
  title: "Notes on the Vine",
  author: "J. Example",
  format: "pdf",
  language: "English",
  segments: [
    { text: "An opening paragraph about gardens.", pageNumber: 1 },
    { text: "Abiding is the heart of John 15:4 and of fruitfulness.", pageNumber: 2 },
    { text: "Pruning is painful but good.", pageNumber: 3 },
  ],
  mentions: [{ segment: 1, reference: "JHN.15.4", matchedText: "John 15:4" }],
};

const GERMAN_ESSAY: SourceFixture = {
  title: "Ein Aufsatz",
  format: "markdown",
  sourceType: "article",
  language: "Deutsch",
  segments: [{ text: "Bleibt in mir.", sectionPath: "Einleitung" }],
};

function withLibrary(...fixtures: SourceFixture[]) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  for (const fixture of fixtures) api.installFixtureSource(fixture);
  return api;
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });

async function openLibrary(user: Awaited<ReturnType<typeof renderApp>>["user"]) {
  await user.click(await within(sourcesPane()).findByRole("button", { name: "Open library" }));
  return screen.findByRole("heading", { level: 1, name: "Library" });
}

async function chooseFile(user: Awaited<ReturnType<typeof renderApp>>["user"], api: ReturnType<typeof createMemoryApi>, path: string) {
  api.state.library.nextChosenFile = path;
  await user.click(await screen.findByRole("button", { name: "Choose a file…" }));
}

describe("Library", () => {
  it("adds a PDF: preview, edit, confirm, then it is in the Library and opens", async () => {
    const api = withLibrary();
    const { user } = await renderApp(api);
    await user.click(await within(sourcesPane()).findByRole("button", { name: "Add to library…" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Add to library" })).toBeInTheDocument();

    await chooseFile(user, api, "/home/test/Grace-and-Fruit.pdf");
    expect(await screen.findByText("PDF · 3 pages")).toBeInTheDocument();
    expect(screen.getByText("Text extracted successfully")).toBeInTheDocument();
    expect(screen.getByText("1 Bible reference detected")).toBeInTheDocument();
    const title = screen.getByLabelText("Title");
    expect(title).toHaveValue("Grace and Fruit");
    await user.clear(title);
    await user.type(title, "Grace and Fruitfulness");
    expect(screen.getByLabelText("Sharing")).toHaveDisplayValue("My own copy — not to be shared");
    await user.click(screen.getByRole("button", { name: "Add to library" }));

    // Adding opens the new source in the reader…
    expect(await screen.findByRole("heading", { level: 1, name: "Grace and Fruitfulness" })).toBeInTheDocument();
    expect(screen.getByText(/Book · PDF · 3 pages · English/)).toBeInTheDocument();
    expect(screen.getByText("p. 2")).toBeInTheDocument();
    expect(api.state.library.sources[0]?.licenceStatus).toBe("private");

    // …and Back leads to the Library, where it is listed.
    await user.click(screen.getByRole("button", { name: "Back" }));
    const list = await screen.findByRole("list", { name: "Sources" });
    expect(within(list).getByRole("button", { name: /^Grace and Fruitfulness/ })).toBeInTheDocument();
  });

  it("previews an EPUB with its chapters and a Markdown file", async () => {
    const api = withLibrary();
    const { user } = await renderApp(api);
    await user.click(await within(sourcesPane()).findByRole("button", { name: "Add to library…" }));
    await chooseFile(user, api, "/home/test/The-Vine.epub");
    expect(await screen.findByText("EPUB · 2 chapters")).toBeInTheDocument();
    expect(screen.getByLabelText("Kind")).toHaveDisplayValue("Book");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.state.library.pending).toBeNull();

    await user.click(await within(sourcesPane()).findByRole("button", { name: "Add to library…" }));
    await chooseFile(user, api, "/home/test/sermon-notes.md");
    expect(await screen.findByText("Markdown · 1 section")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to library" }));
    expect(await screen.findByRole("heading", { level: 1, name: "sermon notes" })).toBeInTheDocument();
    // Markdown and EPUB show section headings, not pages.
    expect(screen.getByText("Chapter 1")).toBeInTheDocument();
    expect(screen.queryByText(/^p\. /)).not.toBeInTheDocument();
  });

  it("explains a scanned PDF and does not add it", async () => {
    const api = withLibrary();
    const { user } = await renderApp(api);
    await user.click(await within(sourcesPane()).findByRole("button", { name: "Add to library…" }));
    await chooseFile(user, api, "/home/test/scanned-commentary.pdf");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This PDF appears to contain scanned pages. OCR support is not available yet, so its text cannot be added.",
    );
    expect(screen.getByRole("button", { name: "Add to library" })).toBeDisabled();
  });

  it("refuses an unsupported file with a plain message", async () => {
    const api = withLibrary();
    const { user } = await renderApp(api);
    await user.click(await within(sourcesPane()).findByRole("button", { name: "Add to library…" }));
    await chooseFile(user, api, "/home/test/letter.rtf");
    expect(await screen.findByRole("alert")).toHaveTextContent("can’t be added to the library");
  });

  it("warns about a duplicate and adds it only when asked", async () => {
    const api = withLibrary({ ...VINE_NOTES, title: "Grace and Fruit" });
    const { user } = await renderApp(api);
    await user.click(await within(sourcesPane()).findByRole("button", { name: "Add to library…" }));
    await chooseFile(user, api, "/home/test/Grace-and-Fruit.pdf");
    expect(await screen.findByText(/already in your library as/)).toHaveTextContent("Grace and Fruit");
    const add = screen.getByRole("button", { name: "Add to library" });
    expect(add).toBeDisabled();
    await user.click(screen.getByLabelText("Add a second copy anyway"));
    await user.click(add);
    await waitFor(() => expect(api.state.library.sources).toHaveLength(2));
  });

  it("filters sources by type and language", async () => {
    const api = withLibrary(VINE_NOTES, GERMAN_ESSAY);
    const { user } = await renderApp(api);
    await openLibrary(user);
    // The list is redrawn after each filter change, so look it up each time.
    const titles = async () =>
      within(await screen.findByRole("list", { name: "Sources" }))
        .getAllByRole("listitem")
        .map((item) => within(item).getAllByRole("button")[0]?.querySelector("span")?.textContent);
    await waitFor(async () => expect(await titles()).toHaveLength(2));

    const filters = screen.getByRole("group", { name: "Filter sources" });
    await user.selectOptions(within(filters).getByLabelText("Language"), "Deutsch");
    await waitFor(async () => expect(await titles()).toEqual(["Ein Aufsatz"]));

    await user.selectOptions(within(filters).getByLabelText("Language"), "");
    await user.selectOptions(within(filters).getByLabelText("Type"), "book");
    await waitFor(async () => expect(await titles()).toEqual(["Notes on the Vine"]));
  });

  it("searches the library from the app bar and opens the exact place", async () => {
    const api = withLibrary(VINE_NOTES);
    const { user } = await renderApp(api);
    await user.selectOptions(screen.getByLabelText("Search in"), "library");
    await user.type(screen.getByLabelText("Search the library"), "fruitfulness{Enter}");

    const results = await screen.findByRole("list", { name: "Library search results" });
    const hit = within(results).getByRole("button", { name: /Notes on the Vine/ });
    // Provenance: author, title and page.
    expect(hit).toHaveTextContent("J. Example, Notes on the Vine · p. 2");
    expect(within(hit).getByText("fruitfulness", { selector: "mark" })).toBeInTheDocument();

    await user.click(hit);
    expect(await screen.findByRole("heading", { level: 1, name: "Notes on the Vine" })).toBeInTheDocument();
    const target = await waitFor(() => {
      const found = document.querySelector("[data-target]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(target).toHaveTextContent("Abiding is the heart of John 15:4");
    expect(target).toHaveFocus();

    // Back returns to the results, still showing the search.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("list", { name: "Library search results" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search the library", { selector: "input:not([type=search])" })).toHaveValue("fruitfulness");
  });

  it("shows the sources for the passage being read, with why, and opens them there", async () => {
    const api = withLibrary(VINE_NOTES);
    const { user } = await renderApp(api);
    expect(await within(sourcesPane()).findByText("No source in your library is linked to this passage.")).toBeInTheDocument();

    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    await user.type(within(scripture).getByLabelText("Go to passage"), "John 15{Enter}");
    const found = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15" });
    const item = within(found).getByRole("button", { name: /Notes on the Vine/ });
    // Who wrote it, where, and why it is here: a plain reason, not "John 15:4" in quotation marks.
    expect(item).toHaveTextContent("J. Example · p. 2Mentions John 15:4");

    // A verse in the same chapter, but not the mentioned one: nothing is offered for sharing a chapter.
    await user.click(await within(scripture).findByRole("button", { name: /^Verse 2\. Show verse tools/ }));
    expect(await within(sourcesPane()).findByText("No source in your library is linked to this passage.")).toBeInTheDocument();
    expect(within(sourcesPane()).queryByRole("list", { name: /^Elsewhere in/ })).not.toBeInTheDocument();
    expect(within(sourcesPane()).queryByRole("list", { name: "Sources for John 15:2" })).not.toBeInTheDocument();

    await user.click(within(scripture).getByRole("button", { name: /^Verse 4\. Show verse tools/ }));
    const verse = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:4" });
    expect(within(sourcesPane()).queryByRole("list", { name: /^Elsewhere in/ })).not.toBeInTheDocument();
    await user.click(within(verse).getByRole("button", { name: /Notes on the Vine/ }));

    // The source opens inside the Sources pane; the workspace stays.
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    expect(within(reader).getByRole("heading", { level: 2, name: "Notes on the Vine" })).toBeInTheDocument();
    expect(within(reader).getByText("p. 2")).toBeInTheDocument();
    await waitFor(() => expect(reader.querySelector("[data-target]")).toHaveTextContent("John 15:4"));
    expect(reader.querySelector("[data-target]")).toHaveFocus();
    // ... and the place says why it was linked
    expect(await within(reader).findByText("Mentions John 15:4")).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Study" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Scripture" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Notes on the Vine" })).not.toBeInTheDocument();

    // Back returns to the overview for the same passage.
    await user.click(within(reader).getByRole("button", { name: "Back to Sources" }));
    expect(await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:4" })).toBeInTheDocument();
    expect(within(sourcesPane()).queryByRole("region", { name: "Notes on the Vine" })).not.toBeInTheDocument();
    expect(within(sourcesPane()).getByRole("heading", { name: "Sources for John 15:4" })).toHaveFocus();
  });

  it("opens a recently added source in the pane, and in the full reader on request", async () => {
    const api = withLibrary(VINE_NOTES);
    const { user } = await renderApp(api);
    await user.click(await within(sourcesPane()).findByRole("button", { name: /^Notes on the Vine/ }));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    // Opened without a place: the title takes focus, the text starts at the top.
    expect(within(reader).getByRole("heading", { level: 2, name: "Notes on the Vine" })).toHaveFocus();
    expect(within(reader).getByText("An opening paragraph about gardens.")).toBeInTheDocument();

    await user.click(within(reader).getByRole("button", { name: "Open full reader" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Notes on the Vine" })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Study" })).not.toBeInTheDocument();

    // Back from the full reader restores the workspace, with the source still
    // open in the Sources pane.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("main", { name: "Study" })).toBeInTheDocument();
    expect(await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" })).toBeInTheDocument();
  });

  it("closes the pane reader when its source is removed from the library", async () => {
    const api = withLibrary(VINE_NOTES);
    const { user } = await renderApp(api);
    await user.click(await within(sourcesPane()).findByRole("button", { name: /^Notes on the Vine/ }));
    await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });

    await user.selectOptions(screen.getByLabelText("Search in"), "library");
    await user.type(screen.getByLabelText("Search the library"), "pruning{Enter}");
    await user.click(await screen.findByRole("button", { name: "Remove Notes on the Vine" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove from library" }));
    await screen.findByText(/Nothing in your library yet/);
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    expect(await within(sourcesPane()).findByText(/No sources yet/)).toBeInTheDocument();
  });
});

describe("finding citations", () => {
  async function inStudyWithFinding(findingType: "observation" | "quotation", content = "", width = 1440) {
    const api = withLibrary(VINE_NOTES);
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Series" });
    const study = await api.studyCreate({ projectId: project.id, title: "The True Vine" });
    await api.findingCreate({ studyId: study.study.id, findingType, content });
    const { user } = await renderApp(api, { width });
    await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /The True Vine/ }));
    const findings = await screen.findByRole("list", { name: "Other notes" });
    return { api, user, findings };
  }

  async function cite(user: Awaited<ReturnType<typeof renderApp>>["user"], findings: HTMLElement, query: string) {
    const details = within(findings).queryByRole("button", { name: /^Details for/, expanded: false });
    if (details) await user.click(details);
    await user.click(within(findings).getByRole("button", { name: "+ Add source" }));
    await user.type(screen.getByLabelText("Search your library for the passage to cite"), `${query}{Enter}`);
    const choices = await screen.findByRole("list", { name: "Passages to cite" });
    return choices;
  }

  it("cites a library passage in a finding and opens it from there", async () => {
    const { api, user, findings } = await inStudyWithFinding("observation", "Abiding comes before fruit.");
    const choices = await cite(user, findings, "abiding");
    await user.click(within(choices).getByRole("button", { name: /Cite J\. Example, Notes on the Vine, p\. 2/ }));

    const chip = await within(findings).findByRole("button", { name: "J. Example, Notes on the Vine, p. 2" });
    expect(api.state.findings[0]?.sources).toHaveLength(1);
    // Citing never changes the finding's own text.
    expect(api.state.findings[0]?.content).toBe("Abiding comes before fruit.");

    // The citation opens the source beside the study, at the cited paragraph.
    await user.click(chip);
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    await waitFor(() => expect(reader.querySelector("[data-target]")).toHaveTextContent("Abiding is the heart"));
    expect(within(findings).getByRole("textbox", { name: "Observation text" })).toHaveValue("Abiding comes before fruit.");

    // Back to Sources: the study is as it was and focus returns to the citation.
    await user.click(within(reader).getByRole("button", { name: "Back to Sources" }));
    await waitFor(() => expect(within(findings).getByRole("button", { name: "J. Example, Notes on the Vine, p. 2" })).toHaveFocus());
    await user.click(within(findings).getByRole("button", { name: "Remove citation J. Example, Notes on the Vine, p. 2" }));
    await waitFor(() => expect(api.state.findings[0]?.sources).toHaveLength(0));
  });

  it("on a narrow window with Sources hidden, opens a citation in the full reader", async () => {
    const { user, findings } = await inStudyWithFinding("observation", "Remain.", 864);
    expect(screen.queryByRole("complementary", { name: "Sources" })).not.toBeInTheDocument();
    const choices = await cite(user, findings, "abiding");
    await user.click(within(choices).getAllByRole("button")[0]!);
    await user.click(await within(findings).findByRole("button", { name: "J. Example, Notes on the Vine, p. 2" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Notes on the Vine" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("[data-target]")).toHaveTextContent("Abiding is the heart"));
    // The layout choice is left alone: Sources stays hidden.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("list", { name: "Other notes" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Sources" })).not.toBeInTheDocument();
  });

  it("uses the cited text as a quotation only when asked", async () => {
    const { api, user, findings } = await inStudyWithFinding("quotation");
    const choices = await cite(user, findings, "pruning");
    expect(screen.getByLabelText("Also use the cited passage as this quotation’s text")).not.toBeChecked();
    await user.click(screen.getByLabelText("Also use the cited passage as this quotation’s text"));
    await user.click(within(choices).getByRole("button", { name: /Cite .* p\. 3/ }));
    await waitFor(() => expect(api.state.findings[0]?.content).toBe("Pruning is painful but good."));
    expect(within(findings).getByRole("textbox", { name: "Quotation text" })).toHaveValue("Pruning is painful but good.");
  });

  it("removes a source after confirmation and keeps the citation as a record", async () => {
    const { api, user, findings } = await inStudyWithFinding("observation", "Remain.");
    const studyId = api.state.studies[0]!.id;
    const choices = await cite(user, findings, "abiding");
    await user.click(within(choices).getAllByRole("button")[0]!);
    await within(findings).findByRole("button", { name: "J. Example, Notes on the Vine, p. 2" });

    await openLibrary(user);
    await user.click(await screen.findByRole("button", { name: "Remove Notes on the Vine" }));
    const confirm = screen.getByRole("alertdialog", { name: "Remove Notes on the Vine?" });
    expect(confirm).toHaveTextContent("Study notes that cite it keep a record of the citation.");
    expect(confirm).toHaveTextContent("your original file is not touched");
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(api.state.library.sources[0]?.deleted).toBe(false);

    await user.click(screen.getByRole("button", { name: "Remove Notes on the Vine" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove from library" }));
    expect(await screen.findByText(/Nothing in your library yet/)).toBeInTheDocument();

    // The finding still says what it cited, marked as removed, not as a link.
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    const after = await screen.findByRole("list", { name: "Other notes" });
    expect(await within(after).findByText("(removed from library)")).toBeInTheDocument();
    expect(within(after).queryByRole("button", { name: "J. Example, Notes on the Vine, p. 2" })).not.toBeInTheDocument();
    expect(api.state.findings.find((f) => f.studyId === studyId)?.sources[0]).toMatchObject({ removed: true, segmentId: null });
  });
});
