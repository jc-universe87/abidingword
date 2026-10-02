import { useEffect, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { formatNumber } from "@/i18n/format";
import { localizeMessage } from "@/i18n/messages";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { LICENCE_STATUSES, SOURCE_TYPES, type LicenceStatus, type SourceImportPreview, type SourceType } from "@/types/library";
import { formatLabel, licenceLabel, sourceTypeLabel } from "./labels";
import { useLibraryNav } from "./LibraryNav";

/** Add to library: choose a file → check → review → add. */
export function AddSourceView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const { openSource } = useLibraryNav();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [preview, setPreview] = useState<SourceImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => heading.current?.focus(), [preview]);

  const choose = async () => {
    setError(null);
    try {
      const path = await api.chooseSourceFile();
      if (!path) return;
      setChecking(true);
      setPreview(await api.libraryImportPreview(path));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setChecking(false);
    }
  };

  const cancel = () => {
    if (preview) void api.libraryImportCancel(preview.previewId).catch(() => undefined);
    onClose();
  };

  return (
    <main aria-labelledby={`${id}-title`} className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-[46rem] flex-col gap-6 px-8 pb-24 pt-8">
        <div className="flex flex-col items-start gap-4">
          <Button variant="quiet" onClick={cancel} disabled={checking}>
            <ArrowLeft className="size-4" aria-hidden="true" /> {t("common.back")}
          </Button>
          <h1 id={`${id}-title`} ref={heading} tabIndex={-1} className="m-0 font-display text-[1.875rem] font-heading text-text-strong">
            {t("library.add.title")}
          </h1>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {checking && <p role="status" className="m-0 text-text-muted">{t("library.add.reading")}</p>}
        {!preview && !checking && (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0 text-text-muted">{t("library.add.intro")}</p>
            <Button variant="primary" onClick={choose}>{t("library.add.choose")}</Button>
          </div>
        )}
        {preview && (
          <Review
            preview={preview}
            onCancel={cancel}
            onAdded={(sourceId) => openSource(sourceId)}
            onError={setError}
          />
        )}
      </div>
    </main>
  );
}

function Review({ preview, onCancel, onAdded, onError }: { preview: SourceImportPreview; onCancel: () => void; onAdded: (id: string) => void; onError: (m: string | null) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [title, setTitle] = useState(preview.suggestedTitle);
  const [author, setAuthor] = useState(preview.suggestedAuthor ?? "");
  const [language, setLanguage] = useState(preview.suggestedLanguage ?? "");
  const [sourceType, setSourceType] = useState<SourceType>(preview.suggestedType);
  const [licence, setLicence] = useState<LicenceStatus>("private");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    onError(null);
    try {
      const source = await api.libraryImportCommit({
        previewId: preview.previewId,
        title,
        author: author || undefined,
        language: language || undefined,
        publisher: preview.suggestedPublisher ?? undefined,
        isbn: preview.suggestedIsbn ?? undefined,
        sourceType,
        licenceStatus: licence,
        allowDuplicate,
      });
      onAdded(source.id);
    } catch (e) {
      onError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const sized = (key: "pages" | "chapters" | "sections" | "paragraphs", count: number) =>
    t(`library.size.${key}`, { count, number: formatNumber(count) });
  const size =
    preview.pageCount !== null
      ? sized("pages", preview.pageCount)
      : preview.chapterCount
        ? // EPUB counts chapters; Markdown counts its main headings.
          sized(preview.format === "epub" ? "chapters" : "sections", preview.chapterCount)
        : sized("paragraphs", preview.segmentCount);
  const field = "h-10 rounded-aw border border-border bg-bg px-3 text-base";

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("library.add.whatFound")} className="flex flex-col gap-1">
        <p className="reading m-0 text-[1.25rem] font-semibold">{title || preview.fileName}</p>
        {author && <p className="reading m-0">{author}</p>}
        <p className="m-0 mt-2">{[formatLabel(t, preview.format), size].join(t("common.listSeparator"))}</p>
        {preview.canImport ? (
          <p className="m-0 flex items-center gap-2"><Check className="size-4" aria-hidden="true" /> {t("library.add.extracted")}</p>
        ) : (
          <p role="alert" className="m-0 flex items-start gap-2 text-danger"><AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden="true" /> {localizeMessage(preview.problemCode, undefined, preview.problem ?? "")}</p>
        )}
        {preview.canImport && (
          <p className="m-0">{t("library.add.references", { count: preview.referenceCount, number: formatNumber(preview.referenceCount) })}</p>
        )}
      </section>

      {preview.duplicateOf && (
        <div role="alert" className="flex flex-col gap-2 border-l-[3px] border-accent bg-bg-secondary px-4 py-3">
          <p className="m-0">
            <Trans i18nKey="library.add.duplicate" values={{ title: preview.duplicateOf.title }} components={{ strong: <strong /> }} />
          </p>
          <label className="flex items-center gap-2 text-[0.9375rem]">
            <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="size-4 accent-[var(--aw-primary)]" />
            {t("library.add.addCopy")}
          </label>
        </div>
      )}

      {preview.canImport && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2"><span className="font-medium text-text-strong">{t("library.metadata.title")}</span><input value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
          <label className="flex flex-col gap-1"><span className="font-medium text-text-strong">{t("library.metadata.author")}</span><input value={author} onChange={(e) => setAuthor(e.target.value)} className={field} /></label>
          <label className="flex flex-col gap-1"><span className="font-medium text-text-strong">{t("library.metadata.language")}</span><input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder={t("library.metadata.languagePlaceholder")} className={field} /></label>
          <label className="flex flex-col gap-1"><span className="font-medium text-text-strong">{t("library.metadata.kind")}</span>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)} className={field}>
              {SOURCE_TYPES.map((type) => <option key={type} value={type}>{sourceTypeLabel(t, type)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="font-medium text-text-strong">{t("library.metadata.sharing")}</span>
            <select value={licence} onChange={(e) => setLicence(e.target.value as LicenceStatus)} className={field}>
              {LICENCE_STATUSES.map((l) => <option key={l} value={l}>{licenceLabel(t, l)}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="flex gap-3 border-t border-border-subtle pt-6">
        <Button variant="primary" onClick={add} disabled={!preview.canImport || busy || !title.trim() || (!!preview.duplicateOf && !allowDuplicate)}>
          {busy ? t("library.add.adding") : t("library.addToLibrary")}
        </Button>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </div>
  );
}
