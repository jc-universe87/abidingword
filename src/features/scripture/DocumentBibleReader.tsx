import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Search, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { PdfViewer } from "@/features/library/PdfViewer";
import { EpubViewer } from "@/features/library/formatted/EpubViewer";
import { placeOfPosition, type EpubPlace } from "@/features/library/formatted/epubLocation";
import { useLoad } from "@/hooks/useLoad";
import { formatNumber } from "@/i18n/format";
import { toApiError } from "@/lib/api";
import { ApiProvider, useApi } from "@/lib/ApiContext";
import type { PdfPlace } from "@/lib/pdfEngine";
import { readLocal, writeLocal } from "@/lib/storage";
import type { EpubStructureItem } from "@/types/library";
import type { BibleDocument, BibleTranslation, DocumentHit, DocumentSegment } from "@/types/scripture";
import { documentApi } from "./documentApi";
import { useScripture } from "./ScriptureContext";

/** Where a person was in a document, remembered on this device only. */
interface Progress {
  page?: number;
  position?: number;
}

const progressKey = (documentId: string) => `bibleDocument.${documentId}`;

/**
 * A Bible kept as a document (v0.23), read in the Scripture pane: its PDF
 * pages or its EPUB/Word formatting in the library's own viewers, or its
 * text, with search where there is text. It has no verses: passages opened
 * from studies go on showing in the Bible read by passage, and this view
 * closes for them. Nothing here changes the Bible read by passage, the
 * passage or its history.
 */
