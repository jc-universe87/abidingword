import type { TFunction } from "i18next";
import { referenceLabel } from "@/i18n/scripture";
import { canvasShape, pointFields, showsFrame, stepFieldLabel, type CanvasShape } from "@/features/teaching/labels";
import type { MaterialScripture } from "@/types/scripture";
import type { TeachingKind, TeachingPoint, TeachingPreparation } from "@/types/teaching";

/**
 * What a Bible Teaching becomes (Materials, v0.18.6). A material is something
 * useful to teach with; the file it is saved as (PDF, Markdown, PowerPoint…)
 * is only how it is delivered. Everything here is put together from the
 * person's own teaching by fixed rules: nothing is written for them,
 * summarised or filled in, an empty part is left out, and the teaching itself
 * is never changed. The presentation is a material too; it keeps its own
 * editor and data (src/features/presentation).
 */
export const OUTPUT_KINDS = ["presentation", "manuscript", "questions", "worksheet"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/**
 * The materials that suit a kind of teaching, in the order offered: a
 * sermon or talk gets a manuscript and listening notes; a group Bible study
 * a leader's guide and a question sheet; a lesson a teacher's guide and a
 * worksheet. Nothing is offered for symmetry's sake.
 */
export function outputsFor(kind: TeachingKind | null): OutputKind[] {
  const shape = canvasShape(kind);
  if (shape === "questions") return ["presentation", "manuscript", "questions"];
  return ["presentation", "manuscript", "worksheet"];
}

/** A verse as every rendering shows it: its number ("16", or "4:1" where a new chapter begins) and its words. */
export interface ScriptureVerse {
  chapter: number;
  verse: number;
  number: string;
  /** A psalm's title, before its first verse. */
  title?: string;
  text: string;
}

/** The text a material shows; each kind of block is drawn the same way on screen, on paper and in Markdown. */
export type Block =
  | { type: "title"; text: string }
  | { type: "passages"; text: string }
  /**
   * A passage's text from the one Bible chosen (v0.18.8): its label with the
   * Bible's short name, the verses in order with their numbers, and, when
   * that Bible lacks verses, a note saying which (nothing is filled in).
   */
  | { type: "scripture"; label: string; verses: ScriptureVerse[]; note?: string; attribution?: string }
  /** Said once at the top, e.g. that this is the leader's version. */
  | { type: "notice"; text: string }
  /** The teaching's one message, set apart. */
  | { type: "message"; label: string; text: string }
  | { type: "heading"; text: string; detail?: string }
  | { type: "text"; text: string }
  | { type: "field"; label: string; text: string }
  /** A question put to the group or the class, numbered. */
  | { type: "question"; number: number; text: string }
  /** Room to write (lines) or to draw (a box), with an optional label. */
  | { type: "space"; style: "lines" | "box"; label?: string };

export interface MaterialDocument {
  kind: Exclude<OutputKind, "presentation">;
  title: string;
  blocks: Block[];
  /** True when the teaching has nothing yet for this material beyond its title. */
  empty: boolean;
}

export interface MaterialOptions {
  /** Manuscript: the person's notes for themselves (never on a sheet for others). */
  includeNotes?: boolean;
  /** Question sheet: the leader's version, with what each question may lead to. */
  leader?: boolean;
  /** Question sheet: the opening and closing as written for the group. */
  includeFrame?: boolean;
  /** Question sheet and worksheet: room to write under each question. */
  writingSpace?: boolean;
  /** The text of the teaching's passages from the chosen Bible (v0.18.8; shown only when it has been read). */
  includePassage?: boolean;
}

export const DEFAULT_OPTIONS: Required<MaterialOptions> = { includeNotes: false, leader: false, includeFrame: false, writingSpace: true, includePassage: false };

/**
 * The passages' text as blocks, when asked for and read from the chosen
 * Bible: one block per passage the whole teaching names, in its order. Only
 * the data given is used; a verse the Bible lacks is named, never supplied.
 */
function scriptureBlocks(t: TFunction, prep: TeachingPreparation, o: Required<MaterialOptions>, scripture: MaterialScripture | null | undefined): Block[] {
  if (!o.includePassage || !scripture) return [];
  const own = prep.passages.filter((p) => p.pointId === null);
  const blocks: Block[] = own.flatMap((p): Block[] => {
    const text = scripture.passages.find((x) => x.canonical === p.reference.canonical);
    if (!text) return [];
    const label = `${referenceLabel(p.reference)} · ${scripture.shortName}`;
    const note = text.verses.length === 0
      ? t("studies.materials.scripture.none", { bible: scripture.shortName })
      : text.missing.length > 0
        ? t("studies.materials.scripture.missing", { bible: scripture.shortName, verses: text.missing.join(", "), count: text.missing.length })
        : undefined;
    // The numbers are worked out once, here: screen, paper, Markdown and Word show the same.
    const verses = text.verses.map(({ chapter, verse, bridgeEnd, title, text: words }, i) => {
      const own = bridgeEnd && bridgeEnd > verse ? `${verse}–${bridgeEnd}` : String(verse);
      return {
        chapter,
        verse,
        number: i > 0 && chapter !== text.verses[i - 1]!.chapter ? `${chapter}:${own}` : own,
        ...(title?.trim() ? { title: title.trim() } : {}),
        text: words,
      };
    });
    return [{ type: "scripture", label, verses, ...(note ? { note } : {}) }];
  });
  const last = blocks[blocks.length - 1];
  // Where the words come from: the Bible's own notice, else its name.
  if (last && last.type === "scripture") last.attribution = scripture.copyrightNotice?.trim() || t("studies.materials.scripture.from", { name: scripture.name });
  return blocks;
}

const has = (text: string | null | undefined): text is string => !!text && text.trim().length > 0;
const trim = (text: string) => text.trim();

/** The whole teaching's passages (not those of a single point), as named in the interface language. */
function passagesLine(prep: TeachingPreparation, pointId: string | null = null): string {
  return prep.passages
    .filter((p) => p.pointId === pointId)
    .map((p) => referenceLabel(p.reference))
    .join(" · ");
}

type ShapeKey = "message" | "introduction" | "conclusion" | "label" | "untitled" | "explanation" | "application" | "illustration";
const shapeText = (t: TFunction, shape: CanvasShape) => (key: ShapeKey, options?: Record<string, unknown>) =>
  t(`studies.teaching.shape.${shape}.${key}`, options ?? {});

const pointHeading = (t: TFunction, shape: CanvasShape, point: TeachingPoint, number: number) => {
  const s = shapeText(t, shape);
  return has(point.title) ? s("label", { number, title: trim(point.title) }) : s("untitled", { number });
};

const isEmptyPoint = (point: TeachingPoint) => !has(point.title) && !has(point.explanation) && !has(point.application) && !has(point.illustration);

/** The material's own name for this kind of teaching (a manuscript of a group study is a leader's guide). */
export function outputName(t: TFunction, kind: OutputKind, teaching: TeachingKind | null): string {
  return t(`studies.materials.kinds.${kind}.${canvasShape(teaching)}.name`);
}
export function outputHint(t: TFunction, kind: OutputKind, teaching: TeachingKind | null): string {
  return t(`studies.materials.kinds.${kind}.${canvasShape(teaching)}.hint`);
}

/**
 * The manuscript: the teaching as one readable text, in its own order. For a
 * sermon or talk the explanation of each point is the text itself and the
 * illustration and application are named; for a group study (a leader's
 * guide) and a lesson (a teacher's guide) every part keeps its name.
 */
export function manuscript(t: TFunction, prep: TeachingPreparation, options: MaterialOptions = {}, scripture?: MaterialScripture | null): MaterialDocument {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const shape = canvasShape(prep.kind);
  const s = shapeText(t, shape);
  const blocks: Block[] = [];
  const passages = passagesLine(prep);
  if (passages) blocks.push({ type: "passages", text: passages });
  const text = scriptureBlocks(t, prep, o, scripture);
  blocks.push(...text);
  if (has(prep.centralMessage)) blocks.push({ type: "message", label: s("message"), text: trim(prep.centralMessage) });
  if (has(prep.introduction) && showsFrame(shape, "introduction", prep.introduction)) {
    blocks.push({ type: "heading", text: s("introduction") }, { type: "text", text: trim(prep.introduction) });
  }
  // A group's questions are numbered as the group sees them: only those with wording count.
  let asked = 0;
  prep.points.forEach((point, index) => {
    if (isEmptyPoint(point)) return;
    const detail = shape === "steps" && point.kind && point.kind !== "audio" ? t(`studies.teaching.stepKind.${point.kind}`) : undefined;
    if (shape === "questions") {
      if (has(point.title)) asked += 1;
      blocks.push({ type: "heading", text: has(point.title) ? s("label", { number: asked, title: trim(point.title) }) : t("studies.materials.questions.unworded"), detail });
    } else blocks.push({ type: "heading", text: pointHeading(t, shape, point, index + 1), detail });
    const own = passagesLine(prep, point.id);
    if (own) blocks.push({ type: "passages", text: own });
    for (const field of pointFields(shape, point)) {
      const text = point[field];
      if (!has(text)) continue;
      // A sermon's explanation is what is said: no label in front of it.
      if (shape === "points" && field === "explanation") blocks.push({ type: "text", text: trim(text) });
      else blocks.push({ type: "field", label: stepFieldLabel(t, point.kind, field) ?? s(field), text: trim(text) });
    }
  });
  if (has(prep.conclusion) && showsFrame(shape, "conclusion", prep.conclusion)) {
    blocks.push({ type: "heading", text: s("conclusion") }, { type: "text", text: trim(prep.conclusion) });
  }
  if (o.includeNotes && has(prep.notes)) blocks.push({ type: "heading", text: t("studies.teaching.notes") }, { type: "text", text: trim(prep.notes) });
  return finish("manuscript", prep, blocks, (passages ? 1 : 0) + text.length);
}

/**
 * The question sheet of a group Bible study. By default it is for the group:
 * the title, the passage and the questions, word for word, with room to
 * write. What each question may lead to, the follow-up questions and the
 * notes for leading stay with the leader: they appear only on the leader's
 * version, which says so at the top. The opening and closing are the
 * leader's words too, and are on the group's sheet only when chosen.
 */
export function questionSheet(t: TFunction, prep: TeachingPreparation, options: MaterialOptions = {}, scripture?: MaterialScripture | null): MaterialDocument {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const s = shapeText(t, "questions");
  const blocks: Block[] = [];
  const passages = passagesLine(prep);
  let frame = 0;
  if (o.leader) {
    blocks.push({ type: "notice", text: t("studies.materials.questions.leaderNotice") });
    frame += 1;
  }
  if (passages) {
    blocks.push({ type: "passages", text: passages });
    frame += 1;
  }
  const text = scriptureBlocks(t, prep, o, scripture);
  blocks.push(...text);
  frame += text.length;
  if (o.leader && has(prep.centralMessage)) blocks.push({ type: "message", label: s("message"), text: trim(prep.centralMessage) });
  if ((o.leader || o.includeFrame) && has(prep.introduction)) blocks.push({ type: "heading", text: s("introduction") }, { type: "text", text: trim(prep.introduction) });
  let number = 0;
  for (const point of prep.points) {
    // A question with nothing to ask is not put to the group; on the leader's version its notes
    // stand unnumbered, so the numbers are the same on both sheets.
    if (!has(point.title)) {
      if (!o.leader || isEmptyPoint(point)) continue;
      blocks.push({ type: "heading", text: t("studies.materials.questions.unworded") });
    } else {
      number += 1;
      blocks.push({ type: "question", number, text: trim(point.title) });
    }
    if (o.leader) {
      for (const field of ["explanation", "application", "illustration"] as const) {
        if (has(point[field])) blocks.push({ type: "field", label: s(field), text: trim(point[field]) });
      }
    } else if (o.writingSpace) blocks.push({ type: "space", style: "lines" });
  }
  if ((o.leader || o.includeFrame) && has(prep.conclusion)) blocks.push({ type: "heading", text: s("conclusion") }, { type: "text", text: trim(prep.conclusion) });
  return finish("questions", prep, blocks, frame);
}

/**
 * A sheet to hand out and write on. For a lesson: the passage, the one thing
 * to remember, its questions and activities with room to write or draw
 * (never the answers to listen for or what an activity needs). For a sermon
 * or talk: listening notes, the points in order with room under each, and
 * room for the listener's own notes. Only what the teaching holds is shown.
 */
export function worksheet(t: TFunction, prep: TeachingPreparation, options: MaterialOptions = {}, scripture?: MaterialScripture | null): MaterialDocument {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const shape = canvasShape(prep.kind);
  const s = shapeText(t, shape);
  const blocks: Block[] = [];
  const passages = passagesLine(prep);
  if (passages) blocks.push({ type: "passages", text: passages });
  blocks.push(...scriptureBlocks(t, prep, o, scripture));
  const before = blocks.length;
  if (shape === "steps") {
    if (has(prep.centralMessage)) blocks.push({ type: "message", label: s("message"), text: trim(prep.centralMessage) });
    let number = 0;
    for (const point of prep.points) {
      if (!has(point.title)) continue;
      if (point.kind === "question") {
        number += 1;
        blocks.push({ type: "question", number, text: trim(point.title) });
        if (o.writingSpace) blocks.push({ type: "space", style: "lines" });
      } else if (point.kind === "activity") {
        blocks.push({ type: "heading", text: trim(point.title) });
        if (o.writingSpace) blocks.push({ type: "space", style: "box" });
      } else if (point.kind === "scripture") {
        const own = passagesLine(prep, point.id);
        blocks.push({ type: "heading", text: trim(point.title), detail: own || undefined });
      }
    }
  } else {
    let number = 0;
    for (const point of prep.points) {
      if (!has(point.title)) continue;
      number += 1;
      blocks.push({ type: "question", number, text: trim(point.title) });
      if (o.writingSpace) blocks.push({ type: "space", style: "lines" });
    }
    // Room for the listener's own thoughts, only once there is something to listen to.
    if (blocks.length > before && o.writingSpace) blocks.push({ type: "space", style: "box", label: t("studies.materials.worksheet.ownNotes") });
  }
  return finish("worksheet", prep, blocks, before);
}

function finish(kind: MaterialDocument["kind"], prep: TeachingPreparation, blocks: Block[], frame: number): MaterialDocument {
  const title = trim(prep.title);
  return { kind, title, blocks: [{ type: "title", text: title }, ...blocks], empty: blocks.length <= frame };
}

export function derive(t: TFunction, kind: MaterialDocument["kind"], prep: TeachingPreparation, options: MaterialOptions = {}, scripture?: MaterialScripture | null): MaterialDocument {
  if (kind === "manuscript") return manuscript(t, prep, options, scripture);
  if (kind === "questions") return questionSheet(t, prep, options, scripture);
  return worksheet(t, prep, options, scripture);
}


/**
 * The material as Markdown, block for block. Room to write becomes a few
 * lines to write on; the text is the person's own, unchanged apart from
 * line breaks kept as Markdown line breaks.
 */
export function toMarkdown(doc: MaterialDocument): string {
  // The person's words are kept as words: a line that would read as Markdown (a heading, a list,
  // a quotation) has its first mark escaped.
  const escape = (text: string) => text.replace(/^(\s*)([#>+*-])/gm, "$1\\$2").replace(/^(\s*)(\d+)([.)])/gm, "$1$2\\$3");
  const lines = (text: string) => escape(text.replace(/\r\n?/g, "\n")).replace(/\n(?!\n)/g, "  \n");
  const out: string[] = [];
  for (const block of doc.blocks) {
    switch (block.type) {
      case "title":
        out.push(`# ${lines(block.text)}`);
        break;
      case "passages":
        out.push(`*${lines(block.text)}*`);
        break;
      case "notice":
        out.push(`> ${block.text}`);
        break;
      case "scripture":
        // The passage as a quotation: its label, the verses with their numbers, what is lacking, its notice.
        out.push(
          [
            `> **${lines(block.label)}**`,
            `> ${block.verses.map((v) => `${v.title ? `*${escape(v.title)}*  \n> ` : ""}**${v.number}** ${escape(v.text)}`).join(" ")}`,
            block.note ? `> *${lines(block.note)}*` : "",
            block.attribution ? `> ${lines(block.attribution)}` : "",
          ]
            .filter((line) => line && line !== "> ")
            .join("\n>\n"),
        );
        break;
      case "message":
        out.push(`> **${block.label}:** ${lines(block.text)}`);
        break;
      case "heading":
        out.push(`## ${lines(block.text)}${block.detail ? ` · ${lines(block.detail)}` : ""}`);
        break;
      case "text":
        out.push(lines(block.text));
        break;
      case "field":
        out.push(`**${block.label}**  \n${lines(block.text)}`);
        break;
      case "question":
        out.push(`${block.number}. ${lines(block.text)}`);
        break;
      case "space":
        out.push([block.label ? `**${block.label}**` : "", ...Array.from({ length: block.style === "box" ? 5 : 3 }, () => "\\_".repeat(40))].filter(Boolean).join("  \n"));
        break;
    }
  }
  return `${out.join("\n\n")}\n`;
}
