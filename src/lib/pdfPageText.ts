import type { PdfPageText } from "./pdfEngine";

/** What a page-text map needs from a PDF.js text item. */
export interface PageTextItem {
  str: string;
  hasEOL: boolean;
  /** Writing direction PDF.js found ("ltr", "rtl", "ttb"). */
  dir: string;
  /** Upright text: no rotation, not a vertical font. */
  upright: boolean;
  /** The item's baseline, as a share of the page height from the top. */
  top: number;
}

/** What [`toPageTextItems`] needs from PDF.js's text content and a page viewport at scale 1. */
export interface RawTextContent {
  items: ReadonlyArray<object>;
  styles: Record<string, { vertical?: boolean }>;
}
export interface UnscaledViewport {
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * PDF.js's text content as page-text items, in the order PDF.js draws them
 * (one text-layer span per item with a string; marked-content markers have
 * neither). Where an item is comes from its own transform, never guessed.
 */
export function toPageTextItems(content: RawTextContent, viewport: UnscaledViewport): PageTextItem[] {
  const items: PageTextItem[] = [];
  for (const raw of content.items as Array<{ str?: string; hasEOL?: boolean; dir?: string; transform?: number[]; fontName?: string }>) {
    if (typeof raw.str !== "string") continue;
    const t = raw.transform ?? [];
    const [, y] = viewport.convertToViewportPoint(t[4] ?? 0, t[5] ?? 0) as [number, number];
    items.push({
      str: raw.str,
      hasEOL: raw.hasEOL === true,
      dir: raw.dir ?? "ltr",
      upright: Math.abs(t[1] ?? 0) < 1e-6 && Math.abs(t[2] ?? 0) < 1e-6 && (t[0] ?? 0) > 0 && (t[3] ?? 0) > 0 && !content.styles[raw.fontName ?? ""]?.vertical,
      top: viewport.height > 0 ? y / viewport.height : 0.5,
    });
  }
  return items;
}

/** Items this near the top or bottom of a page are taken for running headers and footers. */
export const MARGIN = 0.06;

/**
 * The page-text map of a page's text items (v0.13): the items' strings joined
 * in drawing order, a line break after each item that ends a line, with each
 * item's place in the joined text.
 */
export function buildPageText(items: PageTextItem[]): PdfPageText {
  let text = "";
  const starts: number[] = [];
  const lengths: number[] = [];
  const usable: boolean[] = [];
  for (const item of items) {
    starts.push(text.length);
    lengths.push(item.str.length);
    usable.push(item.upright && item.dir !== "rtl" && item.dir !== "ttb" && item.top >= MARGIN && item.top <= 1 - MARGIN);
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return { text, starts, lengths, usable, hasText: /\S/.test(text) };
}

/**
 * The pieces of `text[start, end)` in each item it covers: (item, offset in
 * the item, end offset in the item). Null when a covered item cannot carry a
 * mark, so a range is either marked whole or not at all.
 */
export function rangeParts(map: PdfPageText, start: number, end: number): { item: number; from: number; to: number }[] | null {
  if (!(start < end)) return null;
  const parts: { item: number; from: number; to: number }[] = [];
  for (let i = 0; i < map.starts.length; i += 1) {
    const s = map.starts[i]!;
    const e = s + map.lengths[i]!;
    if (e <= start || s >= end || e === s) continue;
    if (!map.usable[i]) return null;
    parts.push({ item: i, from: Math.max(start, s) - s, to: Math.min(end, e) - s });
  }
  return parts.length > 0 ? parts : null;
}

/** Text folded as the core's find folds it: case, accents and whitespace runs ignored, Hangul syllables whole. */
export function foldForFind(text: string): { folded: string; spans: [number, number][] } {
  let folded = "";
  const spans: [number, number][] = [];
  let at = 0;
  for (const c of text) {
    const range: [number, number] = [at, at + c.length];
    at += c.length;
    if (/\s/u.test(c)) {
      if (folded.endsWith(" ")) spans[spans.length - 1]![1] = range[1];
      else {
        folded += " ";
        spans.push(range);
      }
      continue;
    }
    const parts = /[가-힣]/u.test(c) ? [c] : [...c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()];
    for (const part of parts) {
      const f = part === "ς" ? "σ" : part;
      // one span per UTF-16 unit, so an index into `folded` is an index into `spans`
      for (let k = 0; k < f.length; k += 1) {
        folded += f[k];
        spans.push(range);
      }
    }
  }
  return { folded, spans };
}

/** The non-overlapping places `query` occurs in `text`, folded as the core folds, as UTF-16 ranges of `text`. */
export function findOnPage(text: string, query: string): [number, number][] {
  const needle = foldForFind(query.trim()).folded;
  if (!needle) return [];
  const { folded, spans } = foldForFind(text);
  const out: [number, number][] = [];
  for (let i = folded.indexOf(needle); i >= 0; i = folded.indexOf(needle, i + needle.length)) {
    out.push([spans[i]![0], spans[i + needle.length - 1]![1]]);
  }
  return out;
}

/**
 * Where a DOM point inside a drawn text layer is in the page's text (v0.14):
 * the selection's ends become offsets of `map.text`. The layer has one span
 * per text item, in item order. A point between spans counts as the start of
 * the next one. Null when the point is outside the layer.
 */
export function offsetInLayer(container: HTMLElement, spans: ArrayLike<HTMLElement>, map: PdfPageText, node: Node, offset: number): number | null {
  if (!container.contains(node)) return null;
  const list = Array.from(spans);
  // Inside a span: the item's start, plus the text before the point in that span.
  for (let el: Node | null = node; el && el !== container; el = el.parentNode) {
    const item = list.indexOf(el as HTMLElement);
    if (item < 0) continue;
    const span = list[item]!;
    const range = document.createRange();
    range.setStart(span, 0);
    range.setEnd(node, offset);
    return map.starts[item]! + Math.min(range.toString().length, map.lengths[item]!);
  }
  // Between spans: the first span after the point.
  const point = document.createRange();
  point.setStart(node, offset);
  for (let item = 0; item < list.length; item++) {
    if (point.comparePoint(list[item]!, 0) >= 0) return map.starts[item]!;
  }
  return map.text.length;
}
