import { forwardRef, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { readLocal, writeLocal } from "@/lib/storage";
import type { StudySection } from "@/types/domain";
import { FINDING_TYPES, type Finding, type FindingType } from "@/types/studies";
import { sectionTitle } from "./builtinText";
import { FindingNote } from "./FindingNote";
import { findingInline, findingLabel, findingPlural } from "./labels";

/** Enough findings to be worth narrowing down; fewer need no filter. */
export const FILTER_MIN = 6;

/** A finding that belongs to no section (or to one that is gone): it lives in the study's own notes. */
export function isStudyNote(finding: Finding, sections: StudySection[]): boolean {
  return !finding.sectionId || !sections.some((s) => s.id === finding.sectionId);
}

interface FindingListProps {
  /** Accessible name of the list. */
  label: string;
  /** The findings to show, in the study's order. */
  findings: Finding[];
  /** Every finding of the study, in order. */
  all: Finding[];
  sections: StudySection[];
  /** Reordering is only offered while nothing is filtered out. */
  canMove: boolean;
  onChanged: () => void;
  onRevealScripture: () => void;
}

/** A run of findings as notes in the flow: the study's own, or those of one section. Order is the study's order. */
export function FindingList({ label, findings, all, sections, canMove, onChanged, onRevealScripture }: FindingListProps) {
  if (findings.length === 0) return null;
  const order = all.map((f) => f.id);
  const group = findings.map((f) => f.id);
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col gap-5 p-0">
      {findings.map((finding) => (
        <FindingNote
          key={finding.id}
          finding={finding}
          sections={sections}
          order={order}
          group={group}
          canMove={canMove}
          onChanged={onChanged}
          onRevealScripture={onRevealScripture}
        />
      ))}
    </ol>
  );
}

interface FindingsPanelProps {
  studyId: string;
  /** Every note of the study. */
  findings: Finding[];
  sections: StudySection[];
  /** The kind the notes are narrowed to (everywhere in the study), or null. */
  filter: FindingType | null;
  /** The kind of a note being written here (study-wide, in no part), or null when none is. */
  capturing: FindingType | null;
  onCaptureClose: () => void;
  onChanged: () => void;
  onRevealScripture: () => void;
}

/**
 * The study's other notes: those in no part (or in a part that is gone),
 * after the parts. Nothing at all until there is one, or one is being
 * written. Notes of a part are shown in that part (see `SectionEditor`).
 */
export function FindingsPanel({ studyId, findings, sections, filter, capturing, onCaptureClose, onChanged, onRevealScripture }: FindingsPanelProps) {
  const { t } = useTranslation();
  const id = useId();
  const captureRef = useRef<HTMLTextAreaElement>(null);

  // Writing starts where the user can type.
  useEffect(() => {
    if (capturing) captureRef.current?.focus();
  }, [capturing]);

  const own = findings.filter((f) => isStudyNote(f, sections));
  const shown = filter ? own.filter((f) => f.findingType === filter) : own;

  if (shown.length === 0 && !capturing) return null;

  return (
    <section id="study-findings" aria-labelledby={`${id}-title`} className="scroll-mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h2 id={`${id}-title`} className="type-section m-0">
        {t("studies.findings.heading")}
      </h2>

      {capturing && (
        <QuickCapture
          ref={captureRef}
          place=""
          studyId={studyId}
          sections={sections}
          initialType={capturing}
          onDone={() => {
            onCaptureClose();
            onChanged();
          }}
          onCancel={onCaptureClose}
        />
      )}

      <FindingList
        label={t("studies.findings.listLabel")}
        findings={shown}
        all={findings}
        sections={sections}
        canMove={filter === null}
        onChanged={onChanged}
        onRevealScripture={onRevealScripture}
      />
    </section>
  );
}

/** Narrows the notes shown, everywhere in the study, to one kind; only worth having with many notes. */
export function KindFilter({ findings, filter, onFilter }: { findings: Finding[]; filter: FindingType | null; onFilter: (type: FindingType | null) => void }) {
  const { t } = useTranslation();
  if (findings.length < FILTER_MIN) return null;
  const counts = new Map<FindingType, number>();
  for (const f of findings) counts.set(f.findingType, (counts.get(f.findingType) ?? 0) + 1);
  return (
    <label className="flex items-center gap-2">
      <span>{t("studies.findings.filterGroup")}</span>
      <select
        value={filter && counts.has(filter) ? filter : ""}
        onChange={(e) => onFilter((e.target.value || null) as FindingType | null)}
        className="h-11 max-w-full aw-input px-2 text-text-strong"
      >
        <option value="">{t("studies.findings.all", { count: findings.length })}</option>
        {FINDING_TYPES.filter((type) => counts.has(type)).map((type) => (
          <option key={type} value={type}>
            {t("studies.findings.filterType", { type: findingPlural(t, type), count: counts.get(type) })}
          </option>
        ))}
      </select>
    </label>
  );
}

interface QuickCaptureProps {
  studyId: string;
  sections: StudySection[];
  /** The kind chosen from Add; else the kind last used in this study. */
  initialType?: FindingType;
  /** The part the note goes in, when it was added there (no choice of place is offered then). */
  sectionId?: string;
  /** Where it is open (a part's id, or "" for the other notes), so the study can find it again. */
  place?: string;
  /** Put the cursor in it when it opens (once). */
  autoFocus?: boolean;
  onDone: () => void;
  onCancel: () => void;
}

