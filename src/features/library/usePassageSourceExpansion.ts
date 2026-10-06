import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/ApiContext";
import type { PassageLocation } from "@/types/library";

export interface ExpansionState {
  open: boolean;
  status: "loading" | "ready" | "error";
  /** Every place the source has for the passage (the first few are the group's own). */
  places?: PassageLocation[];
}

/**
 * Which sources have their further places shown, for the passage being read.
 * The places load once per source and passage and are kept while the passage
 * stays the same (collapsing and expanding again does not ask again, nor does
 * returning from the reader). A different passage starts again from nothing.
 */
export function usePassageSourceExpansion(reference: string) {
  const api = useApi();
  const [state, setState] = useState<{ reference: string; bySource: Record<string, ExpansionState> }>({
    reference,
    bySource: {},
  });
  // A different passage discards what was expanded for the last one.
  if (state.reference !== reference) setState({ reference, bySource: {} });
  const current = useRef(reference);
  useEffect(() => {
    current.current = reference;
  }, [reference]);
  const expansion = useMemo(
    () => (state.reference === reference ? state.bySource : {}),
    [state, reference],
  );

  const put = useCallback((forReference: string, sourceId: string, next: ExpansionState) => {
    // A result for a passage no longer being read is dropped.
    if (current.current !== forReference) return;
    setState((prev) => ({
      reference: forReference,
      bySource: { ...(prev.reference === forReference ? prev.bySource : {}), [sourceId]: next },
    }));
  }, []);

  const toggle = useCallback(
    (sourceId: string) => {
      const existing = expansion[sourceId];
      if (existing?.open) {
        put(reference, sourceId, { ...existing, open: false });
        return;
      }
      if (existing?.places) {
        put(reference, sourceId, { ...existing, open: true });
        return;
      }
      put(reference, sourceId, { open: true, status: "loading" });
      api.libraryPassageSourceLocations(sourceId, reference).then(
        (places) => put(reference, sourceId, { open: true, status: "ready", places }),
        () => put(reference, sourceId, { open: false, status: "error" }),
      );
    },
    [api, expansion, put, reference],
  );

  return { expansion, toggle };
}
