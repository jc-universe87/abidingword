import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { derive, type MaterialDocument, type MaterialOptions } from "@/features/materials/derive";
import type { MaterialScripture } from "@/types/scripture";
import type { TeachingPoint, TeachingPreparation } from "@/types/teaching";

// The material documents the Word exporter is tested with (v0.18.8). The
// core's DOCX tests (src-tauri/tests/material_docx.rs) read them from
// FIXTURE; this test keeps that file exactly what derive() makes now, so
// the Word file is always tested against the documents the preview, the
// printed page and the Markdown show. Run with UPDATE_FIXTURES=1 to rewrite
// it after a deliberate change. All text invented; LEADER and PRIVATE mark
// what must never reach a sheet for the group.

const FIXTURE = "src-tauri/tests/fixtures/materials/documents.json";

const point = (n: number, fields: Partial<TeachingPoint>): TeachingPoint => ({ id: `p${n}`, position: n, kind: null, title: "", explanation: "", application: "", illustration: "", ...fields });
const prep = (fields: Partial<TeachingPreparation>): TeachingPreparation => ({
  id: "prep", studyId: "study", title: "Remain in the vine", kind: "sermon", audience: "PRIVATE audience", purpose: "PRIVATE purpose",
  centralMessage: null, introduction: "", conclusion: "", notes: "", points: [], findings: [], passages: [], materials: [], createdAt: "", updatedAt: "", revision: 1, ...fields,
});
const ref = { book: "JHN", startChapter: 15, startVerse: 1, endChapter: 15, endVerse: 3, canonical: "JHN.15.1-JHN.15.3", display: "John 15:1-3" };
const scripture = (shortName: string, verses: string[], missing: string[] = []): MaterialScripture => ({
  translationId: "x", name: shortName, shortName, copyrightNotice: null,
  passages: [{ canonical: ref.canonical, verses: verses.map((text, i) => ({ canonical: `JHN.15.${i + 1}`, chapter: 15, verse: i + 1, text })), missing }],
});

const GROUP = prep({
  kind: "bible_study",
  centralMessage: "LEADER: the group should discover rest.",
  // The opening and closing are the leader's words, on the group's sheet only when chosen.
  introduction: "OPENING: let us pray.",
  conclusion: "CLOSING: share one thing.",
  notes: "PRIVATE: bring extra Bibles.",
  passages: [{ id: "a", pointId: null, reference: ref }],
  points: [
    point(1, { title: "What does “remain” mean here?", explanation: "LEADER: it may lead to verse 9.", application: "LEADER: follow up on love.", illustration: "LEADER: let quiet people speak." }),
    point(2, { title: "", explanation: "LEADER: a question still to write." }),
    point(3, { title: "Where do you try harder?" }),
  ],
});
const SERMON = prep({
  centralMessage: "Fruit comes from remaining.",
  introduction: "Have you ever pruned a rose?\nIt looks harsh.",
  conclusion: "Stay close to him this week.",
  notes: "PRIVATE: thank the choir.",
  passages: [{ id: "a", pointId: null, reference: ref }],
  points: Array.from({ length: 12 }, (_, i) => point(i + 1, { title: `Point ${i + 1} <of> the vine & branches`, explanation: `Paragraph ${i + 1}. ${"The branch lives from the vine; it does not strain. ".repeat(40)}`, application: `Living it ${i + 1}.` })),
});
const LESSON = prep({
  kind: "children",
  centralMessage: "Jesus keeps us close.",
  passages: [{ id: "a", pointId: null, reference: ref }],
  points: [
    point(1, { kind: "text", title: "Welcome", explanation: "LEADER: say hello." }),
    point(2, { kind: "question", title: "What does a branch need?", explanation: "LEADER: listen for “the vine”." }),
    point(3, { kind: "activity", title: "Draw a vine", explanation: "LEADER: hand out crayons.", illustration: "LEADER: crayons, paper" }),
  ],
});
const KOREAN = prep({
  title: "포도나무에 붙어 있으라",
  kind: "bible_study",
  passages: [{ id: "a", pointId: null, reference: ref }],
  points: [point(1, { title: `‘거하라’는 말은 무슨 뜻입니까? ${"가지는 포도나무에서 생명을 얻습니다. ".repeat(30)}`, explanation: "LEADER: 9절로 이어질 수 있습니다." }), point(2, { title: "어디에서 더 애쓰고 있습니까?" })],
});
const GERMAN = prep({
  title: "Bleibt in mir – Gemeindebibelstundenvorbereitungsunterlagen",
  kind: "bible_study",
  points: [point(1, { title: "Was bedeutet „bleiben“ für Glaubensgeschwisterverhältnisse in unserer Gemeindewirklichkeit?", explanation: "LEADER: kann zu Vers 9 führen." })],
});

const t = i18n.t.bind(i18n);
const make = (name: string, p: TeachingPreparation, kind: MaterialDocument["kind"], options: MaterialOptions, text: MaterialScripture | null, language = "en") => {
  const fixed = i18n.getFixedT(language);
  return { name, participant: !options.leader && kind !== "manuscript", document: derive(language === "en" ? t : fixed, kind, p, options, text) };
};

function documents() {
  return [
    make("group-sheet", GROUP, "questions", { includePassage: true }, scripture("BSB", ["I am the true vine.", "Every branch in me…", "You are already clean."])),
    make("group-sheet-with-frame", GROUP, "questions", { includeFrame: true }, null),
    make("leader-version", GROUP, "questions", { leader: true }, null),
    make("leader-guide", GROUP, "manuscript", { includeNotes: false }, null),
    make("sermon-manuscript", SERMON, "manuscript", { includePassage: true }, scripture("BSB", ["I am the true vine."], ["15:2", "15:3"])),
    make("sermon-manuscript-with-notes", SERMON, "manuscript", { includeNotes: true }, null),
    make("listening-notes", SERMON, "worksheet", {}, null),
    make("lesson-worksheet", LESSON, "worksheet", {}, null),
    make("teacher-guide", LESSON, "manuscript", {}, null),
    make("korean-sheet", KOREAN, "questions", { includePassage: true }, scripture("개역한글", ["나는 참포도나무요 내 아버지는 농부라", "무릇 내게 붙어 있어 과실을 맺지 아니하는 가지는", "너희는 내가 일러준 말로 이미 깨끗하였으니"]), "ko"),
    make("german-leader", GERMAN, "questions", { leader: true }, null, "de"),
  ];
}

describe("the documents the Word exporter is tested with", () => {
  it("are exactly what the material model makes now", () => {
    const now = `${JSON.stringify(documents(), null, 1)}\n`;
    if (process.env.UPDATE_FIXTURES || !existsSync(FIXTURE)) writeFileSync(FIXTURE, now);
    expect(readFileSync(FIXTURE, "utf8")).toBe(now);
  });

  it("keep everything for the leader off the group's sheets, in the model itself", () => {
    for (const d of documents().filter((d) => d.participant)) expect(JSON.stringify(d.document), d.name).not.toMatch(/LEADER|PRIVATE/);
    expect(JSON.stringify(documents().find((d) => d.name === "leader-version")!.document)).toMatch(/LEADER/);
    const sheet = (name: string) => JSON.stringify(documents().find((d) => d.name === name)!.document);
    expect(sheet("group-sheet")).not.toMatch(/OPENING|CLOSING/);
    expect(sheet("group-sheet-with-frame")).toMatch(/OPENING[\s\S]*CLOSING/);
  });
});
