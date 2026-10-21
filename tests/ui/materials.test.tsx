import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { derive, manuscript, outputsFor, questionSheet, toMarkdown, worksheet, type Block } from "@/features/materials/derive";
import type { TeachingPoint, TeachingPreparation } from "@/types/teaching";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Teaching materials (v0.18.6): what a Bible Teaching becomes, put together
// from the person's own writing by fixed rules. Nothing is written for them,
// what is for the leader stays with the leader, and the teaching is never
// changed. All text is invented for the tests.

beforeEach(() => window.localStorage.clear());
const t = i18n.t.bind(i18n);

const point = (n: number, fields: Partial<TeachingPoint>): TeachingPoint => ({
  id: `p${n}`,
  position: n,
  kind: null,
  title: "",
  explanation: "",
  application: "",
  illustration: "",
  ...fields,
});
const prep = (fields: Partial<TeachingPreparation>): TeachingPreparation => ({
  id: "prep",
  studyId: "study",
  title: "Remain in the vine",
  kind: "sermon",
  audience: "Young families",
  purpose: "That we stay close to Jesus",
  centralMessage: null,
  introduction: "",
  conclusion: "",
  notes: "",
  points: [],
  findings: [],
  passages: [],
  materials: [],
  createdAt: "",
  updatedAt: "",
  revision: 1,
  ...fields,
});
const ref = { book: "JHN", startChapter: 15, startVerse: 1, endChapter: 15, endVerse: 8, canonical: "JHN.15.1-JHN.15.8", display: "John 15:1-8" };

const SERMON = prep({
  centralMessage: "Fruit comes from remaining.",
  introduction: "Have you ever pruned a rose?",
  conclusion: "Stay close to him this week.",
  notes: "PRIVATE: remember to thank the choir.",
  passages: [{ id: "a", pointId: null, reference: ref }],
  points: [
    point(1, { title: "Jesus is the true vine", explanation: "Israel was called God’s vine.", application: "Start with who he is." }),
    point(2, { title: "", explanation: "", application: "", illustration: "" }),
    point(3, { title: "We bear fruit by remaining", illustration: "A branch on the ground." }),
  ],
});

const STUDY = prep({
  kind: "bible_study",
  centralMessage: "LEADER: the group should discover rest.",
  introduction: "LEADER: open with prayer.",
  conclusion: "LEADER: close by sharing one thing.",
  notes: "PRIVATE: bring extra Bibles.",
  passages: [{ id: "a", pointId: null, reference: ref }],
  points: [
    point(1, { title: "What does “remain” mean here?", explanation: "LEADER: it may lead to verse 9.", application: "LEADER: follow up on love.", illustration: "LEADER: let quiet people speak." }),
    point(2, { title: "", explanation: "LEADER: a question still to write." }),
    point(3, { title: "Where do you try harder?" }),
  ],
});

const LESSON = prep({
  kind: "children",
  centralMessage: "Jesus keeps us close.",
  passages: [{ id: "a", pointId: null, reference: ref }],
  points: [
    point(1, { kind: "text", title: "Welcome", explanation: "Say hello to everyone." }),
    point(2, { kind: "scripture", title: "The vine and the branches" }),
    point(3, { kind: "question", title: "What does a branch need?", explanation: "LEADER: listen for “the vine”." }),
    point(4, { kind: "activity", title: "Draw a vine", explanation: "LEADER: hand out crayons.", illustration: "LEADER: crayons, paper" }),
    point(5, { kind: "text", title: "Prayer" }),
  ],
});

/** Every piece of text a material shows, besides its own labels. */
const texts = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.type === "text" || b.type === "field" || b.type === "message" || b.type === "question" ? [b.text] : b.type === "title" ? [b.text] : []));
/** Every piece of writing the person put in the teaching. */
const writing = (p: TeachingPreparation) =>
  [p.title, p.centralMessage, p.introduction, p.conclusion, p.notes, ...p.points.flatMap((x) => [x.title, x.explanation, x.application, x.illustration])]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .map((x) => x.trim());

