import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

async function withProject(title = "John Sermon Series") {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title });
  return { api, project };
}

// With a single project the Study pane starts on its studies: there is no project to open.
async function openProject(_user: Awaited<ReturnType<typeof renderApp>>["user"], _title: string) {
  await screen.findByRole("heading", { level: 1, name: "Studies" });
}

async function openStudy(api: MemoryApi, user: Awaited<ReturnType<typeof renderApp>>["user"], project: string, study: string) {
  await openProject(user, project);
  const studies = await screen.findByRole("list", { name: "Studies" });
  await user.click(within(studies).getByRole("button", { name: new RegExp(study) }));
  await screen.findByRole("textbox", { name: "Study title" });
  return api;
}

const newStudy = () => within(screen.getByRole("form", { name: "New study" }));

/** The study's one Add action: the two beginnings of a new study, or the Add menu after that. */
async function addNote(user: Awaited<ReturnType<typeof renderApp>>["user"]) {
  const study = within(screen.getByRole("main", { name: "Study" }));
  if (!study.queryByRole("button", { name: "Note" })) await user.click(study.getByRole("button", { name: "Add" }));
  await user.click(study.getByRole("button", { name: "Note" }));
}

const detailsOf = (list: HTMLElement, name: RegExp) => within(list).getByRole("button", { name: new RegExp(`^Details for ${name.source}`) });

const sectionHeadings = () =>
  within(screen.getByRole("main", { name: "Study" }))
    .getAllByRole("heading", { level: 2 })
    .map((h) => h.textContent)
    .filter((t) => t !== "Study notes");

describe("creating studies", () => {
  it("creates a word study with its template and no passage", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user, "John Sermon Series");

    await user.click(newStudy().getByRole("button", { name: "Word study" }));
    await user.type(newStudy().getByLabelText("What would you like to study?"), "Remain (μένω)");
    expect(newStudy().queryByLabelText("Template")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create study" }));

    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Remain (μένω)");
    // the kind of study is not in the everyday header; it is in Study details
    expect(screen.queryByText("Word Study", { selector: "span" })).not.toBeInTheDocument();
    expect(sectionHeadings()).toEqual(["Word", "Occurrences", "Immediate Contexts", "Semantic Range", "Key Passages", "Theological Significance", "Conclusions"]);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    expect(screen.getByRole("group", { name: "Word Study details" })).toBeInTheDocument();
    expect(screen.getByText(/Type: Word Study/)).toBeInTheDocument();
    expect(api.state.studies[0]!.templateId).toBe(api.state.templates.find((t) => t.key === "word-study")!.id);
    expect(api.state.passages).toHaveLength(0);
  });

  it("creates a passage study with its primary passage", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user, "John Sermon Series");
    await user.type(newStudy().getByLabelText("What would you like to study?"), "John 15:1-11");
    await user.click(screen.getByRole("button", { name: "Create study" }));

    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("John 15:1–11");
    expect(sectionHeadings()[0]).toBe("Text");
    const passages = screen.getByRole("region", { name: "Passages" });
    expect(within(passages).queryByText("Primary")).not.toBeInTheDocument();
    // the title is the passage: it is not repeated beneath it, and there is still a way to open it
    expect(within(passages).queryByRole("button", { name: "John 15:1–11" })).not.toBeInTheDocument();
    expect(within(passages).getByRole("button", { name: "Open in Scripture" })).toBeInTheDocument();
  });

  it("creates a custom study with no template and no passage", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user, "John Sermon Series");
    await user.type(newStudy().getByLabelText("What would you like to study?"), "Youth group");
    await user.click(newStudy().getByRole("button", { name: "More options" }));
    await user.click(newStudy().getByRole("button", { name: "No template" }));
    await user.type(newStudy().getByLabelText(/^Title/), "Questions from the youth group");
    await user.click(screen.getByRole("button", { name: "Create study" }));

    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Questions from the youth group");
    expect(sectionHeadings()).toEqual(["Notes"]);
  });

  it("lists studies with type, passage and status, and filters them", async () => {
    const { api, project } = await withProject();
    await api.studyCreate({ projectId: project.id, title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "topical" });
    // filters are only offered once the list is long enough to need them
    for (const n of [1, 2, 3, 4]) await api.studyCreate({ projectId: project.id, title: `Passage ${n}`, primaryPassage: "ROM.8.1" });
    const { user } = await renderApp(api);
    await openProject(user, "John Sermon Series");

    const list = await screen.findByRole("list", { name: "Studies" });
    expect(within(list).getByText(/Passage Study · John 15:1–11/)).toBeInTheDocument();
    await user.selectOptions(within(screen.getByRole("group", { name: "Filter studies" })).getByLabelText("Type"), "topical");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Studies" })).getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("list", { name: "Studies" })).toHaveTextContent("Abiding");
  });
});

