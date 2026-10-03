import { useCallback, useEffect, useState } from "react";
import { PdfOutlineError } from "@/lib/pdfEngine";
import { useApi } from "@/lib/ApiContext";
import type { ContentsItem, Source } from "@/types/library";
import { usePdfEngine } from "./PdfEngineContext";

/**
 * The contents the source itself carries: an EPUB's from the core, a PDF's
 * outline from the PDF engine. Empty (and no control shown) when there are
 * none, the source has no format with contents, or reading them fails: the
 * reader works exactly as before in all those cases. Nothing is generated.
 */
export interface SourceContents {
  /** The source's own contents; empty when there are none, or while they are still being read. */
  items: ContentsItem[];
  /**
   * Offers contents found another way (the Original view's own open document
   * has just read the outline). Taken only if it adds something.
   */
  adopt: (items: ContentsItem[]) => void;
}

type Status = "loading" | "ready" | "failed";

export function useSourceContents(source: Source | null | undefined): SourceContents {
  const api = useApi();
  const engine = usePdfEngine();
  const [found, setFound] = useState<{ id: string; status: Status; items: ContentsItem[] } | null>(null);
  const id = source?.id;
  const kind = source?.originalView?.kind === "pdf" ? "pdf" : source?.format === "epub" ? "epub" : null;

  useEffect(() => {
    if (!id || !kind) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Whether a source has contents is a fact about the source, not about one
    // read having worked. "None" (a valid, empty answer) is final; a read that
    // fails is tried again, a few times with growing pauses, and if it still
    // cannot be read that is remembered as a failure, never as "no contents":
    // the next opening starts afresh, and the Original view can still supply it.
    const attempt = (n: number) => {
      const read = kind === "pdf" ? engine.outline(api, id) : api.librarySourceContents(id);
      read.then(
        (items) => active && setFound((current) => (current?.id === id && current.status === "ready" && current.items.length > 0 ? current : { id, status: "ready", items })),
        (e) => {
          if (!active) return;
          const delay = RETRY_DELAYS_MS[n];
          if (delay !== undefined) {
            timer = setTimeout(() => attempt(n + 1), delay);
            return;
          }
          // The stage (PDF only) says where it went wrong; no document text is logged.
          const stage = e instanceof PdfOutlineError ? ` (at "${e.stage}")` : "";
          void api.logError(`Contents could not be read${stage}: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
          setFound((current) => (current?.id === id && current.items.length > 0 ? current : { id, status: "failed", items: EMPTY }));
        },
      );
    };
    attempt(0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, engine, id, kind]);

  const adopt = useCallback(
    (items: ContentsItem[]) => {
      if (!id || items.length === 0) return;
      setFound((current) => (current?.id === id && current.items.length > 0 ? current : { id, status: "ready", items }));
    },
    [id],
  );

  return { items: found && found.id === id ? found.items : EMPTY, adopt };
}

const EMPTY: ContentsItem[] = [];

/** Waits before the second, third and fourth try of a failed read. */
const RETRY_DELAYS_MS = [300, 1000, 3000];

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
