import type { EpubStructureItem } from "@/types/library";

/**
 * A place in a formatted EPUB: a reading-order document, the element in it
 * (null: its top), and how far in pixels that element's top is from the top
 * of the view (negative: scrolled past it). Elements, not pixel coordinates,
 * are what a place is anchored to.
 */
export interface EpubPlace {
  item: string;
  fragment: string | null;
  offset: number;
}

/** Documents with text, in reading order (a cover or an image-only page has none of its own). */
const withText = (structure: EpubStructureItem[]) => structure.filter((item) => item.segmentCount > 0);

/**
 * The formatted place of a segment of the extracted text: its document, and
 * the nearest element at or before it in that document (the top of the
 * document when the segment is where the document starts). Null for a book
 * with no text.
 */
export function placeOfPosition(structure: EpubStructureItem[], position: number): EpubPlace | null {
  const items = withText(structure);
  if (items.length === 0) return null;
  let item = items[0]!;
  for (const candidate of items) {
    if (candidate.startSegment <= position) item = candidate;
    else break;
  }
  if (position <= item.startSegment) return { item: item.id, fragment: null, offset: 0 };
  let fragment: string | null = null;
  let best = -1;
  for (const [id, at] of Object.entries(item.anchors)) {
    if (at <= position && at > best) {
      best = at;
      fragment = id;
    }
  }
  return { item: item.id, fragment, offset: 0 };
}

/** The segment of the extracted text a formatted place corresponds to: the element's own, else its document's first. */
export function positionOfPlace(structure: EpubStructureItem[], place: { item: string; fragment: string | null }): number | null {
  const item = structure.find((i) => i.id === place.item);
  if (!item) return null;
  const total = structure.reduce((sum, i) => Math.max(sum, i.startSegment + i.segmentCount), 0);
  const at = place.fragment !== null ? item.anchors[place.fragment] : undefined;
  const position = at ?? item.startSegment;
  return Math.max(0, Math.min(position, Math.max(0, total - 1)));
}
