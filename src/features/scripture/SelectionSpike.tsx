import { useEffect, useRef, useState, type RefObject } from "react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { anchorFromSelection, type SelectionAnchor } from "@/lib/selectionAnchor";

/**
 * Phase 2 spike (docs/scripture-annotations-v0.5.md): shows how the current
 * text selection becomes a phrase anchor and whether the core rebuilds the
 * same words from the stored text. Saves nothing. Shown only when the app
 * is started with VITE_SELECTION_SPIKE=1; replaced by the selection toolbar.
 */
export const SELECTION_SPIKE = import.meta.env.VITE_SELECTION_SPIKE === "1";

type Verdict = { state: "checking" } | { state: "ok"; quote: string } | { state: "refused"; message: string };

export function SelectionSpike({ root, translationId }: { root: RefObject<HTMLElement | null>; translationId: string }) {
  const api = useApi();
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const [raw, setRaw] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const latest = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (next: SelectionAnchor) => {
      const ticket = ++latest.current;
      setVerdict({ state: "checking" });
      api
        .annotationAnchorCheck({ translationId, start: next.start, end: next.end, quote: next.quote })
        .then((checked) => ticket === latest.current && setVerdict({ state: "ok", quote: checked.quote }))
        .catch((e) => ticket === latest.current && setVerdict({ state: "refused", message: toApiError(e).message }));
    };
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const element = root.current;
        const selection = document.getSelection();
        if (!element || !selection || selection.isCollapsed) return;
        const next = anchorFromSelection(selection, element);
        if (!next) return;
        setRaw(selection.toString());
        setAnchor(next);
        check(next);
      }, 200);
    };
    document.addEventListener("selectionchange", read);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", read);
    };
  }, [api, root, translationId]);

  const units = anchor ? anchor.quote.length : 0;
  const codePoints = anchor ? [...anchor.quote].length : 0;

  return (
    <section
      aria-label="Selection check"
      className="mt-2 flex flex-col gap-2 rounded-aw border border-dashed border-border p-3 font-ui text-[0.875rem]"
    >
      <p className="m-0 font-semibold text-text-strong">Selection check (development; nothing is saved)</p>
      {!anchor ? (
        <p className="m-0 text-text-muted">Select some Scripture text above.</p>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-text-muted">Verses</dt>
            <dd className="m-0" data-testid="spike-parts">
              {anchor.parts.map((p) => `${p.verse} [${p.start}–${p.end})`).join(" · ")}
            </dd>
            <dt className="text-text-muted">Anchor</dt>
            <dd className="m-0">
              {anchor.start.verse}:{anchor.start.offset} → {anchor.end.verse}:{anchor.end.offset}
            </dd>
            <dt className="text-text-muted">Rebuilt</dt>
            <dd className="reading m-0 break-words" data-testid="spike-quote">⟦{anchor.quote}⟧</dd>
            <dt className="text-text-muted">Length</dt>
            <dd className="m-0">
              {units} UTF-16 units, {codePoints} characters
            </dd>
            <dt className="text-text-muted">Browser</dt>
            <dd className="m-0 break-words font-mono text-[0.8125rem]">{JSON.stringify(raw)}</dd>
            <dt className="text-text-muted">Core</dt>
            <dd className="m-0" data-testid="spike-verdict">
              {verdict?.state === "checking" && "checking…"}
              {verdict?.state === "ok" &&
                (verdict.quote === anchor.quote ? "✓ rebuilt the same words from the stored text" : "✗ rebuilt different words")}
              {verdict?.state === "refused" && <span className="text-danger">✗ {verdict.message}</span>}
            </dd>
          </dl>
          <div>
            <button
              type="button"
              onClick={() => {
                document.getSelection()?.removeAllRanges();
                setAnchor(null);
                setVerdict(null);
                setRaw("");
              }}
              className="min-h-9 rounded-aw border border-border px-3 hover:bg-bg-secondary"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </section>
  );
}