describe("findings", () => {
  async function inStudy() {
    const { api, project } = await withProject();
    await api.studyCreate({ projectId: project.id, title: "The True Vine" });
    const { user } = await renderApp(api);
    await openStudy(api, user, "John Sermon Series", "The True Vine");
    return { api, user };
  }

  it("captures an observation and a question quickly", async () => {
    const { api, user } = await inStudy();
    await addNote(user);
    // Write first; the kind defaults to an observation.
    await user.type(screen.getByLabelText("New observation"), "Abide appears again and again.");
    await user.click(screen.getByRole("button", { name: "Save finding" }));
    await waitFor(() => expect(api.state.findings.map((f) => f.findingType)).toEqual(["observation"]));
    await addNote(user);
    await user.click(screen.getByRole("radio", { name: "Question" }));
    await user.type(screen.getByLabelText("New question"), "What is the fruit?{Control>}{Enter}{/Control}");

    await waitFor(() => expect(api.state.findings.map((f) => f.findingType)).toEqual(["observation", "question"]));
    const list = screen.getByRole("list", { name: "Study notes" });
    expect(within(list).getByRole("textbox", { name: "Observation text" })).toHaveValue("Abide appears again and again.");
    await user.click(screen.getByRole("button", { name: "Study details" }));
    expect(screen.getByRole("region", { name: "Study details" })).toHaveTextContent("2 findings · 1 question");
  });

  it("edits, retypes, filters and deletes findings", async () => {
    const { api, user } = await inStudy();
    const studyId = api.state.studies[0]!.id;
    await api.findingCreate({ studyId, findingType: "observation", content: "First" });
    await api.findingCreate({ studyId, findingType: "question", content: "Second?" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    const list = await screen.findByRole("list", { name: "Study notes" });

    const text = await within(list).findByRole("textbox", { name: "Observation text" });
    await user.clear(text);
    await user.type(text, "First, revised");
    await user.tab();
    await waitFor(() => expect(api.state.findings[0]!.content).toBe("First, revised"));

    // Kind and the rest are in each note's Details; a few notes need no filter.
    expect(screen.queryByLabelText("Show findings")).not.toBeInTheDocument();
    const question = within(list).getByRole("article", { name: /Question/ });
    expect(within(question).queryByLabelText("Finding type")).not.toBeInTheDocument();
    await user.click(detailsOf(list, /question/));
    await user.selectOptions(within(question).getByLabelText("Finding type"), "unresolved_issue");
    await waitFor(() => expect(api.state.findings[1]!.findingType).toBe("unresolved_issue"));

    await user.click(detailsOf(list, /observation/));
    await user.click(within(list).getByRole("button", { name: "Delete observation" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.state.findings).toHaveLength(1));
  });

  it("offers one compact filter once there are many findings", async () => {
    const { api, user } = await inStudy();
    const studyId = api.state.studies[0]!.id;
    for (let i = 0; i < 5; i++) await api.findingCreate({ studyId, findingType: "observation", content: `Seen ${i}` });
    await api.findingCreate({ studyId, findingType: "question", content: "Why?" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    const list = await screen.findByRole("list", { name: "Study notes" });
    expect(within(list).getAllByRole("article")).toHaveLength(6);
    await user.selectOptions(screen.getByLabelText("Show findings"), "question");
    expect(within(list).getAllByRole("article")).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("Show findings"), "");
    expect(within(list).getAllByRole("article")).toHaveLength(6);
  });

  it("reorders, tags and links from a note's details, and closes them with Escape", async () => {
    const { api, user } = await inStudy();
    const studyId = api.state.studies[0]!.id;
    await api.findingCreate({ studyId, findingType: "observation", content: "First" });
    await api.findingCreate({ studyId, findingType: "observation", content: "Second" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    const list = await screen.findByRole("list", { name: "Study notes" });

    const toggle = detailsOf(list, /observation: Second/);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(within(list).getByRole("button", { name: "Move observation up" }));
    await waitFor(() => expect([...api.state.findings].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.content)).toEqual(["Second", "First"]));

    const tags = within(list).getByLabelText("Tags");
    await user.type(tags, "vine, fruit");
    await user.tab();
    await waitFor(() => expect(api.state.findings.find((f) => f.content === "Second")?.tags).toEqual(["fruit", "vine"]));

    await user.keyboard("{Escape}");
    expect(within(list).queryByLabelText("Tags")).not.toBeInTheDocument();
  });

  it("links the current passage and opens it from the finding", async () => {
    const { api, user } = await inStudy();
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    await user.type(within(scripture).getByLabelText("Go to passage"), "John 15{Enter}");
    await user.click(await within(scripture).findByRole("button", { name: /^Verse 2\. Show verse tools/ }));

    await addNote(user);
    await user.type(screen.getByLabelText("New observation"), "What does fruit mean here?");
    // Linking is explicit: nothing is linked until it is ticked (and the choice is under Options).
    await user.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByLabelText("Link current passage (John 15:2)")).not.toBeChecked();
    await user.click(screen.getByLabelText("Link current passage (John 15:2)"));
    await user.click(screen.getByRole("button", { name: "Save finding" }));
    await waitFor(() => expect(api.state.findings[0]?.passages[0]?.reference.canonical).toBe("JHN.15.2"));

    await user.type(within(scripture).getByLabelText("Go to passage"), "Psalm 23{Enter}");
    await within(scripture).findByRole("heading", { level: 2, name: "Psalm 23" });
    await user.click(within(screen.getByRole("list", { name: "Study notes" })).getByRole("button", { name: "John 15:2" }));
    expect(await within(scripture).findByRole("heading", { level: 2, name: "John 15" })).toBeInTheDocument();
  });

  it("does not react to the old Alt shortcuts, and keeps Ctrl+Enter in the editor", async () => {
    const { user } = await inStudy();
    for (const combo of ["{Alt>}o{/Alt}", "{Alt>}n{/Alt}", "{Alt>}q{/Alt}", "{Alt>}g{/Alt}", "{Alt>}{ArrowDown}{/Alt}"]) {
      await user.keyboard(combo);
    }
    expect(screen.queryByLabelText("New observation")).toBeNull();
    expect(screen.queryByLabelText("New question")).toBeNull();
    expect(screen.queryByLabelText("New finding")).toBeNull();

    // Writing a finding still says how to save it, where it is written.
    await addNote(user);
    expect(await screen.findByLabelText("New observation")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Enter saves")).toBeInTheDocument();
  });
});

describe("sections", () => {
  it("adds, reorders and deletes sections", async () => {
    const { api, project } = await withProject();
    await api.studyCreate({ projectId: project.id, title: "Notes study", studyType: "custom" });
    const { user } = await renderApp(api);
    await openStudy(api, user, "John Sermon Series", "Notes study");

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Section" }));
    await waitFor(() => expect(sectionHeadings()).toEqual(["Notes", "New section"]));
    expect(screen.queryByRole("button", { name: "Move section New section up" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Options for section New section" }));
    await user.click(screen.getByRole("button", { name: "Move section New section up" }));
    await waitFor(() => expect(sectionHeadings()).toEqual(["New section", "Notes"]));
    expect(screen.queryByRole("navigation", { name: "Study contents" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Notes: paragraph" }), "Keep this.");
    await user.click(screen.getByRole("button", { name: "Options for section Notes" }));
    await user.click(screen.getByRole("button", { name: "Delete section Notes" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete section Notes?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete section" }));
    await waitFor(() => expect(sectionHeadings()).toEqual(["New section"]));
  });
});

describe("templates", () => {
  it("duplicates a built-in template, customises it and uses it for a new study", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const templates = await screen.findByRole("list", { name: "Study templates" });
    expect(within(templates).getAllByRole("listitem")).toHaveLength(6);
    const passage = within(templates).getByText("Passage Study").closest("li")!;
    await user.click(within(passage as HTMLElement).getByRole("button", { name: "Duplicate and customise" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Edit template" })).toBeInTheDocument();
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Short Passage Study");
    const sections = screen.getByRole("list", { name: "Template sections" });
    for (const title of ["Audience", "Teaching", "Application", "Theology", "Exegesis", "Structure"]) {
      await user.click(within(sections).getByRole("button", { name: `Remove ${title}` }));
    }
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await user.type(screen.getByLabelText("Section 4 title"), "Prayer");
    await user.click(screen.getByRole("button", { name: "Move Prayer up" }));
    await user.click(screen.getByRole("button", { name: "Save template" }));

    const mine = api.state.templates.find((t) => t.name === "Short Passage Study")!;
    expect(mine.sections.map((s) => s.title)).toEqual(["Text", "Context", "Prayer", "Observations"]);
    expect(api.state.templates.find((t) => t.key === "passage-study")!.sections).toHaveLength(9);

    await user.click(await screen.findByRole("button", { name: "Back to workspace" }));
    await openProject(user, "John Sermon Series");
    await user.type(newStudy().getByLabelText("What would you like to study?"), "John 15");
    await user.click(newStudy().getByRole("button", { name: "My template" }));
    await user.selectOptions(newStudy().getByLabelText("Template"), mine.id);
    await user.click(screen.getByRole("button", { name: "Create study" }));
    await screen.findByRole("textbox", { name: "Study title" });
    expect(sectionHeadings()).toEqual(["Text", "Context", "Prayer", "Observations"]);
  });
});

describe("related studies and search", () => {
  it("links a related study and opens it", async () => {
    const { api, project } = await withProject();
    await api.studyCreate({ projectId: project.id, title: "Romans 8" });
    await api.studyCreate({ projectId: project.id, title: "Galatians 4", primaryPassage: "GAL.4.4-GAL.4.7" });
    const { user } = await renderApp(api);
    await openStudy(api, user, "John Sermon Series", "Romans 8");

    expect(screen.queryByRole("region", { name: "Related studies" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Study details" }));
    await user.click(screen.getByRole("button", { name: "+ Link a related study" }));
    const form = screen.getByRole("group", { name: "Link a related study" });
    // ordinarily just choose the study; saying how they are related is one step further
    expect(within(form).queryByLabelText("Relationship")).not.toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Describe the relationship" }));
    await user.selectOptions(within(form).getByLabelText("Relationship"), "continues");
    await user.selectOptions(within(form).getByLabelText("Related study"), api.state.studies[1]!.id);
    await user.click(within(form).getByRole("button", { name: "Link" }));

    const related = await screen.findByRole("region", { name: "Related studies" });
    expect(await within(related).findByText("Continues")).toBeInTheDocument();
    await user.click(within(related).getByRole("button", { name: "Galatians 4" }));
    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Galatians 4");
  });

  it("searches studies by title and finding text and opens a result", async () => {
    const { api, project } = await withProject();
    const vine = await api.studyCreate({ projectId: project.id, title: "The True Vine" });
    await api.studyCreate({ projectId: project.id, title: "Prayer" });
    await api.findingCreate({ studyId: vine.study.id, findingType: "question", content: "What exactly does fruit mean?" });
    const { user } = await renderApp(api);

    await user.selectOptions(screen.getByLabelText("Search in"), "studies");
    await user.type(screen.getByRole("searchbox", { name: "Search studies" }), "fruit{Enter}");
    const results = await screen.findByRole("list", { name: "Study search results" });
    expect(within(results).getByText("Finding: Question")).toBeInTheDocument();
    expect(within(results).getByText("fruit", { selector: "mark" })).toBeInTheDocument();
    await user.click(within(results).getByRole("button", { name: /The True Vine/ }));
    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("The True Vine");

    const search = screen.getByRole("searchbox", { name: "Search studies" });
    await user.clear(search);
    await user.type(search, "prayer{Enter}");
    const again = await screen.findByRole("list", { name: "Study search results" });
    expect(within(again).getAllByRole("listitem")).toHaveLength(1);
  });

  it("opening a study from a list shows its primary passage in Scripture", async () => {
    const { api, project } = await withProject();
    await api.studyCreate({ projectId: project.id, title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    expect(await within(scripture).findByRole("heading", { level: 2, name: "Psalm 23" })).toBeInTheDocument();

    await openStudy(api, user, "John Sermon Series", "The True Vine");
    expect(await within(scripture).findByRole("heading", { level: 2, name: "John 15" })).toBeInTheDocument();
    expect(within(scripture).getByText(/showing John 15:1–11/)).toBeInTheDocument();
  });
});
