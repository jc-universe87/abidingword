import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronRight } from "lucide-react";
import { Button } from "@/design-system/Button";
import { citationText } from "@/features/library/labels";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { CitedPassage } from "@/types/library";
import type { StudyDetail } from "@/types/domain";
import { FINDING_TYPES, type FindingType, type StudySummary } from "@/types/studies";
import { sectionTitle } from "./builtinText";
import { findingLabel } from "./labels";
import { useStudyFocus } from "./StudyFocus";

/** Something read in a source that the person wants to use in a Study. */
export interface FromSource {
  /** What is cited: selected words, a place, or one of the person's marks. */
  cited: CitedPassage;
  /** The source's words, shown read-only (none for a place). */
  quote: string | null;
  /** What the person wrote already (a note on the words or the place), to start from. */
  note: string;
  /** For the citation line under the quote. */
  title: string;
  author: string | null;
  locator: string | null;
  section: string | null;
}

/** Offered at once, as in a new note; the rest are one step away. */
const COMMON: FindingType[] = ["quotation", "observation", "interpretation", "application", "question"];

/**
 * "Add to Study" (v0.15): a small panel, never a large modal, that turns
 * something read in a source into a finding of a Study, keeping the source's
 * words and where they are as its citation. It defaults to the open Study and
 * the part last worked in (else the Study as a whole), and starts as a
 * quotation when the person has not written anything, an observation when
 * they have; all of it can be changed before adding. Nothing is added until
 * the person says so; Escape or Cancel adds nothing.
 */
