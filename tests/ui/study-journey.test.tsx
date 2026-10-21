import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { hasJourney, namesRun, phaseRuns, type Phase } from "@/features/studies/journey";
import type { StudySection } from "@/types/domain";
import passageStudy from "../../resources/templates/passage-study.json";
import teachingStudy from "../../resources/templates/teaching-study.json";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The study journey (v0.18.6, v0.18.7): a Bible Study's parts grouped into
// its movement from the text to teaching, where they stand, by the phase
// each part carries from its template, with an outline to find one's place
// and a quiet way on to a Bible Teaching. All text invented.

beforeEach(() => window.localStorage.clear());

const part = (key: string | null, title = key ?? "Mine", phase: Phase | null = null): StudySection => ({
  id: `${key ?? "own"}-${title}`,
  studyId: "s",
  key,
  title,
  guidance: null,
  phase,
  position: 0,
  blocks: [],
  createdAt: "",
  updatedAt: "",
  revision: 1,
});
/** The parts of a built-in template, with the phases it gives them. */
const builtin = (template: { sections: { key: string; title: string; phase?: string }[] }, keys: string[]) =>
  keys.map((k) => {
    const s = template.sections.find((x) => x.key === k)!;
    return part(k, s.title, (s.phase ?? null) as Phase | null);
  });

describe("the phases of a study", () => {
  it("group the parts of a passage study from the text to its application, in their own order", () => {
    const runs = phaseRuns(builtin(passageStudy, ["text", "observations", "context", "meaning", "theology", "application"]));
    expect(runs.map((r) => [r.phase, r.sections.map((s) => s.key)])).toEqual([
      ["text", ["text", "observations", "context"]],
      ["understanding", ["meaning"]],
      ["theology", ["theology"]],
      ["application", ["application"]],
    ]);
    expect(hasJourney(runs)).toBe(true);
  });

  it("follow an older study's full set of parts through audience to teaching", () => {
    const keys = ["text", "context", "observations", "structure", "exegesis", "theology", "application", "audience", "teaching"];
    expect(phaseRuns(builtin(passageStudy, keys)).map((r) => r.phase)).toEqual(["text", "understanding", "theology", "application", "audience", "teaching"]);
  });

  it("take each part's phase from its template, so the same part can mean another thing in another template", () => {
    const teaching = ["text", "main-idea", "exegesis", "theology", "purpose", "audience", "structure", "illustrations", "application", "teaching-outline"];
    expect(phaseRuns(builtin(teachingStudy, teaching)).map((r) => r.phase)).toEqual(["text", "understanding", "theology", "teaching"]);
    expect(builtin(passageStudy, ["structure"])[0]!.phase).toBe("text");
    expect(builtin(teachingStudy, ["structure"])[0]!.phase).toBe("teaching");
  });

  it("give every built-in part a phase, written in its template", async () => {
    const api = createMemoryApi();
    for (const template of await api.templateList()) {
      for (const section of template.sections) expect(section.phase, `${template.key}/${section.key}`).toBeTruthy();
    }
  });

  it("keep a part without a phase with the part before it, without giving it a meaning, and never reorder", () => {
    const sections = [part("text", "Text", "text"), part(null, "My questions"), part("meaning", "Meaning", "understanding"), part("theology", "Theology", "theology"), part(null, "Hymns")];
    const runs = phaseRuns(sections);
    expect(runs.map((r) => r.sections.map((s) => s.title))).toEqual([["Text", "My questions"], ["Meaning"], ["Theology", "Hymns"]]);
    expect(runs.flatMap((r) => r.sections)).toEqual(sections);
    // The part itself still has none.
    expect(sections[1]!.phase).toBeNull();
  });

  it("follow a template of the person's own: its own order, phases repeated, some left out", () => {
    const sections = [
      part(null, "Prayer"),
      part("user-1", "Read it slowly", "text"),
      part(null, "Who is it for?", "audience"),
      part(null, "Read it again", "text"),
      part(null, "Live it", "application"),
    ];
    const runs = phaseRuns(sections);
    expect(runs.map((r) => r.phase)).toEqual([null, "text", "audience", "text", "application"]);
    expect(hasJourney(runs)).toBe(true);
  });

  it("show a part of an earlier phase placed later as it is: a run of its own", () => {
    const runs = phaseRuns(builtin(passageStudy, ["text", "meaning", "theology", "application", "structure"]));
    expect(runs.map((r) => r.phase)).toEqual(["text", "understanding", "theology", "application", "text"]);
  });

  it("force no shape on a study of the person's own, or one with too little movement", () => {
    expect(phaseRuns([part(null, "Notes")])).toEqual([{ phase: null, sections: [expect.objectContaining({ title: "Notes" })] }]);
    expect(hasJourney(phaseRuns([part(null, "Notes"), part(null, "More")]))).toBe(false);
    expect(hasJourney(phaseRuns([part("word", "Word", "text"), part("occurrences", "Occurrences", "text"), part("semantic-range", "Range", "understanding")]))).toBe(false);
  });

  it("name a phase above its parts only when the first part does not already say it", () => {
    const title = (s: StudySection) => s.title;
    expect(namesRun({ phase: "theology", sections: [part("theology", "Theology")] }, "Theology", title)).toBe(false);
    expect(namesRun({ phase: "text", sections: [part("text", "Text"), part("context", "Context")] }, "Text", title)).toBe(false);
    expect(namesRun({ phase: "understanding", sections: [part("meaning", "Meaning")] }, "Understanding", title)).toBe(true);
    expect(namesRun({ phase: null, sections: [part(null)] }, "", title)).toBe(false);
  });
});

