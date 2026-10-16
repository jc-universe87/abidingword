import type { TextPoint } from "@/types/library";

/**
 * Turns a text selection in a source's Reading view into an anchor in the
 * source's stored text (docs/source-annotations-v0.14.md, "Anchors"):
 * segments and UTF-16 offsets into their stored text, and the quote.
 *
 * Each segment's text is one `[data-segment-id]` paragraph. Anything inside
 * it that is not the source's own text (a mark's button, an open menu) is
 * marked `[data-aw-skip]` and never counted. A paragraph whose drawn text
 * differs from the stored text is never anchored: nothing is marked rather
 * than the wrong words.
 *
 * A selection across paragraphs has one quote: the stored texts joined with
 * "\n" — the convention the core rebuilds and checks.
 */

export const SEGMENT_ATTRIBUTE = "data-segment-id";
export const SKIP_ATTRIBUTE = "data-aw-skip";
export const SEGMENT_JOINER = "\n";

export interface SourceSelection {
  start: TextPoint;
  end: TextPoint;
  quote: string;
  /** Reading positions of the first and last paragraph covered. */
  firstPosition: number;
  lastPosition: number;
  /** On an Original PDF page: the page the words were selected on. */
  page?: number;
}

/** A paragraph of stored text as the reader shows it. */
export interface StoredText {
  position: number;
  text: string;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isSpace = (ch: string) => /\s/.test(ch);

/** The text nodes of `element` that are the source's own text, in order. */
function textNodes(element: Element): Text[] {
  const doc = element.ownerDocument;
  const skipped = (node: Node) => {
    const skip = node.parentElement?.closest(`[${SKIP_ATTRIBUTE}]`);
    return !!skip && element.contains(skip);
  };
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (skipped(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const out: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
  return out;
}

/** The source text drawn in a paragraph. */
export function drawnText(element: Element): string {
  return textNodes(element)
    .map((t) => t.data)
    .join("");
}

/** UTF-16 length of the paragraph's own text before a boundary point. */
function lengthTo(element: Element, node: Node, offset: number): number {
  const doc = element.ownerDocument;
  const range = doc.createRange();
  range.setStart(element, 0);
  range.setEnd(node, offset);
  let total = 0;
  for (const text of textNodes(element)) {
    if (text === node) return total + offset;
    // A text node wholly before the boundary counts in full; the first one after it ends the count.
    if (range.comparePoint(text, text.length) === 0) total += text.length;
    else break;
  }
  return total;
}

/**
 * The anchor for a range inside `root`, or null when it covers no source
 * text or the drawn text cannot be trusted to be the stored text.
 * Boundaries outside paragraphs snap to the nearest paragraph edge;
 * whitespace at either end is left out; a surrogate pair is never split.
 */
export function selectionFromRange(range: Range, root: HTMLElement, stored: (segmentId: string) => StoredText | undefined): SourceSelection | null {
  const doc = root.ownerDocument;
  type Part = { segmentId: string; position: number; text: string; start: number; end: number };
  let parts: Part[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(`[${SEGMENT_ATTRIBUTE}]`)) {
    if (!range.intersectsNode(element)) continue;
    const segmentId = element.getAttribute(SEGMENT_ATTRIBUTE) ?? "";
    const known = stored(segmentId);
    if (!known) return null;
    // Precision first: the drawn text must be exactly the stored text.
    if (drawnText(element) !== known.text) return null;
    const whole = doc.createRange();
    whole.selectNodeContents(element);
    const start = range.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 ? 0 : lengthTo(element, range.startContainer, range.startOffset);
    const end = range.compareBoundaryPoints(Range.END_TO_END, whole) >= 0 ? known.text.length : lengthTo(element, range.endContainer, range.endOffset);
    parts.push({ segmentId, position: known.position, text: known.text, start, end: Math.max(start, end) });
  }
  parts = parts.filter((p) => p.end > p.start);
  while (parts.length > 0) {
    const first = parts[0]!;
    while (first.start < first.end && isSpace(first.text[first.start] ?? "")) first.start += 1;
    if (first.start < first.end) break;
    parts.shift();
  }
  while (parts.length > 0) {
    const last = parts[parts.length - 1]!;
    while (last.end > last.start && isSpace(last.text[last.end - 1] ?? "")) last.end -= 1;
    if (last.end > last.start) break;
    parts.pop();
  }
  if (parts.length === 0) return null;
  // Paragraphs must follow one another: a gap would make a quote the core cannot rebuild.
  for (let i = 1; i < parts.length; i++) if (parts[i]!.position !== parts[i - 1]!.position + 1) return null;
  // Inner paragraphs are covered whole.
  for (let i = 1; i < parts.length - 1; i++) {
    parts[i]!.start = 0;
    parts[i]!.end = parts[i]!.text.length;
  }
  if (parts.length > 1) {
    parts[0]!.end = parts[0]!.text.length;
    parts[parts.length - 1]!.start = 0;
  }
  for (const part of parts) {
    if (part.start > 0 && isHighSurrogate(part.text.charCodeAt(part.start - 1))) part.start -= 1;
    if (part.end < part.text.length && isHighSurrogate(part.text.charCodeAt(part.end - 1))) part.end += 1;
  }
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  return {
    start: { segmentId: first.segmentId, offset: first.start },
    end: { segmentId: last.segmentId, offset: last.end },
    quote: parts.map((p) => p.text.slice(p.start, p.end)).join(SEGMENT_JOINER),
    firstPosition: first.position,
    lastPosition: last.position,
  };
}

/** The anchor for the document's current selection inside `root`, if any. */
export function selectionInside(selection: Selection | null, root: HTMLElement, stored: (segmentId: string) => StoredText | undefined): SourceSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(root)) return null;
  return selectionFromRange(range, root, stored);
}

/** A whole paragraph as a selection (keyboard path: "Highlight this paragraph"), trimmed of edge spaces. */
export function wholeParagraph(segmentId: string, known: StoredText): SourceSelection | null {
  let start = 0;
  let end = known.text.length;
  while (start < end && isSpace(known.text[start] ?? "")) start += 1;
  while (end > start && isSpace(known.text[end - 1] ?? "")) end -= 1;
  if (start === end) return null;
  return {
    start: { segmentId, offset: start },
    end: { segmentId, offset: end },
    quote: known.text.slice(start, end),
    firstPosition: known.position,
    lastPosition: known.position,
  };
}
