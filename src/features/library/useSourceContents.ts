import { useEffect, useState } from "react";
import { useApi } from "@/lib/ApiContext";
import type { ContentsItem, Source } from "@/types/library";
import { usePdfEngine } from "./PdfEngineContext";

/**
 * The contents the source itself carries: an EPUB's from the core, a PDF's
 * outline from the PDF engine. Empty (and no control shown) when there are
 * none, the source has no format with contents, or reading them fails: the
 * reader works exactly as before in all those cases. Nothing is generated.
 */
export function useSourceContents(source: Source | null | undefined): ContentsItem[] {
  const api = useApi();
  const engine = usePdfEngine();
  const [found, setFound] = useState<{ id: string; items: ContentsItem[] } | null>(null);
  const id = source?.id;
  const kind = source?.originalView?.kind === "pdf" ? "pdf" : source?.format === "epub" ? "epub" : null;

  useEffect(() => {
    if (!id || !kind) return;
    let active = true;
    const read = kind === "pdf" ? engine.outline(api, id) : api.librarySourceContents(id);
    read.then(
      (items) => active && setFound({ id, items }),
      (e) => {
        void api.logError(`Contents could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
        if (active) setFound({ id, items: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [api, engine, id, kind]);

  return found && found.id === id ? found.items : EMPTY;
}

const EMPTY: ContentsItem[] = [];

/** The entry the reader is in: the last (deepest, in reading order) whose target is at or before `at`. */
export function currentEntry(items: ContentsItem[], kind: "page" | "segment", at: number): string | null {
  let best: { id: string; value: number } | null = null;
  const visit = (list: ContentsItem[]) => {
    for (const item of list) {
      const t = item.target;
      if (t && t.kind === kind) {
        const value = t.kind === "page" ? t.page : t.position;
        if (value <= at && (!best || value >= best.value)) best = { id: item.id, value };
      }
      visit(item.children);
    }
  };
  visit(items);
  return (best as { id: string } | null)?.id ?? null;
}
