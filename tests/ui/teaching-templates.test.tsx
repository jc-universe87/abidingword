import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { derive } from "@/features/materials/derive";
import { BUILTIN_TEACHING_TEMPLATES, templateFromTeaching } from "@/features/teaching/teachingTemplates";
import { TEACHING_KINDS } from "@/types/teaching";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

// Bible Teaching templates (v0.18.7): what a new teaching starts with, its
// format and its points, questions or steps. Built-in ones stay as they
// are; the person's own are made, edited, duplicated and deleted; a teaching
// takes a copy and is never linked to its template afterwards. All text is
// invented.

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  await api.studyPassageAdd({ studyId: study.id, reference: "JHN.15.1-JHN.15.8" });
  return { api, studyId: study.id };
}
const studyPane = () => screen.getByRole("main", { name: "Study" });

async function openTeaching(api: MemoryApi) {
  const { user } = await renderApp(api);
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
  await user.click(within(studyPane()).getByRole("button", { name: "Bible Teaching" }));
  return user;
}
const newForm = () => within(studyPane()).getByRole("form", { name: "Prepare a teaching from this study" });

async function openAbout(user: User, article: HTMLElement) {
  const toggle = within(article).getByRole("button", { name: /^About this teaching/ });
  if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
  return within(article).getByRole("region", { name: "About this teaching" });
}

describe("the built-in Bible Teaching templates", () => {
  it("are one per format, from the starting structures teachings had before", () => {
    expect(BUILTIN_TEACHING_TEMPLATES.map((b) => b.kind)).toEqual([...TEACHING_KINDS]);
    expect(BUILTIN_TEACHING_TEMPLATES.find((b) => b.kind === "children")!.points.map((p) => [p.key, p.kind])).toEqual([
      ["welcome", "text"], ["story", "scripture"], ["question", "question"], ["activity", "activity"], ["prayer", "text"],
    ]);
    expect(BUILTIN_TEACHING_TEMPLATES.find((b) => b.kind === "lesson")!.points.map((p) => p.key)).toEqual(["teaching", "discussion", "activity"]);
    for (const kind of ["sermon", "bible_study", "youth", "talk", "other"]) expect(BUILTIN_TEACHING_TEMPLATES.find((b) => b.kind === kind)!.points).toEqual([]);
  });

  it("are listed in Settings without a way to change them, only to save one as the person's own", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const templates = await openSettingsSection(user, "Templates");
    const list = within(templates).getByRole("list", { name: "Bible Teaching templates" });
    const children = within(list).getByText("Children").closest("li")!;
    expect(children).toHaveTextContent("Starts with: Welcome · Bible story · Question · Activity · Prayer.");
    expect(children).toHaveTextContent("Built-in");
    expect(within(children).queryByRole("button", { name: /^Edit|^Delete/ })).toBeNull();
    await user.click(within(children).getByRole("button", { name: "Save Children as my template" }));
    // The person's own copy opens to be changed; the built-in stays as it is.
    const sheet = await screen.findByRole("dialog", { name: "Edit Bible Teaching template" });
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Children (copy)");
    expect(api.state.teaching.templates).toHaveLength(1);
    expect(api.state.teaching.templates[0]!.points.map((p) => p.title)).toEqual(["Welcome", "Bible story", "Question", "Activity", "Prayer"]);
    expect(BUILTIN_TEACHING_TEMPLATES.find((b) => b.kind === "children")!.points).toHaveLength(5);
  });
});