describe("which materials a teaching offers", () => {
  it("follows the kind of teaching, never offering a material for symmetry", () => {
    expect(outputsFor("sermon")).toEqual(["presentation", "manuscript", "worksheet"]);
    expect(outputsFor("talk")).toEqual(["presentation", "manuscript", "worksheet"]);
    expect(outputsFor(null)).toEqual(["presentation", "manuscript", "worksheet"]);
    expect(outputsFor("bible_study")).toEqual(["presentation", "manuscript", "questions"]);
    expect(outputsFor("children")).toEqual(["presentation", "manuscript", "worksheet"]);
    expect(outputsFor("lesson")).toEqual(["presentation", "manuscript", "worksheet"]);
  });
});

describe("the manuscript", () => {
  it("is the teaching in its own order, word for word, leaving out what is empty", () => {
    const doc = manuscript(t, SERMON);
    expect(doc.blocks.map((b) => b.type)).toEqual(["title", "passages", "message", "heading", "text", "heading", "text", "field", "heading", "field", "heading", "text"]);
    expect(doc.blocks).toContainEqual({ type: "heading", text: "Point 1: Jesus is the true vine" });
    // The empty point 2 is not there; point 3 keeps its number.
    expect(doc.blocks).toContainEqual({ type: "heading", text: "Point 3: We bear fruit by remaining" });
    expect(doc.blocks.some((b) => b.type === "heading" && b.text.startsWith("Point 2"))).toBe(false);
    expect(doc.blocks).toContainEqual({ type: "passages", text: "John 15:1–8" });
  });

  it("invents nothing: every line it shows is the person's own writing", () => {
    for (const p of [SERMON, STUDY, LESSON]) {
      const own = writing(p);
      for (const text of texts(manuscript(t, p, { includeNotes: true }).blocks)) expect(own).toContain(text);
    }
  });

  it("keeps notes for oneself out unless they are asked for, and never puts audience or purpose in", () => {
    expect(JSON.stringify(manuscript(t, SERMON))).not.toContain("PRIVATE");
    expect(JSON.stringify(manuscript(t, SERMON, { includeNotes: true }))).toContain("PRIVATE: remember to thank the choir.");
    expect(JSON.stringify(manuscript(t, SERMON, { includeNotes: true }))).not.toMatch(/Young families|stay close to Jesus/);
  });

  it("is a leader's guide for a group study and a teacher's guide for a lesson, each part named", () => {
    const guide = manuscript(t, STUDY);
    expect(guide.blocks).toContainEqual({ type: "field", label: "Where it may lead", text: "LEADER: it may lead to verse 9." });
    const lesson = manuscript(t, LESSON);
    expect(lesson.blocks).toContainEqual({ type: "heading", text: "Step 4: Draw a vine", detail: "Activity" });
    expect(lesson.blocks).toContainEqual({ type: "field", label: "What you need", text: "LEADER: crayons, paper" });
  });

  it("says there is nothing yet for an empty teaching, rather than making something up", () => {
    expect(manuscript(t, prep({})).empty).toBe(true);
    expect(manuscript(t, prep({ passages: [{ id: "a", pointId: null, reference: ref }] })).empty).toBe(true);
    expect(manuscript(t, prep({ introduction: "Hello." })).empty).toBe(false);
  });
});

