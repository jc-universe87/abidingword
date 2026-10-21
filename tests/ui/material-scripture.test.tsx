import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { derive, toMarkdown } from "@/features/materials/derive";
import type { MaterialScripture } from "@/types/scripture";
import type { TeachingPreparation } from "@/types/teaching";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The Bible passage on a material (v0.18.8): asked for explicitly, read from
// the Bible chosen in the Scripture pane and only from it, in verse order
// with verse numbers; a verse that Bible lacks is named, never filled in.
// All text invented.

beforeEach(() => window.localStorage.clear());
const t = i18n.t.bind(i18n);

const ref = (canonical: string, display: string, start: number, end: number) => ({ book: "JHN", startChapter: 15, startVerse: start, endChapter: 15, endVerse: end, canonical, display });
const prep = (fields: Partial<TeachingPreparation> = {}): TeachingPreparation => ({
  id: "prep", studyId: "s", title: "Remain in the vine", kind: "bible_study", audience: null, purpose: null, centralMessage: "LEADER ONLY",
  introduction: "", conclusion: "", notes: "", findings: [], materials: [], createdAt: "", updatedAt: "", revision: 1,
  points: [{ id: "q1", position: 0, kind: null, title: "What does remain mean?", explanation: "LEADER: it may lead to v9", application: "", illustration: "" }],
  passages: [{ id: "a", pointId: null, reference: ref("JHN.15.1-JHN.15.3", "John 15:1-3", 1, 3) }, { id: "b", pointId: "q1", reference: ref("JHN.15.9", "John 15:9", 9, 9) }],
  ...fields,
});
const text = (shortName: string, verses: [number, string][], missing: string[] = [], copyrightNotice: string | null = null): MaterialScripture => ({
  translationId: "x", name: shortName, shortName, copyrightNotice,
  passages: [{ canonical: "JHN.15.1-JHN.15.3", verses: verses.map(([verse, words]) => ({ canonical: `JHN.15.${verse}`, chapter: 15, verse, text: words })), missing }],
});

describe("the passage's text in the material model", () => {
  it("is there only when asked for, after the reference, in verse order with numbers, from the one Bible given", () => {
    const korean = text("개역한글", [[1, "나는 참포도나무요"], [2, "무릇 내게 붙어 있어"], [3, "너희는 내가 일러준 말로"]], [], "대한성서공회");
    expect(derive(t, "questions", prep(), {}, korean).blocks.some((b) => b.type === "scripture")).toBe(false);
    const doc = derive(t, "questions", prep(), { includePassage: true }, korean);
    expect(doc.blocks.map((b) => b.type).slice(0, 3)).toEqual(["title", "passages", "scripture"]);
    const block = doc.blocks[2]!;
    expect(block).toMatchObject({ type: "scripture", label: "John 15:1–3 · 개역한글", attribution: "대한성서공회" });
    expect(block.type === "scripture" && block.verses.map((v) => v.verse)).toEqual([1, 2, 3]);
    // Only the whole teaching's passage; a question's own passage is not dumped in.
    expect(doc.blocks.filter((b) => b.type === "scripture")).toHaveLength(1);
    const md = toMarkdown(doc);
    expect(md).toContain("**1** 나는 참포도나무요 **2** 무릇 내게 붙어 있어 **3** 너희는 내가 일러준 말로");
    // The passage text never brings leader notes onto the group's sheet.
    expect(md).not.toMatch(/LEADER/);
    // A passage alone is not something to hand out: the sheet without questions stays empty.
    expect(derive(t, "questions", prep({ points: [] }), { includePassage: true }, korean).empty).toBe(true);
  });

  it("names what the Bible lacks and fills in nothing", () => {
    const german = text("LUT", [[1, "Ich bin ein rechter Weinstock"], [3, "Ihr seid schon rein"]], ["15:2"]);
    const doc = derive(t, "manuscript", prep({ kind: "sermon" }), { includePassage: true }, german);
    const block = doc.blocks.find((b) => b.type === "scripture")!;
    expect(block.type === "scripture" && block.verses.map((v) => v.verse)).toEqual([1, 3]);
    expect(block).toMatchObject({ note: "The LUT has no text for verse 15:2; it is left out, not taken from another Bible." });
    const none = derive(t, "manuscript", prep({ kind: "sermon" }), { includePassage: true }, text("LUT", [], ["15:1", "15:2", "15:3"]));
    expect(none.blocks.find((b) => b.type === "scripture")).toMatchObject({ verses: [], note: "The LUT has no text for this passage. Only the reference is shown." });
  });

  it("keeps a long passage whole", () => {
    const long = text("BSB", Array.from({ length: 60 }, (_, i) => [i + 1, `Verse ${i + 1} ${"word ".repeat(30)}`] as [number, string]));
    const block = derive(t, "manuscript", prep({ kind: "sermon" }), { includePassage: true }, long).blocks.find((b) => b.type === "scripture")!;
    expect(block.type === "scripture" && block.verses.length).toBe(60);
  });
});

describe("Include Bible passage, on screen", () => {
  async function setup() {
    const api = createMemoryApi();
    const bible = api.installFixtureBible("FXA", "alpha");
    api.installFixtureBible("FXB", "beta");
    api.state.settings.scriptureTranslationId = bible.id;
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
    const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
    const created = await api.teachingCreate({ studyId: study.id, title: "Remain in the vine", kind: "sermon", points: [{ title: "Stay connected" }] });
    await api.teachingPassageAdd({ preparationId: created.id, reference: "JHN.15.1-JHN.15.8" });
    return api;
  }
  const pane = () => screen.getByRole("main", { name: "Study" });

  it("reads the passage from the Bible chosen in the Scripture pane, says what it lacks, and never uses another", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
    await user.click(await within(pane()).findByRole("button", { name: "Bible Teaching" }));
    await within(pane()).findByRole("article", { name: "Remain in the vine" });
    await user.click(within(pane()).getByRole("button", { name: "Materials" }));
    await user.click(within(pane()).getByRole("menuitem", { name: /Manuscript/ }));
    const page = await within(pane()).findByRole("article", { name: /preview/i });
    expect(page).not.toHaveTextContent("Fixture alpha");
    await user.click(within(pane()).getByRole("checkbox", { name: "Include Bible passage (FXA)" }));
    await waitFor(() => expect(page).toHaveTextContent("Fixture alpha JHN 15:1 about the vine."));
    expect(page).toHaveTextContent("Fixture alpha JHN 15:7.");
    expect(page).not.toHaveTextContent("Fixture beta");
    expect(page).toHaveTextContent("The FXA has no text for verse 15:8; it is left out, not taken from another Bible.");
    // Turned off again: only the reference.
    await user.click(within(pane()).getByRole("checkbox", { name: "Include Bible passage (FXA)" }));
    expect(page).not.toHaveTextContent("Fixture alpha");
  });
});
