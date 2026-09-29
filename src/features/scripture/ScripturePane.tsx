import { PaneHeader } from "@/design-system/PaneHeader";
import { Button } from "@/design-system/Button";
import { ChapterReader } from "./ChapterReader";
import { PassageNav } from "./PassageNav";
import { useScripture } from "./ScriptureContext";
import { SearchResultsView } from "./SearchResultsView";

/** The Scripture pane: a local passage reader over installed translations. */
export function ScripturePane({ onAddBible }: { onAddBible: () => void }) {
  const { translations, translation, setTranslation, search } = useScripture();

  return (
    <>
      <PaneHeader id="pane-scripture-title" title="Scripture">
        {translations.length > 0 && translation && (
          <label className="flex items-center gap-2">
            <span className="sr-only">Translation</span>
            <select
              value={translation.id}
              onChange={(e) => setTranslation(e.target.value)}
              className="h-9 max-w-40 rounded-aw border border-border bg-bg px-2 text-[0.9375rem]"
            >
              {translations.map((t) => (
                <option key={t.id} value={t.id}>{t.shortName}</option>
              ))}
            </select>
          </label>
        )}
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 px-5 py-5">
          {!translation ? (
            <div className="flex flex-col gap-4">
              <p className="reading m-0 text-text-strong">No Bible has been added yet.</p>
              <p className="m-0 text-[0.9375rem] text-text-muted">
                Add the World English Bible that comes with Abiding Word, or a Bible file you own.
                Everything stays on this computer and works offline.
              </p>
              <Button variant="primary" onClick={onAddBible}>
                Add a Bible…
              </Button>
            </div>
          ) : search ? (
            <SearchResultsView />
          ) : (
            <>
              <PassageNav />
              <div className="border-t border-border-subtle pt-5">
                <ChapterReader translation={translation} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
