import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/ApiContext";
import type { HighlightColor } from "@/types/scripture";
import type { SourceAnnotation } from "@/types/library";

/** One annotation's words inside one paragraph (UTF-16 offsets into its stored text). */
export interface MarkedRange {
  id: string;
  start: number;
  /** End, exclusive; `null` means the paragraph's end. */
  end: number | null;
  color: HighlightColor | null;
  note: boolean;
}

export interface SourceMarks {
  /** Every live annotation of the source, in reading order (unresolved last). */
  all: SourceAnnotation[];
  /** The words marked in each paragraph, by reading position. */
  ranges: Map<number, MarkedRange[]>;
  /** The annotations that belong to each paragraph (where their words or place begin). */
  byParagraph: Map<number, SourceAnnotation[]>;
  /** Reads them again (after a change); gives the new list (empty if the read failed). */
  reload: () => Promise<SourceAnnotation[]>;
  /** Whether this source's marks have been read. */
  loaded: boolean;
}

const EMPTY: SourceAnnotation[] = [];

/**
 * A source's highlights, notes and bookmarks, read once per source and again
 * after a change. A read that fails leaves the text readable without marks
 * (and is logged).
 */
export function useSourceAnnotations(sourceId: string | undefined): SourceMarks {
  const api = useApi();
  const [found, setFound] = useState<{ id: string; all: SourceAnnotation[] } | null>(null);

  const read = useCallback(async (): Promise<SourceAnnotation[]> => {
    if (!sourceId) return [];
    try {
      const all = await api.sourceAnnotationList(sourceId);
      setFound({ id: sourceId, all });
      return all;
    } catch (e) {
      void api.logError(`Marks in the source could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return [];
    }
  }, [api, sourceId]);

  useEffect(() => {
    let active = true;
    if (!sourceId) return;
    api.sourceAnnotationList(sourceId).then(
      (all) => active && setFound({ id: sourceId, all }),
      (e) => void api.logError(`Marks in the source could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
    );
    return () => {
      active = false;
    };
  }, [api, sourceId]);

  const all = found && found.id === sourceId ? found.all : EMPTY;
  const { ranges, byParagraph } = useMemo(() => {
    const ranges = new Map<number, MarkedRange[]>();
    const byParagraph = new Map<number, SourceAnnotation[]>();
    for (const mark of all) {
      if (mark.state === "unresolved" || !mark.start) continue;
      const list = byParagraph.get(mark.start.position) ?? [];
      list.push(mark);
      byParagraph.set(mark.start.position, list);
      const { start, end } = mark;
      if (mark.quote === null || !end || start.offset === null || end.offset === null) continue;
      if (mark.kind === "bookmark") continue;
      for (let position = start.position; position <= end.position; position++) {
        const range: MarkedRange = {
          id: mark.id,
          start: position === start.position ? start.offset : 0,
          end: position === end.position ? end.offset : null,
          color: mark.kind === "highlight" ? mark.color : null,
          note: mark.kind === "note",
        };
        ranges.set(position, [...(ranges.get(position) ?? []), range]);
      }
    }
    return { ranges, byParagraph };
  }, [all]);

  return { all, ranges, byParagraph, reload: read, loaded: found?.id === sourceId };
}
