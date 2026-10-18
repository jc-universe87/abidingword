import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/design-system/Button";
import { Dialog } from "@/design-system/Dialog";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { EXPORT_FORMATS, type ExportFormat, type PresentationDocument } from "@/types/presentation";
import { exportLocale, fileName } from "./labels";

const EXTENSIONS: Record<ExportFormat, string> = { pptx: "pptx", pdf: "pdf", speaker_pdf: "pdf", markdown: "md", package: "json" };
/** Which choices mean something for each format. */
const HAS_NOTES: ExportFormat[] = ["pptx", "markdown"];
const HAS_SOURCES: ExportFormat[] = ["markdown", "speaker_pdf"];

/**
 * Saves the presentation as PowerPoint, PDF (slides, or a speaker sheet for
 * a phone), Markdown or a delivery package — all made from the same slides.
 * The file goes only where the person chooses in the system's save dialog,
 * which asks before replacing a file. The teaching is never changed.
 */
export function ExportDialog({ doc, onClose }: { doc: PresentationDocument; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [format, setFormat] = useState<ExportFormat>("pptx");
  const [notes, setNotes] = useState(false);
  const [sources, setSources] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const suffix = format === "speaker_pdf" ? t("presentation.export.speakerSuffix") : "";
      const path = await api.choosePresentationFile({
        defaultName: fileName(doc.title, suffix, EXTENSIONS[format], t("presentation.export.fileFallback")),
        format,
        filterName: t(`presentation.export.formats.${format}.name`),
      });
      if (!path) return;
      const done = await api.presentationExport({
        id: doc.presentationId,
        format,
        path,
        options: {
          speakerNotes: format === "speaker_pdf" || (HAS_NOTES.includes(format) && notes),
          citations: HAS_SOURCES.includes(format) && sources,
          locale: exportLocale(t),
        },
      });
      setResult(
        [
          done.missingImages > 0 ? t("presentation.export.savedMissing", { path: done.path, count: done.missingImages }) : t("presentation.export.saved", { path: done.path }),
          // Reported, never shrunk quietly: the boxes keep the template's size.
          done.overflowing ? t("presentation.templates.overflowExport", { count: done.overflowing }) : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("presentation.export.title")}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? t("presentation.export.saving") : t("presentation.export.save")}
          </Button>
          <Button onClick={onClose}>{result ? t("common.close") : t("common.cancel")}</Button>
        </>
      }
    >
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 p-0 text-[0.9375rem] text-text-muted">{t("presentation.export.format")}</legend>
        {EXPORT_FORMATS.map((f) => (
          <label key={f} className="flex min-h-11 items-start gap-2 py-1">
            <input type="radio" name={`${id}-format`} checked={format === f} onChange={() => setFormat(f)} className="mt-1 size-5 shrink-0" />
            <span className="flex flex-col">
              <span className="font-medium text-text-strong">{t(`presentation.export.formats.${f}.name`)}</span>
              <span className="text-[0.875rem] text-text-muted">{t(`presentation.export.formats.${f}.hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {HAS_NOTES.includes(format) && (
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} className="size-5" />
          {t("presentation.export.includeNotes")}
        </label>
      )}
      {HAS_SOURCES.includes(format) && (
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={sources} onChange={(e) => setSources(e.target.checked)} className="size-5" />
          {t("presentation.export.includeSources")}
        </label>
      )}
      <p className="m-0 text-[0.875rem] text-text-muted">{t("presentation.export.private")}</p>
      {result && <p role="status" className="m-0 break-words">{result}</p>}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </Dialog>
  );
}
