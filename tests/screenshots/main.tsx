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
import type { MorphDescribed, VerseText } from "@/types/scripture";
import { createMemoryApi, type FixtureWord, type MemoryApi } from "../support/memoryApi";
import { ApiError } from "@/lib/api";
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
  // Writing further along the study (v0.18.6 review): enough that it scrolls and several phases hold work.
  await write(
    "Meaning",
    "To remain is to keep living in what Jesus has already done and said: the disciples are clean already (verse 3).",
    "Pruning is the Father’s care, not his anger. The branch that bears fruit is cut back so that it bears more.",
  );
  await write("Theology", "Union with Christ is the root of the Christian life. Fruit is the evidence of that life, never its price.");
  await write("Application", "Where am I trying to produce fruit by effort instead of staying close to him?");
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
  const shepherd = await api.studyCreate({ projectId: john.id, title: "The Good Shepherd", studyType: "teaching", templateKey: "teaching-study", primaryPassage: "JHN.10.1-JHN.10.18" });
  const condemnation = await api.studyCreate({ projectId: romans.id, title: "No condemnation", studyType: "passage", templateKey: "passage-study", primaryPassage: "ROM.8.1-ROM.8.11" });

  // A group Bible study and a children's lesson, for the materials they become (v0.18.6). Sample writing.
  const group = await api.teachingCreate({ studyId: condemnation.study.id, title: "Small group · No condemnation", kind: "bible_study" });
  await api.teachingUpdate({
    id: group.id,
    centralMessage: "In Christ we are free from condemnation, and the Spirit gives us life.",
    introduction: "Share a time you felt you had to earn someone’s approval.",
    conclusion: "Pray in pairs for one area where you still live under condemnation.",
  });
  await api.teachingPassageAdd({ preparationId: group.id, reference: "ROM.8.1-ROM.8.11" });
  const questions: [string, string, string, string][] = [
    ["What does Paul say there is “now no” of, and for whom?", "Verse 1: no condemnation for those in Christ Jesus.", "Why does Paul say “now”? What has changed?", "Let several people answer before moving on."],
    ["How does verse 3 explain what the law could not do?", "God sent his own Son; sin was condemned in his flesh.", "What does this say about God’s initiative?", ""],
    ["Where do you notice yourself living by the flesh rather than by the Spirit?", "Honest answers; keep it personal, not abstract.", "", "Share first yourself to make it safe."],
    ["What difference does verse 11 make to how you face this week?", "The Spirit who raised Jesus gives life to us.", "", ""],
  ];
  let after: string | undefined;
  for (const [title, explanation, application, illustration] of questions) {
    const next = await api.teachingPointCreate({ preparationId: group.id, title, afterPointId: after });
    const added = next.points[next.points.length - 1]!;
    await api.teachingPointUpdate({ id: added.id, explanation, application, illustration });
    after = added.id;
  }
  const lesson = await api.teachingCreate({ studyId: shepherd.study.id, title: "The shepherd knows my name", kind: "children" });
  await api.teachingUpdate({ id: lesson.id, centralMessage: "Jesus knows me and calls me by name." });
  await api.teachingPassageAdd({ preparationId: lesson.id, reference: "JHN.10.3-JHN.10.4" });
  const steps: { kind: "text" | "scripture" | "question" | "activity"; title: string; explanation: string; illustration?: string }[] = [
    { kind: "text", title: "Welcome and name game", explanation: "Each child says their name and a favourite animal." },
    { kind: "scripture", title: "The shepherd and his sheep", explanation: "Tell John 10:3–4 with a toy sheep." },
    { kind: "question", title: "How does a sheep know its own shepherd?", explanation: "Listen for: by his voice." },
    { kind: "activity", title: "Draw your shepherd and your sheep", explanation: "Each child draws a sheep with their own name on it.", illustration: "Paper, crayons" },
    { kind: "text", title: "Thank you, Jesus, for knowing me", explanation: "A short prayer together." },
  ];
  let previous: string | undefined;
  for (const step of steps) {
    const next = await api.teachingPointCreate({ preparationId: lesson.id, title: step.title, kind: step.kind, afterPointId: previous });
    const added = next.points[next.points.length - 1]!;
    await api.teachingPointUpdate({ id: added.id, explanation: step.explanation, illustration: step.illustration ?? "" });
    previous = added.id;
  }

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

