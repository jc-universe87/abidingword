import { forwardRef, useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { FindingSources } from "@/features/library/FindingSources";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useAutosave } from "@/hooks/useAutosave";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudySection } from "@/types/domain";
import { FINDING_TYPES, type Finding, type FindingType } from "@/types/studies";
import { sectionTitle } from "./builtinText";
import { findingInline, findingLabel, findingPlural } from "./labels";

const QUICK: FindingType[] = ["observation", "question", "interpretation", "application", "conclusion"];

interface FindingsPanelProps {
  studyId: string;
  findings: Finding[];
  sections: StudySection[];
  onChanged: () => void;
  onRevealScripture: () => void;
}

/**
 * Structured findings for a study: quick capture, a type filter and the
 * list itself. Adding an observation should feel like taking a note.
 */
export function FindingsPanel({ studyId, findings, sections, onChanged, onRevealScripture }: FindingsPanelProps) {
  const { t } = useTranslation();
  const id = useId();
  const [capturing, setCapturing] = useState<FindingType | null>(null);
  const [filter, setFilter] = useState<FindingType | null>(null);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  const counts = new Map<FindingType, number>();
  for (const f of findings) counts.set(f.findingType, (counts.get(f.findingType) ?? 0) + 1);
  const shown = filter ? findings.filter((f) => f.findingType === filter) : findings;

  return (
    <section id="study-findings" aria-labelledby={`${id}-title`} className="scroll-mt-4 flex flex-col gap-4 border-t border-border-subtle pt-6">
      <h2 id={`${id}-title`} className="m-0 font-display text-[1.5rem] font-heading text-text-strong">
        {t("studies.findings.heading")}
      </h2>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("studies.findings.addGroup")}>
        <span className="text-[0.9375rem] text-text-muted">{t("studies.findings.add")}</span>
        {QUICK.map((type) => (
          <Button
            key={type}
            variant="secondary"
            className="min-h-9 px-3 text-[0.875rem]"
            aria-pressed={capturing === type}
            onClick={() => {
              setCapturing(type);
              setTimeout(() => captureRef.current?.focus(), 0);
            }}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {findingLabel(t, type)}
          </Button>
        ))}
        <label className="flex items-center">
          <span className="sr-only">{t("studies.findings.otherKind")}</span>
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              setCapturing(e.target.value as FindingType);
              setTimeout(() => captureRef.current?.focus(), 0);
            }}
            className="h-9 rounded-aw border border-border bg-bg px-2 text-[0.875rem]"
          >
            <option value="">{t("studies.findings.more")}</option>
            {FINDING_TYPES.filter((type) => !QUICK.includes(type)).map((type) => (
              <option key={type} value={type}>{findingLabel(t, type)}</option>
            ))}
          </select>
        </label>
      </div>

      {capturing && (
        <QuickCapture
          ref={captureRef}
          studyId={studyId}
          type={capturing}
          sections={sections}
          onTypeChange={setCapturing}
          onDone={() => {
            setCapturing(null);
            onChanged();
          }}
          onCancel={() => setCapturing(null)}
        />
      )}

      {findings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[0.875rem]" role="group" aria-label={t("studies.findings.filterGroup")}>
          <FilterButton active={filter === null} onClick={() => setFilter(null)} label={t("studies.findings.all", { count: findings.length })} />
          {FINDING_TYPES.filter((type) => counts.has(type)).map((type) => (
            <FilterButton
              key={type}
              active={filter === type}
              onClick={() => setFilter(filter === type ? null : type)}
              label={t("studies.findings.filterType", { type: findingPlural(t, type), count: counts.get(type) })}
            />
          ))}
        </div>
      )}

      {findings.length === 0 && !capturing && (
        <p className="m-0 text-[0.9375rem] text-text-muted">
          {t("studies.findings.empty")}
        </p>
      )}

      <ol aria-label={t("studies.findings.listLabel")} className="m-0 flex list-none flex-col gap-3 p-0">
        {shown.map((finding) => (
          <FindingItem
            key={finding.id}
            finding={finding}
            sections={sections}
            order={findings.map((f) => f.id)}
            canMove={filter === null}
            onChanged={onChanged}
            onRevealScripture={onRevealScripture}
          />
        ))}
      </ol>
    </section>
  );
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="min-h-8 rounded-aw border border-border px-2.5 text-text-strong hover:bg-bg-secondary aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary"
    >
      {label}
    </button>
  );
}

interface QuickCaptureProps {
  studyId: string;
  type: FindingType;
  sections: StudySection[];
  onTypeChange: (type: FindingType) => void;
  onDone: () => void;
  onCancel: () => void;
}

