import { screen, waitFor, within } from "@testing-library/react";
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

describe("one Add action", () => {
  it("is a single button; Note, Section and Text block are its choices", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    // a new study shows the choices once, under the one button
    expect(main().getAllByRole("button", { name: "Add" })).toHaveLength(1);
    for (const name of ["Note", "Section", "Text block"]) expect(main().getByRole("button", { name })).toBeInTheDocument();
    expect(main().queryByRole("button", { name: /^Add (note|section)$/ })).not.toBeInTheDocument();
    expect(main().queryByRole("button", { name: /Add content to/ })).not.toBeInTheDocument();
    // once there is writing it is only the button, until asked for
    await user.click(main().getByRole("button", { name: "Note" }));
    await user.type(main().getByLabelText("New observation"), "Branches depend on the vine.");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await screen.findByRole("list", { name: "Findings" });
    expect(main().getByRole("button", { name: "Add" })).toHaveAttribute("aria-expanded", "false");
    expect(main().queryByRole("button", { name: "Text block" })).not.toBeInTheDocument();
  });

  it("opens Text block into its kinds, with the Remark that was the Note block, and adds one where the cursor was", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(main().getByRole("textbox", { name: "Context: paragraph" }));
    await user.click(main().getByRole("button", { name: "Text block" }));
    const kinds = main().getByRole("group", { name: "Text block in Context" });
    expect(within(kinds).getAllByRole("button").map((b) => b.textContent)).toEqual(["Paragraph", "Remark", "Heading", "Quotation", "Question"]);
    await user.click(within(kinds).getByRole("button", { name: "Remark" }));
    const added = await main().findByRole("textbox", { name: "Context: remark" });
    await waitFor(() => expect(added).toHaveFocus());
    // only the label changed: the stored kind is still "note"
    expect(api.state.blocks.filter((b) => b.blockType === "note")).toHaveLength(1);
  });

  it("closes the kinds, then the menu, with Escape, returning focus", async () => {
    const { api } = await emptyStudy();
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.type(main().getByRole("textbox", { name: "Text: paragraph" }), "Abide.");
    const add = main().getByRole("button", { name: "Add" });
    await user.click(add);
    const blocks = main().getByRole("button", { name: "Text block" });
    await user.click(blocks);
    await user.keyboard("{Escape}");
    expect(main().queryByRole("group", { name: /Text block in/ })).not.toBeInTheDocument();
    expect(blocks).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(main().queryByRole("button", { name: "Note" })).not.toBeInTheDocument();
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

    await user.click(main().getByRole("button", { name: "Add" }));
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