/** One prepared answer for the v0.20 pictures (no network in the harness). */
function prepareInquiry(api: MemoryApi, which: string) {
  const assistant = "OpenAI · gpt-6.1-sol";
  if (which === "error") {
    api.state.inquiry.replies.push(new ApiError("assistant", i18n.t("errors.assistant.failed")));
    return;
  }
  const segment = api.state.library.segments.find((x) => x.text.startsWith("Remaining is not anxious striving"));
  const quote = "Remaining is not anxious striving";
  const link = segment && {
    sourceId: segment.sourceId,
    title: "Notes on Abiding",
    author: "Study group notes",
    location: "The True Vine · paragraph 3",
    start: { segmentId: segment.id, offset: 0 },
    end: { segmentId: segment.id, offset: quote.length },
    quote,
  };
  const label = "“Notes on Abiding” by Study group notes — The True Vine · paragraph 3";
  if (which === "study") {
    api.state.inquiry.replies.push({
      result: {
        type: "insight",
        summary: "Your observation follows the passage closely; one link in the text could make it firmer.",
        points: [
          { kind: "text", text: "The passage itself ties fruit to remaining, not to effort.", about: null, aboutLabel: null, evidence: [{ block: "P1", kind: "scripture", label: "John 15:1–11 (WEB)", quote: "he who remains in me, and I in him, bears much fruit", source: null }], references: [], downgraded: false },
          { kind: "writing", text: "Your note says “not from trying harder”; the text says what does produce fruit, but does not mention effort directly.", about: null, aboutLabel: null, evidence: [{ block: "N1", kind: "note", label: "Your note (observation)", quote: "not from trying harder", source: null }], references: [], downgraded: false },
          { kind: "question", text: "How does verse 7 (“my words remain in you”) shape what remaining means?", about: null, aboutLabel: null, evidence: [], references: [], downgraded: false },
          { kind: "knowledge", text: "Israel is pictured as a vine in the Old Testament; Jesus calls himself the true vine.", about: null, aboutLabel: null, evidence: [], references: [{ canonical: "ISA.5.1-ISA.5.7", display: "Isaiah 5:1–7", book: "ISA", startChapter: 5, startVerse: 1, endChapter: 5, endVerse: 7 }, { canonical: "PSA.80.8-PSA.80.16", display: "Psalm 80:8–16", book: "PSA", startChapter: 80, startVerse: 8, endChapter: 80, endVerse: 16 }], downgraded: false },
        ],
        verdict: null,
        unverified: 0,
        downgraded: 0,
      },
      assistant,
      remote: true,
    });
  }
  if (which === "source" && link) {
    api.state.inquiry.replies.push({
      result: {
        type: "insight",
        summary: "The author contrasts remaining with striving and grounds it in Romans 8:1.",
        points: [
          { kind: "source", text: "Remaining is described as the opposite of anxious effort.", about: null, aboutLabel: null, evidence: [{ block: "S1", kind: "source", label, quote, source: link }], references: [], downgraded: false },
          { kind: "source", text: "The author appeals to Romans 8:1 for the absence of condemnation.", about: null, aboutLabel: null, evidence: [{ block: "S1", kind: "source", label, quote: "there is no condemnation for those who are in Christ", source: { ...link, start: { segmentId: link.start.segmentId, offset: segment!.text.indexOf("there is no") }, end: { segmentId: link.start.segmentId, offset: segment!.text.indexOf("there is no") + "there is no condemnation for those who are in Christ".length }, quote: "there is no condemnation for those who are in Christ" } }], references: [{ canonical: "ROM.8.1", display: "Romans 8:1", book: "ROM", startChapter: 8, startVerse: 1, endChapter: 8, endVerse: 1 }], downgraded: false },
          { kind: "inference", text: "The author seems to assume that striving and anxiety go together; the passage does not argue this.", about: null, aboutLabel: null, evidence: [], references: [], downgraded: false },
        ],
        verdict: null,
        unverified: 0,
        downgraded: 0,
      },
      assistant,
      remote: true,
    });
  }
  if (which === "compare" && link) {
    api.state.inquiry.replies.push({
      result: {
        type: "insight",
        summary: "Both connect fruit with staying close to Jesus; only one speaks about effort.",
        points: [
          { kind: "position", text: "Remaining is not anxious striving.", about: "S1", aboutLabel: label, evidence: [{ block: "S1", kind: "source", label, quote, source: link }], references: [{ canonical: "ROM.8.1", display: "Romans 8:1", book: "ROM", startChapter: 8, startVerse: 1, endChapter: 8, endVerse: 1 }], downgraded: false },
          { kind: "position", text: "We live by staying joined to him.", about: "S2", aboutLabel: "“Sermon outline: The True Vine” by Sample sermon — paragraph 3", evidence: [{ block: "S2", kind: "source", label: "“Sermon outline: The True Vine” by Sample sermon — paragraph 3", quote: "we live by staying joined to him", source: null }], references: [{ canonical: "JHN.15.5", display: "John 15:5", book: "JHN", startChapter: 15, startVerse: 5, endChapter: 15, endVerse: 5 }], downgraded: false },
          { kind: "unsupported", text: "That effort plays no part at all is not said in either passage.", about: null, aboutLabel: null, evidence: [], references: [], downgraded: true },
        ],
        verdict: "partly",
        unverified: 0,
        downgraded: 1,
      },
      assistant,
      remote: true,
    });
  }
}