describe("the question sheet", () => {
  it("gives the group only the title, the passage and the questions, with room to write", () => {
    const doc = questionSheet(t, STUDY);
    expect(doc.blocks).toEqual([
      { type: "title", text: "Remain in the vine" },
      { type: "passages", text: "John 15:1–8" },
      { type: "question", number: 1, text: "What does “remain” mean here?" },
      { type: "space", style: "lines" },
      { type: "question", number: 2, text: "Where do you try harder?" },
      { type: "space", style: "lines" },
    ]);
    // Nothing meant for the leader can reach the group's sheet by default.
    expect(JSON.stringify(doc)).not.toMatch(/LEADER|PRIVATE/);
    expect(JSON.stringify(questionSheet(t, STUDY, { writingSpace: false, includeFrame: false }))).not.toMatch(/LEADER|PRIVATE/);
  });

  it("adds the opening and closing only when chosen, and still nothing else of the leader's", () => {
    const doc = questionSheet(t, STUDY, { includeFrame: true });
    expect(JSON.stringify(doc)).toContain("LEADER: open with prayer.");
    expect(JSON.stringify(doc)).toContain("LEADER: close by sharing one thing.");
    expect(JSON.stringify(doc)).not.toMatch(/verse 9|follow up|quiet people|discover rest|PRIVATE/);
  });

  it("is the leader's version only when asked, says so at the top, and holds only what was written", () => {
    const doc = questionSheet(t, STUDY, { leader: true });
    expect(doc.blocks[1]).toEqual({ type: "notice", text: expect.stringContaining("Not for handing out") });
    expect(doc.blocks).toContainEqual({ type: "field", label: "Follow-up questions", text: "LEADER: follow up on love." });
    expect(doc.blocks).toContainEqual({ type: "field", label: "Notes for leading the conversation", text: "LEADER: let quiet people speak." });
    // The person's notes for themselves are never on any sheet.
    expect(JSON.stringify(doc)).not.toContain("PRIVATE");
    for (const text of texts(doc.blocks)) expect([...writing(STUDY), "Question 2"]).toContain(text);
  });
});

describe("the worksheet", () => {
  it("gives a class the questions and activities with room, never the answers or what the teacher needs", () => {
    const doc = worksheet(t, LESSON);
    expect(doc.blocks).toEqual([
      { type: "title", text: "Remain in the vine" },
      { type: "passages", text: "John 15:1–8" },
      { type: "message", label: "The one thing to remember", text: "Jesus keeps us close." },
      { type: "heading", text: "The vine and the branches" },
      { type: "question", number: 1, text: "What does a branch need?" },
      { type: "space", style: "lines" },
      { type: "heading", text: "Draw a vine" },
      { type: "space", style: "box" },
    ]);
    expect(JSON.stringify(doc)).not.toMatch(/LEADER|Say hello/);
  });

  it("is listening notes for a sermon: the points to follow, with room under each and for one's own notes", () => {
    const doc = worksheet(t, SERMON);
    expect(doc.blocks.filter((b) => b.type === "question").map((b) => (b as { text: string }).text)).toEqual(["Jesus is the true vine", "We bear fruit by remaining"]);
    expect(doc.blocks[doc.blocks.length - 1]).toEqual({ type: "space", style: "box", label: "My notes" });
    // The explanation, application and message are what the listener is to hear, not read off the sheet.
    expect(JSON.stringify(doc)).not.toMatch(/Israel was called|Start with who|Fruit comes from remaining|rose/);
    expect(worksheet(t, prep({ points: [point(1, { explanation: "Only an explanation." })] })).empty).toBe(true);
  });
});

describe("numbers", () => {
  it("are the same on the group's sheet, the leader's version and the leader's guide", () => {
    const study = prep({
      kind: "bible_study",
      points: [point(1, { title: "Why?" }), point(2, { explanation: "LEADER: notes before the question is written." }), point(3, { title: "How?" })],
    });
    const numbered = (blocks: Block[]) => blocks.flatMap((b) => (b.type === "question" ? [`${b.number}. ${b.text}`] : b.type === "heading" && /^Question/.test(b.text) ? [b.text] : []));
    expect(numbered(questionSheet(t, study).blocks)).toEqual(["1. Why?", "2. How?"]);
    expect(numbered(questionSheet(t, study, { leader: true }).blocks)).toEqual(["1. Why?", "2. How?"]);
    expect(numbered(manuscript(t, study).blocks)).toEqual(["Question 1: Why?", "Question 2: How?"]);
    // The notes of the question not yet worded are still with the leader, unnumbered.
    expect(questionSheet(t, study, { leader: true }).blocks).toContainEqual({ type: "heading", text: "Notes for a question not yet worded" });
    expect(manuscript(t, study).blocks).toContainEqual({ type: "heading", text: "Notes for a question not yet worded" });
  });
});

