import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { LICENCE_STATUSES, SOURCE_TYPES, type LicenceStatus, type SourceImportPreview, type SourceType } from "@/types/library";
import { FORMAT_LABELS, LICENCE_LABELS, SOURCE_TYPE_LABELS } from "./labels";
import { useLibraryNav } from "./LibraryNav";

/** Add to library: choose a file → check → review → add. */
export function AddSourceView({ onClose }: { onClose: () => void }) {
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
            <ArrowLeft className="size-4" aria-hidden="true" /> Back
          </Button>
          <h1 id={`${id}-title`} ref={heading} tabIndex={-1} className="m-0 font-display text-[1.875rem] font-semibold text-text-strong">
            Add to library
          </h1>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {checking && <p role="status" className="m-0 text-text-muted">Reading the file and finding its text…</p>}
        {!preview && !checking && (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0 text-text-muted">
              Choose a PDF, EPUB, Markdown (.md) or text (.txt) file. Abiding Word keeps its own copy in your library and never
              changes your file. Scanned PDFs cannot be read yet.
            </p>
            <Button variant="primary" onClick={choose}>Choose a file…</Button>
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

  const size =
    preview.pageCount !== null
      ? `${preview.pageCount} page${preview.pageCount === 1 ? "" : "s"}`
      : preview.chapterCount
        ? `${preview.chapterCount} chapter${preview.chapterCount === 1 ? "" : "s"}`
        : `${preview.segmentCount} paragraph${preview.segmentCount === 1 ? "" : "s"}`;
  const field = "h-10 rounded-aw border border-border bg-bg px-3 text-base";

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="What was found" className="flex flex-col gap-1">
        <p className="reading m-0 text-[1.25rem] font-semibold">{title || preview.fileName}</p>
        {author && <p className="reading m-0">{author}</p>}
        <p className="m-0 mt-2">{FORMAT_LABELS[preview.format]} · {size}</p>
        {preview.canImport ? (
          <p className="m-0 flex items-center gap-2"><Check className="size-4" aria-hidden="true" /> Text extracted successfully</p>
        ) : (
          <p role="alert" className="m-0 flex items-start gap-2 text-danger"><AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden="true" /> {preview.problem}</p>
        )}
        {preview.canImport && (
          <p className="m-0">{preview.referenceCount} Bible reference{preview.referenceCount === 1 ? "" : "s"} detected</p>
        )}
      </section>

      {preview.duplicateOf && (
        <div role="alert" className="flex flex-col gap-2 border-l-[3px] border-accent bg-bg-secondary px-4 py-3">
          <p className="m-0">This file is already in your library as <strong>{preview.duplicateOf.title}</strong>.</p>
          <label className="flex items-center gap-2 text-[0.9375rem]">
            <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="size-4 accent-[var(--aw-primary)]" />
            Add a second copy anyway
          </label>
        </div>
      )}

      {preview.canImport && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2"><span className="font-medium text-text-strong">Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
          <label className="flex flex-col gap-1"><span className="font-medium text-text-strong">Author</span><input value={author} onChange={(e) => setAuthor(e.target.value)} className={field} /></label>
          <label className="flex flex-col gap-1"><span className="font-medium text-text-strong">Language</span><input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English, Deutsch" className={field} /></label>
          <label className="flex flex-col gap-1"><span className="font-medium text-text-strong">Kind</span>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)} className={field}>
              {SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="font-medium text-text-strong">Sharing</span>
            <select value={licence} onChange={(e) => setLicence(e.target.value as LicenceStatus)} className={field}>
              {LICENCE_STATUSES.map((l) => <option key={l} value={l}>{LICENCE_LABELS[l]}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="flex gap-3 border-t border-border-subtle pt-6">
        <Button variant="primary" onClick={add} disabled={!preview.canImport || busy || !title.trim() || (!!preview.duplicateOf && !allowDuplicate)}>
          {busy ? "Adding…" : "Add to library"}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