/**
 * Original-language research (v0.21): a CONSTRUCTED annotated sample, named
 * as such — invented lines of real Hebrew words, not Bible text — with word
 * annotations written for the screenshots. Codes follow the OSHB
 * documentation's examples; nothing is an analysis of a real verse.
 */
function seedAnnotated(api: MemoryApi) {
  const sample = api.installFixtureBible("SAMPLE", "sample");
  Object.assign(sample, { name: "Constructed sample (not Bible text)", language: "Hebrew", languageCode: "hbo" });
  const verb = (conjugation: string): MorphDescribed => ({
    scheme: "oshb",
    language: "hebrew",
    segments: [{ partOfSpeech: "verb", features: [{ field: "stem", value: "qal" }, { field: "conjugation", value: conjugation }, { field: "person", value: "third" }, { field: "gender", value: "masculine" }, { field: "number", value: "singular" }] }],
  });
  const noun = (number: string, state = "absolute"): MorphDescribed => ({
    scheme: "oshb",
    language: "hebrew",
    segments: [{ partOfSpeech: "noun", features: [{ field: "nounType", value: "common" }, { field: "gender", value: "masculine" }, { field: "number", value: number }, { field: "state", value: state }] }],
  });
  const lines: [string, string, FixtureWord[]][] = [
    ["GEN.1.1", "בָּרָא אֱלֹהִים אוֹר", [
      { surface: "בָּרָא", lemma: "בָּרָא", strong: "H1254a", morph: "HVqp3ms", described: verb("perfect") },
      { surface: "אֱלֹהִים", lemma: "אֱלֹהִים", strong: "H430", morph: "HNcmpa", described: noun("plural") },
      { surface: "אוֹר", lemma: "אוֹר", strong: "H216", morph: "HNcmsa", described: noun("singular") },
    ]],
    ["GEN.1.2", "וַיִּבְרָא אֱלֹהִים מַיִם", [
      { surface: "וַיִּבְרָא", lemma: "בָּרָא", strong: "H1254a", morph: "HC/Vqw3ms" },
      { surface: "אֱלֹהִים", lemma: "אֱלֹהִים", strong: "H430", morph: "HNcmpa", described: noun("plural") },
    ]],
    ["GEN.1.3", "בָּרָא אוֹר", [
      { surface: "בָּרָא", lemma: "בָּרָא", strong: "H1254a", morph: "HVqp3ms", described: verb("perfect") },
      { surface: "אוֹר", lemma: "אוֹר", strong: "H216", morph: "HNcmsa", described: noun("singular") },
    ]],
    ["GEN.1.4", "בָּרָא דָּבָר", [{ surface: "בָּרָא", lemma: "בָּרָא", strong: "H1254b", morph: "HVqp3ms", described: verb("perfect") }]],
    ["GEN.1.5", "אֱלֹהִים בָּרָא", [
      { surface: "אֱלֹהִים", lemma: "אֱלֹהִים", strong: "H430", morph: "HNcmpa", described: noun("plural") },
      { surface: "בָּרָא", lemma: "בָּרָא", strong: "H1254a", morph: "HVqp3ms", described: verb("perfect") },
    ]],
  ];
  for (const [verse, text, words] of lines) {
    api.setVerseText(sample.id, verse, text);
    api.installFixtureWords(sample.id, verse, words, "oshb");
  }
  return sample;
}

