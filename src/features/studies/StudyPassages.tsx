import { useCallback, useId, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";

/**
 * The passages a study is about. Optional: topical and doctrinal studies may
 * have none. Clicking a passage opens it in the Scripture pane.
 */
export function StudyPassages({ studyId, onReveal }: { studyId: string; onReveal: () => void }) {
  const api = useApi();
  const { goTo } = useScripture();
  const passages = useLoad(useCallback(() => api.studyPassageList(studyId), [api, studyId]));
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const ref = await api.referenceParse(text);
      await api.studyPassageAdd({ studyId, reference: ref.canonical });
      setText("");
      setAdding(false);
      passages.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const remove = async (passageId: string) => {
    setError(null);
    try {
      await api.studyPassageRemove(passageId);
      passages.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const list = passages.data ?? [];
  return (
    <section aria-label="Passages" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((passage, index) => (
          <span key={passage.id} className="inline-flex items-center rounded-aw border border-border">
            <button
              type="button"
              onClick={() => {
                goTo(passage.reference);
                onReveal();
              }}
              title="Open in the Scripture pane"
              className="inline-flex min-h-9 items-center gap-1.5 px-3 text-[0.9375rem] font-medium text-link hover:bg-bg-secondary"
            >
              {passage.reference.display}
              {index === 0 && list.length > 1 && <span className="sr-only"> (primary passage)</span>}
            </button>
            <button
              type="button"
              onClick={() => remove(passage.id)}
              aria-label={`Remove ${passage.reference.display} from this study`}
              className="inline-flex size-9 items-center justify-center border-l border-border text-text-muted hover:bg-bg-secondary"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </span>
        ))}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-9 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong"
          >
            <Plus className="size-4" aria-hidden="true" />
            {list.length === 0 ? "Add the passage this study is about" : "Add passage"}
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2" noValidate>
          <label htmlFor={`${id}-passage`} className="sr-only">Passage to add</label>
          <input
            id={`${id}-passage`}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="e.g. John 15:1-11"
            className="h-9 min-w-0 flex-1 basis-48 rounded-aw border border-border bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted"
          />
          <button type="submit" className="h-9 rounded-aw bg-primary px-3 text-[0.9375rem] font-medium text-on-primary hover:bg-primary-hover">
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="h-9 rounded-aw border border-border px-3 text-[0.9375rem]">
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="m-0 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
