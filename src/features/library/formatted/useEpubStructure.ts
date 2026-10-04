import { useEffect, useState } from "react";
import { useApi } from "@/lib/ApiContext";
import type { EpubStructureItem, Source } from "@/types/library";

/** An EPUB's (or DOCX's) parts for its formatted view: loading, ready (possibly empty), or failed. */
export type EpubStructure =
  | { status: "none" | "loading" | "failed"; items: EpubStructureItem[] }
  | { status: "ready"; items: EpubStructureItem[] };

const NONE: EpubStructure = { status: "none", items: [] };
const LOADING: EpubStructure = { status: "loading", items: [] };

/**
 * Reads the book's structure once per source (only for an EPUB that has a
 * formatted view). A book whose structure cannot be read, or has no text,
 * simply has no Original view: Reading is unaffected.
 */
export function useEpubStructure(source: Source | null | undefined): EpubStructure {
  const api = useApi();
  const [found, setFound] = useState<{ id: string; structure: EpubStructure } | null>(null);
  const id = source?.id;
  const kind = source?.originalView?.kind;
  const wanted = kind === "epub" || kind === "docx";
  useEffect(() => {
    if (!id || !wanted) return;
    let active = true;
    (kind === "docx" ? api.libraryDocxStructure(id) : api.libraryEpubStructure(id)).then(
      (items) => active && setFound({ id, structure: { status: "ready", items } }),
      (e) => {
        if (!active) return;
        void api.logError(`Formatted ${kind === "docx" ? "DOCX" : "EPUB"} structure could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
        setFound({ id, structure: { status: "failed", items: [] } });
      },
    );
    return () => {
      active = false;
    };
  }, [api, id, wanted, kind]);
  if (!wanted) return NONE;
  return found && found.id === id ? found.structure : LOADING;
}