/** A constructed Greek sample (v0.22): lexical numbers and Robinson codes, or numbers only. */
function seedGreek(api: MemoryApi, numbersOnly: boolean) {
  const sample = api.installFixtureBible(numbersOnly ? "GRNUM" : "GRSAMPLE", "greek");
  Object.assign(sample, { name: numbersOnly ? "Constructed numbers sample (not Bible text)" : "Constructed Greek sample (not Bible text)", language: "Greek", languageCode: "grc" });
  const noun = (c: string): MorphDescribed => ({ scheme: "robinson", language: "greek", segments: [{ partOfSpeech: "noun", features: [{ field: "case", value: c }, { field: "number", value: "singular" }, { field: "gender", value: "masculine" }] }] });
  const verb: MorphDescribed = { scheme: "robinson", language: "greek", segments: [{ partOfSpeech: "verb", features: [{ field: "tense", value: "imperfect" }, { field: "voice", value: "active" }, { field: "mood", value: "indicative" }, { field: "person", value: "third" }, { field: "number", value: "singular" }] }] };
  const lines: [string, string, FixtureWord[]][] = [
    ["JHN.1.1", "ὁ λόγος ἦν ἐν ἀρχῇ", [
      { surface: "λόγος", strong: "G3056", morph: "N-NSM", described: noun("nominative") },
      { surface: "ἦν", strong: "G1510", morph: "V-IAI-3S", described: verb },
    ]],
    ["JHN.1.2", "λόγον ἤκουσεν", [{ surface: "λόγον", strong: "G3056", morph: "N-ASM", described: noun("accusative") }]],
    ["JHN.1.3", "περὶ τοῦ λόγου", [{ surface: "λόγου", strong: "G3056", morph: "N-GSM", described: noun("genitive") }]],
  ];
  for (const [verse, text, words] of lines) {
    api.setVerseText(sample.id, verse, text);
    api.installFixtureWords(sample.id, verse, numbersOnly ? words.map((w) => ({ surface: w.surface, strong: w.strong })) : words, numbersOnly ? "none" : "robinson");
  }
  api.state.settings.scriptureTranslationId = sample.id;
  api.state.settings.scripturePassage = "JHN.1";
  return sample;
}

const EMPTY_LEFT = { syntax: 0, conflict: 0, tooLong: 0, unbalanced: 0, overlapping: 0, outsideVerse: 0, empty: 0, tooMany: 0 };

