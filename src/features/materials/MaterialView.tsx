import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Copy, FileText, Printer } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { copyText } from "@/lib/clipboard";
import { fileName } from "@/features/presentation/labels";
import type { TeachingPreparation } from "@/types/teaching";
import { DEFAULT_OPTIONS, derive, outputName, toMarkdown, type Block, type MaterialDocument, type MaterialOptions } from "./derive";

type Kind = MaterialDocument["kind"];

/** The choices a material offers, each small and in plain words (no layout settings). */
const OPTIONS: Record<Kind, (keyof MaterialOptions)[]> = {
  manuscript: ["includeNotes"],
  questions: ["leader", "includeFrame", "writingSpace"],
  worksheet: ["writingSpace"],
};

/**
 * A material of a Bible Teaching (v0.18.6): shown at once as it will be
 * printed, with the few choices that matter beside it, and the ways to take
 * it away: print (or save as PDF in the system's print dialog), a text file
 * (Markdown), or the clipboard for a document or an email. It is put
 * together from the teaching each time it is shown, so it always says what
 * the teaching says; nothing here changes the teaching.
 */
export function MaterialView({ kind, preparation, onBack }: { kind: Kind; preparation: TeachingPreparation; onBack: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [options, setOptions] = useState<MaterialOptions>(DEFAULT_OPTIONS);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [printing, setPrinting] = useState(false);
  const name = outputName(t, kind, preparation.kind);
  const doc = useMemo(() => derive(t, kind, preparation, options), [t, kind, preparation, options]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Printing shows only the material: a copy of it is put at the top of the page while the
  // system's print dialog is open (where it can also be saved as a PDF), and taken away after.
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("aw-printing");
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const frame = requestAnimationFrame(() => {
      try {
        window.print();
      } catch {
        setStatus({ tone: "error", text: t("studies.materials.status.printFailed") });
        done();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", done);
      document.body.classList.remove("aw-printing");
    };
  }, [printing, t]);

  const saveMarkdown = async () => {
    setStatus(null);
    try {
      const path = await api.chooseMaterialFile({
        defaultName: fileName(preparation.title, name, "md", t("presentation.export.fileFallback")),
        filterName: t("studies.materials.action.filterName"),
      });
      if (!path) return;
      const saved = await api.materialSaveMarkdown({ path, text: toMarkdown(doc) });
      setStatus({ tone: "ok", text: t("studies.materials.status.saved", { path: saved }) });
    } catch (e) {
      setStatus({ tone: "error", text: toApiError(e).message });
    }
  };
  const copy = async () => {
    const ok = await copyText(toMarkdown(doc));
    setStatus(ok ? { tone: "ok", text: t("studies.materials.status.copied") } : { tone: "error", text: t("studies.materials.status.copyFailed") });
  };

  const shape = kind === "questions" ? "questions" : null;
  const optionLabel = (option: keyof MaterialOptions) =>
    option === "includeFrame"
      ? t("studies.materials.option.includeFrame", {
          opening: t(`studies.teaching.shape.${shape ?? "questions"}.introduction`),
          closing: t(`studies.teaching.shape.${shape ?? "questions"}.conclusion`),
        })
      : t(`studies.materials.option.${option}`);
  // The leader's version holds the opening and closing already, and its notes take the place of room to write.
  const offered = OPTIONS[kind].filter((option) => !(options.leader && (option === "includeFrame" || option === "writingSpace")));

  return (
    <section aria-labelledby={`${id}-title`} className="@container flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <Button variant="quiet" className="-ml-2 min-h-11" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("studies.materials.view.back")}
          </Button>
        </div>
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="type-worktitle m-0 outline-none">
          {name}
        </h2>
        <p className="type-meta m-0">{t("studies.materials.view.from", { title: preparation.title })}</p>
      </header>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Button variant="primary" className="min-h-11" onClick={() => setPrinting(true)} disabled={doc.empty}>
          <Printer className="size-4" aria-hidden="true" />
          {t("studies.materials.action.print")}
        </Button>
        <Button className="min-h-11" onClick={() => void saveMarkdown()} disabled={doc.empty}>
          <FileText className="size-4" aria-hidden="true" />
          {t("studies.materials.action.markdown")}
        </Button>
        <Button variant="quiet" className="min-h-11" onClick={() => void copy()} disabled={doc.empty}>
          <Copy className="size-4" aria-hidden="true" />
          {t("studies.materials.action.copy")}
        </Button>
        {offered.length > 0 && (
          <fieldset className="m-0 flex flex-wrap items-center gap-x-4 border-0 p-0 @lg:ml-auto">
            <legend className="type-meta float-left mr-2 p-0">{t("studies.materials.view.options")}</legend>
            {offered.map((option) => (
              <label key={option} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[0.9375rem]">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={!!options[option]}
                  onChange={(e) => setOptions((o) => ({ ...o, [option]: e.target.checked }))}
                />
                {optionLabel(option)}
              </label>
            ))}
          </fieldset>
        )}
      </div>
      {status && (
        <p role={status.tone === "error" ? "alert" : "status"} className={`m-0 break-words text-[0.9375rem] ${status.tone === "error" ? "text-danger" : ""}`}>
          {status.text}
        </p>
      )}


      {doc.empty ? (
        <p className="m-0 border-l-2 border-border py-1 pl-3 text-text-muted">{t("studies.materials.view.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <MaterialPage doc={doc} label={t("studies.materials.view.preview", { name })} />
        </div>
      )}
      {printing && createPortal(<div id="material-print"><MaterialPage doc={doc} /></div>, document.body)}
    </section>
  );
}

/** The material as a page of paper: always white, in the reading face, the same on screen and when printed. */
export function MaterialPage({ doc, label }: { doc: MaterialDocument; label?: string }) {
  return (
    <article aria-label={label} className="aw-material">
      {doc.blocks.map((block, index) => (
        <MaterialBlock key={index} block={block} />
      ))}
    </article>
  );
}

function MaterialBlock({ block }: { block: Block }) {
  switch (block.type) {
    case "title":
      return <h3 className="aw-material-title">{block.text}</h3>;
    case "passages":
      return <p className="aw-material-passages">{block.text}</p>;
    case "notice":
      return <p className="aw-material-notice">{block.text}</p>;
    case "message":
      return (
        <div className="aw-material-message">
          <p className="aw-material-label">{block.label}</p>
          <p>{block.text}</p>
        </div>
      );
    case "heading":
      return (
        <h4 className="aw-material-heading">
          {block.text}
          {block.detail && <span className="aw-material-detail"> · {block.detail}</span>}
        </h4>
      );
    case "text":
      return <p className="aw-material-text">{block.text}</p>;
    case "field":
      return (
        <div className="aw-material-field">
          <p className="aw-material-label">{block.label}</p>
          <p className="aw-material-text">{block.text}</p>
        </div>
      );
    case "question":
      return (
        <p className="aw-material-question">
          <span className="aw-material-number">{block.number}.</span> {block.text}
        </p>
      );
    case "space":
      return (
        <div className="aw-material-space-wrap" aria-hidden="true">
          {block.label && <p className="aw-material-label">{block.label}</p>}
          <div className={block.style === "box" ? "aw-material-box" : "aw-material-lines"} />
        </div>
      );
  }
}
