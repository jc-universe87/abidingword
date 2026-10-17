import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Study workspace refinement (v0.10). All text is invented.

beforeEach(() => window.localStorage.clear());

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function withStudy(study: { title: string; primaryPassage?: string; studyType?: "passage" | "word" | "teaching" | "topical" | "custom"; templateId?: string; status?: "active" | "archived" }) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Sermon Series" });
  const detail = await api.studyCreate({ projectId: project.id, ...study });
  if (study.status) await api.studyUpdate({ id: detail.study.id, status: study.status });
  return { api, project, studyId: detail.study.id };
}

async function open(user: User, title: RegExp) {
  await user.click(await screen.findByRole("button", { name: title }));
  return screen.findByRole("textbox", { name: "Study title" });
}

const header = () => document.getElementById("study-overview") as HTMLElement;

describe("the study header", () => {
  it("shows the passage once when the title is the passage", async () => {
    const { api } = await withStudy({ title: "John 15:1–11", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /John 15:1–11/);
    const passages = within(header()).getByRole("region", { name: "Passages" });
    expect(within(passages).queryByRole("button", { name: "John 15:1–11" })).not.toBeInTheDocument();
    expect(within(passages).getByRole("button", { name: "Open in Scripture" })).toBeInTheDocument();
    expect(within(passages).getByRole("button", { name: "Related passage" })).toBeInTheDocument();
  });

  it("treats a dash, spacing or case difference as the same", async () => {
    const { api } = await withStudy({ title: "john 15:1-11", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /john 15:1-11/i);
    expect(within(header()).queryByRole("button", { name: "John 15:1–11" })).not.toBeInTheDocument();
  });

  it("shows the passage beneath a title that differs from it", async () => {
    const { api } = await withStudy({ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    expect(within(header()).getByRole("button", { name: "John 15:1–11" })).toBeInTheDocument();
    expect(within(header()).queryByRole("button", { name: "Open in Scripture" })).not.toBeInTheDocument();
  });

  it("does not depend on what Scripture happens to show", async () => {
    for (const shown of ["JHN.15", "PSA.23"]) {
      const { api } = await withStudy({ title: "John 15:1–11", primaryPassage: "JHN.15.1-JHN.15.11" });
      api.state.settings.scripturePassage = shown;
      const { user } = await renderApp(api);
      await open(user, /John 15:1–11/);
      expect(within(header()).queryByRole("button", { name: "John 15:1–11" })).not.toBeInTheDocument();
      expect(within(header()).getByRole("button", { name: "Open in Scripture" })).toBeInTheDocument();
      document.body.innerHTML = "";
    }
  });

  it("follows the title when it is edited", async () => {
    const { api } = await withStudy({ title: "John 15:1–11", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    const title = await open(user, /John 15:1–11/);
    await user.clear(title);
    await user.type(title, "The True Vine");
    await user.tab();
    expect(await within(header()).findByRole("button", { name: "John 15:1–11" })).toBeInTheDocument();
  });

  it("does not show the kind of study in the header, only in Study details", async () => {
    const { api } = await withStudy({ title: "Righteousness", studyType: "word" });
    const { user } = await renderApp(api);
    await open(user, /Righteousness/);
    expect(within(header()).queryByText("Word Study")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Study details" }));
    expect(within(screen.getByRole("region", { name: "Study details" })).getByText(/Type: Word Study/)).toBeInTheDocument();
  });
});

describe("Study details", () => {
  it("is grouped: about, passages, related studies and copy", async () => {
    const { api } = await withStudy({ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    const details = screen.getByRole("region", { name: "Study details" });
    const groups = within(details).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(groups).toEqual(["About this study", "Passages", "Related studies", "Copy"]);
    const about = within(details).getByRole("group", { name: "About this study" });
    expect(within(about).getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(within(about).getByRole("textbox", { name: /Purpose/ })).toBeInTheDocument();
    expect(within(details).getByRole("group", { name: "Copy" })).toContainElement(within(details).getByRole("button", { name: /Duplicate/ }));
  });

  it("never names a built-in template", async () => {
    const { api } = await withStudy({ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    const details = screen.getByRole("region", { name: "Study details" });
    expect(details).not.toHaveTextContent(/Template/i);
    expect(details).not.toHaveTextContent("Passage Study Template");
  });

  it("says where a study came from only for the user's own template", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Series" });
    const builtin = api.state.templates.find((t) => t.isBuiltin && t.studyType === "passage")!;
    const copy = await api.templateDuplicate(builtin.id);
    const own = await api.templateUpdate({ id: copy.id, name: "Wednesday Bible Study", studyType: copy.studyType, sections: copy.sections });
    await api.studyCreate({ projectId: project.id, title: "Mine", templateId: own.id });
    const { user } = await renderApp(api);
    await open(user, /Mine/);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    expect(screen.getByRole("region", { name: "Study details" })).toHaveTextContent("From your template: Wednesday Bible Study");
  });

  it("closes with Escape and returns focus to its toggle", async () => {
    const { api } = await withStudy({ title: "The True Vine" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const toggle = screen.getByRole("button", { name: "Study details" });
    await user.click(toggle);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(toggle).toHaveFocus());
  });
});

const main = () => within(screen.getByRole("main", { name: "Study" }));

async function emptyStudy() {
  return withStudy({ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
}

describe("Add, in each part of the study", () => {
  it("has its own Add at the end of every part, and no Add for the whole study at the top", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const parts = main().getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(parts).toEqual(["Text", "Observations", "Context", "Meaning", "Theology", "Application"]);
    for (const part of parts) expect(main().getByRole("button", { name: `Add to ${part}` })).toBeInTheDocument();
    expect(main().queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(main().queryByText("Start your study")).not.toBeInTheDocument();
  });

  it("adds an observation where it was asked for, with no generic kind of thing to choose first", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Add to Context" }));
    const choices = main().getByRole("group", { name: "Add to Context" });
    expect(within(choices).getAllByRole("button").map((b) => b.textContent)).toEqual(["Writing", "Observation", "Question", "Interpretation", "Application", "More types"]);
    await user.click(within(choices).getByRole("button", { name: "Observation" }));
    const text = main().getByLabelText("New observation");
    expect(text).toHaveFocus();
    // added from a part, it goes in that part: no choice of place to make
    expect(main().queryByRole("combobox", { name: /In/ })).not.toBeInTheDocument();
    await user.type(text, "The disciples are already clean.");
    await user.click(main().getByRole("button", { name: "Save" }));
    const notes = await main().findByRole("list", { name: "Notes in Context" });
    expect(within(notes).getByDisplayValue("The disciples are already clean.")).toBeInTheDocument();
    expect(api.state.findings[0]).toMatchObject({ findingType: "observation", sectionId: api.state.sections.find((s) => s.title === "Context")!.id });
  });

  it("offers every kind under More types, and adds writing to the part it was asked in", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Add to Theology" }));
    await user.click(main().getByRole("button", { name: "More types" }));
    const choices = main().getByRole("group", { name: "Add to Theology" });
    for (const kind of ["Quotation", "Doctrine", "Illustration", "Teaching idea", "Unresolved issue", "Conclusion"]) expect(within(choices).getByRole("button", { name: kind })).toBeInTheDocument();
    await user.click(within(choices).getByRole("button", { name: "Writing" }));
    const fields = await main().findAllByRole("textbox", { name: "Theology: paragraph" });
    expect(fields).toHaveLength(2);
    await waitFor(() => expect(fields[1]).toHaveFocus());
    expect(api.state.blocks.filter((b) => b.blockType === "paragraph" && b.sectionId === api.state.sections.find((s) => s.title === "Theology")!.id)).toHaveLength(2);
  });

  it("closes with Escape and returns focus to the part's Add", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const add = main().getByRole("button", { name: "Add to Text" });
    await user.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(main().queryByRole("group", { name: "Add to Text" })).not.toBeInTheDocument();
    expect(add).toHaveFocus();
  });
});

describe("review fixes: writing notes in parts", () => {
  it("does not pull the cursor back into an open note while writing elsewhere", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Add to Context" }));
    await user.click(main().getByRole("button", { name: "Observation" }));
    expect(main().getByLabelText("New observation")).toHaveFocus();
    // Typing in another part re-renders the study; the cursor stays where it is.
    const theology = main().getByRole("textbox", { name: "Theology: paragraph" });
    await user.click(theology);
    await user.type(theology, "God prunes.");
    expect(theology).toHaveFocus();
    expect(theology).toHaveValue("God prunes.");
  });

  it("keeps a half-written note when Add is used in another part, and returns to its Add after saving", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Add to Context" }));
    await user.click(main().getByRole("button", { name: "Observation" }));
    await user.type(main().getByLabelText("New observation"), "Half written");
    await user.click(main().getByRole("button", { name: "Add to Application" }));
    await user.click(within(main().getByRole("group", { name: "Add to Application" })).getByRole("button", { name: "Question" }));
    // Two notes being written, each in its own part; nothing lost.
    expect(main().getByLabelText("New observation")).toHaveValue("Half written");
    expect(main().getByLabelText("New question")).toHaveFocus();
    // Add again where a note is open keeps the draft and goes back to it.
    await user.click(main().getByRole("button", { name: "Add to Context" }));
    await user.click(within(main().getByRole("group", { name: "Add to Context" })).getByRole("button", { name: "Question" }));
    expect(main().getByLabelText("New observation")).toHaveValue("Half written");
    expect(main().getByLabelText("New observation")).toHaveFocus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(api.state.findings).toHaveLength(1));
    await waitFor(() => expect(main().getByRole("button", { name: "Add to Context" })).toHaveFocus());
  });

  it("moves the keyboard to the first further kind when More types is chosen", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Add to Meaning" }));
    await user.click(main().getByRole("button", { name: "More types" }));
    await waitFor(() => expect(main().getByRole("button", { name: "Quotation" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(main().getByRole("button", { name: "Add to Meaning" })).toHaveFocus();
  });
});

describe("folding parts away", () => {
  it("folds a part to its heading, says how many notes it holds, and remembers it for this study", async () => {
    const { api, studyId } = await emptyStudy();
    const context = api.state.sections.find((s) => s.title === "Context")!;
    await api.findingCreate({ studyId, findingType: "question", content: "Which feast?", sectionId: context.id });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const toggle = main().getByRole("button", { name: "Context" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(main().getByRole("textbox", { name: "Context: paragraph", hidden: true })).not.toBeVisible();
    expect(within(main().getByRole("region", { name: "Context" })).getByText("1 note")).toBeInTheDocument();
    cleanup();
    // The app opens again where it was: in this study.
    await renderApp(api);
    await screen.findByRole("textbox", { name: "Study title" });
    expect(main().getByRole("button", { name: "Context" })).toHaveAttribute("aria-expanded", "false");
    expect(main().getByRole("button", { name: "Text" })).toHaveAttribute("aria-expanded", "true");
  });

  it("folds and unfolds the whole study at once, so it reads as an outline", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Fold all" }));
    for (const part of ["Text", "Observations", "Context", "Meaning", "Theology", "Application"]) expect(main().getByRole("button", { name: part })).toHaveAttribute("aria-expanded", "false");
    await user.click(main().getByRole("button", { name: "Unfold all" }));
    expect(main().getByRole("button", { name: "Meaning" })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens a folded part again when something is added to it", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Meaning" }));
    // Add stays reachable from the heading's part only when open; adding from Fold all + Unfold works too
    await user.click(main().getByRole("button", { name: "Meaning" }));
    await user.click(main().getByRole("button", { name: "Add to Meaning" }));
    await user.click(main().getByRole("button", { name: "Question" }));
    expect(main().getByRole("button", { name: "Meaning" })).toHaveAttribute("aria-expanded", "true");
    expect(main().getByLabelText("New question")).toBeVisible();
  });
});

describe("adding a part", () => {
  it("suggests the parts the study's template keeps for later, and keeps their guidance", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Add a part" }));
    const suggested = main().getByRole("group", { name: "Parts you might add" });
    expect(within(suggested).getAllByRole("button").map((b) => b.textContent)).toEqual(["Structure", "Key Words", "Related Scripture", "Open Questions"]);
    await user.click(within(suggested).getByRole("button", { name: "Key Words" }));
    await main().findByRole("heading", { level: 2, name: "Key Words" });
    expect(within(main().getByRole("region", { name: "Key Words" })).getByText(/Words that carry the passage/)).toBeInTheDocument();
    // what is there already is not suggested again
    await user.click(main().getByRole("button", { name: "Add a part" }));
    expect(within(main().getByRole("group", { name: "Parts you might add" })).queryByRole("button", { name: "Key Words" })).not.toBeInTheDocument();
  });

  it("adds a part with the person's own heading, and Escape puts the form away", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const add = main().getByRole("button", { name: "Add a part" });
    await user.click(add);
    await user.type(main().getByRole("textbox", { name: "Your own heading" }), "Prayer{Enter}");
    await main().findByRole("heading", { level: 2, name: "Prayer" });
    await user.click(add);
    await user.keyboard("{Escape}");
    expect(main().queryByRole("textbox", { name: "Your own heading" })).not.toBeInTheDocument();
    expect(add).toHaveFocus();
  });
});

describe("Remark, the former Note block, in every language", () => {
  it("is named differently from a study note (finding) and from a Scripture note", async () => {
    const { default: en } = await import("@/i18n/locales/en/studies.json");
    const { default: de } = await import("@/i18n/locales/de/studies.json");
    const { default: ko } = await import("@/i18n/locales/ko/studies.json");
    const { default: fr } = await import("@/i18n/locales/fr/studies.json");
    const { default: es } = await import("@/i18n/locales/es/studies.json");
    const { default: pt } = await import("@/i18n/locales/pt/studies.json");
    const remark = [en, de, ko, fr, es, pt].map((l) => l.blockType.note);
    expect(remark).toEqual(["Remark", "Bemerkung", "참고", "Remarque", "Comentario", "Comentário"]);
    // not the word for a note (finding) in the Add menu, nor for a Scripture note
    const finding = [en, de, ko, fr, es, pt].map((l) => l.add.note);
    const scripture = ["Note", "Notiz", "메모", "Note", "Nota", "Nota"];
    remark.forEach((word, i) => {
      expect(word).not.toBe(finding[i]);
      expect(word).not.toBe(scripture[i]);
    });
  });
});

describe("Quick capture", () => {
  it("offers the four common kinds at once, and the rest under More types", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Note" }));
    const kinds = main().getByRole("radiogroup", { name: "Kind of note" });
    expect(within(kinds).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Observation", "Interpretation", "Application", "Question"]);
    expect(within(kinds).getByRole("radio", { name: "Observation" })).toBeChecked();
    expect(within(kinds).queryByRole("radio", { name: "Doctrine" })).not.toBeInTheDocument();
    await user.click(within(kinds).getByRole("button", { name: "More types" }));
    expect(within(kinds).getAllByRole("radio")).toHaveLength(10);
    await user.click(within(kinds).getByRole("radio", { name: "Doctrine" }));
    await user.type(main().getByLabelText("New doctrine"), "Union with Christ.");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(api.state.findings.map((f) => f.findingType)).toEqual(["doctrine"]));
  });

  it("moves between kinds with the arrow keys", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Note" }));
    main().getByRole("radio", { name: "Observation" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(main().getByRole("radio", { name: "Interpretation" })).toBeChecked();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(main().getByRole("radio", { name: "Question" })).toBeChecked();
  });

  it("remembers the last kind used in a study, and keeps another study's own", async () => {
    const { api, project, studyId } = await emptyStudy();
    const other = await api.studyCreate({ projectId: project.id, title: "Romans 8", primaryPassage: "ROM.8.1-ROM.8.4" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Note" }));
    await user.click(main().getByRole("radio", { name: "Application" }));
    await user.type(main().getByLabelText("New application"), "Stay close.");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(api.state.findings).toHaveLength(1));

    await user.click(main().getByRole("button", { name: "Note" }));
    expect(main().getByRole("radio", { name: "Application" })).toBeChecked();
    expect(window.localStorage.getItem(`abiding-word.study.lastFindingType.${studyId}`)).toBe('"application"');
    expect(window.localStorage.getItem(`abiding-word.study.lastFindingType.${other.study.id}`)).toBeNull();
  });

  it("keeps a remembered less common kind on show", async () => {
    const { api, studyId } = await emptyStudy();
    window.localStorage.setItem(`abiding-word.study.lastFindingType.${studyId}`, '"illustration"');
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Note" }));
    expect(main().getByRole("radio", { name: "Illustration" })).toBeChecked();
    expect(main().getAllByRole("radio")).toHaveLength(5);
  });

  it("ignores a remembered kind that is not one", async () => {
    const { api, studyId } = await emptyStudy();
    window.localStorage.setItem(`abiding-word.study.lastFindingType.${studyId}`, '"nonsense"');
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Note" }));
    expect(main().getByRole("radio", { name: "Observation" })).toBeChecked();
  });

  it("keeps the section and the passage link under Options, and saves a study-wide note without them", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("button", { name: "Note" }));
    expect(main().queryByRole("combobox", { name: /In/ })).not.toBeInTheDocument();
    const options = main().getByRole("button", { name: "Options" });
    expect(options).toHaveAttribute("aria-expanded", "false");
    await user.click(options);
    expect(main().getByRole("combobox", { name: "In" })).toHaveValue("");
    await user.keyboard("{Escape}");
    // Escape puts Options away first; the capture is still open
    expect(main().queryByRole("combobox", { name: "In" })).not.toBeInTheDocument();
    await user.type(main().getByLabelText("New observation"), "A study-wide thought.");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(api.state.findings).toHaveLength(1));
    expect(api.state.findings[0]!.sectionId).toBeNull();
  });
});

describe("findings in sections", () => {
  async function withNotes() {
    const { api, studyId } = await emptyStudy();
    const sections = (await api.studyGet(studyId)).sections;
    const context = sections.find((s) => s.title === "Context")!;
    const exegesis = sections.find((s) => s.title === "Meaning")!;
    await api.findingCreate({ studyId, findingType: "observation", content: "Study-wide first." });
    await api.findingCreate({ studyId, findingType: "interpretation", content: "In context.", sectionId: context.id });
    await api.findingCreate({ studyId, findingType: "question", content: "In meaning?", sectionId: exegesis.id });
    await api.findingCreate({ studyId, findingType: "application", content: "Study-wide second." });
    return { api, studyId, context, exegesis };
  }

  it("shows a section's findings in that section, and the rest under Study notes", async () => {
    const { api } = await withNotes();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);

    const context = main().getByRole("region", { name: "Context" });
    const inContext = within(context).getByRole("list", { name: "Notes in Context" });
    expect(within(inContext).getByRole("textbox", { name: "Interpretation text" })).toHaveValue("In context.");
    expect(within(inContext).getAllByRole("article")).toHaveLength(1);
    const exegesis = main().getByRole("region", { name: "Meaning" });
    expect(within(within(exegesis).getByRole("list", { name: "Notes in Meaning" })).getByRole("textbox", { name: "Question text" })).toHaveValue("In meaning?");

    const own = main().getByRole("list", { name: "Other notes" });
    expect(within(own).getAllByRole("textbox").map((t) => (t as HTMLTextAreaElement).value)).toEqual(["Study-wide first.", "Study-wide second."]);
    expect(within(own).queryByDisplayValue("In context.")).not.toBeInTheDocument();
    expect(main().getByRole("heading", { level: 2, name: "Other notes" })).toBeInTheDocument();
  });

  it("shows no Study notes area when every finding belongs to a section", async () => {
    const { api, studyId } = await emptyStudy();
    const context = (await api.studyGet(studyId)).sections.find((s) => s.title === "Context")!;
    await api.findingCreate({ studyId, findingType: "observation", content: "Only here.", sectionId: context.id });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    expect(main().queryByRole("heading", { name: "Other notes" })).not.toBeInTheDocument();
    expect(main().queryByRole("list", { name: "Other notes" })).not.toBeInTheDocument();
    expect(within(main().getByRole("region", { name: "Context" })).getByRole("list", { name: "Notes in Context" })).toBeInTheDocument();
  });

  it("treats a finding whose section is gone as one of the study's own", async () => {
    const { api } = await withNotes();
    api.state.findings.find((f) => f.content === "In meaning?")!.sectionId = "gone";
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const own = main().getByRole("list", { name: "Other notes" });
    expect(within(own).getByDisplayValue("In meaning?")).toBeInTheDocument();
  });

  it("changes no finding, section or block merely by showing them", async () => {
    const { api } = await withNotes();
    const before = JSON.stringify([api.state.findings, api.state.sections, api.state.blocks]);
    const calls: string[] = [];
    for (const name of ["findingUpdate", "findingReorder", "findingCreate", "findingDelete", "studyBlockUpdate", "studySectionUpdate"] as const) {
      const original = api[name] as (...args: unknown[]) => unknown;
      (api as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        calls.push(name);
        return original(...args);
      };
    }
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await main().findByRole("list", { name: "Notes in Context" });
    expect(calls).toEqual([]);
    expect(JSON.stringify([api.state.findings, api.state.sections, api.state.blocks])).toBe(before);
  });

  it("reorders within what is shown together and leaves the other findings in their places", async () => {
    const { api, studyId } = await withNotes();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const own = main().getByRole("list", { name: "Other notes" });
    await user.click(within(own).getAllByRole("button", { name: /^Details for/ })[1]!);
    await user.click(within(own).getByRole("button", { name: /^Move .* up/ }));
    await waitFor(() => expect(api.state.findings.filter((f) => f.studyId === studyId).sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.content)).toEqual(["Study-wide second.", "In context.", "In meaning?", "Study-wide first."]));
    const shown = within(main().getByRole("list", { name: "Other notes" })).getAllByRole("textbox", { name: / text$/ }).map((t) => (t as HTMLTextAreaElement).value);
    expect(shown).toEqual(["Study-wide second.", "Study-wide first."]);
  });

  it("narrows by kind in the study's notes and in every section together", async () => {
    const { api, studyId, context } = await withNotes();
    for (const content of ["a", "b"]) await api.findingCreate({ studyId, findingType: "observation", content, sectionId: context.id });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.selectOptions(main().getByRole("combobox", { name: "Show notes" }), "question");
    expect(within(main().getByRole("region", { name: "Meaning" })).getByRole("list", { name: "Notes in Meaning" })).toBeInTheDocument();
    expect(main().queryByRole("list", { name: "Notes in Context" })).not.toBeInTheDocument();
    expect(main().queryByDisplayValue("Study-wide first.")).not.toBeInTheDocument();
  });

  it("has no separate Contents menu: every part of a long study is in the study itself, as a heading", async () => {
    const { api, studyId } = await emptyStudy();
    const sections = (await api.studyGet(studyId)).sections;
    expect(sections.length).toBeGreaterThanOrEqual(5);
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    expect(main().queryByRole("button", { name: "Contents" })).not.toBeInTheDocument();
    expect(main().queryByRole("navigation", { name: "Study contents" })).not.toBeInTheDocument();
    for (const section of sections) expect(main().getByRole("heading", { level: 2, name: section.title })).toBeInTheDocument();
  });
});

describe("the study list", () => {
  async function withStudies(count: number, archived = 0) {
    const api = createMemoryApi();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Series" });
    for (let n = 1; n <= count; n++) {
      const detail = await api.studyCreate({ projectId: project.id, title: `Study ${n}`, primaryPassage: "ROM.8.1" });
      if (n <= archived) await api.studyUpdate({ id: detail.study.id, status: "archived" });
    }
    return api;
  }

  it("offers no filters for a short list, and does not repeat Active on every row", async () => {
    const api = await withStudies(3);
    await renderApp(api);
    const list = await screen.findByRole("list", { name: "Studies" });
    expect(screen.queryByRole("group", { name: "Filter studies" })).not.toBeInTheDocument();
    expect(within(list).queryByText(/Active/)).not.toBeInTheDocument();
  });

  it("offers the filters once the list is long", async () => {
    const api = await withStudies(6);
    await renderApp(api);
    await screen.findByRole("list", { name: "Studies" });
    const filters = screen.getByRole("group", { name: "Filter studies" });
    expect(within(filters).getByLabelText("Status")).toBeInTheDocument();
    expect(within(filters).getByLabelText("Type")).toBeInTheDocument();
  });

  it("keeps archived studies out of the way, shows them on request, and says Archived on them", async () => {
    const api = await withStudies(4, 1);
    const { user } = await renderApp(api);
    const list = await screen.findByRole("list", { name: "Studies" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).queryByText(/Archived/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show archived (1)" }));
    expect(within(screen.getByRole("list", { name: "Studies" })).getAllByRole("listitem")).toHaveLength(4);
    expect(within(screen.getByRole("list", { name: "Studies" })).getByText(/Archived/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide archived" }));
    expect(within(screen.getByRole("list", { name: "Studies" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("still finds archived studies through the status filter", async () => {
    const api = await withStudies(7, 2);
    const { user } = await renderApp(api);
    await screen.findByRole("list", { name: "Studies" });
    await user.selectOptions(within(screen.getByRole("group", { name: "Filter studies" })).getByLabelText("Status"), "archived");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Studies" })).getAllByRole("listitem")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /Show archived/ })).not.toBeInTheDocument();
  });

  it("says plainly when everything is archived", async () => {
    const api = await withStudies(1, 1);
    const { user } = await renderApp(api);
    await screen.findByRole("button", { name: "Show archived (1)" });
    expect(screen.queryByRole("list", { name: "Studies" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show archived (1)" }));
    expect(await screen.findByRole("list", { name: "Studies" })).toBeInTheDocument();
  });
});

describe("related studies", () => {
  async function two() {
    const api = createMemoryApi();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Series" });
    await api.studyCreate({ projectId: project.id, title: "Romans 8" });
    const other = await api.studyCreate({ projectId: project.id, title: "Galatians 4" });
    return { api, other: other.study.id };
  }

  it("links a study as simply related, without asking how", async () => {
    const { api, other } = await two();
    const { user } = await renderApp(api);
    await open(user, /Romans 8/);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    await user.click(screen.getByRole("button", { name: "+ Link a related study" }));
    const form = screen.getByRole("group", { name: "Link a related study" });
    expect(within(form).getByLabelText("Related study")).toBeInTheDocument();
    expect(within(form).queryByText("This study")).not.toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText("Related study"), other);
    await user.click(within(form).getByRole("button", { name: "Link" }));
    await waitFor(() => expect(api.state.relations.map((r) => r.relationType)).toEqual(["related"]));
  });

  it("keeps the kinds of relationship one step away, and Escape steps back", async () => {
    const { api } = await two();
    const { user } = await renderApp(api);
    await open(user, /Romans 8/);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    await user.click(screen.getByRole("button", { name: "+ Link a related study" }));
    const form = screen.getByRole("group", { name: "Link a related study" });
    await user.click(within(form).getByRole("button", { name: "Describe the relationship" }));
    const kinds = within(form).getByLabelText("Relationship");
    expect(within(kinds).getAllByRole("option").map((o) => o.textContent)).toEqual(["Related to", "Continues", "Contrasts with", "Supports", "Linked to"]);
    await user.keyboard("{Escape}");
    expect(within(form).queryByLabelText("Relationship")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Link a related study" })).toBeInTheDocument();
  });
});

describe("editable text looks editable before it is touched", () => {
  it("gives the title, a note and a block a resting underline, not a hover-only border", async () => {
    const { api, studyId } = await emptyStudy();
    await api.findingCreate({ studyId, findingType: "observation", content: "Visible." });
    const { user } = await renderApp(api);
    const title = await open(user, /The True Vine/);
    expect(title.className).toContain("border-b-border-subtle");
    expect(main().getByRole("textbox", { name: "Observation text" }).className).toContain("border-b-border-subtle");
    expect(main().getByRole("textbox", { name: "Context: paragraph" }).className).toContain("border-b-border-subtle");
  });
});

describe("controls for a text block", () => {
  it("are one visible button, not hover-only, and reachable by keyboard", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const toggle = main().getByRole("button", { name: "Options for paragraph in Context" });
    expect(toggle.className).not.toContain("opacity-0");
    expect(toggle.closest("[class*='group-hover']")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // the actions are not there until asked for, then they are plain buttons in the tab order
    expect(main().queryByRole("button", { name: "Delete paragraph in Context" })).not.toBeInTheDocument();
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const group = main().getByRole("group", { name: "Options for paragraph in Context" });
    expect(within(group).getByRole("button", { name: "Delete paragraph in Context" })).not.toHaveAttribute("tabindex", "-1");
    await user.keyboard("{Escape}");
    expect(toggle).toHaveFocus();
    expect(main().queryByRole("group", { name: "Options for paragraph in Context" })).not.toBeInTheDocument();
  });

  it("move a block and delete it with a question first", async () => {
    const { api, studyId } = await emptyStudy();
    const context = (await api.studyGet(studyId)).sections.find((s) => s.title === "Context")!;
    await api.studyBlockCreate({ sectionId: context.id, blockType: "note" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.type(main().getByRole("textbox", { name: "Context: remark" }), "A remark.");
    await user.click(main().getByRole("button", { name: "Options for remark in Context" }));
    await user.click(main().getByRole("button", { name: "Move remark up in Context" }));
    await waitFor(() => expect(api.state.blocks.filter((b) => b.sectionId === context.id).sort((a, b) => a.position - b.position)[0]!.blockType).toBe("note"));
    await user.click(main().getByRole("button", { name: "Delete remark in Context" }));
    await user.click(await main().findByRole("button", { name: "Keep" }));
    expect(api.state.blocks.some((b) => b.blockType === "note")).toBe(true);
  });
});

describe("pane-aware layout and target sizes", () => {
  const sources = import.meta.glob("/src/features/studies/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

  it("lays out by the pane's own width (container queries), never the window's", () => {
    const viewport = Object.entries(sources).flatMap(([file, text]) => (text.match(/["'`\s](sm|md|lg|xl|2xl):[\w-]+/g) ?? []).map((m) => `${file}: ${m.trim()}`));
    expect(viewport).toEqual([]);
    expect(sources["/src/features/studies/StudyPane.tsx"]).toContain("@container");
  });

  it("has no hover-only controls and no small touch targets in the Study pane", () => {
    const problems = Object.entries(sources).flatMap(([file, text]) =>
      [/opacity-0/, /group-hover:opacity/, /\bmin-h-(8|9)\b/, /\bsize-(8|9)\b/, /["'\s]h-9["'\s]/].filter((re) => re.test(text)).map((re) => `${file}: ${re}`),
    );
    expect(problems).toEqual([]);
  });
});

describe("six-language coverage of what v0.10 added", () => {
  const KEYS = [
    "home.title", "home.organise", "home.back", "projects.defaultTitle",
    "passages.openPrimary", "header.typeLine", "header.fromTemplate", "header.groupAbout", "header.groupCopy",
    "add.note", "add.to", "add.writing", "parts.add", "parts.own", "parts.suggested", "parts.collapseAll", "parts.expandAll",
    "blockType.note", "blockTypeInline.note", "blocks.options", "blocks.optionsGroup", "blocks.optionsTooltip",
    "findings.kindGroup", "findings.moreTypes", "findings.options", "findings.heading", "findings.listLabel", "findings.inSection",
    "list.hideArchived", "relations.target", "relations.relation", "relations.describe",
  ];

  it("has every new or changed string in English, German, Korean, French, Spanish and Portuguese", async () => {
    const files = {
      en: (await import("@/i18n/locales/en/studies.json")).default,
      de: (await import("@/i18n/locales/de/studies.json")).default,
      ko: (await import("@/i18n/locales/ko/studies.json")).default,
      fr: (await import("@/i18n/locales/fr/studies.json")).default,
      es: (await import("@/i18n/locales/es/studies.json")).default,
      pt: (await import("@/i18n/locales/pt/studies.json")).default,
    } as Record<string, unknown>;
    const read = (tree: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
    for (const [language, tree] of Object.entries(files)) {
      for (const key of KEYS) expect(read(tree, key), `${language}: ${key}`).toEqual(expect.any(String));
    }
    // Korean is written, not translated word for word
    expect(read(files.ko, "home.title")).toBe("성경공부");
    expect(read(files.ko, "list.showArchived_other")).toBe("보관된 항목 보기 ({{count}})");
  });
});