async function start() {
  const api = createMemoryApi({
    version: "0.5.0-dev.26",
    updatesEnabled: true,
    dataDirectory: "C:\\Users\\You\\AppData\\Roaming\\Abiding Word",
    databasePath: "C:\\Users\\You\\AppData\\Roaming\\Abiding Word\\database\\abiding-word.db",
    logDirectory: "C:\\Users\\You\\AppData\\Roaming\\Abiding Word\\logs",
  });
  if (params.get("empty") !== "1") await seed(api);
  // The example project (v0.19), added as the person would from Settings.
  if (params.get("sample") === "1") await api.sampleProjectInstall();
  // Study and research help (v0.20): the assistant off (the plain study), or prepared answers.
  if (params.get("assistant") === "off") api.state.teaching.assistant.config = { ...api.state.teaching.assistant.config, enabled: false };
  const inquiry = params.get("inquiry");
  if (inquiry) prepareInquiry(api, inquiry);
  if (params.get("words") === "1") {
    const sample = seedAnnotated(api);
    if (params.get("read") === "sample") {
      api.state.settings.scriptureTranslationId = sample.id;
      api.state.settings.scripturePassage = "GEN.1";
    }
    // A Word Study using the sample's lexical numbers.
    const project = api.state.projects[0];
    if (project) {
      const study = await api.studyCreate({ projectId: project.id, title: "Creating (word study)", studyType: "word", templateKey: "word-study" });
      await api.studyUpdate({ id: study.study.id, details: { lemma: "בָּרָא", lexicalId: "H1254a", translationId: sample.id } });
    }
  }
  if (params.get("preview") === "words") {
    api.state.nextChosenFiles = ["/home/you/Downloads/annotated_usfm.zip"];
    api.state.nextPreviewWords = {
      marked: 124, words: 121, verses: 15, withLemma: 121, withLexicalId: 119, withMorphology: 121, distinctLemmas: 63,
      phrases: 0, parts: 6, morphAttribute: "x-morph", grammar: { scheme: "oshb", coded: 8, described: 8, stated: { file: "copr.htm", words: "Open Scriptures Hebrew Bible" } }, estimatedBytes: 0, otherAttributes: ["srcloc"],
      leftOut: { syntax: 2, conflict: 1, tooLong: 0, unbalanced: 0, overlapping: 0, outsideVerse: 0, empty: 0, tooMany: 0 },
      indexed: true, notIndexed: null,
    };
  }
  // v0.22 scenes.
  const greek = params.get("greek");
  if (greek) seedGreek(api, greek === "numbers");
  if (params.get("preview") === "robinson") {
    api.state.nextChosenFiles = ["/home/you/Downloads/grcmt_usfm.zip"];
    api.state.nextPreviewWords = {
      marked: 140121, words: 140121, verses: 7957, withLemma: 0, withLexicalId: 140121, withMorphology: 140121, distinctLemmas: 0,
      phrases: 0, parts: 0, morphAttribute: "x-morph", grammar: { scheme: "robinson", coded: 140121, described: 139870, stated: null }, estimatedBytes: 140121 * 51, otherAttributes: [],
      leftOut: EMPTY_LEFT, indexed: true, notIndexed: null,
    };
  }
  if (params.get("preview") === "strongs") {
    api.state.nextChosenFiles = ["/home/you/Downloads/grcsbl_usfm.zip"];
    api.state.nextPreviewWords = {
      marked: 137554, words: 137554, verses: 7939, withLemma: 0, withLexicalId: 137554, withMorphology: 0, distinctLemmas: 0,
      phrases: 0, parts: 0, morphAttribute: null, grammar: { scheme: null, coded: 0, described: 0, stated: null }, estimatedBytes: 137554 * 51, otherAttributes: [],
      leftOut: EMPTY_LEFT, indexed: false, notIndexed: "strongOnly",
    };
  }
  if (params.get("wordsPreview") === "strongs") {
    api.state.nextWordsPreview = {
      marked: 31102, words: 31102, verses: 31102, withLemma: 0, withLexicalId: 31102, withMorphology: 0, distinctLemmas: 0,
      phrases: 0, parts: 0, morphAttribute: null, grammar: { scheme: null, coded: 0, described: 0, stated: null }, estimatedBytes: 31102 * 51, otherAttributes: [],
      leftOut: EMPTY_LEFT, indexed: false, notIndexed: "strongOnly",
    };
  }
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