async function withStudy(studyType: "passage" | "custom" = "passage") {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const detail = await api.studyCreate({ projectId: project.id, title: "Abiding", studyType });
  return { api, detail };
}

async function openStudy(api: ReturnType<typeof createMemoryApi>) {
  const { user } = await renderApp(api);
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await screen.findByRole("textbox", { name: "Study title" });
  return user;
}
const study = () => screen.getByRole("main", { name: "Study" });

describe("the study's movement on screen", () => {
  it("shows an outline of its phases that takes the person to a phase and its first part", async () => {
    const { api } = await withStudy();
    const user = await openStudy(api);
    const outline = within(study()).getByRole("navigation", { name: "Study outline" });
    expect(within(outline).getAllByRole("button").map((b) => b.textContent)).toEqual(["Text", "Understanding", "Theology", "Application"]);
    await user.click(within(outline).getByRole("button", { name: "Go to Theology" }));
    expect(within(study()).getByRole("heading", { level: 2, name: "Theology" })).toHaveFocus();
  });

  it("names a phase above its first part only where it adds something; every part keeps its own heading", async () => {
    const { api } = await withStudy();
    await openStudy(api);
    const meaning = within(study()).getByRole("region", { name: "Meaning" });
    expect(meaning).toHaveTextContent(/^Understanding/);
    expect(within(study()).getByRole("region", { name: "Theology" })).not.toHaveTextContent(/^Theology.*Theology/);
    expect(within(study()).getByRole("region", { name: "Meaning" })).toHaveAttribute("data-phase-start", "1");
    expect(within(study()).getByRole("region", { name: "Observations" })).not.toHaveAttribute("data-phase-start");
    for (const name of ["Text", "Observations", "Context", "Meaning", "Theology", "Application"]) {
      expect(within(study()).getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  it("sets the part being worked in apart from the others, and folding still works part by part", async () => {
    const { api } = await withStudy();
    const user = await openStudy(api);
    const theology = within(study()).getByRole("region", { name: "Theology" });
    await user.click(within(theology).getByRole("button", { name: "Theology" }));
    // Folded: a folded part is never marked as the one being worked in.
    expect(within(theology).getByRole("button", { name: "Theology" })).toHaveAttribute("aria-expanded", "false");
    expect(theology).not.toHaveAttribute("data-active");
    await user.click(within(theology).getByRole("button", { name: "Theology" }));
    expect(theology).toHaveAttribute("data-active", "true");
    expect(within(study()).getByRole("region", { name: "Meaning" })).not.toHaveAttribute("data-active");
  });

  it("keeps a part as it is while it is moved, even when it then begins its phase", async () => {
    const { api } = await withStudy();
    const user = await openStudy(api);
    const observations = within(study()).getByRole("region", { name: "Observations" });
    await user.click(within(observations).getByRole("button", { name: "Options for part Observations" }));
    // Up to the start of the study: the part that begins the phase changes.
    await user.click(within(observations).getByRole("button", { name: "Move part Observations up" }));
    await waitFor(() => expect(within(study()).getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("Observations"));
    const moved = within(study()).getByRole("region", { name: "Observations" });
    expect(moved).toBe(observations);
    expect(within(moved).getByRole("button", { name: "Move part Observations up" })).toHaveFocus();
  });

  it("offers a Bible Teaching at its end, quietly, and opens the one prepared once there is one", async () => {
    const { api, detail } = await withStudy();
    const user = await openStudy(api);
    const end = await within(study()).findByRole("complementary", { name: "Bible Teaching" });
    expect(end).toHaveTextContent("this study can become a Bible Teaching");
    await user.click(within(end).getByRole("button", { name: "Prepare a Bible Teaching" }));
    expect(within(study()).getByRole("button", { name: "Bible Teaching", pressed: true })).toBeInTheDocument();

    await api.teachingCreate({ studyId: detail.study.id, title: "Remain in the vine", kind: "sermon" });
    await user.click(within(study()).getByRole("button", { name: "Bible Study" }));
    // Back at the study, its end names what was prepared, without leaving and coming back.
    await waitFor(() => expect(within(study()).getByRole("complementary", { name: "Bible Teaching" })).toHaveTextContent("Prepared from this study: Remain in the vine"));
  });

  it("names the Bible Teaching already prepared instead of offering to make one", async () => {
    const { api, detail } = await withStudy();
    await api.teachingCreate({ studyId: detail.study.id, title: "Remain in the vine", kind: "sermon" });
    await openStudy(api);
    const end = await within(study()).findByRole("complementary", { name: "Bible Teaching" });
    await waitFor(() => expect(end).toHaveTextContent("Prepared from this study: Remain in the vine"));
    expect(within(end).getByRole("button", { name: "Open the Bible Teaching" })).toBeInTheDocument();
    expect(within(end).queryByRole("button", { name: "Prepare a Bible Teaching" })).not.toBeInTheDocument();
  });

  it("shows no outline and no phase names for a study of the person's own shape", async () => {
    const { api } = await withStudy("custom");
    await openStudy(api);
    expect(within(study()).queryByRole("navigation", { name: "Study outline" })).not.toBeInTheDocument();
    expect(within(study()).getByRole("heading", { level: 2, name: "Notes" })).toBeInTheDocument();
  });
});
