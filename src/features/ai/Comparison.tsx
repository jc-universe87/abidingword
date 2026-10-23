import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ExcerptInput } from "@/types/inquiry";

/** The most passages compared at once (as the core allows). */
export const COMPARE_MAX = 3;

/** A passage the person deliberately put aside to compare, with what the tray shows of it. */
export interface ComparedPassage {
  excerpt: ExcerptInput;
  title: string;
  author: string | null;
  /** e.g. "p. 52" or "Chapter 4 › Grace", from the stored paragraph. */
  locator: string | null;
}

export interface Comparison {
  passages: ComparedPassage[];
  /** Adds a passage; false when it is already there or the tray is full. */
  add: (passage: ComparedPassage) => boolean;
  remove: (index: number) => void;
  clear: () => void;
}

const same = (a: ExcerptInput, b: ExcerptInput) =>
  a.sourceId === b.sourceId && a.start.segmentId === b.start.segmentId && a.start.offset === b.start.offset && a.end.segmentId === b.end.segmentId && a.end.offset === b.end.offset;

const ComparisonContext = createContext<Comparison | null>(null);

/**
 * The passages put aside to compare (v0.20): two or three, chosen one by one
 * in the reader, for this session only. Nothing here is saved or sent until
 * the person asks for a comparison.
 */
export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [passages, setPassages] = useState<ComparedPassage[]>([]);
  const add = useCallback(
    (passage: ComparedPassage) => {
      if (passages.length >= COMPARE_MAX || passages.some((p) => same(p.excerpt, passage.excerpt))) return false;
      setPassages([...passages, passage]);
      return true;
    },
    [passages],
  );
  const remove = useCallback((index: number) => setPassages((all) => all.filter((_, i) => i !== index)), []);
  const clear = useCallback(() => setPassages([]), []);
  const value = useMemo(() => ({ passages, add, remove, clear }), [passages, add, remove, clear]);
  return <ComparisonContext.Provider value={value}>{children}</ComparisonContext.Provider>;
}

const NONE: Comparison = { passages: [], add: () => false, remove: () => undefined, clear: () => undefined };

/** The comparison tray; outside a provider (isolated tests), comparing is not offered. */
export function useComparison(): Comparison {
  return useContext(ComparisonContext) ?? NONE;
}
