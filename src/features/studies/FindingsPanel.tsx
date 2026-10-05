import { forwardRef, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Trash2, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { FindingSources } from "@/features/library/FindingSources";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useAutosave } from "@/hooks/useAutosave";
import { readLocal, writeLocal } from "@/lib/storage";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudySection } from "@/types/domain";
import { FINDING_TYPES, type Finding, type FindingType } from "@/types/studies";
import { sectionTitle } from "./builtinText";
import { findingInline, findingLabel, findingPlural } from "./labels";

/** Enough findings to be worth narrowing down; fewer need no filter. */
const FILTER_MIN = 6;

interface FindingsPanelProps {
  studyId: string;
  findings: Finding[];
  sections: StudySection[];
  /** Whether the "add a note" form is open (opened from the study's one Add action). */
  capturing: boolean;
  onCaptureClose: () => void;
  onChanged: () => void;
  onRevealScripture: () => void;
}

/**
 * The study's findings, as notes in the flow of the study: nothing at all
 * until there is one or the user is writing one, then the notes themselves.
 * Adding is the study's one Add action; kind, section, links and the rest
 * are in each note's Details.
 */
export function FindingsPanel({ studyId, findings, sections, capturing, onCaptureClose, onChanged, onRevealScripture }: FindingsPanelProps) {
  const { t } = useTranslation();
  const id = useId();
  const [filter, setFilter] = useState<FindingType | null>(null);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  // Writing starts where the user can type.
  useEffect(() => {
    if (capturing) captureRef.current?.focus();
  }, [capturing]);

  const counts = new Map<FindingType, number>();
  for (const f of findings) counts.set(f.findingType, (counts.get(f.findingType) ?? 0) + 1);
  const active = filter && counts.has(filter) ? filter : null;
  const shown = active ? findings.filter((f) => f.findingType === active) : findings;

  if (findings.length === 0 && !capturing) return null;

  return (
    <section
      id="study-findings"
      aria-labelledby={findings.length > 0 ? `${id}-title` : undefined}
      aria-label={findings.length === 0 ? t("studies.findings.heading") : undefined}
      className="scroll-mt-4 flex flex-col gap-4 border-t border-border-subtle pt-6"
    >
      {findings.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 id={`${id}-title`} className="m-0 font-display text-[1.375rem] font-heading text-text-strong">
            {t("studies.findings.heading")}
          </h2>
          {findings.length >= FILTER_MIN && (
            <label className="flex items-center gap-2 text-[0.9375rem] text-text-muted">
              <span>{t("studies.findings.filterGroup")}</span>
              <select
                value={active ?? ""}
                onChange={(e) => setFilter((e.target.value || null) as FindingType | null)}
                className="h-9 max-w-full rounded-aw border border-border bg-bg px-2 text-text-strong"
              >
                <option value="">{t("studies.findings.all", { count: findings.length })}</option>
                {FINDING_TYPES.filter((type) => counts.has(type)).map((type) => (
                  <option key={type} value={type}>
                    {t("studies.findings.filterType", { type: findingPlural(t, type), count: counts.get(type) })}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {capturing && (
        <QuickCapture
          ref={captureRef}
          studyId={studyId}
          sections={sections}
          onDone={() => {
            onCaptureClose();
            onChanged();
          }}
          onCancel={onCaptureClose}
        />
      )}

      {findings.length > 0 && (
        <ol aria-label={t("studies.findings.listLabel")} className="m-0 flex list-none flex-col gap-5 p-0">
          {shown.map((finding) => (
            <FindingItem
              key={finding.id}
              finding={finding}
              sections={sections}
              order={findings.map((f) => f.id)}
              canMove={active === null}
              onChanged={onChanged}
              onRevealScripture={onRevealScripture}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

interface QuickCaptureProps {
  studyId: string;
  sections: StudySection[];
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
const QuickCapture = forwardRef<HTMLTextAreaElement, QuickCaptureProps>(function QuickCapture({ studyId, sections, onDone, onCancel }, ref) {
  const { t } = useTranslation();
  const api = useApi();
  const { currentPassage } = useScripture();
  const id = useId();
  const [type, setType] = useState<FindingType>(() => lastType(studyId));
  const [more, setMore] = useState(false);
  const [options, setOptions] = useState(false);
  const [text, setText] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [linkPassage, setLinkPassage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A kind outside the common four, chosen now or remembered, stays on show.
  const kinds = more ? [...FINDING_TYPES] : COMMON_TYPES.includes(type) ? COMMON_TYPES : [...COMMON_TYPES, type];
  const hasOptions = sections.length > 0 || currentPassage !== null;

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

  const pill =
    "min-h-11 rounded-full border border-border px-4 font-ui text-[0.9375rem] text-text-strong hover:bg-bg " +
    "aria-checked:border-primary aria-checked:bg-primary aria-checked:text-on-primary";
  const field = "h-11 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2";

  return (
    <div role="group" aria-label={t("studies.findings.addGroup")} className="@container flex flex-col gap-3 border-l-[3px] border-accent bg-bg-secondary px-4 py-3" onKeyDown={keys}>
      <label htmlFor={`${id}-text`} className="sr-only">{t("studies.findings.newLabel", { type: findingInline(t, type) })}</label>
      <textarea
        id={`${id}-text`}
        ref={ref}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("studies.findings.writePlaceholder")}
        className="reading rounded-aw border border-border bg-bg px-3 py-2 text-[1rem] placeholder:text-text-muted"
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
              {sections.length > 0 && (
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

interface FindingItemProps {
  finding: Finding;
  sections: StudySection[];
  order: string[];
  canMove: boolean;
  onChanged: () => void;
  onRevealScripture: () => void;
}

function FindingItem({ finding, sections, order, canMove, onChanged, onRevealScripture }: FindingItemProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { goTo, currentPassage } = useScripture();
  const detailsId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(finding.content);
  const [tags, setTags] = useState(finding.tags.join(", "));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = findingLabel(t, finding.findingType);
  const type = findingInline(t, finding.findingType);

  const save = useCallback((content: string) => api.findingUpdate({ id: finding.id, content }), [api, finding.id]);
  const { schedule, flush } = useAutosave(save);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const move = (delta: -1 | 1) => {
    const index = order.indexOf(finding.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    const ids = [...order];
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    void act(() => api.findingReorder({ parentId: finding.studyId, ids }));
  };
  const position = order.indexOf(finding.id);
  const linked = currentPassage && finding.passages.some((p) => p.reference.canonical === currentPassage.canonical);
  const section = sections.find((s) => s.id === finding.sectionId);
  const excerpt = finding.content.slice(0, 60);

  const field = "h-9 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2";
  const quiet = "inline-flex min-h-9 items-center rounded-aw px-2 text-text-muted hover:bg-bg-secondary hover:text-text-strong disabled:opacity-40";

  return (
    <li>
      <article
        aria-label={t("studies.findings.itemLabel", { type: label, excerpt })}
        className="flex flex-col gap-1 border-l-[3px] border-border py-1 pl-4"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
            toggle.current?.focus();
          }
        }}
      >
        <p className="m-0 text-[0.875rem] font-medium text-text-muted">
          {label}
          {section && <span className="font-normal">{t("common.listSeparator")}{sectionTitle(section)}</span>}
        </p>

        <textarea
          aria-label={t("studies.findings.text", { type: label })}
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            schedule(e.target.value);
          }}
          onBlur={flush}
          className="reading w-full resize-y rounded-aw border border-transparent bg-transparent px-2 py-1 -mx-2 text-[1rem] hover:border-border-subtle focus:border-border"
        />

        {(finding.passages.length > 0 || finding.sources.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-[0.875rem]">
            {finding.passages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  goTo(p.reference);
                  onRevealScripture();
                }}
                className="min-h-8 rounded-aw border border-border px-2 font-medium text-link hover:bg-bg-secondary"
              >
                {referenceLabel(p.reference)}
              </button>
            ))}
          </div>
        )}
        <FindingSources
          finding={finding}
          canAdd={open}
          onChanged={onChanged}
          onQuote={
            finding.findingType === "quotation"
              ? (quotation) => {
                  setText(quotation);
                  schedule(quotation);
                }
              : undefined
          }
        />

        <div>
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={t("studies.findings.detailsFor", { type, excerpt })}
            onClick={() => setOpen(!open)}
            className={`${quiet} -ml-2 gap-1 text-[0.875rem]`}
          >
            {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
            {t("studies.findings.details")}
          </button>
        </div>

        {open && (
          <div id={detailsId} className="flex flex-col gap-3 rounded-aw border border-border-subtle bg-bg-secondary px-3 py-3 text-[0.9375rem]">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <label className="flex items-center gap-2">
                <span className="text-text-muted">{t("studies.findings.typeLabel")}</span>
                <select
                  value={finding.findingType}
                  onChange={(e) => act(() => api.findingUpdate({ id: finding.id, findingType: e.target.value as FindingType }))}
                  className={field}
                >
                  {FINDING_TYPES.map((option) => (
                    <option key={option} value={option}>{findingLabel(t, option)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-text-muted">{t("studies.findings.section")}</span>
                <select
                  value={finding.sectionId ?? ""}
                  onChange={(e) => act(() => api.findingUpdate({ id: finding.id, sectionId: e.target.value }))}
                  className={field}
                >
                  <option value="">{t("studies.findings.wholeStudy")}</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{sectionTitle(s)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-text-muted">{t("studies.findings.tags")}</span>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  onBlur={() => {
                    const next = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
                    if (next.join(",") !== finding.tags.join(",")) void act(() => api.findingSetTags({ findingId: finding.id, tags: next }));
                  }}
                  placeholder={t("studies.findings.tagsPlaceholder")}
                  className={`${field} w-44`}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {finding.passages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => act(() => api.findingUnlinkPassage(p.id))}
                  aria-label={t("studies.findings.unlink", { passage: referenceLabel(p.reference) })}
                  className="inline-flex min-h-8 items-center gap-1 rounded-aw border border-border px-2 text-text-muted hover:bg-bg"
                >
                  {referenceLabel(p.reference)}
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ))}
              {currentPassage && !linked && (
                <button
                  type="button"
                  onClick={() => act(() => api.findingLinkPassage({ findingId: finding.id, reference: currentPassage.canonical }))}
                  className="min-h-8 rounded-aw px-2 text-text-muted underline-offset-2 hover:text-text-strong hover:underline"
                >
                  {t("studies.findings.link", { passage: referenceLabel(currentPassage) })}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {canMove && (
                <>
                  <button type="button" className={quiet} disabled={position <= 0} onClick={() => move(-1)} aria-label={t("studies.findings.moveUp", { type })}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={quiet} disabled={position >= order.length - 1} onClick={() => move(1)} aria-label={t("studies.findings.moveDown", { type })}>
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                </>
              )}
              <button
                type="button"
                className={`${quiet} ml-auto gap-1 hover:text-danger`}
                onClick={() => (text.trim() ? setConfirming(true) : act(() => api.findingDelete(finding.id)))}
                aria-label={t("studies.findings.delete", { type })}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t("common.delete")}
              </button>
            </div>
          </div>
        )}

        {confirming && (
          <div role="alertdialog" aria-label={t("studies.findings.confirmDelete", { type })} className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
            <span>{t("studies.findings.confirmDelete", { type })}</span>
            <Button variant="primary" onClick={() => act(() => api.findingDelete(finding.id))}>{t("common.delete")}</Button>
            <Button autoFocus onClick={() => setConfirming(false)}>{t("common.keep")}</Button>
          </div>
        )}
        {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
      </article>
    </li>
  );
}
