import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PaneHeader } from "@/design-system/PaneHeader";
import { Button } from "@/design-system/Button";
import { ChapterReader } from "./ChapterReader";
import { ConcordanceView } from "./ConcordanceView";
import { useLibraryNav } from "@/features/library/LibraryNav";
import { MarksView } from "./MarksView";
import { PassageNav } from "./PassageNav";
import { ScriptureHistoryBar } from "./ScriptureHistoryBar";
import { useScripture } from "./ScriptureContext";
import { SearchResultsView } from "./SearchResultsView";

/** The Scripture pane: a local passage reader over installed translations. */
export function ScripturePane({ onAddBible }: { onAddBible: () => void }) {
  const { openSource } = useLibraryNav();
  const { t } = useTranslation();
  const { translations, translation, setTranslation, search, goTo, navigationId, concordanceRequest } = useScripture();
  // Bible is the default; Marks is a second view of the same pane. The Bible
  // stays mounted underneath, so coming back finds the reading place, the open
  // verse tools and the scroll position as they were.
  const [view, setView] = useState<"bible" | "marks" | "concordance">("bible");
  const scroller = useRef<HTMLDivElement>(null);
  const bibleScroll = useRef(0);
  // Going to a passage by any route (a search result, a chapter button, a mark)
  // shows the Bible: nobody navigates to a verse to look at a list.
  const [seenNavigation, setSeenNavigation] = useState(navigationId);
  if (seenNavigation !== navigationId) {
    setSeenNavigation(navigationId);
    if (view !== "bible") setView("bible");
  }
  // A word study asked for its occurrences: show the concordance.
  const [seenConcordance, setSeenConcordance] = useState(concordanceRequest?.nonce ?? 0);
  if (concordanceRequest && concordanceRequest.nonce !== seenConcordance) {
    setSeenConcordance(concordanceRequest.nonce);
    if (view !== "concordance") setView("concordance");
  }
  const choose = (next: "bible" | "marks" | "concordance") => {
    if (next === view) return;
    if (view === "bible") bibleScroll.current = scroller.current?.scrollTop ?? 0;
    setView(next);
  };
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = view === "bible" ? bibleScroll.current : 0;
  }, [view]);

  return (
    <>
      <PaneHeader id="pane-scripture-title" title={t("app.panes.name.scripture")}>
        {translations.length > 0 && translation && (
          <label className="flex items-center gap-2">
            <span className="sr-only">{t("scripture.translation")}</span>
            <select
              value={translation.id}
              onChange={(e) => setTranslation(e.target.value)}
              className="h-9 max-w-40 rounded-aw border border-border bg-bg px-2 text-[0.9375rem]"
            >
              {translations.map((bible) => (
                <option key={bible.id} value={bible.id}>{bible.shortName}</option>
              ))}
            </select>
          </label>
        )}
      </PaneHeader>
      <div ref={scroller} data-scroll-root className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 px-5 py-5">
          {!translation ? (
            <div className="flex flex-col gap-4">
              <p className="reading m-0 text-text-strong">{t("scripture.empty.title")}</p>
              <p className="m-0 text-[0.9375rem] text-text-muted">
                {t("scripture.empty.body")}
              </p>
              <Button variant="primary" onClick={onAddBible}>
                {t("scripture.empty.addBible")}
              </Button>
            </div>
          ) : search ? (
            <SearchResultsView />
          ) : (
            <>
              <div role="group" aria-label={t("scripture.marks.viewLabel")} className="flex self-start rounded-aw border border-border p-0.5">
                {(["bible", "marks", "concordance"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => choose(v)}
                    className="min-h-9 rounded-[4px] px-3 font-ui text-[0.9375rem] text-text-strong hover:bg-bg-secondary aria-pressed:bg-primary aria-pressed:text-on-primary"
                  >
                    {t(`scripture.marks.${v}`)}
                  </button>
                ))}
              </div>
              <div hidden={view !== "bible"} className={view === "bible" ? "flex flex-col gap-5" : "hidden"}>
                <ScriptureHistoryBar />
                <PassageNav />
                <div className="border-t border-border-subtle pt-5">
                  <ChapterReader translation={translation} />
                </div>
              </div>
              {/* Kept while elsewhere, so the occurrences found are still there on coming back. */}
              <div hidden={view !== "concordance"} className={view === "concordance" ? "" : "hidden"}>
                <ConcordanceView />
              </div>
              {view === "marks" && (
                <MarksView
                  translation={translation}
                  onOpen={(mark) => {
                    // The passage first, then the Bible: the reader scrolls to it on arriving.
                    goTo(mark.reference);
                    setView("bible");
                  }}
                  onOpenSource={(mark) => {
                    // At its words or place; a mark on a page of an Original PDF opens that page there.
                    if (mark.start) openSource(mark.sourceId, mark.start.segmentId);
                    else if (mark.pageNumber !== null && mark.fraction !== null) openSource(mark.sourceId, undefined, { mode: "original", page: mark.pageNumber });
                    else openSource(mark.sourceId);
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
