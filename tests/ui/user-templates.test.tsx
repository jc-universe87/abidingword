import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { partsFromStudy } from "@/features/studies/templateParts";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

// User-designed templates (v0.18.7): a Bible Study template says where each
// of its parts belongs in the study outline, a study follows its own
// template's structure, and any study's structure can become a template of
// the person's own. All text invented.

beforeEach(() => window.localStorage.clear());

async function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Psalms" });
  return { api, project };
}

async function openStudy(api: MemoryApi, title: string) {
  const { user } = await renderApp(api);
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: new RegExp(title) }));
  await screen.findByRole("textbox", { name: "Study title" });
  return user;
}
const study = () => screen.getByRole("main", { name: "Study" });
const outline = () => within(study()).queryByRole("navigation", { name: "Study outline" });
const outlineNames = () => within(outline()!).getAllByRole("button").map((b) => b.textContent);

describe("a Bible Study template of one's own", () => {
  it("is designed part by part: headings, order and where each part belongs, all by keyboard-reachable controls", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const templates = await openSettingsSection(user, "Templates");
    await user.click(within(templates).getByRole("button", { name: "New template…" }));
    const sheet = await screen.findByRole("dialog", { name: "New template" });
    await user.type(within(sheet).getByRole("textbox", { name: "Name" }), "Lectio");
    const first = within(sheet).getByLabelText("Heading of part 1");
    await user.clear(first);
    await user.type(first, "Read slowly");
    await user.selectOptions(within(sheet).getByLabelText("Where part 1 belongs in the study outline"), "text");
    for (const [n, title, phase] of [
      [2, "Pray", ""],
      [3, "Live it", "application"],
      [4, "What it says of God", "theology"],
    ] as const) {
      await user.click(within(sheet).getByRole("button", { name: "Add a part" }));
      await user.type(within(sheet).getByLabelText(`Heading of part ${n}`), title);
      if (phase) await user.selectOptions(within(sheet).getByLabelText(`Where part ${n} belongs in the study outline`), phase);
    }
    // Reordered with buttons, not dragging; focus stays with the part that moved.
    const up = within(sheet).getByRole("button", { name: "Move What it says of God up" });
    await user.click(up);
    expect(within(sheet).getByRole("button", { name: "Move What it says of God up" })).toHaveFocus();
    expect(within(sheet).getByLabelText("Heading of part 3")).toHaveValue("What it says of God");
    // Each phase choice says what it is in words; "Not in the outline" for none.
    expect(within(within(sheet).getByLabelText("Where part 2 belongs in the study outline")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Not in the outline", "Text", "Understanding", "Theology", "Application", "Audience", "Teaching",
    ]);
    await user.click(within(sheet).getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const mine = api.state.templates.find((t) => t.name === "Lectio")!;
    expect(mine.isBuiltin).toBe(false);
    expect(mine.sections.map((s) => [s.title, s.phase ?? null])).toEqual([
      ["Read slowly", "text"],
      ["Pray", null],
      ["What it says of God", "theology"],
      ["Live it", "application"],
    ]);
    // Every part has a key of its own, never a built-in one, and no two alike.
    const keys = mine.sections.map((s) => s.key!);
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(key).toMatch(/^own-/);
  });

  it("gives a study made from it the template's own outline: its order, a repeated phase, a part with none", async () => {
    const { api, project } = await setup();
    const mine = await api.templateCreate({
      name: "Lectio",
      studyType: "custom",
      sections: [
        { key: "own-a", title: "Read slowly", phase: "text" },
        { key: "own-b", title: "Pray", phase: null },
        { key: "own-c", title: "Live it", phase: "application" },
        { key: "own-d", title: "Read it again", phase: "text" },
        { key: "own-e", title: "Who is it for?", phase: "audience" },
      ],
    });
    await api.studyCreate({ projectId: project.id, title: "Psalm 1", templateId: mine.id });
    await openStudy(api, "Psalm 1");
    // Text appears once in the outline (it goes to its first place); no phase is invented.
    expect(outlineNames()).toEqual(["Text", "Application", "Audience"]);
    // The part without a phase stays where it is, under no heading of its own.
    const pray = within(study()).getByRole("region", { name: "Pray" });
    expect(pray).not.toHaveAttribute("data-phase-start");
    expect(within(study()).getByRole("region", { name: "Read it again" })).toHaveAttribute("data-phase-start");
    expect(within(study()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Read slowly", "Pray", "Live it", "Read it again", "Who is it for?"]);
  });

  it("shows no outline for a template of the person's own without phases", async () => {
    const { api, project } = await setup();
    const mine = await api.templateCreate({ name: "Plain", studyType: "custom", sections: [{ title: "One" }, { title: "Two" }, { title: "Three" }] });
    await api.studyCreate({ projectId: project.id, title: "Psalm 2", templateId: mine.id });
    await openStudy(api, "Psalm 2");
    expect(outline()).toBeNull();
  });

  it("refuses two parts with one key, so a study never mistakes one part for another", async () => {
    const { api } = await setup();
    await expect(api.templateCreate({ name: "Twice", studyType: "custom", sections: [{ key: "own-a", title: "A" }, { key: "own-a", title: "B" }] })).rejects.toThrow(/same part/);
  });
});

describe("a study's own parts", () => {
  it("can be given, moved to or taken out of a phase from the part's options", async () => {
    const { api, project } = await setup();
    await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "passage" });
    const user = await openStudy(api, "Abiding");
    expect(outlineNames()).toEqual(["Text", "Understanding", "Theology", "Application"]);
    const application = within(study()).getByRole("region", { name: "Application" });
    await user.click(within(application).getByRole("button", { name: "Options for part Application" }));
    const phase = within(application).getByLabelText("Where Application belongs in the study outline");
    expect(phase).toHaveValue("application");
    await user.selectOptions(phase, "audience");
    await waitFor(() => expect(outlineNames()).toEqual(["Text", "Understanding", "Theology", "Audience"]));
    expect(api.state.sections.find((s) => s.title === "Application")!.phase).toBe("audience");
    await user.selectOptions(within(application).getByLabelText("Where Application belongs in the study outline"), "");
    // Taken out of the outline, it sits with the part before it, with no meaning of its own.
    await waitFor(() => expect(outlineNames()).toEqual(["Text", "Understanding", "Theology"]));
    expect(api.state.sections.find((s) => s.title === "Application")!.phase).toBeNull();
    // The part keeps its key, its heading and its place.
    expect(api.state.sections.find((s) => s.title === "Application")!.key).toBe("application");
  });

  it("added from the template's parts for later come with their key and phase; one's own come with neither", async () => {
    const { api, project } = await setup();
    await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "passage" });
    const user = await openStudy(api, "Abiding");
    await user.click(within(study()).getByRole("button", { name: "Add a part" }));
    await user.click(within(study()).getByRole("button", { name: "Key Words" }));
    await waitFor(() => expect(api.state.sections.find((s) => s.title === "Key Words")).toBeTruthy());
    expect(api.state.sections.find((s) => s.title === "Key Words")).toMatchObject({ key: "key-words", phase: "text" });

    await user.click(within(study()).getByRole("button", { name: "Add a part" }));
    await user.type(within(study()).getByPlaceholderText("Your own heading"), "Hymns");
    await user.click(within(study()).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.state.sections.find((s) => s.title === "Hymns")).toBeTruthy());
    expect(api.state.sections.find((s) => s.title === "Hymns")).toMatchObject({ key: null, phase: null });
  });
});

