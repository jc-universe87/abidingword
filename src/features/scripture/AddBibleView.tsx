import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Check, CircleX } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { BibleTranslation, ImportIssue, ImportPreview } from "@/types/scripture";
import { useScripture } from "./ScriptureContext";

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

  const title = { choose: "Add a Bible", checking: "Checking the Bible…", review: "New Bible", done: "Bible added" }[step.kind];

  return (
    <main aria-labelledby="add-bible-title" className="min-h-0 flex-1 overflow-y-auto bg-bg" onKeyDown={(e) => e.key === "Escape" && step.kind !== "checking" && cancel()}>
      <div className="mx-auto flex max-w-[46rem] flex-col gap-8 px-8 pb-24 pt-8">
        <div className="flex flex-col items-start gap-4">
          <Button variant="quiet" onClick={cancel} disabled={step.kind === "checking"}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {step.kind === "done" ? "Back" : "Cancel"}
          </Button>
          <h1 id="add-bible-title" ref={heading} tabIndex={-1} className="m-0 font-display text-[1.875rem] font-heading text-text-strong">
            {title}
          </h1>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {step.kind === "choose" && <ChooseStep onBundled={(id) => preview({ bundled: id })} onFiles={chooseFiles} />}
        {step.kind === "checking" && (
          <p role="status" className="m-0 text-text-muted">
            Reading and checking every book, chapter and verse. This can take a few seconds.
          </p>
        )}
        {step.kind === "review" && (
          <ReviewStep
            preview={step.preview}
            onCancel={cancel}
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
              <strong>{step.bible.name}</strong> is ready to read, with {step.bible.bookCount} books and{" "}
              {step.bible.verseCount.toLocaleString()} verses.
            </p>
            <Button
              variant="primary"
              onClick={() => {
                setTranslation(step.bible.id);
                onClose();
              }}
            >
              Read it now
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

function ChooseStep({ onBundled, onFiles }: { onBundled: (id: string) => void; onFiles: () => void }) {
  const api = useApi();
  const bundled = useLoad(useCallback(() => api.bibleBundledList(), [api]));
  const available = (bundled.data ?? []).filter((b) => !b.installed);
  return (
    <div className="flex flex-col gap-8">
      {available.map((bible) => (
        <section key={bible.id} className="flex flex-col items-start gap-2 border-t border-border-subtle pt-6">
          <h2 className="m-0 text-[1.125rem] font-semibold text-text-strong">Included with Abiding Word</h2>
          <p className="m-0">
            <strong>{bible.name}</strong> ({bible.shortName}) · {bible.language} · {bible.licenseType}
          </p>
          <Button variant="primary" onClick={() => onBundled(bible.id)}>
            Add {bible.name}
          </Button>
        </section>
      ))}
      <section className="flex flex-col items-start gap-2 border-t border-border-subtle pt-6">
        <h2 className="m-0 text-[1.125rem] font-semibold text-text-strong">A Bible you own</h2>
        <p className="m-0 text-text-muted">
          Choose a Bible in USFM format: a .zip download, or its .usfm files. Abiding Word keeps its own copy
          and never changes your file.
        </p>
        <Button onClick={onFiles}>Choose Bible files…</Button>
      </section>
    </div>
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
}

function ReviewStep({ preview, onCancel, onAdd }: { preview: ImportPreview; onCancel: () => void; onAdd: (d: Details) => Promise<void> }) {
  const id = useId();
  const s = preview.suggested;
  const [name, setName] = useState(s.name);
  const [shortName, setShortName] = useState(s.shortName);
  const [language, setLanguage] = useState(s.language);
  const [busy, setBusy] = useState(false);
  const errors = preview.issues.filter((i) => i.severity === "error");
  const warnings = preview.issues.filter((i) => i.severity === "warning");
  const notes = preview.issues.filter((i) => i.severity === "note");
  const complete = name.trim() && shortName.trim() && language.trim();

  const add = async () => {
    setBusy(true);
    await onAdd({
      name,
      shortName,
      language,
      languageCode: s.languageCode || undefined,
      publisher: s.publisher ?? undefined,
      copyrightNotice: s.copyrightNotice ?? undefined,
      licenseType: s.licenseType ?? undefined,
    });
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_10rem]">
        <Field id={`${id}-name`} label="Name" value={name} onChange={setName} />
        <Field id={`${id}-short`} label="Short name" value={shortName} onChange={setShortName} hint="e.g. WEB" />
        <Field id={`${id}-lang`} label="Language" value={language} onChange={setLanguage} />
      </div>

      <section aria-label="What was found" className="flex flex-col gap-1">
        <p className="reading m-0">{preview.bookCount} books detected</p>
        <p className="reading m-0">{preview.chapterCount.toLocaleString()} chapters detected</p>
        <p className="reading m-0">{preview.verseCount.toLocaleString()} verses detected</p>
        {s.licenseType && <p className="m-0 mt-2 text-[0.9375rem] text-text-muted">Licence: {s.licenseType}</p>}
      </section>

      <ul aria-label="Books" className="m-0 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2">
        {preview.books.map((book) => (
          <li key={book.code} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5">
            <span>{book.name}</span>
            <BookStatus status={book.status} />
          </li>
        ))}
      </ul>

      {errors.length > 0 && (
        <IssueGroup title={`${errors.length} problem${errors.length === 1 ? "" : "s"} must be fixed before this Bible can be added`} issues={errors} open />
      )}
      {warnings.length > 0 && <IssueGroup title={`${warnings.length} warning${warnings.length === 1 ? "" : "s"} — worth reviewing`} issues={warnings} />}
      {notes.length > 0 && <IssueGroup title={`${notes.length} note${notes.length === 1 ? "" : "s"}`} issues={notes} />}
      {preview.skippedFiles.length > 0 && (
        <p className="m-0 text-[0.9375rem] text-text-muted">
          {preview.skippedFiles.length} file{preview.skippedFiles.length === 1 ? " was" : "s were"} left out because{" "}
          {preview.skippedFiles.length === 1 ? "it is" : "they are"} not one of the 66 books (for example an introduction or glossary).
        </p>
      )}

      <div className="flex flex-wrap gap-3 border-t border-border-subtle pt-6">
        <Button variant="primary" onClick={add} disabled={!preview.canImport || !complete || busy}>
          {busy ? "Adding…" : "Add this Bible"}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Field(props: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label htmlFor={props.id} className="flex flex-col gap-1">
      <span className="text-[0.9375rem] font-medium text-text-strong">{props.label}</span>
      <input
        id={props.id}
        value={props.value}
        placeholder={props.hint}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-10 rounded-aw border border-border bg-bg px-3 text-base placeholder:text-text-muted"
      />
    </label>
  );
}

function BookStatus({ status }: { status: "ok" | "warning" | "error" }) {
  const map: Record<typeof status, [ReactNode, string]> = {
    ok: [<Check key="i" className="size-4 text-text-strong" aria-hidden="true" />, "Looks good"],
    warning: [<AlertTriangle key="i" className="size-4 text-accent" aria-hidden="true" />, "Worth reviewing"],
    error: [<CircleX key="i" className="size-4 text-danger" aria-hidden="true" />, "Problem"],
  };
  const [icon, label] = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.875rem] text-text-muted" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function IssueGroup({ title, issues, open }: { title: string; issues: ImportIssue[]; open?: boolean }) {
  return (
    <details open={open} className="border-l-[3px] border-border pl-4">
      <summary className="cursor-pointer font-semibold text-text-strong">{title}</summary>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[0.9375rem]">
        {issues.map((issue, index) => (
          <li key={index}>{issue.message}</li>
        ))}
      </ul>
    </details>
  );
}
