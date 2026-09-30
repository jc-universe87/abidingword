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

async function openProject(user: Awaited<ReturnType<typeof renderApp>>["user"], title: string) {
  await user.click(within(await screen.findByRole("list", { name: "Projects" })).getByRole("button", { name: new RegExp(title) }));
}

async function openStudy(api: MemoryApi, user: Awaited<ReturnType<typeof renderApp>>["user"], project: string, study: string) {
  await openProject(user, project);
  const studies = await screen.findByRole("list", { name: "Studies" });
  await user.click(within(studies).getByRole("button", { name: new RegExp(study) }));
  await screen.findByRole("textbox", { name: "Study title" });
  return api;
}

const newStudy = () => within(screen.getByRole("form", { name: "New study" }));

const sectionHeadings = () =>
  within(screen.getByRole("main", { name: "Study" }))
    .getAllByRole("heading", { level: 2 })
    .map((h) => h.textContent)
    .filter((t) => t !== "Findings");

describe("creating studies", () => {
  it("creates a word study with its template and no passage", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user, "John Sermon Series");

    await user.type(newStudy().getByLabelText("Title"), "Remain (μένω)");
    await user.selectOptions(newStudy().getByLabelText("Type"), "word");
    expect(newStudy().getByLabelText("Template")).toHaveDisplayValue("Word Study");
    expect(newStudy().getByText("(optional)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create study" }));

    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Remain (μένω)");
    expect(screen.getByText("Word Study", { selector: "p" })).toBeInTheDocument();
    expect(sectionHeadings()).toEqual(["Word", "Occurrences", "Immediate Contexts", "Semantic Range", "Key Passages", "Theological Significance", "Conclusions"]);
    expect(screen.getByRole("group", { name: "Word Study details" })).toBeInTheDocument();
    expect(api.state.passages).toHaveLength(0);
  });

  it("creates a passage study with its primary passage", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user, "John Sermon Series");
    await user.type(newStudy().getByLabelText("Title"), "The True Vine");
    await user.type(newStudy().getByLabelText(/Passage/), "John 15:1-11");
    await user.click(screen.getByRole("button", { name: "Create study" }));

    await screen.findByRole("textbox", { name: "Study title" });
    expect(sectionHeadings()[0]).toBe("Text");
    const passages = screen.getByRole("region", { name: "Passages" });
    expect(await within(passages).findByText("Primary")).toBeInTheDocument();
    expect(within(passages).getByRole("button", { name: "John 15:1–11" })).toBeInTheDocument();
  });

  it("creates a custom study with no template and no passage", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user, "John Sermon Series");
    await user.type(newStudy().getByLabelText("Title"), "Questions from the youth group");
    await user.selectOptions(newStudy().getByLabelText("Type"), "custom");
    expect(newStudy().getByLabelText("Template")).toHaveDisplayValue("No template (one Notes section)");
    await user.click(screen.getByRole("button", { name: "Create study" }));

    await screen.findByRole("textbox", { name: "Study title" });
    expect(sectionHeadings()).toEqual(["Notes"]);
  });

  it("lists studies with type, passage and status, and filters them", async () => {
    const { api, project } = await withProject();
    await api.studyCreate({ projectId: project.id, title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "topical" });
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
    const add = screen.getByRole("group", { name: "Add a finding" });
    await user.click(within(add).getByRole("button", { name: "Observation" }));
    await user.type(screen.getByLabelText("New observation"), "Abide appears again and again.");
    await user.click(screen.getByRole("button", { name: "Save finding" }));
    await user.click(within(add).getByRole("button", { name: "Question" }));
    await user.type(screen.getByLabelText("New question"), "What is the fruit?{Control>}{Enter}{/Control}");

    await waitFor(() => expect(api.state.findings.map((f) => f.findingType)).toEqual(["observation", "question"]));
    const list = screen.getByRole("list", { name: "Findings" });
    expect(within(list).getByRole("textbox", { name: "Observation text" })).toHaveValue("Abide appears again and again.");
    expect(screen.getByLabelText("Overview")).toHaveTextContent("2 findings · 1 question");
  });

  it("edits, retypes, filters and deletes findings", async () => {
    const { api, user } = await inStudy();
    const studyId = api.state.studies[0]!.id;
    await api.findingCreate({ studyId, findingType: "observation", content: "First" });
    await api.findingCreate({ studyId, findingType: "question", content: "Second?" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    const list = await screen.findByRole("list", { name: "Findings" });

    const text = await within(list).findByRole("textbox", { name: "Observation text" });
    await user.clear(text);
    await user.type(text, "First, revised");
    await user.tab();
    await waitFor(() => expect(api.state.findings[0]!.content).toBe("First, revised"));

    const question = within(list).getByRole("article", { name: /Question/ });
    await user.selectOptions(within(question).getByLabelText("Finding type"), "unresolved_issue");
    await waitFor(() => expect(api.state.findings[1]!.findingType).toBe("unresolved_issue"));

    const filters = screen.getByRole("group", { name: "Show findings" });
    await user.click(await within(filters).findByRole("button", { name: "Observations (1)" }));
    expect(within(list).getAllByRole("article")).toHaveLength(1);
    await user.click(within(filters).getByRole("button", { name: "All (2)" }));

    await user.click(within(list).getByRole("button", { name: "Delete observation" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.state.findings).toHaveLength(1));
  });

  it("links the current passage and opens it from the finding", async () => {
    const { api, user } = await inStudy();
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    await user.type(within(scripture).getByLabelText("Go to passage"), "John 15{Enter}");
    await user.click(await within(scripture).findByRole("button", { name: /^Verse 2\. Show verse tools/ }));

    await user.click(within(screen.getByRole("group", { name: "Add a finding" })).getByRole("button", { name: "Question" }));
    await user.type(screen.getByLabelText("New question"), "What does fruit mean here?");
    await user.click(screen.getByLabelText("Link current passage (John 15:2)"));
    await user.click(screen.getByRole("button", { name: "Save finding" }));
    await waitFor(() => expect(api.state.findings[0]?.passages[0]?.reference.canonical).toBe("JHN.15.2"));

    await user.type(within(scripture).getByLabelText("Go to passage"), "Psalm 23{Enter}");
    await within(scripture).findByRole("heading", { level: 2, name: "Psalm 23" });
    await user.click(within(screen.getByRole("list", { name: "Findings" })).getByRole("button", { name: "John 15:2" }));
    expect(await within(scripture).findByRole("heading", { level: 2, name: "John 15" })).toBeInTheDocument();
  });

  it("opens quick capture with Alt+O", async () => {
    await inStudy();
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.keyboard("{Alt>}o{/Alt}");
    expect(await screen.findByLabelText("New observation")).toHaveFocus();
  });
});

describe("sections", () => {
  it("adds, reorders and deletes sections", async () => {
    const { api, project } = await withProject();
    await api.studyCreate({ projectId: project.id, title: "Notes study", studyType: "custom" });
    const { user } = await renderApp(api);
    await openStudy(api, user, "John Sermon Series", "Notes study");

    await user.click(screen.getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(sectionHeadings()).toEqual(["Notes", "New section"]));
    await user.click(screen.getByRole("button", { name: "Move section New section up" }));
    await waitFor(() => expect(sectionHeadings()).toEqual(["New section", "Notes"]));
    const nav = screen.getByRole("navigation", { name: "Study contents" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Findings", "New section", "Notes"]);

    await user.type(screen.getByRole("textbox", { name: "Notes: paragraph" }), "Keep this.");
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
    await user.type(newStudy().getByLabelText("Title"), "From my template");
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

    await user.click(screen.getByRole("button", { name: "+ Link a related study" }));
    const form = screen.getByRole("group", { name: "Link a related study" });
    await user.selectOptions(within(form).getByLabelText("Relation"), "continues");
    await user.selectOptions(within(form).getByLabelText("Study to link"), api.state.studies[1]!.id);
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
    expect(within(results).getByText("Finding")).toBeInTheDocument();
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
