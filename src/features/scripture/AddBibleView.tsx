import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, Check, CircleX, ExternalLink } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Dialog } from "@/design-system/Dialog";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { formatNumber } from "@/i18n/format";
import { localizeMessage } from "@/i18n/messages";
import { bookName } from "@/i18n/scripture";
import type { BibleTranslation, BundledBibleInfo, DocumentFileInfo, DocumentPreview, ImportIssue, ImportPreview, WordChoice } from "@/types/scripture";
import { NO_CHOICE, WordResearch, hasWordResearch } from "./WordResearch";
import { useScripture } from "./ScriptureContext";
import { LanguageChoice, type LanguageValue } from "./LanguageChoice";

type Step =
  | { kind: "choose" }
  | { kind: "checking" }
  | { kind: "review"; preview: ImportPreview }
  | { kind: "done"; bible: BibleTranslation };

/**
 * Add Bible → choose → review → add. Nothing is saved until the user
 * presses "Add this Bible"; cancelling discards the checked files.
 */
export function AddBibleView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const { reloadTranslations, setTranslation } = useScripture();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [step.kind]);

  const preview = async (request: { bundled?: string; paths?: string[] }) => {
    setError(null);
    setStep({ kind: "checking" });
    try {
      setStep({ kind: "review", preview: await api.bibleImportPreview(request) });
    } catch (e) {
      setError(toApiError(e).message);
      setStep({ kind: "choose" });
    }
  };

  const chooseFiles = async () => {
    setError(null);
    try {
      const paths = await api.chooseBibleFiles();
      if (paths && paths.length > 0) await preview({ paths });
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const cancel = () => {
    if (step.kind === "review") void api.bibleImportCancel(step.preview.previewId).catch(() => undefined);
    onClose();
  };

  const title = {
    choose: t("scripture.addBible.title.choose"),
    checking: t("scripture.addBible.title.checking"),
    review: t("scripture.addBible.title.review"),
    done: t("scripture.addBible.title.done"),
  }[step.kind];

  return (
    <div
      className="h-full overflow-y-auto bg-bg"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented && step.kind !== "checking" && !(e.target as HTMLElement).closest("input, textarea, select")) {
          e.preventDefault();
          cancel();
        }
      }}
    >
      <div className="mx-auto flex max-w-[46rem] flex-col gap-8 px-8 pb-24 pt-8">
        <div className="flex flex-col items-start gap-4">
          <Button variant="quiet" onClick={cancel} disabled={step.kind === "checking"}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {step.kind === "done" ? t("common.back") : t("common.cancel")}
          </Button>
          <h1 id="add-bible-title" ref={heading} tabIndex={-1} className="type-title m-0">
            {title}
          </h1>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {step.kind === "choose" && <ChooseStep onBundled={(id) => preview({ bundled: id })} onFiles={chooseFiles} />}
        {step.kind === "checking" && (
          <p role="status" className="m-0 text-text-muted">
            {t("scripture.addBible.checking")}
          </p>
        )}
        {step.kind === "review" && (
          <ReviewStep
            preview={step.preview}
            onCancel={cancel}
            onCorrect={async (books) => {
              setError(null);
              try {
                setStep({ kind: "review", preview: await api.bibleImportCorrect(step.preview.previewId, books) });
              } catch (e) {
                setError(toApiError(e).message);
              }
            }}
            onAdd={async (details) => {
              setError(null);
              try {
                const bible = await api.bibleImportCommit({ previewId: step.preview.previewId, ...details });
                await reloadTranslations();
                setStep({ kind: "done", bible });
              } catch (e) {
                setError(toApiError(e).message);
              }
            }}
          />
        )}
        {step.kind === "done" && (
          <div className="flex flex-col items-start gap-4">
            <p className="reading m-0">
              {step.bible.kind === "document" ? (
                <Trans i18nKey="scripture.addBible.doneDocument" values={{ name: step.bible.name }} components={{ strong: <strong /> }} />
              ) : (
                <Trans
                  i18nKey="scripture.addBible.done"
                  count={step.bible.bookCount}
                  values={{ name: step.bible.name, verses: formatNumber(step.bible.verseCount) }}
                  components={{ strong: <strong /> }}
                />
              )}
            </p>
            <Button
              variant="primary"
              onClick={() => {
                setTranslation(step.bible.id);
                onClose();
              }}
            >
              {t("scripture.addBible.readNow")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChooseStep({ onBundled, onFiles }: { onBundled: (id: string) => void; onFiles: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const selectId = useId();
  const bundled = useLoad(useCallback(() => api.bibleBundledList(), [api]));
  // Grouped by language, the interface language's group first; otherwise the core's order is kept.
  const language = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0];
  const groups: { code: string; name: string; bibles: BundledBibleInfo[] }[] = [];
  for (const bible of (bundled.data ?? []).filter((b) => !b.installed)) {
    let group = groups.find((g) => g.code === bible.languageCode);
    if (!group) {
      group = { code: bible.languageCode, name: bible.language, bibles: [] };
      groups.push(group);
    }
    group.bibles.push(bible);
  }
  groups.sort((a, b) => Number(b.code === language) - Number(a.code === language));
  const available = groups.flatMap((g) => g.bibles);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = available.find((b) => b.id === chosenId) ?? available[0];
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-col gap-8">
      {chosen && (
        <section className="flex flex-col items-start gap-3 border-t border-border-subtle pt-6">
          <h2 className="type-section m-0">{t("scripture.addBible.included")}</h2>
          <label htmlFor={selectId} className="font-medium">
            {t("scripture.addBible.chooseLabel")}
          </label>
          <div className="flex w-full flex-wrap items-center gap-2">
            <select
              id={selectId}
              value={chosen.id}
              onChange={(e) => setChosenId(e.target.value)}
              className="h-10 min-w-0 flex-1 aw-input px-3"
            >
              {groups.map((group) => (
                <optgroup key={group.code} label={group.name}>
                  {group.bibles.map((bible) => (
                    <option key={bible.id} value={bible.id}>
                      {bible.name} ({bible.shortName})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button variant="primary" onClick={() => setConfirming(true)}>
              {t("scripture.addBible.addSelected")}
            </Button>
          </div>
          <p className="m-0 text-[0.9375rem] text-text-muted">{[chosen.language, chosen.licenseType].join(t("common.listSeparator"))}</p>
          {confirming && (
            <Dialog
              title={t("scripture.addBible.confirmTitle", { name: chosen.name })}
              onClose={() => setConfirming(false)}
              actions={
                <>
                  <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setConfirming(false);
                      onBundled(chosen.id);
                    }}
                  >
                    {t("scripture.addBible.confirmContinue")}
                  </Button>
                </>
              }
            >
              <p className="m-0">
                <strong>{chosen.name}</strong> ({chosen.shortName})
              </p>
              <p className="m-0">{t("scripture.addBible.confirmLanguage", { language: chosen.language })}</p>
              <p className="m-0">{t("scripture.addBible.licence", { licence: chosen.licenseType })}</p>
              <p className="m-0 text-text-muted">{t("scripture.addBible.confirmBody")}</p>
            </Dialog>
          )}
        </section>
      )}
      <section className="flex flex-col items-start gap-2 border-t border-border-subtle pt-6">
        <h2 className="type-section m-0">{t("scripture.addBible.ownTitle")}</h2>
        <p className="m-0 text-text-muted">
          {t("scripture.addBible.ownBody")}
        </p>
        <Button onClick={onFiles}>{t("scripture.addBible.chooseFiles")}</Button>
        <OriginalLanguageGuide />
      </section>
    </div>
  );
}

/**
 * Where Hebrew and Greek editions with word information can be found (v0.22):
 * links only, opened in the browser. Abiding Word downloads nothing itself
 * and ships none of these editions; the person chooses the files afterwards.
 */
const EDITIONS = [
  { key: "oshb", url: "https://github.com/openscriptures/morphhb" },
  { key: "wlc", url: "https://ebible.org/Scriptures/details.php?id=hboWLC" },
  { key: "morphgnt", url: "https://github.com/morphgnt/sblgnt" },
  { key: "rp", url: "https://ebible.org/Scriptures/details.php?id=grcmt" },
  { key: "sbl", url: "https://ebible.org/Scriptures/details.php?id=grcsbl" },
] as const;

function OriginalLanguageGuide() {
  const { t } = useTranslation();
  const api = useApi();
  return (
    <details className="w-full text-[0.9375rem]">
      <summary className="cursor-pointer text-text-strong">{t("scripture.addBible.guide.title")}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="m-0 text-text-muted">{t("scripture.addBible.guide.intro")}</p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {EDITIONS.map((edition) => (
            <li key={edition.key} className="flex flex-col gap-0.5">
              <span className="font-medium text-text-strong">{t(`scripture.addBible.guide.${edition.key}.name`)}</span>
              <span>{t(`scripture.addBible.guide.${edition.key}.gives`)}</span>
              <span className="text-text-muted">{t(`scripture.addBible.guide.${edition.key}.how`)}</span>
              <span>
                <Button variant="quiet" onClick={() => void api.openExternalLink(edition.url)}>
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  {t("scripture.addBible.guide.open", { host: new URL(edition.url).host })}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <p className="m-0 text-text-muted">{t("scripture.addBible.guide.note")}</p>
      </div>
    </details>
  );
}

interface Details {
  name: string;
  shortName: string;
  language: string;
  languageCode?: string;
  publisher?: string;
  copyrightNotice?: string;
  licenseType?: string;
  words?: WordChoice;
  asDocument?: boolean;
}

export type Correction = { index: number; book: string | null };

function ReviewStep({ preview, onCancel, onAdd, onCorrect }: { preview: ImportPreview; onCancel: () => void; onAdd: (d: Details) => Promise<void>; onCorrect: (books: Correction[]) => Promise<void> }) {
  const { t } = useTranslation();
  const id = useId();
  const s = preview.suggested;
  const [name, setName] = useState(s.name);
  const [shortName, setShortName] = useState(s.shortName);
  // Chosen only from the files' own metadata (or the bundled list); otherwise
  // left for the person. A tag without a name is named by LanguageChoice.
  const [language, setLanguage] = useState<LanguageValue | null>(() => (s.languageCode ? { code: s.languageCode, name: s.language } : null));
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<WordChoice>(NO_CHOICE);
  const doc = preview.document ?? null;
  // A Bible from documents is added by its verses when they can be used, else as a document.
  const [byVerse, setByVerse] = useState(true);
  const asDocument = !!doc && (!doc.versesUsable || !byVerse);
  const [notice, setNotice] = useState(s.copyrightNotice ?? s.licenseType ?? "");
  const errors = preview.issues.filter((i) => i.severity === "error");
  const warnings = preview.issues.filter((i) => i.severity === "warning");
  const notes = preview.issues.filter((i) => i.severity === "note");
  const complete = name.trim() && shortName.trim() && language !== null && language.name.trim();

  const add = async () => {
    setBusy(true);
    await onAdd({
      name,
      shortName,
      language: language?.name.trim() ?? "",
      languageCode: language?.code ?? undefined,
      publisher: s.publisher ?? undefined,
      copyrightNotice: doc ? notice.trim() || undefined : (s.copyrightNotice ?? undefined),
      licenseType: doc ? undefined : (s.licenseType ?? undefined),
      words,
      asDocument: doc ? asDocument : undefined,
    });
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_10rem]">
        <Field id={`${id}-name`} label={t("scripture.addBible.field.name")} value={name} onChange={setName} />
        <Field id={`${id}-short`} label={t("scripture.addBible.field.shortName")} value={shortName} onChange={setShortName} hint={t("scripture.addBible.field.shortNameHint")} />
        <div className="sm:col-span-2">
          <LanguageChoice id={`${id}-lang`} label={t("scripture.addBible.field.language")} value={language} onChange={setLanguage} />
        </div>
      </div>

      {doc && (
        <div className="-mt-4 flex flex-col gap-1">
          <label htmlFor={`${id}-notice`} className="type-subhead">
            {t("scripture.addBible.document.licenceField")}
          </label>
          <input id={`${id}-notice`} value={notice} onChange={(e) => setNotice(e.target.value)} className="h-10 aw-input px-3 text-base" aria-describedby={`${id}-notice-hint`} />
          <span id={`${id}-notice-hint`} className="type-meta">
            {t("scripture.addBible.document.licenceHint")}
          </span>
        </div>
      )}

      {doc && <DocumentFiles preview={doc} />}

      {(!doc || preview.verseCount > 0) && (
        <section aria-label={t("scripture.addBible.found")} className="flex flex-col gap-1">
          <p className="reading m-0">{t("scripture.addBible.booksDetected", { count: preview.bookCount })}</p>
          <p className="reading m-0">{t("scripture.addBible.chaptersDetected", { count: preview.chapterCount, number: formatNumber(preview.chapterCount) })}</p>
          <p className="reading m-0">{t("scripture.addBible.versesDetected", { count: preview.verseCount, number: formatNumber(preview.verseCount) })}</p>
          {!doc && s.licenseType && <p className="m-0 mt-2 text-[0.9375rem] text-text-muted">{t("scripture.addBible.licence", { licence: s.licenseType })}</p>}
        </section>
      )}

      {doc && <DocumentChoice preview={doc} byVerse={byVerse} onByVerse={setByVerse} />}

      {doc ? (
        <p className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.addBible.document.noWords")}</p>
      ) : (
        hasWordResearch(preview.words) && <WordResearch report={preview.words} choice={words} onChoice={setWords} atImport />
      )}

      {doc ? (
        doc.books.length > 0 && <FoundBooks preview={doc} onCorrect={onCorrect} />
      ) : (
        <ul aria-label={t("scripture.addBible.books")} className="m-0 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2">
          {preview.books.map((book) => (
            <li key={book.code} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5">
              <span>{bookName(book.code, book.name)}</span>
              <BookStatus status={book.status} />
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <IssueGroup title={t("scripture.addBible.problems", { count: errors.length })} issues={errors} open={!doc} />
      )}
      {warnings.length > 0 && <IssueGroup title={t("scripture.addBible.warnings", { count: warnings.length })} issues={warnings} />}
      {notes.length > 0 && <IssueGroup title={t("scripture.addBible.notes", { count: notes.length })} issues={notes} />}
      {doc && doc.leftOut.length > 0 && <LeftOut preview={doc} />}
      {preview.skippedFiles.length > 0 && (
        <details className="text-[0.9375rem] text-text-muted">
          <summary className="cursor-pointer">{t("scripture.addBible.skipped", { count: preview.skippedFiles.length })}</summary>
          <p className="m-0 mt-1 break-all">
            <span className="sr-only">{t("scripture.addBible.skippedNames")}: </span>
            {preview.skippedFiles.join(", ")}
          </p>
        </details>
      )}

      <div className="flex flex-wrap gap-3 border-t border-border-subtle pt-6">
        <Button variant="primary" onClick={add} disabled={!preview.canImport || !complete || busy}>
          {busy ? t("scripture.addBible.adding") : asDocument ? t("scripture.addBible.document.addDocument") : t("scripture.addBible.add")}
        </Button>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </div>
  );
}

function Field(props: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label htmlFor={props.id} className="flex flex-col gap-1">
      <span className="type-subhead">{props.label}</span>
      <input
        id={props.id}
        value={props.value}
        placeholder={props.hint}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-10 aw-input px-3 text-base placeholder:text-text-muted"
      />
    </label>
  );
}

function BookStatus({ status }: { status: "ok" | "warning" | "error" }) {
  const { t } = useTranslation();
  const map: Record<typeof status, [ReactNode, string]> = {
    ok: [<Check key="i" className="size-4 text-text-strong" aria-hidden="true" />, t("scripture.addBible.bookStatus.ok")],
    warning: [<AlertTriangle key="i" className="size-4 text-accent" aria-hidden="true" />, t("scripture.addBible.bookStatus.warning")],
    error: [<CircleX key="i" className="size-4 text-danger" aria-hidden="true" />, t("scripture.addBible.bookStatus.error")],
  };
  const [icon, label] = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 type-meta" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function IssueGroup({ title, issues, open }: { title: string; issues: ImportIssue[]; open?: boolean }) {
  return (
    <details open={open} className="border-l-[3px] border-border pl-4">
      <summary className="type-subhead cursor-pointer">{title}</summary>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[0.9375rem]">
        {issues.map((issue, index) => (
          <li key={index}>{localizeMessage(issue.code, issue.params, issue.message)}</li>
        ))}
      </ul>
    </details>
  );
}

/** What each chosen document holds, in plain words (v0.23). */
function DocumentFiles({ preview }: { preview: DocumentPreview }) {
  const { t } = useTranslation();
  const kind = (file: DocumentFileInfo) => {
    if (file.format === "pdf") {
      const pages = file.pages ?? 0;
      return file.scanned
        ? t("scripture.addBible.document.file.pdfScanned", { count: pages, formatted: formatNumber(pages) })
        : t("scripture.addBible.document.file.pdfText", { count: pages, formatted: formatNumber(pages) });
    }
    return t(`scripture.addBible.document.file.${file.format}`);
  };
  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-section m-0">{t("scripture.addBible.document.filesTitle")}</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {preview.files.map((file) => (
          <li key={file.name} className="flex flex-col gap-0.5 border-b border-border-subtle pb-2">
            <span className="break-all font-medium text-text-strong">{file.name}</span>
            <span className="text-[0.9375rem]">{kind(file)}</span>
            <span className="type-meta">{file.keepsLayout ? t("scripture.addBible.document.layoutKept") : t("scripture.addBible.document.layoutText")}</span>
            {file.notes > 0 && <span className="type-meta">{t("scripture.addBible.document.notes", { count: file.notes, formatted: formatNumber(file.notes) })}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** By book, chapter and verse, or as a document to read: the one choice the person makes (v0.23). */
function DocumentChoice({ preview, byVerse, onByVerse }: { preview: DocumentPreview; byVerse: boolean; onByVerse: (v: boolean) => void }) {
  const { t } = useTranslation();
  const name = useId();
  const scanned = preview.textChars === 0;
  if (!preview.versesUsable) {
    const message = scanned
      ? t("scripture.addBible.document.scannedOnly")
      : preview.books.some((b) => b.verses > 0)
        ? t("scripture.addBible.document.unusable")
        : t("scripture.addBible.document.noneFound");
    return <Notice>{message}</Notice>;
  }
  const isPdf = preview.files.some((f) => f.format === "pdf");
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="type-subhead mb-1">{t("scripture.addBible.document.modeLabel")}</legend>
      <p className="m-0 text-[0.9375rem]">{t("scripture.addBible.document.usable")}</p>
      {[true, false].map((verses) => (
        <label key={String(verses)} className="flex items-start gap-2">
          <input type="radio" name={name} className="mt-1" checked={byVerse === verses} onChange={() => onByVerse(verses)} />
          <span className="flex flex-col">
            <span className="font-medium">{verses ? t("scripture.addBible.document.mode.verses") : t("scripture.addBible.document.mode.document")}</span>
            <span className="text-[0.9375rem] text-text-muted">{verses ? t("scripture.addBible.document.mode.versesHint") : t("scripture.addBible.document.mode.documentHint")}</span>
          </span>
        </label>
      ))}
      {isPdf && byVerse && <p className="m-0 type-meta">{t("scripture.addBible.document.pdfLimit")}</p>}
    </fieldset>
  );
}

/**
 * The books found, each at its heading in the document (v0.23). A heading read
 * as the wrong book, or naming none, is corrected here; the documents are then
 * read again. Folded unless something needs attention.
 */
export function FoundBooks({ preview, onCorrect }: { preview: DocumentPreview; onCorrect: (books: Correction[]) => Promise<void> }) {
  const { t } = useTranslation();
  const { books: canon } = useScripture();
  const [busy, setBusy] = useState(false);
  const attention = !preview.versesUsable && preview.books.some((b) => b.detected === null || b.verses > 0);
  const choose = async (index: number, value: string) => {
    const corrections: Correction[] = preview.books
      .filter((b) => b.index !== index && (b.leftOut || b.book !== b.detected))
      .map((b) => ({ index: b.index, book: b.leftOut ? null : b.book }));
    corrections.push({ index, book: value === "" ? null : value });
    setBusy(true);
    await onCorrect(corrections);
    setBusy(false);
  };
  return (
    <details open={attention} className="border-l-[3px] border-border pl-4">
      <summary className="type-subhead cursor-pointer">{t("scripture.addBible.document.booksTitle", { count: preview.books.length, formatted: formatNumber(preview.books.length) })}</summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.addBible.document.booksIntro")}</p>
        {busy && (
          <p role="status" className="m-0 text-[0.9375rem]">
            {t("scripture.addBible.document.correcting")}
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {preview.books.map((book) => (
            <li key={book.index} className="flex flex-col gap-1">
              <label className="flex flex-col gap-1">
                <span className="break-words text-[0.9375rem] font-medium">{t("scripture.addBible.document.bookChoice", { heading: book.heading })}</span>
                <select
                  value={book.leftOut ? "" : (book.book ?? "-")}
                  disabled={busy}
                  onChange={(e) => void choose(book.index, e.target.value)}
                  className="h-9 max-w-80 aw-input px-2"
                >
                  {book.book === null && !book.leftOut && <option value="-">{t("scripture.addBible.document.notRecognised")}</option>}
                  <option value="">{t("scripture.addBible.document.leaveOut")}</option>
                  {canon.map((b) => (
                    <option key={b.code} value={b.code}>
                      {bookName(b.code, b.name)}
                    </option>
                  ))}
                </select>
              </label>
              {!book.leftOut && book.book && (
                <span className="type-meta">{t("scripture.addBible.document.bookCounts", { chapters: formatNumber(book.chapters), verses: formatNumber(book.verses) })}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/** Text that belongs to no verse, with examples and where they are (v0.23). */
export function LeftOut({ preview }: { preview: DocumentPreview }) {
  const { t } = useTranslation();
  return (
    <details className="border-l-[3px] border-border pl-4 text-[0.9375rem]">
      <summary className="type-subhead cursor-pointer">{t("scripture.addBible.document.leftOutTitle", { formatted: formatNumber(preview.stats.leftOutChars) })}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="m-0 text-text-muted">{t("scripture.addBible.document.leftOutIntro")}</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {preview.leftOut.map((item, index) => (
            <li key={index} className="flex flex-col">
              <span className="type-meta">
                {[t(`scripture.addBible.document.reason.${item.reason}`), item.place.page !== null ? t("scripture.document.page", { page: formatNumber(item.place.page) }) : null].filter(Boolean).join(t("common.listSeparator"))}
              </span>
              <span className="break-words">{item.sample}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