export function DocumentBibleReader({ bible, onFindVerses }: { bible: BibleTranslation; onFindVerses: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const { translation, openDocumentBible } = useScripture();
  const documents = useLoad(useCallback(() => api.bibleDocuments(bible.id), [api, bible.id]));
  const [chosen, setChosen] = useState(0);
  const list = documents.data ?? [];
  const document = list[Math.min(chosen, Math.max(0, list.length - 1))] ?? null;
  const hasText = list.some((d) => d.segmentCount > 0);
  const scanned = document?.extractionStatus === "ocr_required";
  const [view, setView] = useState<"original" | "text">("original");
  const shown: "original" | "text" = !document?.view ? "text" : scanned ? "original" : view;
  const [jump, setJump] = useState<{ document: string; position: number; page: number | null; nonce: number } | null>(null);
  const selectId = useId();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border-subtle px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="type-item m-0">{bible.name}</h2>
            <p className="m-0 type-meta">{t("scripture.document.kind")}</p>
          </div>
          {translation && (
            <Button variant="quiet" onClick={() => openDocumentBible(null)}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("scripture.document.back", { name: translation.shortName })}
            </Button>
          )}
        </div>
        <details className="text-[0.9375rem]">
          <summary className="cursor-pointer text-text-muted">{t("scripture.document.whatSummary")}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="m-0">{t("scripture.document.what")}</p>
            {hasText ? (
              <div className="flex flex-col items-start gap-1">
                <p className="m-0 text-text-muted">{t("scripture.document.findVersesHint")}</p>
                <Button onClick={onFindVerses}>{t("scripture.document.findVerses")}</Button>
              </div>
            ) : (
              <p className="m-0 text-text-muted">{t("scripture.document.noTextAtAll")}</p>
            )}
          </div>
        </details>
        {list.length > 1 && (
          <label htmlFor={selectId} className="flex flex-col gap-1 text-[0.9375rem]">
            <span className="font-medium">{t("scripture.document.part")}</span>
            <select id={selectId} value={chosen} onChange={(e) => setChosen(Number(e.target.value))} className="h-9 aw-input px-2">
              {list.map((d, i) => (
                <option key={d.id} value={i}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {hasText && (
          <DocumentSearch
            bible={bible}
            documents={list}
            onOpen={(hit) => {
              const index = list.findIndex((d) => d.id === hit.documentId);
              if (index >= 0) setChosen(index);
              setJump({ document: hit.documentId, position: hit.position, page: hit.pageNumber, nonce: Date.now() });
            }}
          />
        )}
        {document?.view && !scanned && document.segmentCount > 0 && (
          <div role="group" aria-label={t("scripture.document.viewLabel")} className="-ml-2 flex flex-wrap">
            {(["original", "text"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={shown === v} onClick={() => setView(v)} className="aw-tab">
                {t(`scripture.document.view.${v}`)}
              </button>
            ))}
          </div>
        )}
        {scanned && <Notice>{t("scripture.document.scanned")}</Notice>}
        {documents.error && <Notice tone="error">{documents.error.message}</Notice>}
      </div>
      {document &&
        (shown === "text" ? (
          <DocumentText key={document.id} document={document} jump={jump && jump.document === document.id ? jump : null} />
        ) : (
          <DocumentOriginal key={document.id} document={document} jump={jump && jump.document === document.id ? jump : null} />
        ))}
    </div>
  );
}

/** Search in the document's text; results open at their page or paragraph. */
function DocumentSearch({ bible, documents, onOpen }: { bible: BibleTranslation; documents: BibleDocument[]; onOpen: (hit: DocumentHit) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DocumentHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setHits(await api.bibleDocumentSearch(bible.id, query));
    } catch (e) {
      setError(toApiError(e).message);
      setHits(null);
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (documentId: string) => documents.find((d) => d.id === documentId)?.name ?? "";
  return (
    <div className="flex flex-col gap-2">
      <form
        role="search"
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t("scripture.document.searchLabel")}
        </label>
        <input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("scripture.document.searchPlaceholder")}
          className="h-9 min-w-0 flex-1 aw-input px-2 text-[0.9375rem]"
        />
        <Button type="submit" disabled={busy || !query.trim()}>
          <Search className="size-4" aria-hidden="true" />
          {t("scripture.document.search")}
        </Button>
      </form>
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
      {hits && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p role="status" className="m-0 type-meta">
              {t("scripture.document.found", { count: hits.length, formatted: formatNumber(hits.length) })}
            </p>
            <Button variant="quiet" onClick={() => setHits(null)} aria-label={t("scripture.document.closeResults")}>
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <ul className="m-0 flex max-h-56 list-none flex-col overflow-y-auto border-y border-border-subtle p-0">
            {hits.map((hit) => (
              <li key={`${hit.documentId}-${hit.position}`}>
                <button type="button" onClick={() => onOpen(hit)} className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-hover">
                  <span className="type-meta">
                    {[documents.length > 1 ? nameOf(hit.documentId) : null, hit.pageNumber !== null ? t("scripture.document.page", { page: formatNumber(hit.pageNumber) }) : hit.sectionPath].filter(Boolean).join(t("common.listSeparator"))}
                  </span>
                  <span className="line-clamp-2 text-[0.9375rem]">{hit.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The document's original: PDF pages or EPUB/Word formatting, in the library's viewers. */
function DocumentOriginal({ document, jump }: { document: BibleDocument; jump: { position: number; page: number | null; nonce: number } | null }) {
  const api = useApi();
  const reading = useMemo(() => documentApi(api), [api]);
  return <ApiProvider api={reading}>{document.view === "pdf" ? <PdfOriginal document={document} jump={jump} /> : <FormattedOriginal document={document} jump={jump} />}</ApiProvider>;
}

function PdfOriginal({ document, jump }: { document: BibleDocument; jump: { page: number | null; nonce: number } | null }) {
  const [start] = useState(() => readLocal<Progress>(progressKey(document.id), {}).page ?? 1);
  const now = useRef<(() => PdfPlace) | null>(null);
  const [link, setLink] = useState<{ page: number; nonce: number; fraction?: number } | null>(null);
  const target = jump?.page ? { page: jump.page, nonce: jump.nonce } : link;
  return (
    <PdfViewer
      sourceId={document.id}
      initialPage={start}
      onPageChange={(page) => writeLocal(progressKey(document.id), { page })}
      jumpTo={target}
      onLink={(place) => setLink({ page: place.page, fraction: place.fraction, nonce: Date.now() })}
      locationRef={now}
    />
  );
}

function FormattedOriginal({ document, jump }: { document: BibleDocument; jump: { position: number; nonce: number } | null }) {
  const { t } = useTranslation();
  const api = useApi();
  const kind = document.view === "docx" ? "docx" : "epub";
  const structure = useLoad(useCallback(() => (kind === "docx" ? api.libraryDocxStructure(document.id) : api.libraryEpubStructure(document.id)), [api, document.id, kind]));
  const now = useRef<(() => EpubPlace) | null>(null);
  const [link, setLink] = useState<(EpubPlace & { nonce: number }) | null>(null);
  const items: EpubStructureItem[] = structure.data ?? [];
  const [start] = useState(() => readLocal<Progress>(progressKey(document.id), {}).position ?? 0);
  // Where the reader is, remembered on leaving (this device only).
  useEffect(
    () => () => {
      const place = now.current?.();
      if (!place || !structure.data) return;
      const at = structure.data.findIndex((i) => i.id === place.item);
      if (at >= 0) writeLocal(progressKey(document.id), { position: structure.data[at]!.startSegment });
    },
    [document.id, structure.data],
  );
  if (structure.error) return <p className="m-5 text-danger">{t("scripture.document.unreadable")}</p>;
  if (!structure.data) return <p role="status" className="m-5 text-text-muted">{t("common.loading")}</p>;
  if (items.length === 0) return <p className="m-5 text-text-muted">{t("scripture.document.unreadable")}</p>;
  const place = (position: number): EpubPlace => placeOfPosition(items, position) ?? { item: items[0]!.id, fragment: null, offset: 0 };
  const target = jump ? { ...place(jump.position), nonce: jump.nonce } : link;
  return (
    <EpubViewer
      sourceId={document.id}
      kind={kind}
      structure={items}
      start={place(start)}
      jumpTo={target}
      onLink={(to) => setLink({ item: to.item, fragment: to.id, offset: 0, nonce: Date.now() })}
      locationRef={now}
    />
  );
}

const TEXT_PAGE = 200;

/** The document's text, paragraph by paragraph, with its pages or sections. */
function DocumentText({ document, jump }: { document: BibleDocument; jump: { position: number; nonce: number } | null }) {
  const { t } = useTranslation();
  const api = useApi();
  const [offset, setOffset] = useState(() => {
    const saved = readLocal<Progress>(progressKey(document.id), {}).position ?? 0;
    return Math.max(0, saved - (saved % TEXT_PAGE));
  });
  const [segments, setSegments] = useState<DocumentSegment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [seenJump, setSeenJump] = useState(0);
  if (jump && jump.nonce !== seenJump) {
    setSeenJump(jump.nonce);
    setOffset(Math.max(0, jump.position - (jump.position % TEXT_PAGE)));
    setTarget(jump.position);
  }
  useEffect(() => {
    let active = true;
    api.bibleDocumentSegments({ documentId: document.id, offset, limit: TEXT_PAGE }).then(
      (w) => active && (setSegments(w.segments), setError(null)),
      (e) => active && setError(toApiError(e).message),
    );
    writeLocal(progressKey(document.id), { position: offset });
    return () => {
      active = false;
    };
  }, [api, document.id, offset]);
  useEffect(() => {
    if (target === null || !segments) return;
    scroller.current?.querySelector(`[data-position="${target}"]`)?.scrollIntoView({ block: "center" });
  }, [target, segments]);
  if (document.segmentCount === 0) return <p className="m-5 text-text-muted">{t("scripture.document.noText")}</p>;
  const last = offset + TEXT_PAGE >= document.segmentCount;
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {error && <Notice tone="error">{error}</Notice>}
      {offset > 0 && (
        <Button variant="quiet" onClick={() => setOffset(Math.max(0, offset - TEXT_PAGE))}>
          {t("scripture.document.earlier")}
        </Button>
      )}
      <div className="flex flex-col gap-3">
        {(segments ?? []).map((s, i, all) => {
          const place = s.pageNumber !== null ? t("scripture.document.page", { page: formatNumber(s.pageNumber) }) : s.sectionPath;
          const before = all[i - 1];
          const newPlace = !before || before.pageNumber !== s.pageNumber || before.sectionPath !== s.sectionPath;
          return (
            <div key={s.position} data-position={s.position} className={target === s.position ? "-mx-2 rounded-aw bg-hover px-2" : undefined}>
              {newPlace && place && <p className="m-0 mb-1 type-meta">{place}</p>}
              <p className="reading m-0">{s.text}</p>
            </div>
          );
        })}
      </div>
      {!last && segments && (
        <Button variant="quiet" onClick={() => setOffset(offset + TEXT_PAGE)}>
          {t("scripture.document.later")}
        </Button>
      )}
    </div>
  );
}
