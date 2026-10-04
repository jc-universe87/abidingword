/**
 * Back and Forward inside one source. A deliberate jump (a link, a contents
 * entry) records where the reader was and where it went; scrolling records
 * nothing. A place is generic enough for every format: a PDF's page and how
 * far down it, and the position of the extracted text with how far it sits
 * from the top of the view. The user never sees any of this.
 */
export interface SourceLocation {
  /** A physical page (PDF), when the place is known by one. */
  page: number | null;
  /** How far down that page (0 = top, 1 = bottom); only meaningful with `page` in the original view. */
  fraction: number;
  /** The segment of the extracted text at the top of the view (Reading), when known. */
  position: number | null;
  /** How far, in pixels, the top of that segment is below the top of the view (negative: partly scrolled past). */
  offset: number;
}

export interface ReaderHistory {
  /** The places visited, oldest first; the reader is at `entries[index]`. */
  entries: SourceLocation[];
  index: number;
}

export const NO_HISTORY: ReaderHistory = { entries: [], index: -1 };

/** A long session keeps its most recent places only. */
export const MAX_HISTORY = 200;

export const canGoBack = (h: ReaderHistory) => h.index > 0;
export const canGoForward = (h: ReaderHistory) => h.index >= 0 && h.index < h.entries.length - 1;

/**
 * A deliberate jump from `here` to `target`: what was ahead of the reader
 * (places it had gone Back from) is dropped, as in a browser.
 */
export function visit(h: ReaderHistory, here: SourceLocation, target: SourceLocation): ReaderHistory {
  const before = h.index >= 0 ? h.entries.slice(0, h.index) : [];
  const entries = [...before, here, target].slice(-MAX_HISTORY);
  return { entries, index: entries.length - 1 };
}

/** One step Back, remembering where the reader is now so Forward returns exactly there. Null at the start. */
export function stepBack(h: ReaderHistory, here: SourceLocation): { history: ReaderHistory; to: SourceLocation } | null {
  if (!canGoBack(h)) return null;
  const entries = [...h.entries];
  entries[h.index] = here;
  const index = h.index - 1;
  return { history: { entries, index }, to: entries[index]! };
}

/** One step Forward, remembering where the reader is now. Null at the end. */
export function stepForward(h: ReaderHistory, here: SourceLocation): { history: ReaderHistory; to: SourceLocation } | null {
  if (!canGoForward(h)) return null;
  const entries = [...h.entries];
  entries[h.index] = here;
  const index = h.index + 1;
  return { history: { entries, index }, to: entries[index]! };
}
