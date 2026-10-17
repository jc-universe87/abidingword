import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, Check, CircleX } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Dialog } from "@/design-system/Dialog";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { formatNumber } from "@/i18n/format";
import { localizeMessage } from "@/i18n/messages";
import { bookName } from "@/i18n/scripture";
import type { BibleTranslation, BundledBibleInfo, ImportIssue, ImportPreview } from "@/types/scripture";
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
          <h1 id="add-bible-title" ref={heading} tabIndex={-1} className="m-0 font-display text-[1.875rem] font-heading text-text-strong">
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
              <Trans
                i18nKey="scripture.addBible.done"
                count={step.bible.bookCount}
                values={{ name: step.bible.name, verses: formatNumber(step.bible.verseCount) }}
                components={{ strong: <strong /> }}
              />
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
          <h2 className="m-0 text-[1.125rem] font-semibold text-text-strong">{t("scripture.addBible.included")}</h2>
          <label htmlFor={selectId} className="font-medium">
            {t("scripture.addBible.chooseLabel")}
          </label>
          <div className="flex w-full flex-wrap items-center gap-2">
            <select
              id={selectId}
              value={chosen.id}
              onChange={(e) => setChosenId(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-aw border border-border bg-bg px-3"
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
        <h2 className="m-0 text-[1.125rem] font-semibold text-text-strong">{t("scripture.addBible.ownTitle")}</h2>
        <p className="m-0 text-text-muted">
          {t("scripture.addBible.ownBody")}
        </p>
        <Button onClick={onFiles}>{t("scripture.addBible.chooseFiles")}</Button>
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
  const { t } = useTranslation();
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
        <Field id={`${id}-name`} label={t("scripture.addBible.field.name")} value={name} onChange={setName} />
        <Field id={`${id}-short`} label={t("scripture.addBible.field.shortName")} value={shortName} onChange={setShortName} hint={t("scripture.addBible.field.shortNameHint")} />
        <Field id={`${id}-lang`} label={t("scripture.addBible.field.language")} value={language} onChange={setLanguage} />
      </div>

      <section aria-label={t("scripture.addBible.found")} className="flex flex-col gap-1">
        <p className="reading m-0">{t("scripture.addBible.booksDetected", { count: preview.bookCount })}</p>
        <p className="reading m-0">{t("scripture.addBible.chaptersDetected", { count: preview.chapterCount, number: formatNumber(preview.chapterCount) })}</p>
        <p className="reading m-0">{t("scripture.addBible.versesDetected", { count: preview.verseCount, number: formatNumber(preview.verseCount) })}</p>
        {s.licenseType && <p className="m-0 mt-2 text-[0.9375rem] text-text-muted">{t("scripture.addBible.licence", { licence: s.licenseType })}</p>}
      </section>

      <ul aria-label={t("scripture.addBible.books")} className="m-0 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2">
        {preview.books.map((book) => (
          <li key={book.code} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5">
            <span>{bookName(book.code, book.name)}</span>
            <BookStatus status={book.status} />
          </li>
        ))}
      </ul>

      {errors.length > 0 && (
        <IssueGroup title={t("scripture.addBible.problems", { count: errors.length })} issues={errors} open />
      )}
      {warnings.length > 0 && <IssueGroup title={t("scripture.addBible.warnings", { count: warnings.length })} issues={warnings} />}
      {notes.length > 0 && <IssueGroup title={t("scripture.addBible.notes", { count: notes.length })} issues={notes} />}
      {preview.skippedFiles.length > 0 && (
        <p className="m-0 text-[0.9375rem] text-text-muted">
          {t("scripture.addBible.skipped", { count: preview.skippedFiles.length })}
        </p>
      )}

      <div className="flex flex-wrap gap-3 border-t border-border-subtle pt-6">
        <Button variant="primary" onClick={add} disabled={!preview.canImport || !complete || busy}>
          {busy ? t("scripture.addBible.adding") : t("scripture.addBible.add")}
        </Button>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
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
  const { t } = useTranslation();
  const map: Record<typeof status, [ReactNode, string]> = {
    ok: [<Check key="i" className="size-4 text-text-strong" aria-hidden="true" />, t("scripture.addBible.bookStatus.ok")],
    warning: [<AlertTriangle key="i" className="size-4 text-accent" aria-hidden="true" />, t("scripture.addBible.bookStatus.warning")],
    error: [<CircleX key="i" className="size-4 text-danger" aria-hidden="true" />, t("scripture.addBible.bookStatus.error")],
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
          <li key={index}>{localizeMessage(issue.code, issue.params, issue.message)}</li>
        ))}
      </ul>
    </details>
  );
}
