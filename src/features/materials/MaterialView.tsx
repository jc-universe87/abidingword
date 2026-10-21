import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Copy, FileText, FileType, Printer } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { copyText } from "@/lib/clipboard";
import { fileName } from "@/features/presentation/labels";
import type { TeachingPreparation } from "@/types/teaching";
import { useScripture } from "@/features/scripture/ScriptureContext";
import type { MaterialScripture } from "@/types/scripture";
import { DEFAULT_OPTIONS, derive, outputName, toMarkdown, type Block, type MaterialDocument, type MaterialOptions } from "./derive";

type Kind = MaterialDocument["kind"];

/** The choices a material offers, each small and in plain words (no layout settings). */
const OPTIONS: Record<Kind, (keyof MaterialOptions)[]> = {
  manuscript: ["includePassage", "includeNotes"],
  questions: ["includePassage", "leader", "includeFrame", "writingSpace"],
  worksheet: ["includePassage", "writingSpace"],
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
  // Each request to print, counted: a web view that never says printing has finished can still print again.
  const [printing, setPrinting] = useState(0);
  const name = outputName(t, kind, preparation.kind);
  // The passage's text (v0.18.8), when asked for: read from the Bible chosen in the Scripture
  // pane, and only from it. While it is read, or if it cannot be, the material keeps the reference.
  const { translation } = useScripture();
  const references = useMemo(() => preparation.passages.filter((p) => p.pointId === null).map((p) => p.reference.canonical), [preparation.passages]);
  const [scripture, setScripture] = useState<{ key: string; text: MaterialScripture | null; error: string | null } | null>(null);
  const wanted = options.includePassage && translation && references.length > 0 ? `${translation.id}|${references.join(",")}` : null;
  useEffect(() => {
    if (!wanted || !translation) return;
    let live = true;
    api.materialScripture({ translationId: translation.id, references }).then(
      (text) => live && setScripture({ key: wanted, text, error: null }),
      (e: unknown) => live && setScripture({ key: wanted, text: null, error: toApiError(e).message }),
    );
    return () => {
      live = false;
    };
  }, [api, wanted, translation, references]);
  const read = scripture && scripture.key === wanted ? scripture : null;
  const doc = useMemo(() => derive(t, kind, preparation, options, read?.text ?? null), [t, kind, preparation, options, read]);
  // Asked-for text not (yet) there: nothing is printed, saved or copied without it, unnoticed.
  const waiting = !!wanted && (!read || !!read.error);
  const blocked = doc.empty || waiting;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Printing shows only the material: a copy of it is put at the top of the page while the
  // system's print dialog is open (where it can also be saved as a PDF), and taken away after.
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("aw-printing");
    const done = () => setPrinting(0);
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
  // A Word document of the very same material (v0.18.8), written by the core.
  const saveDocx = async () => {
    setStatus(null);
    try {
      const path = await api.chooseMaterialFile({
        defaultName: fileName(preparation.title, name, "docx", t("presentation.export.fileFallback")),
        filterName: t("studies.materials.action.docxFilterName"),
        extension: "docx",
      });
      if (!path) return;
      const saved = await api.materialSaveDocx({ path, document: doc, format: docxFormat() });
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
    option === "includePassage"
      ? translation
        ? t("studies.materials.option.includePassage", { bible: translation.shortName })
        : t("studies.materials.option.includePassageNone")
      : option === "includeFrame"
      ? t("studies.materials.option.includeFrame", {
          opening: t(`studies.teaching.shape.${shape ?? "questions"}.introduction`),
          closing: t(`studies.teaching.shape.${shape ?? "questions"}.conclusion`),
        })
      : t(`studies.materials.option.${option}`);
  // The leader's version holds the opening and closing already, and its notes take the place of room to write.
  const offered = OPTIONS[kind].filter(
    (option) => !(options.leader && (option === "includeFrame" || option === "writingSpace")) && !(option === "includePassage" && references.length === 0),
  );

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
        <Button variant="primary" className="min-h-11" onClick={() => setPrinting((n) => n + 1)} disabled={blocked}>
          <Printer className="size-4" aria-hidden="true" />
          {t("studies.materials.action.print")}
        </Button>
        <Button className="min-h-11" onClick={() => void saveMarkdown()} disabled={blocked}>
          <FileText className="size-4" aria-hidden="true" />
          {t("studies.materials.action.markdown")}
        </Button>
        <Button className="min-h-11" onClick={() => void saveDocx()} disabled={blocked}>
          <FileType className="size-4" aria-hidden="true" />
          {t("studies.materials.action.docx")}
        </Button>
        <Button variant="quiet" className="min-h-11" onClick={() => void copy()} disabled={blocked}>
          <Copy className="size-4" aria-hidden="true" />
          {t("studies.materials.action.copy")}
        </Button>
        {offered.length > 0 && (
          <fieldset className="m-0 flex flex-wrap items-center gap-x-4 border-0 p-0 @lg:ml-auto">
            <legend className="type-meta float-left mr-2 p-0">{t("studies.materials.view.options")}</legend>
            {offered.map((option) => (
              <label
                key={option}
                className={`inline-flex min-h-11 items-center gap-2 text-[0.9375rem] ${option === "includePassage" && !translation ? "cursor-default text-text-muted" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  className="size-4"
                  disabled={option === "includePassage" && !translation}
                  checked={!!options[option] && !(option === "includePassage" && !translation)}
                  onChange={(e) => setOptions((o) => ({ ...o, [option]: e.target.checked }))}
                />
                {optionLabel(option)}
              </label>
            ))}
          </fieldset>
        )}
      </div>
      {wanted && !read && <p role="status" className="type-meta m-0">{t("studies.materials.scripture.reading")}</p>}
      {read?.error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{t("studies.materials.scripture.failed", { reason: sentence(read.error) })}</p>}
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
      {printing > 0 && createPortal(<div id="material-print"><MaterialPage doc={doc} /></div>, document.body)}
    </section>
  );
}

/** An error's words as a sentence, so the next one does not run into it. */
const sentence = (text: string) => (/[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/**
 * The Word document's proofing language and paper: the interface language
 * (with the system's region where it is the same language), and US Letter
 * where that is the usual paper.
 */
function docxFormat(): { language: string; paper: "a4" | "letter" } {
  const system = typeof navigator === "undefined" ? "" : navigator.language || "";
  const ui = i18n.language || "en";
  const language = system.toLowerCase().startsWith(ui.toLowerCase()) ? system : ui;
  const region = (system.split("-")[1] ?? "").toUpperCase();
  return { language, paper: ["US", "CA", "MX", "PH", "CL", "CO", "VE", "PR", "GT", "CR", "PA", "DO", "SV", "NI", "HN"].includes(region) ? "letter" : "a4" };
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
    case "scripture":
      // Scripture set apart from the teaching's own words: its label, the verses with their numbers.
      return (
        <blockquote className="aw-material-scripture">
          <p className="aw-material-label">{block.label}</p>
          {block.verses.length > 0 && (
          <p>
            {block.verses.map((v, i) => (
              <span key={i}>
                {v.title && <em className="aw-material-psalm-title">{v.title}</em>}
                <sup className="aw-material-verse">{v.number}</sup>
                {v.text}{" "}
              </span>
            ))}
          </p>
          )}
          {block.note && <p className="aw-material-note">{block.note}</p>}
          {block.attribution && <p className="aw-material-attribution">{block.attribution}</p>}
        </blockquote>
      );
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