describe("a Bible Teaching template of one's own", () => {
  it("is designed with a format and its steps, each with its kind, reordered by buttons", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const templates = await openSettingsSection(user, "Templates");
    await user.click(within(templates).getByRole("button", { name: "New Bible Teaching template…" }));
    const sheet = await screen.findByRole("dialog", { name: "New Bible Teaching template" });
    await user.type(within(sheet).getByRole("textbox", { name: "Name" }), "Youth evening");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Format" }), "youth");
    // A youth teaching is in points: no step kinds offered.
    await user.click(within(sheet).getByRole("button", { name: "Add a point" }));
    expect(within(sheet).queryByRole("combobox", { name: /Kind of step/ })).toBeNull();
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Format" }), "children");
    await user.type(within(sheet).getByRole("textbox", { name: "Title of step 1" }), "Game");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Kind of step: Game" }), "activity");
    await user.click(within(sheet).getByRole("button", { name: "Add a step" }));
    await user.type(within(sheet).getByRole("textbox", { name: "Title of step 2" }), "Bible story");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Kind of step: Bible story" }), "scripture");
    await user.click(within(sheet).getByRole("button", { name: "Move Bible story up" }));
    expect(within(sheet).getByRole("button", { name: "Move Bible story down" })).toHaveFocus();
    await user.click(within(sheet).getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const mine = api.state.teaching.templates[0]!;
    expect(mine).toMatchObject({ name: "Youth evening", kind: "children" });
    expect(mine.points.map((p) => [p.title, p.kind])).toEqual([["Bible story", "scripture"], ["Game", "activity"]]);
    const row = within(within(templates).getByRole("list", { name: "Bible Teaching templates" })).getByText("Youth evening").closest("li")!;
    expect(row).toHaveTextContent("Starts with: Bible story · Game.");
    for (const name of ["Edit Youth evening", "Duplicate Youth evening", "Delete Youth evening"]) expect(within(row).getByRole("button", { name })).toBeInTheDocument();
  });

  it("starts a teaching as a copy: later edits and deletion never change it", async () => {
    const { api } = await setup();
    await api.teachingTemplateCreate({ name: "Youth evening", kind: "children", points: [{ title: "Game", kind: "activity" }, { key: "story", title: "Bible story", kind: "scripture" }, { title: "", kind: "question" }] });
    const user = await openTeaching(api);
    const form = newForm();
    expect(within(form).getByRole("group", { name: "What would you like to prepare?" })).toBeInTheDocument();
    const own = await within(form).findByRole("group", { name: "Your templates" });
    await user.click(within(own).getByRole("radio", { name: "Youth evening" }));
    expect(form).toHaveTextContent("Starts with: Game · Bible story · Step 3.");
    expect(within(form).getByRole("textbox", { name: "Title" })).toHaveAttribute("placeholder", "Youth evening · Abiding");
    await user.click(within(form).getByRole("button", { name: "Start" }));
    const article = await within(studyPane()).findByRole("article", { name: "Youth evening · Abiding" });
    const made = api.state.teaching.preparations[0]!;
    expect(made.kind).toBe("children");
    expect(made.points.map((p) => [p.title, p.kind])).toEqual([["Game", "activity"], ["Bible story", "scripture"], ["", "question"]]);
    expect(within(article).getByRole("heading", { name: "Lesson plan" })).toBeInTheDocument();

    const template = api.state.teaching.templates[0]!;
    await api.teachingTemplateUpdate({ id: template.id, name: "Changed", kind: "sermon", points: [] });
    await api.teachingTemplateDelete(template.id);
    expect(api.state.teaching.preparations[0]!.points.map((p) => p.title)).toEqual(["Game", "Bible story", ""]);
    expect(api.state.teaching.preparations[0]!.kind).toBe("children");
  });

  it("starts as before from a built-in one: a lesson with its steps in the person's language", async () => {
    const { api } = await setup();
    const user = await openTeaching(api);
    await user.click(within(newForm()).getByRole("radio", { name: "Lesson" }));
    expect(newForm()).toHaveTextContent("Starts with: Teaching · Discussion · Activity.");
    await user.click(within(newForm()).getByRole("button", { name: "Start" }));
    await within(studyPane()).findByRole("article", { name: "Lesson · Abiding" });
    expect(api.state.teaching.preparations[0]!.points.map((p) => [p.title, p.kind])).toEqual([["Teaching", "text"], ["Discussion", "question"], ["Activity", "activity"]]);
  });

  it("can be duplicated and deleted in Settings, with a confirmation that says teachings stay", async () => {
    const { api } = await setup();
    await api.teachingTemplateCreate({ name: "Youth evening", kind: "youth", points: [{ title: "" }] });
    const { user } = await renderApp(api);
    const templates = await openSettingsSection(user, "Templates");
    await user.click(within(templates).getByRole("button", { name: "Duplicate Youth evening" }));
    await waitFor(() => expect(api.state.teaching.templates.map((x) => x.name).sort()).toEqual(["Youth evening", "Youth evening (copy)"]));
    await user.click(await within(templates).findByRole("button", { name: "Delete Youth evening (copy)" }));
    const confirm = within(templates).getByRole("alertdialog", { name: "Delete Youth evening (copy)?" });
    expect(confirm).toHaveTextContent("Bible Teachings already made from it are not affected.");
    expect(within(confirm).getByRole("button", { name: "Keep it" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(api.state.teaching.templates.map((x) => x.name)).toEqual(["Youth evening"]));
  });
});

describe("Save as my template, from a teaching", () => {
  it("keeps a lesson's steps with their titles and kinds, and nothing written in it", async () => {
    const { api, studyId } = await setup();
    const prep = await api.teachingCreate({ studyId, title: "Sunday kids", kind: "children", points: [{ title: "Welcome", kind: "text" }, { title: "Grapes", kind: "activity" }] });
    const id = prep.points[1]!.id;
    await api.teachingPointUpdate({ id, explanation: "Pass the grapes round, slowly.", illustration: "A bowl of grapes" });
    await api.teachingUpdate({ id: prep.id, audience: "Six-year-olds", purpose: "Stay close", centralMessage: "Jesus is the vine.", introduction: "Hello everyone", notes: "Ask Anna" });
    const user = await openTeaching(api);
    const article = await within(studyPane()).findByRole("article", { name: "Sunday kids" });
    const about = await openAbout(user, article);
    await user.click(within(about).getByRole("button", { name: "Save as my template" }));
    const form = within(about).getByRole("form", { name: "Save this teaching's structure as a template" });
    expect(form).toHaveTextContent("keeps the format and the steps in order, each with its title and kind");
    expect(form).toHaveTextContent("Nothing you wrote comes with it");
    expect(within(form).getByRole("textbox", { name: "Name of the template" })).toHaveValue("Sunday kids");
    await user.click(within(form).getByRole("button", { name: "Save template" }));
    expect(await within(about).findByRole("status")).toHaveTextContent("Saved as your template “Sunday kids”.");

    const mine = api.state.teaching.templates[0]!;
    expect(mine.kind).toBe("children");
    expect(mine.points).toEqual([{ title: "Welcome", kind: "text" }, { title: "Grapes", kind: "activity" }]);
    expect(JSON.stringify(mine)).not.toMatch(/grapes round|bowl|Six-year|Stay close|vine|Hello|Anna|JHN/);
  });

  it("keeps a sermon's number of points and a group study's number of questions, untitled: those are the teaching itself", () => {
    const point = (title: string) => ({ id: title, position: 0, kind: null, title, explanation: "x", application: "y", illustration: "z" });
    expect(templateFromTeaching({ kind: "sermon", points: [point("The vine is Christ"), point("We are branches")] })).toEqual({ kind: "sermon", points: [{ title: "" }, { title: "" }] });
    expect(templateFromTeaching({ kind: "bible_study", points: [point("What does remain mean?")] })).toEqual({ kind: "bible_study", points: [{ title: "" }] });
    // A teaching of no kind is saved as "other"; an audio step keeps its kind (kept for later, as in a teaching).
    expect(templateFromTeaching({ kind: null, points: [] })).toEqual({ kind: "other", points: [] });
    expect(templateFromTeaching({ kind: "lesson", points: [{ ...point("Song"), kind: "audio" }] })).toEqual({ kind: "lesson", points: [{ title: "Song", kind: "audio" }] });
  });
});

describe("Add a step", () => {
  it("adds a step of the kind chosen, from a menu reached by keyboard", async () => {
    const { api, studyId } = await setup();
    await api.teachingCreate({ studyId, title: "Sunday kids", kind: "children", points: [] });
    const user = await openTeaching(api);
    const article = await within(studyPane()).findByRole("article", { name: "Sunday kids" });
    const add = within(article).getByRole("button", { name: /Add a step/ });
    expect(add).toHaveAttribute("aria-haspopup", "menu");
    add.focus();
    await user.keyboard("{Enter}");
    const menu = within(article).getByRole("menu", { name: "Kind of step to add" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Teaching", "Bible reading", "Question", "Activity", "Picture"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Activity" }));
    await waitFor(() => expect(api.state.teaching.preparations[0]!.points.map((p) => p.kind)).toEqual(["activity"]));
  });
});

describe("Materials from a teaching made with one's own template", () => {
  it("show what the teaching has, and invent nothing for what it does not", async () => {
    const { api, studyId } = await setup();
    const t = i18n.t.bind(i18n);
    const lesson = await api.teachingGet((await api.teachingCreate({ studyId, title: "Evening", kind: "children", points: [{ title: "Game", kind: "activity" }, { title: "", kind: "question" }] })).id);
    const guide = derive(t, "manuscript", lesson);
    // The named step is there with its kind; the untitled, unwritten one is left out; no field is made up.
    expect(guide.blocks.filter((b) => b.type !== "title")).toEqual([{ type: "heading", text: "Step 1: Game", detail: "Activity" }]);
    // A group study from a template of untitled questions has nothing to hand out yet, and says so.
    const group = await api.teachingGet((await api.teachingCreate({ studyId, title: "Group", kind: "bible_study", points: [{ title: "" }, { title: "" }] })).id);
    const sheet = derive(t, "questions", group);
    expect(sheet.empty).toBe(true);
    expect(sheet.blocks.filter((b) => b.type === "question")).toEqual([]);
    const sermon = await api.teachingGet((await api.teachingCreate({ studyId, title: "Sunday", kind: "sermon", points: [{ title: "" }, { title: "" }, { title: "" }] })).id);
    expect(derive(t, "manuscript", sermon).empty).toBe(true);
  });
});

describe("review fixes (v0.18.7)", () => {
  it("says when a teaching has more steps than a template can start with, and keeps focus on its toggle", async () => {
    const { api, studyId } = await setup();
    await api.teachingCreate({ studyId, title: "Long", kind: "children", points: Array.from({ length: 20 }, (_, i) => ({ title: `Step ${i}`, kind: "text" as const })) });
    const prep = api.state.teaching.preparations[0]!;
    await api.teachingPointCreate({ preparationId: prep.id, title: "One more", kind: "activity" });
    const user = await openTeaching(api);
    const article = await within(studyPane()).findByRole("article", { name: "Long" });
    const about = await openAbout(user, article);
    const toggle = within(about).getByRole("button", { name: "Save as my template" });
    await user.click(toggle);
    const form = within(about).getByRole("form", { name: "Save this teaching's structure as a template" });
    expect(form).toHaveTextContent("at most 20 points, questions or steps");
    expect(within(form).getByRole("button", { name: "Save template" })).toBeDisabled();
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(toggle).toHaveFocus();
    expect(api.state.teaching.templates).toEqual([]);
  });

  it("gives focus back to Add a step when adding fails", async () => {
    const { api, studyId } = await setup();
    await api.teachingCreate({ studyId, title: "Kids", kind: "children", points: [] });
    const user = await openTeaching(api);
    const article = await within(studyPane()).findByRole("article", { name: "Kids" });
    api.teachingPointCreate = async () => {
      throw new Error("The disk is full.");
    };
    await user.click(within(article).getByRole("button", { name: /Add a step/ }));
    await user.click(within(article).getByRole("menuitem", { name: "Question" }));
    await waitFor(() => expect(within(article).getByRole("button", { name: /Add a step/ })).toHaveFocus());
  });
});
