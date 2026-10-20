// The documentation screenshot harness (see vite.config.ts and capture.mjs).
// The real interface, an in-memory library written for the guide, and the
// public-domain World English Bible. Nothing here ships with the app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/noto-serif/400.css";
import "@fontsource/noto-serif/400-italic.css";
import "@fontsource/noto-serif/600.css";
import "@/design-system/index.css";
import i18n from "@/i18n";
import { App } from "@/app/App";
import type { VerseText } from "@/types/scripture";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { createMemoryUpdater } from "../support/memoryUpdater";
import { minimalPdf } from "../support/minimalPdf";
import { IMPORTED } from "../support/memoryTemplates";
import { acceptImport } from "@/types/presentationTemplate";

const params = new URLSearchParams(location.search);

async function seed(api: MemoryApi) {
  // The World English Bible, installed as the reading Bible.
  const chapters = (await (await fetch("/web.json")).json()) as Record<string, VerseText[]>;
  const web = api.installFixtureBible("WEB", "web");
  Object.assign(web, {
    name: "World English Bible",
    publisher: "eBible.org",
    licenseType: "Public Domain",
    copyrightNotice: "The World English Bible is in the Public Domain.",
    isBuiltin: true,
    bookCount: 66,
    verseCount: Object.values(chapters).reduce((n, list) => n + list.length, 0),
  });
  api.state.text.set(web.id, new Map(Object.entries(chapters)));
  api.state.settings.scriptureTranslationId = web.id;
  api.state.settings.scripturePassage = params.get("passage") ?? "JHN.15";
  api.state.settings.theme = params.get("theme") === "dark" ? "dark" : "light";
  // A projector beside the computer, for the audience-screen scenes.
  if (params.get("screens") === "2")
    api.state.presentation.screens = [
      { index: 0, name: "Built-in", width: 1440, height: 900, primary: true },
      { index: 1, name: "Projector", width: 1920, height: 1080, primary: false },
    ];

  // A church template imported from the PowerPoint corpus file, for the template scenes.
  if (params.get("template") === "1")
    await api.presentationTemplateCreate({
      name: "Grace Church Sunday",
      description: "",
      definition: acceptImport(IMPORTED, IMPORTED.suggestions, IMPORTED.definition.fonts),
      sourceFormat: "pptx",
      sourceName: "Grace Church.pptx",
    });

  // Collections and studies (sample content written for this guide).
  const workspaceId = api.state.workspace.id;
  const john = await api.projectCreate({ workspaceId, title: "Gospel of John", description: "A slow walk through John’s Gospel." });
  const romans = await api.projectCreate({ workspaceId, title: "Romans sermon series", description: "Preparing a twelve-week series." });

  const vine = await api.studyCreate({
    projectId: john.id,
    title: "Abiding in the Vine",
    studyType: "passage",
    templateKey: "passage-study",
    primaryPassage: "JHN.15.1-JHN.15.11",
    description: "What it means to remain in Christ, from Jesus’ last words to his disciples.",
  });
  const write = async (sectionTitle: string, ...paragraphs: string[]) => {
    const section = vine.sections.find((s) => s.title === sectionTitle);
    if (!section) return;
    const [first, ...rest] = paragraphs;
    const block = section.blocks[0];
    if (block && first) await api.studyBlockUpdate({ id: block.id, content: first });
    for (const content of rest) await api.studyBlockCreate({ sectionId: section.id, blockType: "paragraph", content });
  };
  await write("Text", "Jesus speaks to his disciples on the night before the cross. The picture is simple: a vine, its branches and a gardener.");
  await write(
    "Context",
    "These chapters are one long evening conversation. Jesus has washed the disciples’ feet and is preparing them for his departure.",
  );
  await write(
    "Observations",
    "The word “remain” comes again and again in verses 4 to 10.",
    "The branch does not produce fruit by effort; it bears fruit because it stays joined to the vine.",
  );
  const observations = vine.sections.find((s) => s.title === "Observations");
  const application = vine.sections.find((s) => s.title === "Application");
  const fruit = await api.findingCreate({
    studyId: vine.study.id,
    findingType: "observation",
    sectionId: observations?.id,
    passage: "JHN.15.4-JHN.15.5",
    content: "Fruit comes from remaining in Jesus, not from trying harder.",
  });
  await api.findingCreate({
    studyId: vine.study.id,
    findingType: "question",
    sectionId: observations?.id,
    passage: "JHN.15.7",
    content: "What does it look like for his words to remain in me day by day?",
  });
  await api.findingCreate({
    studyId: vine.study.id,
    findingType: "application",
    sectionId: application?.id,
    content: "Begin each morning with a short passage before anything else.",
  });
  await api.studyPassageAdd({ studyId: vine.study.id, reference: "GAL.5.22-GAL.5.23", role: "related" });

  await api.studyCreate({ projectId: john.id, title: "Abide (μένω) — word study", studyType: "word", templateKey: "word-study", primaryPassage: "JHN.15.4" });
  await api.studyCreate({ projectId: john.id, title: "The Good Shepherd", studyType: "teaching", templateKey: "teaching-study", primaryPassage: "JHN.10.1-JHN.10.18" });
  await api.studyCreate({ projectId: romans.id, title: "No condemnation", studyType: "passage", templateKey: "passage-study", primaryPassage: "ROM.8.1-ROM.8.11" });

  // Marks on John 15.
  await api.annotationCreate({ reference: "JHN.15.5", kind: "highlight", color: "amber", translationId: web.id });
  await api.annotationCreate({ reference: "JHN.15.9", kind: "highlight", color: "green", translationId: web.id });
  await api.annotationCreate({
    reference: "JHN.15.7",
    kind: "note",
    translationId: web.id,
    content: "Prayer grows out of abiding: when his words live in me, they shape what I ask for.",
  });
  await api.annotationCreate({ reference: "JHN.15.11", kind: "bookmark", translationId: web.id });

  // A small library (own words; no copyrighted text).
  api.installFixtureSource({
    title: "Notes on Abiding",
    author: "Study group notes",
    format: "markdown",
    language: "English",
    segments: [
      { text: "John 15:1–11 — The True Vine", sectionPath: "The True Vine" },
      { text: "Jesus does not ask the branches to produce fruit; he asks them to remain. As John 15:5 says, apart from him we can do nothing.", sectionPath: "The True Vine" },
      { text: "Remaining is not anxious striving. Romans 8:1 reminds us there is no condemnation for those who are in Christ.", sectionPath: "The True Vine" },
      { text: "The fruit he produces is described in Galatians 5:22–23: love, joy, peace and more.", sectionPath: "Fruit" },
    ],
    mentions: [
      { segment: 1, reference: "JHN.15.5", matchedText: "John 15:5" },
      { segment: 2, reference: "ROM.8.1", matchedText: "Romans 8:1" },
      { segment: 3, reference: "GAL.5.22-GAL.5.23", matchedText: "Galatians 5:22–23" },
    ],
    sections: [{ segment: 0, reference: "JHN.15.1-JHN.15.11", matchedText: "John 15:1–11", heading: "John 15:1–11 — The True Vine", through: 2 }],
  });
  // Marks in that source (v0.14): a highlight, and a note on words.
  const abiding = (start: string) => api.state.library.segments.find((x) => x.text.startsWith(start))!;
  const mark = async (segmentText: string, words: string, more: { kind: "highlight"; color: "amber" | "green" } | { kind: "note"; content: string }) => {
    const segment = abiding(segmentText);
    const at = segment.text.indexOf(words);
    await api.sourceAnnotationCreate({ sourceId: segment.sourceId, ...more, start: { segmentId: segment.id, offset: at }, end: { segmentId: segment.id, offset: at + words.length }, quote: words });
  };
  await mark("Jesus does not ask", "he asks them to remain", { kind: "highlight", color: "green" });
  await mark("Remaining is not anxious", "Remaining is not anxious striving", { kind: "note", content: "Rest, not effort: abiding is receiving." });
  // A study note brought from that source (v0.15): the person's words, the book's words and where they are.
  const remaining = abiding("Remaining is not anxious");
  const resting = await api.findingCreateFromSource({
    studyId: vine.study.id,
    findingType: "interpretation",
    sectionId: application?.id,
    content: "Abiding is receiving, not striving: I rest in what Christ has done.",
    sourceId: remaining.sourceId,
    start: { segmentId: remaining.id, offset: 0 },
    end: { segmentId: remaining.id, offset: "Remaining is not anxious striving".length },
    quote: "Remaining is not anxious striving",
  });

  // A sermon prepared from the study (v0.16): the person's own writing, with the study's findings linked.
  const sermon = await api.teachingCreate({ studyId: vine.study.id, title: "Sunday sermon · Abiding in the Vine", kind: "sermon" });
  await api.teachingUpdate({
    id: sermon.id,
    audience: "The whole church, with many young families",
    purpose: "That we stop trying harder and learn to stay close to Jesus.",
    centralMessage: "Fruit comes from remaining in Jesus, not from trying harder.",
    introduction: "Have you ever watched someone prune a rose bush? It looks like they are hurting it. But a few months later the bush is full of flowers. Jesus says his Father does something like that with us.",
  });
  const first = await api.teachingPointCreate({ preparationId: sermon.id, title: "Jesus is the true vine" });
  const vinePoint = first.points[0]!;
  await api.teachingPointUpdate({
    id: vinePoint.id,
    explanation: "Israel was often called God’s vine, and it did not bear the fruit God looked for. Jesus says: I am the true vine. Everything the vine was meant to be, he is.",
    application: "Our life with God does not start with what we do, but with who he is.",
  });
  await api.teachingPassageAdd({ preparationId: sermon.id, pointId: vinePoint.id, reference: "PSA.80.8-PSA.80.16" });
  const second = await api.teachingPointCreate({ preparationId: sermon.id, title: "We bear fruit by remaining", afterPointId: vinePoint.id });
  const remainPoint = second.points[1]!;
  await api.teachingPointUpdate({
    id: remainPoint.id,
    explanation: "A branch does not strain to make grapes. It stays joined to the vine, and the fruit comes. The word “remain” comes again and again in verses 4 to 10.",
    application: "This week, begin each morning with a short passage before anything else.",
  });
  await api.teachingFindingLink({ preparationId: sermon.id, pointId: remainPoint.id, findingId: fruit.id });
  await api.teachingFindingLink({ preparationId: sermon.id, pointId: remainPoint.id, findingId: resting.id });
  await api.teachingPointCreate({ preparationId: sermon.id, title: "The Father is glorified", afterPointId: remainPoint.id });
  await api.teachingPassageAdd({ preparationId: sermon.id, reference: "JHN.15.1-JHN.15.8" });
  await api.teachingUpdate({ id: sermon.id, conclusion: "Stay close to him this week: begin each day with his words." });
  // The assistant, turned on for the guide's pictures, with one prepared answer (no network in the harness).
  api.state.teaching.assistant.config = { ...api.state.teaching.assistant.config, enabled: true, provider: "openai", model: "gpt-6.1-sol" };
  api.state.teaching.assistant.keys.set("openai", "sample");
  api.state.teaching.assistant.replies.push({
    result: {
      type: "proposal",
      suggestion:
        "Have you ever watched someone prune a rose bush? It looks as if they are hurting it. Yet a few months later the bush is full of flowers. Jesus says his Father does something like that with us.",
      changes: "Two small changes for flow: “as if” and “Yet” at the start of the third sentence. Your words and tone are kept.",
      placement: "replace",
    },
    assistant: "OpenAI · gpt-6.1-sol",
    remote: true,
  });
  api.installFixtureSource({
    title: "Sermon outline: The True Vine",
    author: "Sample sermon",
    format: "docx",
    language: "English",
    segments: [
      { text: "1. The Vine (John 15:1) — Jesus is the true vine; the Father tends it." },
      { text: "2. The branches (John 15:5) — we live by staying joined to him." },
      { text: "3. The fruit (John 15:8) — a life that shows the Father’s glory." },
    ],
    mentions: [
      { segment: 0, reference: "JHN.15.1", matchedText: "John 15:1" },
      { segment: 1, reference: "JHN.15.5", matchedText: "John 15:5" },
      { segment: 2, reference: "JHN.15.8", matchedText: "John 15:8" },
    ],
  });
  api.installFixtureSource({
    title: "Andachten zum Johannesevangelium",
    author: "Beispieltext",
    format: "text",
    language: "Deutsch",
    segments: [{ text: "Vergleiche Joh 15,5 und Mal 4,3. Lass uns mal sehen, was das für den Alltag bedeutet." }],
    mentions: [
      { segment: 0, reference: "JHN.15.5", matchedText: "Joh 15,5" },
      { segment: 0, reference: "MAL.4.3", matchedText: "Mal 4,3" },
    ],
  });
  api.installFixtureSource({
    title: "A Short Guide to Bible Study",
    author: "Sample handbook",
    format: "pdf",
    language: "English",
    segments: [
      { text: "Read the passage slowly, more than once. Notice repeated words, like “remain” in John 15:4–10.", pageNumber: 12 },
      { text: "Ask what the passage meant to its first readers before asking what it means today.", pageNumber: 13 },
    ],
    mentions: [{ segment: 0, reference: "JHN.15.4-JHN.15.10", matchedText: "John 15:4–10" }],
  });
  // A highlight across the handbook's line break and a note: drawn on the real page by PDF.js (v0.14).
  await mark("Read the passage slowly", "Notice repeated words, like “remain”", { kind: "highlight", color: "amber" });
  await mark("Ask what the passage meant", "its first readers", { kind: "note", content: "Who first heard this?" });
  // The handbook's original: a real PDF (written here), so the Original view draws real pages with PDF.js.
  const handbook = minimalPdf(
    Array.from({ length: 13 }, (_, i) => {
      const page = i + 1;
      const furniture = [
        { size: 8, y: 815, text: "A SHORT GUIDE TO BIBLE STUDY" },
        { size: 9, x: 290, y: 30, text: String(page) },
      ];
      if (page === 12)
        return [
          ...furniture,
          { size: 20, y: 740, text: "Chapter 3  Reading Slowly" },
          { size: 11, y: 690, text: "Read the passage slowly, more than once. Notice repeated words," },
          { size: 11, y: 674, text: "like “remain” in John 15:4–10." },
        ];
      if (page === 13)
        return [
          ...furniture,
          { size: 20, y: 740, text: "Chapter 4  Asking Questions" },
          { size: 11, y: 690, text: "Ask what the passage meant to its first readers before asking what" },
          { size: 11, y: 674, text: "it means today." },
        ];
      return [...furniture, { size: 11, y: 700, text: `Earlier pages of the handbook (page ${page}).` }];
    }),
  );
  api.libraryOriginalInfo = async () => ({ kind: "pdf", sizeBytes: handbook.length });
  api.libraryOriginalRead = async (_id, offset, length) => handbook.slice(offset, offset + length);
}

async function start() {
  const api = createMemoryApi({
    version: "0.5.0-dev.26",
    updatesEnabled: true,
    dataDirectory: "C:\\Users\\You\\AppData\\Roaming\\Abiding Word",
    databasePath: "C:\\Users\\You\\AppData\\Roaming\\Abiding Word\\database\\abiding-word.db",
    logDirectory: "C:\\Users\\You\\AppData\\Roaming\\Abiding Word\\logs",
  });
  if (params.get("empty") !== "1") await seed(api);
  await i18n.changeLanguage(params.get("lang") ?? "en");
  // All three panes even in a narrow window, as the owner works (review scenes, v0.18.5).
  if (params.get("sourcesOpen") === "1") localStorage.setItem("abiding-word.layout.sourcesOpen", "true");
  // Wider side panes for close-ups (layout preferences live in browser storage).
  for (const pane of ["scriptureWidth", "sourcesWidth"]) {
    const width = params.get(pane);
    if (width) localStorage.setItem(`abiding-word.layout.${pane}`, width);
  }
  (window as unknown as { api: MemoryApi }).api = api;
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");
  createRoot(root).render(
    <StrictMode>
      <App api={api} updater={createMemoryUpdater()} />
    </StrictMode>,
  );
}

void start();