const QuickCapture = forwardRef<HTMLTextAreaElement, QuickCaptureProps>(function QuickCapture(
  { studyId, type, sections, onTypeChange, onDone, onCancel },
  ref,
) {
  const { t } = useTranslation();
  const api = useApi();
  const { currentPassage } = useScripture();
  const id = useId();
  const [text, setText] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [linkPassage, setLinkPassage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (event.key === "Escape") onCancel();
  };

  return (
    <div className="flex flex-col gap-2 border-l-[3px] border-accent bg-bg-secondary px-4 py-3" onKeyDown={keys}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <span className="font-medium text-text-strong">{t("studies.findings.type")}</span>
          <select value={type} onChange={(e) => onTypeChange(e.target.value as FindingType)} className="h-9 rounded-aw border border-border bg-bg px-2">
            {FINDING_TYPES.map((option) => (
              <option key={option} value={option}>{findingLabel(t, option)}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <span className="text-text-muted">{t("studies.findings.in")}</span>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="h-9 max-w-48 rounded-aw border border-border bg-bg px-2">
            <option value="">{t("studies.findings.wholeStudy")}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{sectionTitle(s)}</option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor={`${id}-text`} className="sr-only">{t("studies.findings.newLabel", { type: findingInline(t, type) })}</label>
      <textarea
        id={`${id}-text`}
        ref={ref}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("studies.findings.newPlaceholder", { type: findingInline(t, type) })}
        className="reading rounded-aw border border-border bg-bg px-3 py-2 text-[1rem] placeholder:text-text-muted"
      />
      {currentPassage && (
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" checked={linkPassage} onChange={(e) => setLinkPassage(e.target.checked)} className="size-4 accent-[var(--aw-primary)]" />
          {t("studies.findings.linkCurrent", { passage: referenceLabel(currentPassage) })}
        </label>
      )}
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={busy}>{t("studies.findings.save")}</Button>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <span className="text-[0.875rem] text-text-muted">{t("studies.findings.saveHint")}</span>
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

  const iconButton = "inline-flex size-9 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary disabled:opacity-40";

  return (
    <li>
      <article aria-label={t("studies.findings.itemLabel", { type: label, excerpt: finding.content.slice(0, 60) })} className="flex flex-col gap-2 border-l-[3px] border-border py-1 pl-4">
        <div className="flex flex-wrap items-center gap-2 text-[0.875rem]">
          <label className="flex items-center">
            <span className="sr-only">{t("studies.findings.typeLabel")}</span>
            <select
              value={finding.findingType}
              onChange={(e) => act(() => api.findingUpdate({ id: finding.id, findingType: e.target.value as FindingType }))}
              className="h-8 rounded-aw border border-border bg-bg px-1.5 font-semibold text-text-strong"
            >
              {FINDING_TYPES.map((option) => (
                <option key={option} value={option}>{findingLabel(t, option)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-text-muted">{t("studies.findings.inLower")}</span>
            <select
              aria-label={t("studies.findings.section")}
              value={finding.sectionId ?? ""}
              onChange={(e) => act(() => api.findingUpdate({ id: finding.id, sectionId: e.target.value }))}
              className="h-8 max-w-44 rounded-aw border border-border bg-bg px-1.5"
            >
              <option value="">{t("studies.findings.wholeStudy")}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{sectionTitle(s)}</option>
              ))}
            </select>
          </label>
          <span className="ml-auto flex items-center">
            {canMove && (
              <>
                <button type="button" className={iconButton} disabled={position <= 0} onClick={() => move(-1)} aria-label={t("studies.findings.moveUp", { type })}>
                  <ArrowUp className="size-4" aria-hidden="true" />
                </button>
                <button type="button" className={iconButton} disabled={position >= order.length - 1} onClick={() => move(1)} aria-label={t("studies.findings.moveDown", { type })}>
                  <ArrowDown className="size-4" aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="button"
              className={`${iconButton} hover:text-danger`}
              onClick={() => (text.trim() ? setConfirming(true) : act(() => api.findingDelete(finding.id)))}
              aria-label={t("studies.findings.delete", { type })}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </span>
        </div>

        <textarea
          aria-label={t("studies.findings.text", { type: label })}
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            schedule(e.target.value);
          }}
          onBlur={flush}
          className="reading w-full resize-y rounded-aw border border-transparent bg-transparent px-2 py-1 text-[1rem] hover:border-border-subtle focus:border-border"
        />

        <div className="flex flex-wrap items-center gap-2 text-[0.875rem]">
          {finding.passages.map((p) => (
            <span key={p.id} className="inline-flex items-center rounded-aw border border-border">
              <button
                type="button"
                onClick={() => {
                  goTo(p.reference);
                  onRevealScripture();
                }}
                className="min-h-8 px-2 font-medium text-link hover:bg-bg-secondary"
              >
                {referenceLabel(p.reference)}
              </button>
              <button
                type="button"
                onClick={() => act(() => api.findingUnlinkPassage(p.id))}
                aria-label={t("studies.findings.unlink", { passage: referenceLabel(p.reference) })}
                className="inline-flex size-8 items-center justify-center border-l border-border text-text-muted hover:bg-bg-secondary"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
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
          <label className="ml-auto flex items-center gap-1.5">
            <span className="text-text-muted">{t("studies.findings.tags")}</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={() => {
                const next = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
                if (next.join(",") !== finding.tags.join(",")) void act(() => api.findingSetTags({ findingId: finding.id, tags: next }));
              }}
              placeholder={t("studies.findings.tagsPlaceholder")}
              className="h-8 w-44 rounded-aw border border-border-subtle bg-bg px-2 placeholder:text-text-muted"
            />
          </label>
        </div>

        <FindingSources
          finding={finding}
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