export function AddToStudyPanel({
  from,
  onAdded,
  onCancel,
}: {
  from: FromSource;
  /** The finding was added; says where, for a short confirmation. */
  onAdded: (where: { study: string; part: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const focus = useStudyFocus();
  const [studyId, setStudyId] = useState<string | null>(focus.openStudyId);
  const [choosing, setChoosing] = useState(focus.openStudyId === null);
  const [studies, setStudies] = useState<StudySummary[] | null>(null);
  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [sectionId, setSectionId] = useState<string>("");
  const [note, setNote] = useState(from.note);
  const [chosenType, setChosenType] = useState<FindingType | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // Until the person picks a kind: a quotation if they have written nothing, else an observation.
  const type: FindingType = chosenType ?? (note.trim() || from.quote === null ? "observation" : "quotation");
  const kinds = more ? [...FINDING_TYPES] : COMMON.includes(type) ? COMMON : [...COMMON, type];

  // The studies to choose from, when none is open or another is wanted.
  useEffect(() => {
    if (!choosing || studies) return;
    let active = true;
    api.studyList({}).then(
      (all) => {
        if (!active) return;
        const sorted = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setStudies(sorted);
        // The open study, if it is still there; else the most recent one.
        if (sorted[0] && !sorted.some((s) => s.id === studyId)) setStudyId(sorted[0].id);
      },
      (e) => active && setError(toApiError(e).message),
    );
    return () => {
      active = false;
    };
  }, [api, choosing, studies, studyId]);

  // The chosen study's parts; the part last worked in, if it is one of them.
  useEffect(() => {
    if (!studyId) return;
    let active = true;
    api.studyGet(studyId).then(
      (loaded) => {
        if (!active) return;
        setError(null);
        setDetail(loaded);
        const last = studyId === focus.openStudyId ? focus.activeSectionId : null;
        setSectionId(last && loaded.sections.some((s) => s.id === last) ? last : "");
      },
      (e) => active && setError(toApiError(e).message),
    );
    return () => {
      active = false;
    };
    // The defaults are taken once per study chosen, not again while the panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, studyId]);

  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);

  // The study shown is the one chosen (not one still loading in its place).
  const ready = detail !== null && detail.study.id === studyId;
  const save = async () => {
    if (!detail || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.findingCreateFromSource({
        ...from.cited,
        studyId: detail.study.id,
        findingType: type,
        content: note.trim(),
        sectionId: sectionId || undefined,
      });
      focus.findingsChanged(detail.study.id);
      const part = detail.sections.find((s) => s.id === sectionId);
      onAdded({ study: detail.study.title, part: part ? sectionTitle(part) : t("studies.findings.wholeStudy") });
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  // Arrow keys move through the kinds, as in a new note.
  const arrows = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = kinds[(kinds.indexOf(type) + step + kinds.length) % kinds.length]!;
    setChosenType(next);
    requestAnimationFrame(() => document.getElementById(`${id}-kind-${next}`)?.focus());
  };

  // The kind of note is an option among several: the shared choice chip (v0.18.5).
  const pill = "aw-choice min-h-11 px-4";
  const select = "h-11 min-w-0 max-w-full aw-input px-2";
  const citation = citationText(t, from);
  const noStudies = studies !== null && studies.length === 0;
  const heading = detail && !choosing ? t("studies.fromSource.title", { study: detail.study.title }) : t("studies.fromSource.label");

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-aw-skip=""
      onKeyDown={keys}
      className="@container flex select-none flex-col gap-3 rounded-aw border border-t-[4px] border-border border-t-accent bg-bg-secondary px-4 py-3.5 font-ui text-[0.9375rem] shadow-[0_-6px_20px_rgba(0,0,0,0.22)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="type-group m-0">
          {heading}
        </h3>
        {!choosing && (
          <button type="button" onClick={() => setChoosing(true)} className="min-h-11 rounded-aw px-2 text-text-muted underline-offset-2 hover:text-text-strong hover:underline">
            {t("studies.fromSource.otherStudy")}
          </button>
        )}
      </div>

      {from.quote !== null && (
        <figure className="m-0 flex flex-col gap-1">
          <blockquote className="reading m-0 line-clamp-4 whitespace-pre-line break-words border-l-[3px] border-accent bg-bg px-3 py-1.5 text-[1.0625rem] text-text-strong">
            {from.quote}
          </blockquote>
          {citation && (
            <figcaption className="flex items-center gap-1 type-meta">
              <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />— {citation}
            </figcaption>
          )}
        </figure>
      )}
      {from.quote === null && citation && (
        <p className="m-0 flex items-center gap-1 type-meta">
          <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
          {citation}
        </p>
      )}

      {choosing && (
        <div className="flex flex-col gap-1">
          {studies === null && !error && <p className="m-0 text-text-muted">{t("studies.fromSource.loading")}</p>}
          {noStudies && <p className="m-0 text-text-strong">{t("studies.fromSource.noStudies")}</p>}
          {studies && studies.length > 0 && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted">{t("studies.fromSource.chooseStudy")}</span>
              <select value={studyId ?? ""} onChange={(e) => setStudyId(e.target.value)} className={select}>
                {studies.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {!noStudies && (
        <>
          <label className="flex flex-col gap-1">
            <span className="type-meta font-medium !text-text-strong">{t("studies.fromSource.yourNote")}</span>
            <textarea
              ref={field}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={from.quote === null ? t("studies.fromSource.placeholderRequired") : t("studies.fromSource.placeholder")}
              className="reading select-text rounded-aw border-2 border-border bg-bg px-3 py-2 text-[1rem] placeholder:text-text-muted"
            />
          </label>

          <div role="radiogroup" aria-label={t("studies.findings.kindGroup")} className="flex flex-wrap items-center gap-2" onKeyDown={arrows}>
            {kinds.map((option) => (
              <button
                key={option}
                id={`${id}-kind-${option}`}
                type="button"
                role="radio"
                aria-checked={type === option}
                tabIndex={type === option ? 0 : -1}
                onClick={() => setChosenType(option)}
                className={pill}
              >
                {findingLabel(t, option)}
              </button>
            ))}
            {!more && kinds.length < FINDING_TYPES.length && (
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore(true)}
                className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-text-muted hover:text-text-strong"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
                {t("studies.findings.moreTypes")}
              </button>
            )}
          </div>

          {ready && detail.sections.length > 0 && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted">{t("studies.findings.in")}</span>
              <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={select}>
                <option value="">{t("studies.findings.wholeStudy")}</option>
                {detail.sections.map((s) => (
                  <option key={s.id} value={s.id}>{sectionTitle(s)}</option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!noStudies && (
          <Button variant="primary" className="min-h-11" disabled={busy || !ready || (from.quote === null && !note.trim())} onClick={() => void save()}>
            {t("studies.fromSource.save")}
          </Button>
        )}
        <Button className="min-h-11" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        {!noStudies && <span className="type-meta">{t("studies.findings.saveHint")}</span>}
      </div>
    </section>
  );
}
