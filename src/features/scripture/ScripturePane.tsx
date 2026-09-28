import { PaneHeader } from "@/design-system/PaneHeader";

/**
 * Scripture pane. Foundation v0.1 shows the navigation shape only; the
 * Scripture engine (licensed texts in resources/scripture, passage lookup,
 * parallel versions) arrives in the next phase. No Scripture text is faked.
 */
export function ScripturePane() {
  return (
    <>
      <PaneHeader id="pane-scripture-title" title="Scripture" />
      <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5">
        <form className="flex flex-col gap-2" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="scripture-passage" className="text-[0.9375rem] font-medium text-text-strong">
            Passage
          </label>
          <div className="flex gap-2">
            <input
              id="scripture-passage"
              disabled
              placeholder="e.g. Romans 8:1–17"
              className="h-10 min-w-0 flex-1 rounded-aw border border-border bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled
              className="h-10 rounded-aw border border-border px-3 text-[0.9375rem] text-text-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              Open
            </button>
          </div>
        </form>

        <div className="border-t border-border-subtle pt-5">
          <p className="reading m-0 text-text-strong">The Scripture engine will be added in the next phase.</p>
          <p className="mt-3 text-[0.9375rem] text-text-muted">
            You will be able to open any passage here and read it beside your study, fully offline.
          </p>
        </div>
      </div>
    </>
  );
}
