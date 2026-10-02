import type { AnchorEnd } from "@/types/scripture";

/**
 * Turns a text selection in the Scripture reader into a phrase anchor:
 * canonical verses and UTF-16 offsets into each verse's stored text
 * (docs/scripture-annotations-v0.5.md, "Selection anchoring").
 *
 * Each verse's text sits in its own `[data-verse-text="BOOK.C.V"]`
 * element, apart from verse numbers and markers, so only Scripture text
 * is ever counted. Offsets are measured with DOM ranges, which count
 * UTF-16 units however the text is split into elements.
 */

export const VERSE_TEXT_ATTRIBUTE = "data-verse-text";

export interface SelectedPart {
  /** Canonical verse, e.g. JHN.15.4. */
  verse: string;
  /** UTF-16 offsets into the verse's text, end exclusive. */
  start: number;
  end: number;
}

export interface SelectionAnchor {
  start: AnchorEnd;
  end: AnchorEnd;
  /** The selected part of each verse, joined with one space (as the core rebuilds it). */
  quote: string;
  parts: SelectedPart[];
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isSpace = (ch: string) => /\s/.test(ch);

/** Length of the text from the start of `container` to a boundary point. */
function lengthTo(container: HTMLElement, node: Node, offset: number): number {
  const range = container.ownerDocument.createRange();
  range.setStart(container, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function chapterOf(verse: string): string {
  return verse.split(".").slice(0, 2).join(".");
}

/**
 * The anchor for a range inside `root`, or null when it covers no
 * Scripture text. Boundaries outside verse text (a verse number, a marker,
 * the gap between verses) snap to the nearest verse-text edge; whitespace
 * at either end is left out; a surrogate pair is never split. Returns null
 * if the selection reaches into another chapter.
 */
export function anchorFromRange(range: Range, root: HTMLElement): SelectionAnchor | null {
  const doc = root.ownerDocument;
  const texts = new Map<string, string>();
  let parts: SelectedPart[] = [];

  for (const element of root.querySelectorAll<HTMLElement>(`[${VERSE_TEXT_ATTRIBUTE}]`)) {
    if (!range.intersectsNode(element)) continue;
    const verse = element.getAttribute(VERSE_TEXT_ATTRIBUTE) ?? "";
    const text = element.textContent ?? "";
    const whole = doc.createRange();
    whole.selectNodeContents(element);
    const start =
      range.compareBoundaryPoints(Range.START_TO_START, whole) <= 0
        ? 0
        : lengthTo(element, range.startContainer, range.startOffset);
    const end =
      range.compareBoundaryPoints(Range.END_TO_END, whole) >= 0
        ? text.length
        : lengthTo(element, range.endContainer, range.endOffset);
    texts.set(verse, text);
    parts.push({ verse, start, end });
  }

  parts = parts.filter((p) => p.end > p.start);
  // Leave out whitespace at either end, dropping parts that hold nothing else.
  while (parts.length > 0) {
    const first = parts[0]!;
    const text = texts.get(first.verse) ?? "";
    while (first.start < first.end && isSpace(text[first.start] ?? "")) first.start += 1;
    if (first.start < first.end) break;
    parts.shift();
  }
  while (parts.length > 0) {
    const last = parts[parts.length - 1]!;
    const text = texts.get(last.verse) ?? "";
    while (last.end > last.start && isSpace(text[last.end - 1] ?? "")) last.end -= 1;
    if (last.end > last.start) break;
    parts.pop();
  }
  if (parts.length === 0) return null;
  if (new Set(parts.map((p) => chapterOf(p.verse))).size > 1) return null;

  // Never split a surrogate pair.
  for (const part of parts) {
    const text = texts.get(part.verse) ?? "";
    if (part.start > 0 && isHighSurrogate(text.charCodeAt(part.start - 1))) part.start -= 1;
    if (part.end < text.length && isHighSurrogate(text.charCodeAt(part.end - 1))) part.end += 1;
  }

  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  return {
    start: { verse: first.verse, offset: first.start },
    end: { verse: last.verse, offset: last.end },
    quote: parts.map((p) => (texts.get(p.verse) ?? "").slice(p.start, p.end)).join(" "),
    parts,
  };
}

/** The anchor for the document's current selection inside `root`, if any. */
export function anchorFromSelection(selection: Selection | null, root: HTMLElement): SelectionAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(root)) return null;
  return anchorFromRange(range, root);
}
