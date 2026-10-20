import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDown, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Dialog } from "@/design-system/Dialog";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { ImportedTemplate, ImportProgress, PresentationTemplate } from "@/types/presentationTemplate";
import { ImportReview } from "./ImportReview";
import { TemplateDesigner } from "./TemplateDesigner";

type View = { kind: "list" } | { kind: "review"; imported: ImportedTemplate; fileName: string } | { kind: "design"; template: PresentationTemplate | null };

/**
 * Church presentation templates (v0.18.1): import a design from PowerPoint
 * (Keynote and Google Slides save as PowerPoint), take one to another
 * computer as a template file, design a simple one, or remove one. A
 * template is only a design; no teaching or slide is changed here.
 */
export function TemplateManager({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: "list" });
  if (view.kind === "review") {
    return <ImportReview imported={view.imported} fileName={view.fileName} onDone={() => setView({ kind: "list" })} />;
  }
  if (view.kind === "design") {
    return <TemplateDesigner template={view.template} onDone={() => setView({ kind: "list" })} />;
  }
  return <TemplateList onClose={onClose} onReview={(imported, fileName) => setView({ kind: "review", imported, fileName })} onDesign={(template) => setView({ kind: "design", template })} />;
}

function TemplateList({
  onClose,
  onReview,
  onDesign,
}: {
  onClose: () => void;
  onReview: (imported: ImportedTemplate, fileName: string) => void;
  onDesign: (template: PresentationTemplate | null) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const list = useLoad(useCallback(() => api.presentationTemplateList(), [api]));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let active = true;
    void api.onTemplateImportProgress((p) => active && setProgress(p)).then((un) => (active ? (stop = un) : un()), () => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, [api]);

  const run = async (work: () => Promise<void>) => {
    setError(null);
    setStatus("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const importPowerPoint = () =>
    run(async () => {
      const path = await api.chooseTemplateFile({ kind: "pptx", title: t("presentation.templates.choosePptx"), filterName: t("presentation.templates.pptxFilter") });
      if (!path) return;
      const imported = await api.presentationTemplateImportPptx(path);
      onReview(imported, path.split(/[\\/]/).pop() ?? path);
    });
  const importPackage = () =>
    run(async () => {
      const path = await api.chooseTemplateFile({ kind: "package", title: t("presentation.templates.choosePackage"), filterName: t("presentation.templates.packageFilter") });
      if (!path) return;
      const created = await api.presentationTemplateImportPackage(path);
      setStatus(t("presentation.templates.added", { name: created.name }));
      list.reload();
    });
  const exportOne = (id: string, name: string) =>
    run(async () => {
      const path = await api.chooseTemplateSaveFile({ defaultName: `${name}.awtemplate`, filterName: t("presentation.templates.packageFilter") });
      if (!path) return;
      await api.presentationTemplateExport({ id, path });
      setStatus(t("presentation.templates.exported", { path }));
    });
  const remove = (id: string, name: string) =>
    run(async () => {
      await api.presentationTemplateDelete(id);
      setConfirm(null);
      setStatus(t("presentation.templates.removed", { name }));
      list.reload();
    });
  const edit = (id: string) =>
    run(async () => {
      onDesign(await api.presentationTemplateGet(id));
    });

  const templates = list.data ?? [];
  return (
    <Dialog
      wide
      title={t("presentation.templates.title")}
      onClose={onClose}
      actions={<Button onClick={onClose}>{t("common.close")}</Button>}
    >
      <p className="m-0 max-w-prose text-[0.9375rem] text-text-muted">{t("presentation.templates.intro")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void importPowerPoint()} disabled={busy}>
          <FileUp className="size-4" aria-hidden="true" />
          {t("presentation.templates.importPptx")}
        </Button>
        <Button onClick={() => void importPackage()} disabled={busy}>
          <FileUp className="size-4" aria-hidden="true" />
          {t("presentation.templates.importPackage")}
        </Button>
        <Button onClick={() => onDesign(null)} disabled={busy}>
          <Plus className="size-4" aria-hidden="true" />
          {t("presentation.templates.new")}
        </Button>
      </div>
      <details className="border-y border-border-subtle text-[0.9375rem]">
        <summary className="type-subhead flex min-h-11 cursor-pointer items-center rounded-aw px-1 hover:bg-hover">{t("presentation.templates.otherApps")}</summary>
        <ul className="mb-2 mt-0 flex flex-col gap-1 pl-5">
          <li>{t("presentation.templates.keynote")}</li>
          <li>{t("presentation.templates.googleSlides")}</li>
          <li>{t("presentation.templates.libreOffice")}</li>
        </ul>
        <p className="m-0 pb-2 text-text-muted">{t("presentation.templates.fontsNote")}</p>
      </details>
      {busy && (
        <p role="status" className="m-0 text-[0.9375rem]">
          {progress && progress.total > 0 ? t("presentation.templates.reading", { done: progress.done, total: progress.total }) : t("presentation.templates.working")}
        </p>
      )}
      {status && <p role="status" className="m-0 break-words text-[0.9375rem]">{status}</p>}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      {list.error && <p role="alert" className="m-0 text-danger">{list.error.message}</p>}
      <h3 className="type-group m-0 mt-2">{t("presentation.templates.yours")}</h3>
      {list.data && templates.length === 0 && <p className="type-meta m-0">{t("presentation.templates.none")}</p>}
      {/* A list, not a stack of boxes (v0.18.5). */}
      <ul className="m-0 flex list-none flex-col border-t border-border-subtle p-0">
        {templates.map((tpl) => (
          <li key={tpl.id} className="flex flex-wrap items-center gap-2 border-b border-border-subtle py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="type-item break-words">{tpl.name}</span>
              <span className="type-meta">
                {[t(`presentation.templates.source.${tpl.sourceFormat}`), tpl.width / tpl.height > 1.5 ? "16:9" : tpl.width / tpl.height > 1.2 ? "4:3" : `${tpl.width} × ${tpl.height}`, tpl.description].filter(Boolean).join(" · ")}
              </span>
            </span>
            {confirm === tpl.id ? (
              <span className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
                <span>{t("presentation.templates.deleteConfirm")}</span>
                <Button variant="danger" onClick={() => void remove(tpl.id, tpl.name)}>
                  {t("common.delete")}
                </Button>
                <Button autoFocus onClick={() => setConfirm(null)}>
                  {t("common.keep")}
                </Button>
              </span>
            ) : (
              <span className="flex flex-wrap items-center">
                <button type="button" onClick={() => void edit(tpl.id)} disabled={busy} className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] hover:bg-hover">
                  <Pencil className="size-4" aria-hidden="true" />
                  {t("presentation.templates.edit", { name: tpl.name })}
                </button>
                <button type="button" onClick={() => void exportOne(tpl.id, tpl.name)} disabled={busy} className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] hover:bg-hover">
                  <FileDown className="size-4" aria-hidden="true" />
                  {t("presentation.templates.export", { name: tpl.name })}
                </button>
                <button type="button" onClick={() => setConfirm(tpl.id)} className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-hover hover:text-danger">
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t("presentation.templates.delete", { name: tpl.name })}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
