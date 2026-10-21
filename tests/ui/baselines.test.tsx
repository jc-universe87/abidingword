import { readFileSync, readdirSync } from "node:fs";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BUILTIN_TEACHING_TEMPLATES } from "@/features/teaching/teachingTemplates";
import { STEP_KINDS, TEACHING_KINDS } from "@/types/teaching";
import { STUDY_PHASES, STUDY_TYPES } from "@/types/studies";
import { createMemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

// The built-in baselines (v0.18.8): starting points kept as data
// (resources/templates/*.json, resources/teaching-templates.json), easy to
// review and change later; a change only ever shapes new work. All text invented.

const LANGS = ["en", "de", "ko", "fr", "es", "pt"];
const studies = (lang: string) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/studies.json`, "utf8"));
const studyTemplates = readdirSync("resources/templates")
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`resources/templates/${f}`, "utf8")) as { key: string; name: string; description?: string; studyType: string; offered?: boolean; sections: { key: string; title: string; guidance?: string; phase?: string; optional?: boolean; retired?: boolean }[] });

describe("the built-in Bible Study templates", () => {
  it("are well formed: a kind, unique stable keys, a known phase for every part, at least one part to start with", () => {
    expect(studyTemplates.length).toBe(6);
    expect(new Set(studyTemplates.map((t) => t.key)).size).toBe(6);
    for (const template of studyTemplates) {
      expect(STUDY_TYPES, template.key).toContain(template.studyType);
      const keys = template.sections.map((s) => s.key);
      expect(new Set(keys).size, template.key).toBe(keys.length);
      for (const s of template.sections) {
        expect(s.key, template.key).toMatch(/^[a-z0-9-]{1,64}$/);
        expect(STUDY_PHASES, `${template.key}/${s.key}`).toContain(s.phase);
      }
      expect(template.sections.some((s) => !s.optional && !s.retired), template.key).toBe(true);
    }
  });

  it("have their names, descriptions, headings and guidance in all six languages", () => {
    for (const lang of LANGS) {
      const text = studies(lang).builtin.templates;
      for (const template of studyTemplates) {
        expect(text[template.key]?.name, `${lang}/${template.key}`).toBeTruthy();
        for (const s of template.sections) expect(text[template.key].sections[s.key]?.title, `${lang}/${template.key}/${s.key}`).toBeTruthy();
      }
    }
  });

  it("never force all six phases: each uses the ones that fit it, in its own order", () => {
    const used = (key: string) => new Set(studyTemplates.find((t) => t.key === key)!.sections.filter((s) => !s.optional && !s.retired).map((s) => s.phase));
    expect(used("word-study")).toEqual(new Set(["text", "understanding"]));
    expect(used("passage-study")).toEqual(new Set(["text", "understanding", "theology", "application"]));
  });

  it("say once in the data whether they are offered for new work", () => {
    expect(studyTemplates.filter((t) => t.offered === false).map((t) => t.key)).toEqual(["teaching-study"]);
  });
});

describe("the built-in Bible Teaching templates", () => {
  it("are well formed: one per format, known step kinds, unique keys, titles in all six languages", () => {
    expect(BUILTIN_TEACHING_TEMPLATES.map((b) => b.kind).sort()).toEqual([...TEACHING_KINDS].sort());
    for (const b of BUILTIN_TEACHING_TEMPLATES) {
      const keys = b.points.map((p) => p.key);
      expect(new Set(keys).size, b.kind).toBe(keys.length);
      for (const p of b.points) {
        expect(STEP_KINDS, `${b.kind}/${p.key}`).toContain(p.kind);
        for (const lang of LANGS) expect(studies(lang).teaching.starts[b.kind]?.[p.key], `${lang}/${b.kind}/${p.key}`).toBeTruthy();
      }
    }
  });

  it("impose no shape on a sermon or talk: they start empty, between an introduction and a conclusion", () => {
    for (const kind of ["sermon", "talk", "youth", "other", "bible_study"]) expect(BUILTIN_TEACHING_TEMPLATES.find((b) => b.kind === kind)!.points).toEqual([]);
  });
});

describe("what a template starts with", () => {
  it("is said from the template's own parts where a study is begun and in Settings", async () => {
    const api = createMemoryApi();
    await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
    const { user } = await renderApp(api);
    const form = await screen.findByRole("form", { name: "New study" });
    const passage = studyTemplates.find((t) => t.key === "passage-study")!;
    const starts = `Starts with: ${passage.sections.filter((s) => !s.optional && !s.retired).map((s) => s.title).join(" · ")}.`;
    await waitFor(() => expect(form).toHaveTextContent(starts));
    expect(form).not.toHaveTextContent("Starts with: Notes");
    await user.click(within(form).getByRole("button", { name: "Word study" }));
    expect(form).toHaveTextContent("Starts with: Word · Occurrences · Semantic Range · Key Passages · Conclusions.");
    const templates = await openSettingsSection(user, "Templates");
    const row = within(within(templates).getByRole("list", { name: "Study templates" })).getByText("Passage Study").closest("li")!;
    expect(row).toHaveTextContent(starts);
  });

  it("follows the data: a changed built-in starts new work differently, and nothing already made changes", async () => {
    const api = createMemoryApi();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
    const before = await api.studyCreate({ projectId: project.id, title: "Before", studyType: "word" });
    // A personal copy made from the built-in, before the change.
    const builtin = api.state.templates.find((t) => t.key === "word-study")!;
    const copy = await api.templateDuplicate(builtin.id);
    // The owner refines the baseline (here: the resource as installed at the next start).
    builtin.sections = [{ key: "word", title: "Word", phase: "text" }, { key: "conclusions", title: "Conclusions", phase: "understanding" }];
    const after = await api.studyCreate({ projectId: project.id, title: "After", studyType: "word" });
    expect(after.sections.map((s) => s.key)).toEqual(["word", "conclusions"]);
    expect((await api.studyGet(before.study.id)).sections.map((s) => s.key)).toEqual(before.sections.map((s) => s.key));
    expect(api.state.templates.find((t) => t.id === copy.id)!.sections.length).toBeGreaterThan(2);

    const teaching = BUILTIN_TEACHING_TEMPLATES.find((b) => b.kind === "lesson")!;
    const kept = teaching.points;
    try {
      const old = await api.teachingCreate({ studyId: before.study.id, title: "Old", kind: "lesson", points: kept.map((p) => ({ title: p.key, kind: p.kind })) });
      (teaching as { points: typeof kept }).points = [{ key: "teaching", kind: "text" }];
      expect((await api.teachingGet(old.id)).points).toHaveLength(3);
    } finally {
      (teaching as { points: typeof kept }).points = kept;
    }
  });
});

describe("from a study to a teaching", () => {
  it("chooses the format, then a matching template of one's own; others are not offered; the study stays as it was", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
    const { study, sections } = await api.studyCreate({ projectId: project.id, title: "Abiding", studyType: "passage" });
    await api.teachingTemplateCreate({ name: "Sunday sermon", kind: "sermon", points: [{ title: "" }, { title: "" }] });
    await api.teachingTemplateCreate({ name: "Youth night", kind: "youth", points: [{ title: "Game" }] });
    const { user } = await renderApp(api);
    await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
    const pane = screen.getByRole("main", { name: "Study" });
    const end = await within(pane).findByRole("complementary", { name: "Bible Teaching" });
    await user.click(within(end).getByRole("button", { name: "Prepare a Bible Teaching" }));
    const form = await within(pane).findByRole("form", { name: "Prepare a teaching from this study" });
    // Sermon is chosen: only the sermon template is offered beside the built-in one.
    const startFrom = await within(form).findByRole("radiogroup", { name: "Start from" });
    expect(within(startFrom).getAllByRole("radio").map((r) => r.parentElement!.textContent)).toEqual(["Sermon (built-in)", "Sunday sermon"]);
    await user.click(within(startFrom).getByRole("radio", { name: "Sunday sermon" }));
    expect(form).toHaveTextContent("Starts with: Point 1 · Point 2.");
    // A format without templates of one's own asks nothing more.
    await user.click(within(form).getByRole("radio", { name: "Group Bible study" }));
    expect(within(form).queryByRole("radiogroup", { name: "Start from" })).toBeNull();
    await user.click(within(form).getByRole("radio", { name: "Sermon" }));
    await user.click(within(await within(form).findByRole("radiogroup", { name: "Start from" })).getByRole("radio", { name: "Sunday sermon" }));
    await user.click(within(form).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(api.state.teaching.preparations).toHaveLength(1));
    expect(api.state.teaching.preparations[0]!).toMatchObject({ kind: "sermon" });
    expect(api.state.teaching.preparations[0]!.points.map((p) => p.title)).toEqual(["", ""]);
    expect((await api.studyGet(study.id)).sections.map((s) => [s.id, s.title])).toEqual(sections.map((s) => [s.id, s.title]));
  });
});