/** What a note is until the user says otherwise (or has said otherwise before, in this study). */
const DEFAULT_TYPE: FindingType = "observation";

/** Offered at once; the rest are one step away under "More types". */
const COMMON_TYPES: FindingType[] = ["observation", "interpretation", "application", "question"];

const lastTypeKey = (studyId: string) => `study.lastFindingType.${studyId}`;

/** The kind last used in this study, if it is still a kind (a per-device convenience, never study data). */
function lastType(studyId: string): FindingType {
  const stored = readLocal<string | null>(lastTypeKey(studyId), null);
  return FINDING_TYPES.find((type) => type === stored) ?? DEFAULT_TYPE;
}

/**
 * Write first, classify second: the text comes first; the kind is a row of
 * four common choices (the rest under "More types"), remembered per study; where
 * it belongs and linking the passage being read are under "Options".
 */
export const QuickCapture = forwardRef<HTMLTextAreaElement, QuickCaptureProps>(function QuickCapture({ studyId, sections, initialType, sectionId: fixedSection, place, autoFocus, onDone, onCancel }, ref) {
  const { t } = useTranslation();
  const api = useApi();
  const { currentPassage } = useScripture();
  const id = useId();
  const [type, setType] = useState<FindingType>(() => initialType ?? lastType(studyId));
  const [more, setMore] = useState(false);
  const [options, setOptions] = useState(false);
  const [text, setText] = useState("");
  const [sectionId, setSectionId] = useState(fixedSection ?? "");
  const [linkPassage, setLinkPassage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A kind outside the common four, chosen now or remembered, stays on show.
  const kinds = more ? [...FINDING_TYPES] : COMMON_TYPES.includes(type) ? COMMON_TYPES : [...COMMON_TYPES, type];
  const choosePlace = fixedSection === undefined && sections.length > 0;
  const hasOptions = choosePlace || currentPassage !== null;

  const save = async () => {
    if (!text.trim()) {
      setError(t("studies.findings.writeFirst"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.findingCreate({
        studyId,
        findingType: type,
        content: text.trim(),
        sectionId: sectionId || undefined,
        passage: linkPassage && currentPassage ? currentPassage.canonical : undefined,
      });
      writeLocal(lastTypeKey(studyId), type);
      setText("");
      setLinkPassage(false);
      onDone();
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
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      if (options) {
        setOptions(false);
      } else {
        onCancel();
      }
    }
  };

  // Arrow keys move through the kinds, as in any radio group.
  const arrows = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = kinds[(kinds.indexOf(type) + step + kinds.length) % kinds.length]!;
    setType(next);
    requestAnimationFrame(() => document.getElementById(`${id}-kind-${next}`)?.focus());
  };

  // The kind of note is an option among several: the shared choice chip (v0.18.5).
  const pill = "aw-choice min-h-11 px-4";
  const field = "h-11 min-w-0 max-w-full aw-input px-2";

  return (
    <div role="group" aria-label={t("studies.findings.addGroup")} className="@container flex flex-col gap-3 border-l-[3px] border-accent bg-bg-secondary px-4 py-3" onKeyDown={keys}>
      <label htmlFor={`${id}-text`} className="sr-only">{t("studies.findings.newLabel", { type: findingInline(t, type) })}</label>
      <textarea
        id={`${id}-text`}
        ref={ref}
        data-capture={place}
        autoFocus={autoFocus}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("studies.findings.writePlaceholder")}
        className="aw-writing"
      />
      <div role="radiogroup" aria-label={t("studies.findings.kindGroup")} className="flex flex-wrap items-center gap-2" onKeyDown={arrows}>
        {kinds.map((option) => (
          <button
            key={option}
            id={`${id}-kind-${option}`}
            type="button"
            role="radio"
            aria-checked={type === option}
            tabIndex={type === option ? 0 : -1}
            onClick={() => setType(option)}
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
            className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:text-text-strong"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
            {t("studies.findings.moreTypes")}
          </button>
        )}
      </div>
      {hasOptions && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={options}
            aria-controls={`${id}-options`}
            onClick={() => setOptions(!options)}
            className="inline-flex min-h-11 items-center gap-1 self-start rounded-aw px-2 text-[0.9375rem] text-text-muted hover:text-text-strong"
          >
            {options ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
            {t("studies.findings.options")}
          </button>
          {options && (
            <div id={`${id}-options`} className="flex flex-col gap-2 text-[0.9375rem] @md:flex-row @md:flex-wrap @md:items-center @md:gap-4">
              {choosePlace && (
                <label className="flex items-center gap-2">
                  <span className="text-text-muted">{t("studies.findings.in")}</span>
                  <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={field}>
                    <option value="">{t("studies.findings.wholeStudy")}</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>{sectionTitle(s)}</option>
                    ))}
                  </select>
                </label>
              )}
              {currentPassage && (
                <label className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={linkPassage} onChange={(e) => setLinkPassage(e.target.checked)} className="size-5 accent-[var(--aw-primary)]" />
                  {t("studies.findings.linkCurrent", { passage: referenceLabel(currentPassage) })}
                </label>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" className="min-h-11" onClick={save} disabled={busy}>{t("studies.findings.save")}</Button>
        <Button className="min-h-11" onClick={onCancel}>{t("common.cancel")}</Button>
        <span className="text-[0.9375rem] text-text-muted">{t("studies.findings.saveHint")}</span>
      </div>
    </div>
  );
});