describe("Save as my template", () => {
  it("keeps a study's structure — headings, guidance, order, phases — and none of its writing", async () => {
    const { api, project } = await setup();
    const detail = await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "passage", primaryPassage: "PSA.23", description: "For the men's group" });
    const text = detail.sections[0]!;
    await api.studyBlockUpdate({ id: text.blocks[0]!.id, content: "The vine and the branches, written out by me." });
    await api.studySectionUpdate({ id: detail.sections[1]!.id, title: "What I notice" });
    await api.studySectionCreate({ studyId: detail.study.id, title: "Hymns" });
    const user = await openStudy(api, "Abiding");

    await user.click(within(study()).getByRole("button", { name: "Bible Study information" }));
    await user.click(await screen.findByRole("button", { name: "Save as my template" }));
    const form = screen.getByRole("form", { name: "Save this study’s structure as a template" });
    expect(form).toHaveTextContent("keeps this study’s 7 parts");
    expect(form).toHaveTextContent("Your writing, notes, passages and details stay in this study.");
    const name = within(form).getByLabelText("Name of the template");
    expect(name).toHaveValue("Abiding");
    await user.clear(name);
    await user.type(name, "My passage study");
    await user.click(within(form).getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(screen.getByText(/Saved as your template “My passage study”/)).toBeInTheDocument());

    const mine = api.state.templates.find((t) => t.name === "My passage study")!;
    expect(mine.isBuiltin).toBe(false);
    expect(mine.studyType).toBe("passage");
    expect(mine.description).toBeNull();
    expect(mine.sections.map((s) => [s.title, s.phase ?? null])).toEqual([
      ["Text", "text"],
      ["What I notice", "text"],
      ["Context", "text"],
      ["Meaning", "understanding"],
      ["Theology", "theology"],
      ["Application", "application"],
      ["Hymns", null],
    ]);
    expect(mine.sections[0]!.guidance).toMatch(/The passage being studied/);
    const json = JSON.stringify(mine);
    expect(json).not.toMatch(/vine and the branches|men's group|PSA/);
    // The study itself is unchanged, and not tied to the new template.
    expect(api.state.studies.find((s) => s.id === detail.study.id)!.templateId).toBe(detail.study.templateId);

    // A new study from it starts with the same structure, and none of the writing.
    const again = await api.studyCreate({ projectId: project.id, title: "Psalm 23", templateId: mine.id });
    expect(again.sections.map((s) => s.title)).toEqual(mine.sections.map((s) => s.title));
    expect(again.sections.flatMap((s) => s.blocks).every((b) => b.content === "")).toBe(true);
  });

  it("gives every part one key of its own, keeping a built-in part's", () => {
    const base = { studyId: "s", guidance: null, position: 0, blocks: [], createdAt: "", updatedAt: "", revision: 1 };
    const parts = partsFromStudy([
      { ...base, id: "1", key: "text", title: "Text", phase: "text" },
      { ...base, id: "2", key: null, title: "Mine", phase: null },
      { ...base, id: "3", key: "text", title: "Text again", phase: "text" },
    ]);
    expect(parts[0]!.key).toBe("text");
    expect(parts[1]!.key).toMatch(/^own-/);
    expect(parts[2]!.key).toMatch(/^own-/);
    expect(new Set(parts.map((p) => p.key)).size).toBe(3);
  });
});

