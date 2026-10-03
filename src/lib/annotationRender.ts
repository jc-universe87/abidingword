import type { Annotation, HighlightColor } from "@/types/scripture";

/**
 * What the reader draws for saved annotations (docs/scripture-annotations-v0.5.md,
 * "Rendering rule"). Pure functions over the annotations the core returned for
 * the active translation: a phrase is drawn only when the core says its anchor
 * is `shown` there, and nothing here ever compares or repairs wording.
 */

/** Which colours cover a stretch of text or a verse, in a stable order. */
export type CoveringColors = HighlightColor[];

/** What to paint where highlights meet: a colour, or nothing. */
export type Paint = HighlightColor | null;

let warned = false;

/**
 * Chooses what is painted for the highlight colours covering one stretch of
 * text (or one whole verse).
 *
 * The core keeps phrase highlights on one wording from overlapping: a new
 * highlight owns exactly the words it covers and the others are merged,
 * trimmed or split around it (docs/scripture-annotations-v0.5.md,
 * "Overlapping highlights"). So one colour covers a stretch, and the same
 * colour twice is still one colour (callers pass the distinct colours).
 *
 * Several *different* colours can only come from data written before that
 * rule existed (or damaged data). The reader does not pick a winner for it —
 * no "latest wins" here — it paints nothing for that stretch, which is safe
 * and not misleading. Everything stays stored and listed, and the next
 * highlight made over it is normalised by the core.
 */
export function highlightPaint(colors: CoveringColors): Paint {
  if (colors.length > 1 && !warned && import.meta.env.DEV) {
    warned = true;
    console.warn("Overlapping highlights of different colours (older data); nothing is painted for them.");
  }
  return colors.length === 1 ? (colors[0] ?? null) : null;
}

const chapterOf = (verse: string) => verse.split(".").slice(0, 2).join(".");
const verseNumber = (verse: string) => Number(verse.split(".")[2]);

/** True when a phrase anchor covers some of `verse`'s text (same chapter, in range). */
function anchorCovers(annotation: Annotation, verse: string): boolean {
  const anchor = annotation.anchor;
  if (!anchor) return false;
  if (chapterOf(anchor.start.verse) !== chapterOf(verse)) return false;
  const n = verseNumber(verse);
  return n >= verseNumber(anchor.start.verse) && n <= verseNumber(anchor.end.verse);
}

/** A stretch of one verse's text and what covers it. Offsets are UTF-16, end exclusive. */
export interface TextSegment {
  start: number;
  end: number;
  /** Distinct colours of the phrase highlights covering it. */
  colors: CoveringColors;
  /** A phrase note covers it. */
  noted: boolean;
}

/** Phrase highlights and phrase notes that are drawn for this verse in the current wording. */
export function shownPhrases(verse: string, annotations: Annotation[]): Annotation[] {
  return annotations.filter(
    (a) => (a.kind === "highlight" || a.kind === "note") && a.anchor?.shown && anchorCovers(a, verse),
  );
}

/**
 * The verse's text cut where a drawn phrase starts or ends, covering the whole
 * text from 0 to `length`. Only phrases the core reports as shown take part.
 */
export function phraseSegments(verse: string, length: number, annotations: Annotation[]): TextSegment[] {
  const phrases = shownPhrases(verse, annotations).map((a) => {
    const anchor = a.anchor!;
    return {
      annotation: a,
      start: anchor.start.verse === verse ? anchor.start.offset : 0,
      end: anchor.end.verse === verse ? anchor.end.offset : length,
    };
  });
  const cuts = new Set<number>([0, length]);
  for (const p of phrases) {
    cuts.add(Math.max(0, Math.min(length, p.start)));
    cuts.add(Math.max(0, Math.min(length, p.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i]!;
    const end = points[i + 1]!;
    const covering = phrases.filter((p) => p.start <= start && p.end >= end);
    const colors = [...new Set(covering.flatMap((p) => (p.annotation.kind === "highlight" && p.annotation.color ? [p.annotation.color] : [])))];
    segments.push({ start, end, colors, noted: covering.some((p) => p.annotation.kind === "note") });
  }
  return segments;
}

/** Annotations that mark whole verses (no phrase anchor). */
export const wholeVerse = (annotations: Annotation[]): Annotation[] => annotations.filter((a) => !a.anchor);

export interface VerseMarks {
  /** Colours of whole-verse highlights covering the verse. */
  verseColors: CoveringColors;
  bookmarked: boolean;
  /** Notes of either kind (verse or phrase) covering the verse. */
  notes: Annotation[];
  /** A phrase highlight is drawn in this verse. */
  wordsHighlighted: boolean;
}

/** Everything the reader shows for one verse, from the annotations covering it. */
export function verseMarks(verse: string, annotations: Annotation[]): VerseMarks {
  const whole = wholeVerse(annotations);
  return {
    verseColors: [...new Set(whole.flatMap((a) => (a.kind === "highlight" ? [a.color ?? "amber"] : [])))],
    bookmarked: whole.some((a) => a.kind === "bookmark"),
    notes: annotations.filter((a) => a.kind === "note"),
    wordsHighlighted: shownPhrases(verse, annotations).some((a) => a.kind === "highlight"),
  };
}

/** Class names are written out in full so Tailwind can see them. */
export const PHRASE_CLASS: Record<HighlightColor, string> = {
  amber: "bg-hl-amber",
  green: "bg-hl-green",
  blue: "bg-hl-blue",
  rose: "bg-hl-rose",
  grey: "bg-hl-grey",
};

export const VERSE_CLASS: Record<HighlightColor, string> = {
  amber: "bg-hl-amber/40",
  green: "bg-hl-green/40",
  blue: "bg-hl-blue/40",
  rose: "bg-hl-rose/40",
  grey: "bg-hl-grey/40",
};

export const SWATCH_CLASS = PHRASE_CLASS;

/** The reference of a selection's covered verses, as `annotation_create` expects. */
export function coveredReference(startVerse: string, endVerse: string): string {
  return startVerse === endVerse ? startVerse : `${startVerse}-${endVerse}`;
}