describe("Markdown", () => {
  it("writes the material block for block, keeping the person's line breaks", () => {
    const md = toMarkdown(derive(t, "manuscript", prep({ introduction: "Line one\nLine two", points: [point(1, { title: "First", explanation: "Said." })] })));
    expect(md).toBe("# Remain in the vine\n\n## Introduction\n\nLine one  \nLine two\n\n## Point 1: First\n\nSaid.\n");
    expect(toMarkdown(questionSheet(t, STUDY))).toContain("1. What does “remain” mean here?");
  });

  it("keeps the person's words as words, never as Markdown syntax", () => {
    const md = toMarkdown(derive(t, "manuscript", prep({ title: "1. Remain", introduction: "# not a heading\n- not a list\n> not a quote" })));
    expect(md).toContain("# 1\\. Remain");
    expect(md).toContain("\\# not a heading  \n\\- not a list  \n\\> not a quote");
  });
});

// ---------------------------------------------------------------------------
// On screen
// ---------------------------------------------------------------------------

async function setup(kind: "sermon" | "bible_study" = "sermon") {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  const created = await api.teachingCreate({ studyId: study.id, title: "Remain in the vine", kind, points: [{ title: kind === "sermon" ? "Stay connected" : "What does remain mean?" }] });
  await api.teachingUpdate({ id: created.id, introduction: "Have you ever pruned a rose?", notes: "PRIVATE note" });
  await api.teachingPointUpdate({ id: created.points[0]!.id, explanation: "LEADER explanation" });
  return { api, prepId: created.id };
}
const studyPane = () => screen.getByRole("main", { name: "Study" });

async function openMaterials(api: ReturnType<typeof createMemoryApi>) {
  const { user } = await renderApp(api);
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
  await user.click(within(studyPane()).getByRole("button", { name: "Bible Teaching" }));
  await within(studyPane()).findByRole("article", { name: "Remain in the vine" });
  await user.click(within(studyPane()).getByRole("button", { name: "Materials" }));
  return user;
}