describe("review fixes (v0.18.7)", () => {
  it("gives focus back to Save as my template when its form closes, and says when a study cannot be a template", async () => {
    const { api, project } = await setup();
    await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "passage" });
    const user = await openStudy(api, "Abiding");
    await user.click(within(study()).getByRole("button", { name: "Bible Study information" }));
    const toggle = await screen.findByRole("button", { name: "Save as my template" });
    await user.click(toggle);
    await user.keyboard("{Escape}");
    expect(toggle).toHaveFocus();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(screen.getByText(/Saved as your template “Abiding”/)).toHaveAttribute("role", "status");
  });

  it("offers no built-in parts for later to a study whose own template was deleted", async () => {
    const { api, project } = await setup();
    const mine = await api.templateCreate({ name: "Mine", studyType: "passage", sections: [{ key: "own-a", title: "Read" }, { key: "own-b", title: "Later one", optional: true }] });
    await api.studyCreate({ projectId: project.id, title: "Abiding", templateId: mine.id });
    await api.templateDelete(mine.id);
    const user = await openStudy(api, "Abiding");
    await user.click(within(study()).getByRole("button", { name: "Add a part" }));
    expect(within(study()).queryByRole("group", { name: "Parts you might add" })).toBeNull();
  });

  it("refuses the same part twice in one study, and a key that is not a plain word", async () => {
    const { api, project } = await setup();
    const detail = await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "passage" });
    await expect(api.studySectionCreate({ studyId: detail.study.id, title: "Text again", key: "text" })).rejects.toThrow(/already has that part/);
    await expect(api.studySectionCreate({ studyId: detail.study.id, title: "Odd", key: "Not a key!" })).rejects.toThrow(/not valid/);
  });

  it("shows a part's new phase at once, as a 44 px control", async () => {
    const { api, project } = await setup();
    await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "passage" });
    const user = await openStudy(api, "Abiding");
    const meaning = within(study()).getByRole("region", { name: "Meaning" });
    await user.click(within(meaning).getByRole("button", { name: "Options for part Meaning" }));
    const select = within(meaning).getByLabelText("Where Meaning belongs in the study outline");
    expect(select).toHaveClass("h-11");
    await user.selectOptions(select, "theology");
    expect(select).toHaveValue("theology");
  });

  it("moves focus to New template… after a template is deleted, and back to Delete when it is kept", async () => {
    const { api } = await setup();
    await api.templateCreate({ name: "Mine", studyType: "custom", sections: [{ title: "One" }] });
    const { user } = await renderApp(api);
    const templates = await openSettingsSection(user, "Templates");
    const del = within(templates).getByRole("button", { name: "Delete Mine" });
    await user.click(del);
    await user.click(within(templates).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(within(templates).getByRole("button", { name: "Delete Mine" })).toHaveFocus());
    await user.click(within(templates).getByRole("button", { name: "Delete Mine" }));
    await user.click(within(templates).getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(within(templates).getByRole("button", { name: "New template…" })).toHaveFocus());
  });
});
