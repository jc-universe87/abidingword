/**
 * Placing a PDF source's stored text on its drawn pages, and back (v0.14).
 *
 * A PDF has two representations (v0.13, "Two representations, never
 * merged"): the text imported into the library (segments: what annotations
 * are anchored in) and the text PDF.js draws on a page (what marks are
 * placed with). They differ in small ways: the import joins a word broken
 * at a line end, collapses spaces and may space items differently; PDF.js
 * may use a ligature character (ﬁ). Both sides are folded the same way —
 * white space and soft hyphens dropped, a line-end hyphen before a
 * lower-case letter dropped, compatibility forms (ligatures) expanded, case
 * and accents ignored — and a stored paragraph is placed on its page only
 * where its folded text occurs exactly once. Anything that cannot be placed
 * exactly is not placed: a mark is never drawn on other words. The stored
 * text stays the identity; this only finds where it is drawn.
 */

/** Folded text and, for each folded unit, the range of the original it came from. */
export interface FoldedText {
  folded: string;
  starts: number[];
  ends: number[];
}

const isSpace = (c: string) => /\s/u.test(c);
const SOFT_HYPHEN = "­";

/**
 * Folds text for matching (see the module comment). `lineBreaks` reads
 * "-" at the end of a line before a lower-case letter as a broken word
 * (drawn page text), as the import joins it.
 */
export function foldForMatch(text: string, lineBreaks = false): FoldedText {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  const chars = [...text];
  let at = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    const start = at;
    at += c.length;
    if (isSpace(c) || c === SOFT_HYPHEN) continue;
    if (lineBreaks && (c === "-" || c === "‐")) {
      // A word broken over a line: "-", then a line break (spaces around it allowed), then a lower-case letter.
      let j = i + 1;
      let broke = false;
      while (j < chars.length && isSpace(chars[j]!)) {
        if (chars[j] === "\n") broke = true;
        j++;
      }
      if (broke && j < chars.length && /\p{Ll}/u.test(chars[j]!)) continue;
    }
    const expanded = /[가-힣]/u.test(c) ? c : c.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const unit of expanded) {
      if (isSpace(unit)) continue;
      const u = unit === "ς" ? "σ" : unit;
      for (let k = 0; k < u.length; k++) {
        folded += u[k];
        starts.push(start);
        ends.push(at);
      }
    }
  }
  return { folded, starts, ends };
}

/** Every place `needle` occurs in `hay` (overlaps included). */
function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** A stored paragraph as the page needs it. */
export interface PageSegment {
  segmentId: string;
  position: number;
  text: string;
}

/** A stored paragraph found exactly once on a drawn page. */
export interface PlacedSegment extends PageSegment {
  fold: FoldedText;
  /** Where its folded text starts in the page's folded text. */
  at: number;
}

/** A drawn page with the stored paragraphs that could be placed on it exactly. */
export interface PagePlacement {
  page: FoldedText;
  placed: PlacedSegment[];
}

/**
 * Places each stored paragraph of a page on the page's drawn text: only a
 * paragraph whose folded text occurs exactly once, and never two over the
 * same text.
 */
export function placeSegments(pageText: string, segments: PageSegment[]): PagePlacement {
  const page = foldForMatch(pageText, true);
  const placed: PlacedSegment[] = [];
  for (const segment of segments) {
    const fold = foldForMatch(segment.text);
    if (!fold.folded) continue;
    const found = occurrences(page.folded, fold.folded);
    if (found.length === 1) placed.push({ ...segment, fold, at: found[0]! });
  }
  // Two paragraphs over the same drawn text: neither is trusted.
  const clash = new Set<string>();
  for (const a of placed) {
    for (const b of placed) {
      if (a === b) continue;
      if (a.at < b.at + b.fold.folded.length && b.at < a.at + a.fold.folded.length) clash.add(a.segmentId);
    }
  }
  return { page, placed: placed.filter((p) => !clash.has(p.segmentId)).sort((a, b) => a.at - b.at) };
}

/**
 * Where stored text `[from, to)` of a placed paragraph is drawn: a range of
 * the page's drawn text, or null if it holds nothing visible or the
 * paragraph is not placed.
 */
export function storedToPage(placement: PagePlacement, segmentId: string, from: number, to: number): [number, number] | null {
  const segment = placement.placed.find((p) => p.segmentId === segmentId);
  if (!segment) return null;
  const { fold } = segment;
  let first = -1;
  let last = -1;
  for (let i = 0; i < fold.folded.length; i++) {
    if (fold.starts[i]! >= from && fold.ends[i]! <= to) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  const { page } = placement;
  return [page.starts[segment.at + first]!, page.ends[segment.at + last]!];
}

/** Selected words of a page, as an anchor in the stored text. */
export interface StoredRange {
  start: { segmentId: string; offset: number };
  end: { segmentId: string; offset: number };
  /** The stored text, paragraphs joined with "\n" (as the core rebuilds it). */
  quote: string;
}

/**
 * The stored text under a range of a page's drawn text, or null when any of
 * it is not placed text (a running header, an unplaced paragraph) or it
 * holds nothing visible. Paragraphs must follow one another in the source.
 */
export function pageToStored(placement: PagePlacement, pageStart: number, pageEnd: number): StoredRange | null {
  const { page, placed } = placement;
  // The folded units the selection covers.
  let first = -1;
  let last = -1;
  for (let i = 0; i < page.folded.length; i++) {
    if (page.starts[i]! >= pageStart && page.ends[i]! <= pageEnd) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  type Part = { segment: PlacedSegment; from: number; to: number; whole: { head: boolean; tail: boolean } };
  const parts: Part[] = [];
  let covered = 0;
  // `placed` is in page order: the parts below are too.
  for (const segment of placed) {
    const a = Math.max(first, segment.at);
    const b = Math.min(last, segment.at + segment.fold.folded.length - 1);
    if (a > b) continue;
    parts.push({
      segment,
      from: segment.fold.starts[a - segment.at]!,
      to: segment.fold.ends[b - segment.at]!,
      // Whether the selection reaches the paragraph's first and last characters.
      whole: { head: a === segment.at, tail: b === segment.at + segment.fold.folded.length - 1 },
    });
    covered += b - a + 1;
  }
  // Every selected unit must belong to a placed paragraph: nothing is guessed.
  if (parts.length === 0 || covered !== last - first + 1) return null;
  // Across paragraphs, the page must draw them in reading order, one after another, and the
  // selection must run from inside the first to inside the last without leaving anything out:
  // otherwise the stored range would hold words that were never selected (two columns, a float).
  for (let i = 1; i < parts.length; i++) if (parts[i]!.segment.position !== parts[i - 1]!.segment.position + 1) return null;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i < parts.length - 1 && !part.whole.tail) return null;
    if (i > 0 && !part.whole.head) return null;
  }
  const head = parts[0]!;
  const tail = parts[parts.length - 1]!;
  return {
    start: { segmentId: head.segment.segmentId, offset: head.from },
    end: { segmentId: tail.segment.segmentId, offset: tail.to },
    quote: parts
      .map((p, i) => p.segment.text.slice(i === 0 ? p.from : 0, i === parts.length - 1 ? p.to : p.segment.text.length))
      .join("\n"),
  };
}