describe("Materials on screen", () => {
  it("shows the manuscript at once, as a page, and goes back to the teaching unchanged", async () => {
    const { api, prepId } = await setup();
    const before = await api.teachingGet(prepId);
    const user = await openMaterials(api);
    await user.click(screen.getByRole("menuitem", { name: "Manuscript" }));
    const page = await within(studyPane()).findByRole("article", { name: "Preview: Manuscript" });
    expect(page).toHaveTextContent("Have you ever pruned a rose?");
    expect(page).toHaveTextContent("Point 1: Stay connected");
    expect(page).not.toHaveTextContent("PRIVATE note");
    expect(within(studyPane()).getByRole("heading", { level: 2, name: "Manuscript" })).toHaveFocus();
    // Notes for oneself, when chosen.
    await user.click(within(studyPane()).getByRole("checkbox", { name: "My notes for myself" }));
    expect(page).toHaveTextContent("PRIVATE note");
    await user.click(within(studyPane()).getByRole("button", { name: "Back to the teaching" }));
    await waitFor(() => expect(within(studyPane()).getByRole("button", { name: "Materials" })).toHaveFocus());
    expect(await api.teachingGet(prepId)).toEqual(before);
  });

  it("saves a material as a text file where the person chooses, and copies it", async () => {
    const { api } = await setup();
    const user = await openMaterials(api);
    await user.click(screen.getByRole("menuitem", { name: "Manuscript" }));
    await within(studyPane()).findByRole("article", { name: "Preview: Manuscript" });
    await user.click(within(studyPane()).getByRole("button", { name: "Save as a text file…" }));
    await within(studyPane()).findByText("Saved: /home/test/Documents/Teaching.md");
    expect(api.state.presentation.materialDialogs).toEqual(["Remain in the vine – Manuscript.md"]);
    expect(api.state.presentation.materialSaves[0]!.text).toContain("# Remain in the vine");
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    await user.click(within(studyPane()).getByRole("button", { name: "Copy the text" }));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("## Point 1: Stay connected"));
    await within(studyPane()).findByText(/Copied/);
  });

  it("prints only the material, through the system's print dialog (where it can be saved as a PDF)", async () => {
    const { api } = await setup();
    const user = await openMaterials(api);
    await user.click(screen.getByRole("menuitem", { name: "Manuscript" }));
    await within(studyPane()).findByRole("article", { name: "Preview: Manuscript" });
    // What was on the page while the print dialog was open, read afterwards (an assertion thrown
    // inside the dialog would be caught by the view).
    const seen: { printing: boolean; text: string | null }[] = [];
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      seen.push({ printing: document.body.classList.contains("aw-printing"), text: document.getElementById("material-print")?.textContent ?? null });
      window.dispatchEvent(new Event("afterprint"));
    });
    const button = within(studyPane()).getByRole("button", { name: "Print or save as PDF…" });
    await user.click(button);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(seen[0]!.printing).toBe(true);
    expect(seen[0]!.text).toContain("Have you ever pruned a rose?");
    await waitFor(() => expect(document.getElementById("material-print")).toBeNull());
    expect(document.body).not.toHaveClass("aw-printing");
    // A web view that never says printing has finished can still print again.
    print.mockImplementation(() => undefined);
    await user.click(button);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    await user.click(button);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(3));
    print.mockRestore();
  });

  it("offers a group study a leader's guide and a question sheet that keeps the leader's notes back", async () => {
    const { api } = await setup("bible_study");
    const user = await openMaterials(api);
    const menu = screen.getByRole("menu", { name: "Materials" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^Presentation/),
      expect.stringMatching(/^Leader’s guide/),
      expect.stringMatching(/^Question sheet/),
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "Question sheet" }));
    const page = await within(studyPane()).findByRole("article", { name: "Preview: Question sheet" });
    expect(page).toHaveTextContent("What does remain mean?");
    expect(page).not.toHaveTextContent("LEADER explanation");
    expect(page).not.toHaveTextContent("Have you ever pruned");
    await user.click(within(studyPane()).getByRole("checkbox", { name: "Leader’s version, with notes for leading" }));
    expect(page).toHaveTextContent("LEADER explanation");
    expect(page).toHaveTextContent("Not for handing out");
    expect(page).not.toHaveTextContent("PRIVATE note");
  });

  it("says plainly when there is nothing yet, and offers nothing to save", async () => {
    const api = createMemoryApi();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
    const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
    await api.teachingCreate({ studyId: study.id, title: "Remain in the vine", kind: "bible_study" });
    const user = await openMaterials(api);
    await user.click(screen.getByRole("menuitem", { name: "Question sheet" }));
    await within(studyPane()).findByText("Nothing here yet. What you write in the teaching appears here.");
    expect(within(studyPane()).getByRole("button", { name: "Print or save as PDF…" })).toBeDisabled();
    expect(within(studyPane()).getByRole("button", { name: "Save as a text file…" })).toBeDisabled();
  });

  it("offers the presentation's files from Materials once there are slides, through the same export as the editor", async () => {
    const { api, prepId } = await setup();
    await api.presentationCreate({ preparationId: prepId, propose: true, labels: { introduction: "Introduction", conclusion: "Conclusion" } });
    const user = await openMaterials(api);
    const item = screen.getByRole("menuitem", { name: "Save the presentation as a file…" });
    expect(item).toHaveAccessibleDescription("PowerPoint, PDF slides, a speaker sheet for a phone, Markdown or a delivery package");
    await user.click(item);
    const dialog = await screen.findByRole("dialog", { name: "Export the presentation" });
    await user.click(within(dialog).getByRole("button", { name: "Choose where to save…" }));
    await waitFor(() => expect(api.state.presentation.exports).toHaveLength(1));
    expect(api.state.presentation.exports[0]).toMatchObject({ format: "pptx" });
  });
});
