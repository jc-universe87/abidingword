import { PaneHeader } from "@/design-system/PaneHeader";

/**
 * Sources pane: the personal library. Foundation v0.1 shows its empty
 * state only; importing commentaries, books and notes arrives later.
 */
export function SourcesPane() {
  return (
    <>
      <PaneHeader id="pane-sources-title" title="Sources" />
      <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5">
        <section aria-labelledby="library-heading">
          <h3 id="library-heading" className="m-0 text-[1.0625rem] font-semibold text-text-strong">
            Your library
          </h3>
          <p className="mt-2 text-[0.9375rem] text-text-muted">No sources yet.</p>
        </section>

        <div className="border-t border-border-subtle pt-5">
          <p className="reading m-0 text-text-strong">Personal source import will arrive in a later phase.</p>
          <p className="mt-3 text-[0.9375rem] text-text-muted">
            Commentaries, books, articles and your own notes will live here, stored on this computer.
          </p>
          <button
            type="button"
            disabled
            className="mt-4 h-10 rounded-aw border border-border px-4 text-[0.9375rem] text-text-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            Import source…
          </button>
        </div>
      </div>
    </>
  );
}
