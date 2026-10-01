import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import { highlighted } from "@/lib/highlight";

interface Props {
  query: string;
  onOpen: (study: { id: string; projectId: string }) => void;
  onClose: () => void;
}

/** Results of a search across the user's studies (not Scripture). */
export function StudySearchResults({ query, onOpen, onClose }: Props) {
  const api = useApi();
  const hits = useLoad(useCallback(() => api.studySearch(query), [api, query]));
  return (
    <section aria-labelledby="study-search-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="study-search-title" className="m-0 font-display text-[1.875rem] font-heading text-text-strong">
          Studies matching “{query}”
        </h1>
        <button type="button" onClick={onClose} className="inline-flex min-h-9 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-strong hover:bg-bg-secondary">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </button>
      </div>
      {hits.error && <Notice tone="error">{hits.error.message}</Notice>}
      {hits.loading && <p role="status" className="m-0 text-text-muted">Searching your studies…</p>}
      {hits.data && (
        <>
          <p role="status" className="m-0 text-[0.9375rem] text-text-muted">
            {hits.data.length === 0 ? "Nothing found in your studies." : `${hits.data.length} match${hits.data.length === 1 ? "" : "es"}.`}
          </p>
          <ol aria-label="Study search results" className="m-0 flex list-none flex-col p-0">
            {hits.data.map((hit, index) => (
              <li key={`${hit.studyId}-${index}`} className="border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => onOpen({ id: hit.studyId, projectId: hit.projectId })}
                  className="flex w-full flex-col items-start gap-1 px-1 py-3 text-left hover:bg-bg-secondary"
                >
                  <span className="font-display text-[1.125rem] font-heading text-text-strong">{hit.studyTitle}</span>
                  <span className="text-[0.875rem] text-text-muted">{hit.location}</span>
                  <span className="reading text-[1rem]">{highlighted(hit.snippet)}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
