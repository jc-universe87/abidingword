// Words and small helpers for presentations (v0.18).
import type { TFunction } from "i18next";
import i18n from "i18next";
import themes from "../../../resources/presentation/themes.json";
import englishBooks from "@/i18n/locales/en/books.json";
import englishPresentation from "@/i18n/locales/en/presentation.json";
import { referenceLabel } from "@/i18n/scripture";
import type { ExportLocale, ItemKind, ItemSource, PresentationItem, PresentationTheme, RefInfo } from "@/types/presentation";
import type { TeachingPreparation } from "@/types/teaching";

export interface Palette {
  background: string;
  text: string;
  muted: string;
  accent: string;
}

/** The colours of a background, shared with the exports (resources/presentation/themes.json). */
export function palette(theme: PresentationTheme): Palette {
  return (themes as Record<string, Palette>)[theme] ?? themes.light;
}

export function itemKindLabel(t: TFunction, kind: ItemKind): string {
  return t(`presentation.kinds.${kind}`);
}

export function themeLabel(t: TFunction, theme: PresentationTheme): string {
  return t(`presentation.themes.${theme}`);
}

/** A passage as the reader sees it, in the interface language. */
export function refLabel(ref: RefInfo): string {
  return referenceLabel({ ...ref, display: "" });
}

/** Which part of the teaching an item shows, in words. */
export function sourceLabel(t: TFunction, source: ItemSource | null, prep: TeachingPreparation): string {
  if (!source) return t("presentation.source.own");
  switch (source.kind) {
    case "preparation":
      return t(`presentation.source.field.${source.field ?? "title"}`);
    case "point": {
      const index = prep.points.findIndex((p) => p.id === source.id);
      if (index < 0) return t("presentation.source.missing");
      const title = prep.points[index]!.title.trim();
      return title ? t("presentation.source.pointTitled", { number: index + 1, title }) : t("presentation.source.point", { number: index + 1 });
    }
    case "passage": {
      const passage = prep.passages.find((p) => p.id === source.id);
      return passage ? t("presentation.source.passage", { reference: referenceLabel(passage.reference) }) : t("presentation.source.missing");
    }
    case "material": {
      const material = prep.materials.find((m) => m.id === source.id);
      return material ? t("presentation.source.material", { title: material.title || t("presentation.kinds.image") }) : t("presentation.source.missing");
    }
    case "finding":
      return prep.findings.some((f) => f.finding.id === source.id) ? t("presentation.source.finding") : t("presentation.source.missing");
  }
}

/**
 * What the teaching itself says for an item's heading or audience text (the
 * same rules as the core's document): shown while the slide follows the
 * teaching, and as the start of the person's own wording.
 */
export function teachingText(item: PresentationItem, prep: TeachingPreparation, part: "heading" | "body"): string | null {
  const s = item.source;
  if (!s) return null;
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  if (s.kind === "preparation") {
    if (s.field === "title" && part === "heading") return clean(prep.title);
    if (s.field === "central_message" && part === "body") return clean(prep.centralMessage);
    return null;
  }
  if (s.kind === "point") {
    const point = prep.points.find((p) => p.id === s.id);
    if (!point) return null;
    const asks = item.kind === "question";
    return (asks ? part === "body" : part === "heading") ? clean(point.title) : null;
  }
  if (s.kind === "material") {
    const m = prep.materials.find((x) => x.id === s.id);
    return m && m.kind !== "image" && part === "body" ? clean(m.content) : null;
  }
  if (s.kind === "finding") {
    const f = prep.findings.find((x) => x.finding.id === s.id);
    return f && part === "body" ? clean(f.finding.content) : null;
  }
  return null;
}

/** Whether the part of the teaching an item follows gives it this field. */
export function teachingGives(item: PresentationItem, part: "heading" | "body"): boolean {
  const s = item.source;
  if (!s) return false;
  if (s.kind === "preparation") return (s.field === "title" && part === "heading") || (s.field === "central_message" && part === "body");
  if (s.kind === "point") return item.kind === "question" ? part === "body" : part === "heading";
  if (s.kind === "material" || s.kind === "finding") return part === "body";
  return false;
}

const LANGUAGE_TAGS: Record<string, string> = { en: "en-US", de: "de-DE", ko: "ko-KR", fr: "fr-FR", es: "es-ES", pt: "pt-BR" };

/** The words the exports need, in the interface language. */
export function exportLocale(t: TFunction): ExportLocale {
  const bookNames: Record<string, string> = {};
  for (const code of Object.keys(englishBooks.name)) bookNames[code] = t(`books.name.${code}`, { defaultValue: code });
  const label = (key: keyof typeof englishPresentation.export.labels) => t(`presentation.export.labels.${key}`);
  return {
    language: LANGUAGE_TAGS[i18n.language] ?? "en-US",
    bookNames,
    psalm: t("books.psalm"),
    verseSeparator: t("books.verseSeparator"),
    labels: {
      slide: label("slide"),
      speakerNotes: label("speakerNotes"),
      introduction: label("introduction"),
      conclusion: label("conclusion"),
      explanation: label("explanation"),
      application: label("application"),
      illustration: label("illustration"),
      standing: label("standing"),
      citations: label("citations"),
      generatedImage: label("generatedImage"),
      imageUnavailable: label("imageUnavailable"),
      scriptureUnavailable: label("scriptureUnavailable"),
      pause: label("pause"),
      next: label("next"),
      standings: Object.fromEntries(
        (Object.keys(englishPresentation.export.standings) as (keyof typeof englishPresentation.export.standings)[]).map((s) => [s, t(`presentation.export.standings.${s}`)]),
      ),
    },
  };
}

/** A file name from the title: letters, numbers, spaces and dashes only. */
export function fileName(title: string, suffix: string, extension: string, fallback = "Presentation"): string {
  const visible = [...title].map((c) => (c.charCodeAt(0) < 32 ? " " : c)).join("");
  const cleaned = visible.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  // Cut by characters, never inside one.
  const base = [...cleaned].slice(0, 80).join("").trim() || fallback;
  return `${base}${suffix ? ` – ${suffix}` : ""}.${extension}`;
}

export function slideText(t: TFunction, kind: ItemKind, heading: string | null, body: string | null, ref: RefInfo | null): string {
  return heading || body || (ref ? refLabel(ref) : "") || itemKindLabel(t, kind);
}

/** How much room a text takes; a Hangul or CJK character counts as two (as in the core). */
export function textWeight(text: string): number {
  let n = 0;
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    const wide = (code >= 0x1100 && code <= 0x11ff) || (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);
    n += wide ? 2 : 1;
  }
  return n;
}

/** Whole verses, about 600 of room per slide: the core's rule for Scripture slides (document.rs). */
export function splitVerses<V extends { text: string }>(verses: V[]): V[][] {
  const groups: V[][] = [];
  let size = 0;
  for (const verse of verses) {
    const len = textWeight(verse.text);
    const last = groups.at(-1);
    if (last && size + len <= 600) {
      size += len;
      last.push(verse);
    } else {
      size = len;
      groups.push([verse]);
    }
  }
  return groups;
}
