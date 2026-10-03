import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PaneHeader } from "@/design-system/PaneHeader";
import { Button } from "@/design-system/Button";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useLoad } from "@/hooks/useLoad";
import { referenceLabel } from "@/i18n/scripture";
import { useApi } from "@/lib/ApiContext";
import { locatorLabel } from "./labels";
import { useLibraryNav } from "./LibraryNav";
import { SourceReader, type ReaderMode } from "./SourceReader";

/** A source open inside the Sources pane (kept by the shell, so it survives leaving the workspace). */
export interface PaneSource {
  sourceId: string;
  segmentId?: string;
  /** Changes on every open, so opening the same place again re-targets it. */
  key: number;
  /** What had focus when the source was opened; focus returns there on Back. */
  opener: HTMLElement | null;
}

interface SourcesPaneProps {
  reading?: PaneSource | null;
  onCloseReader?: () => void;
  onExpandReader?: (mode?: ReaderMode) => void;
}

/**
 * Sources pane: the personal library beside the study. Shows which sources
 * mention the passage being read (found by the reference detector at
 * import), recent sources, and the way into the full Library. A source
 * opened from the workspace is read here, beside Scripture and the Study.
 */
export function SourcesPane({ reading, onCloseReader, onExpandReader }: SourcesPaneProps = {}) {
  const { t } = useTranslation();
  const api = useApi();
  const { openLibrary, openSource, addSource } = useLibraryNav();
  const { currentPassage, location, books } = useScripture();
  // The selected verse or passage; otherwise the chapter on screen.
  const reference = currentPassage?.canonical ?? `${location.book}.${location.chapter}`;
  const chapterCount = books.find((b) => b.code === (currentPassage?.book ?? location.book))?.chapterCount;
  const label = referenceLabel(
    currentPassage ?? {
      canonical: reference,
      display: "",
      book: location.book,
      startChapter: location.chapter,
      startVerse: null,
      endChapter: location.chapter,
      endVerse: null,
    },
    chapterCount,
  );
  const mentions = useLoad(useCallback(() => api.librarySourcesForPassage(reference), [api, reference]));
  const recent = useLoad(useCallback(() => api.libraryList({}), [api]));
  const empty = recent.data?.length === 0;

  // Back from the reader: focus returns to what opened it (a citation in the
  // study, say) or, if that is gone, to the first heading of the overview.
  const overview = useRef<HTMLDivElement>(null);
  const returning = useRef<{ opener: HTMLElement | null } | null>(null);
  useEffect(() => {
    if (!returning.current || reading) return;
    const { opener } = returning.current;
    returning.current = null;
    if (opener?.isConnected) opener.focus();
    else overview.current?.querySelector<HTMLElement>("h3")?.focus();
  }, [reading]);

  if (reading) {
    return (
      <>
        <PaneHeader id="pane-sources-title" title={t("app.panes.name.sources")} />
        <SourceReader
          key={reading.key}
          variant="pane"
          sourceId={reading.sourceId}
          segmentId={reading.segmentId}
          onClose={() => {
            returning.current = { opener: reading.opener };
            onCloseReader?.();
          }}
          onExpand={onExpandReader}
        />
      </>
    );
  }

  return (
    <>
      <PaneHeader id="pane-sources-title" title={t("app.panes.name.sources")} />
      <div ref={overview} className="flex min-h-0 flex-col gap-6 overflow-y-auto px-5 py-5">
        {/* Nothing until the library has loaded, so the pane never flickers
            from one layout to the other. */}
        {recent.error && <p className="m-0 text-[0.9375rem] text-danger">{recent.error.message}</p>}
        {recent.data === undefined ? null : empty ? (
          <section aria-labelledby="library-heading" className="flex flex-col items-start gap-3">
            <h3 id="library-heading" tabIndex={-1} className="m-0 text-[1.0625rem] font-semibold text-text-strong">{t("library.pane.libraryHeading")}</h3>
            <p className="m-0 text-[0.9375rem] text-text-muted">{t("library.pane.empty")}</p>
            <Button onClick={addSource}>{t("library.addToLibraryEllipsis")}</Button>
          </section>
        ) : (
          <>
            <section aria-labelledby="mentions-heading" className="flex flex-col gap-2">
              <h3 id="mentions-heading" tabIndex={-1} className="m-0 text-[1.0625rem] font-semibold text-text-strong">
                {t("library.pane.mentioning", { passage: label })}
              </h3>
              {mentions.error && <p className="m-0 text-[0.9375rem] text-danger">{mentions.error.message}</p>}
              {mentions.data?.length === 0 && (
                <p className="m-0 text-[0.9375rem] text-text-muted">{t("library.pane.noMentions")}</p>
              )}
              {mentions.data && mentions.data.length > 0 && (
                <ul aria-label={t("library.pane.mentioning", { passage: label })} className="m-0 flex list-none flex-col p-0">
                  {mentions.data.map((m) => (
                    <li key={`${m.segmentId}-${m.matchedText}`} className="border-t border-border-subtle">
                      <button type="button" onClick={() => openSource(m.sourceId, m.segmentId)} className="flex w-full flex-col items-start gap-0.5 py-2 text-left hover:bg-bg-secondary">
                        <span className="font-semibold text-text-strong"><cite className="not-italic">{m.sourceTitle}</cite></span>
                        <span className="text-[0.875rem] text-text-muted">
                          {[m.author, locatorLabel(t, m.locator), t("library.quoted", { text: m.matchedText })].filter(Boolean).join(t("common.listSeparator"))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
              <h3 id="recent-heading" className="m-0 text-[1.0625rem] font-semibold text-text-strong">{t("library.pane.recent")}</h3>
              <ul className="m-0 flex list-none flex-col p-0">
                {(recent.data ?? []).slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => openSource(s.id)} className="w-full py-1 text-left text-[0.9375rem] text-text-strong hover:underline">
                      {s.title}{s.author ? <span className="text-text-muted">{t("common.listSeparator")}{s.author}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
              <Button onClick={() => openLibrary()}>{t("library.pane.openLibrary")}</Button>
              <Button variant="quiet" onClick={addSource}>{t("library.addToLibraryEllipsis")}</Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
