import { forwardRef, useCallback, useId, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useAutosave } from "@/hooks/useAutosave";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudySection } from "@/types/domain";
import { FINDING_TYPES, type Finding, type FindingType } from "@/types/studies";
import { FINDING_LABELS, FINDING_PLURALS } from "./labels";

const QUICK: FindingType[] = ["observation", "question", "interpretation", "application", "conclusion"];

export interface FindingsPanelHandle {
  /** Opens quick capture, optionally for a type, and focuses it. */
  capture: (type?: FindingType) => void;
}

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
export const FindingsPanel = forwardRef<FindingsPanelHandle, FindingsPanelProps>(function FindingsPanel(
  { studyId, findings, sections, onChanged, onRevealScripture },
  ref,
) {
  const id = useId();
  const [capturing, setCapturing] = useState<FindingType | null>(null);
  const [filter, setFilter] = useState<FindingType | null>(null);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    capture: (type) => {
      setCapturing(type ?? capturing ?? "observation");
      // Focus after the capture box has rendered.
      setTimeout(() => captureRef.current?.focus(), 0);
    },
  }));

  const counts = new Map<FindingType, number>();
  for (const f of findings) counts.set(f.findingType, (counts.get(f.findingType) ?? 0) + 1);
  const shown = filter ? findings.filter((f) => f.findingType === filter) : findings;

  return (
    <section id="study-findings" aria-labelledby={`${id}-title`} className="scroll-mt-4 flex flex-col gap-4 border-t border-border-subtle pt-6">
      <h2 id={`${id}-title`} className="m-0 font-display text-[1.5rem] font-semibold text-text-strong">
        Findings
      </h2>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Add a finding">
        <span className="text-[0.9375rem] text-text-muted">Add:</span>
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
            {FINDING_LABELS[type]}
          </Button>
        ))}
        <label className="flex items-center">
          <span className="sr-only">Other kind of finding</span>
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              setCapturing(e.target.value as FindingType);
              setTimeout(() => captureRef.current?.focus(), 0);
            }}
            className="h-9 rounded-aw border border-border bg-bg px-2 text-[0.875rem]"
          >
            <option value="">More…</option>
            {FINDING_TYPES.filter((t) => !QUICK.includes(t)).map((t) => (
              <option key={t} value={t}>{FINDING_LABELS[t]}</option>
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
        <div className="flex flex-wrap items-center gap-2 text-[0.875rem]" role="group" aria-label="Show findings">
          <FilterButton active={filter === null} onClick={() => setFilter(null)} label={`All (${findings.length})`} />
          {FINDING_TYPES.filter((t) => counts.has(t)).map((t) => (
            <FilterButton key={t} active={filter === t} onClick={() => setFilter(filter === t ? null : t)} label={`${FINDING_PLURALS[t]} (${counts.get(t)})`} />
          ))}
        </div>
      )}

      {findings.length === 0 && !capturing && (
        <p className="m-0 text-[0.9375rem] text-text-muted">
          No findings yet. Record observations, questions and conclusions as you study; they stay findable later.
        </p>
      )}

      <ol aria-label="Findings" className="m-0 flex list-none flex-col gap-3 p-0">
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
});

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
      setError("Write the finding first.");
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
          <span className="font-medium text-text-strong">Type</span>
          <select value={type} onChange={(e) => onTypeChange(e.target.value as FindingType)} className="h-9 rounded-aw border border-border bg-bg px-2">
            {FINDING_TYPES.map((t) => (
              <option key={t} value={t}>{FINDING_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <span className="text-text-muted">In</span>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="h-9 max-w-48 rounded-aw border border-border bg-bg px-2">
            <option value="">Whole study</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor={`${id}-text`} className="sr-only">New {FINDING_LABELS[type].toLowerCase()}</label>
      <textarea
        id={`${id}-text`}
        ref={ref}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`New ${FINDING_LABELS[type].toLowerCase()}…`}
        className="reading rounded-aw border border-border bg-bg px-3 py-2 text-[1rem] placeholder:text-text-muted"
      />
      {currentPassage && (
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" checked={linkPassage} onChange={(e) => setLinkPassage(e.target.checked)} className="size-4 accent-[var(--aw-primary)]" />
          Link current passage ({currentPassage.display})
        </label>
      )}
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={busy}>Save finding</Button>
        <Button onClick={onCancel}>Cancel</Button>
        <span className="text-[0.875rem] text-text-muted">Ctrl+Enter saves</span>
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
  const api = useApi();
  const { goTo, currentPassage } = useScripture();
  const [text, setText] = useState(finding.content);
  const [tags, setTags] = useState(finding.tags.join(", "));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = FINDING_LABELS[finding.findingType];

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
      <article aria-label={`${label}: ${finding.content.slice(0, 60)}`} className="flex flex-col gap-2 border-l-[3px] border-border py-1 pl-4">
        <div className="flex flex-wrap items-center gap-2 text-[0.875rem]">
          <label className="flex items-center">
            <span className="sr-only">Finding type</span>
            <select
              value={finding.findingType}
              onChange={(e) => act(() => api.findingUpdate({ id: finding.id, findingType: e.target.value as FindingType }))}
              className="h-8 rounded-aw border border-border bg-bg px-1.5 font-semibold text-text-strong"
            >
              {FINDING_TYPES.map((t) => (
                <option key={t} value={t}>{FINDING_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-text-muted">in</span>
            <select
              aria-label="Section"
              value={finding.sectionId ?? ""}
              onChange={(e) => act(() => api.findingUpdate({ id: finding.id, sectionId: e.target.value }))}
              className="h-8 max-w-44 rounded-aw border border-border bg-bg px-1.5"
            >
              <option value="">Whole study</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>
          <span className="ml-auto flex items-center">
            {canMove && (
              <>
                <button type="button" className={iconButton} disabled={position <= 0} onClick={() => move(-1)} aria-label={`Move ${label.toLowerCase()} up`}>
                  <ArrowUp className="size-4" aria-hidden="true" />
                </button>
                <button type="button" className={iconButton} disabled={position >= order.length - 1} onClick={() => move(1)} aria-label={`Move ${label.toLowerCase()} down`}>
                  <ArrowDown className="size-4" aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="button"
              className={`${iconButton} hover:text-danger`}
              onClick={() => (text.trim() ? setConfirming(true) : act(() => api.findingDelete(finding.id)))}
              aria-label={`Delete ${label.toLowerCase()}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </span>
        </div>

        <textarea
          aria-label={`${label} text`}
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
                {p.reference.display}
              </button>
              <button
                type="button"
                onClick={() => act(() => api.findingUnlinkPassage(p.id))}
                aria-label={`Unlink ${p.reference.display}`}
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
              + Link {currentPassage.display}
            </button>
          )}
          <label className="ml-auto flex items-center gap-1.5">
            <span className="text-text-muted">Tags</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={() => {
                const next = tags.split(",").map((t) => t.trim()).filter(Boolean);
                if (next.join(",") !== finding.tags.join(",")) void act(() => api.findingSetTags({ findingId: finding.id, tags: next }));
              }}
              placeholder="e.g. covenant, sermon"
              className="h-8 w-44 rounded-aw border border-border-subtle bg-bg px-2 placeholder:text-text-muted"
            />
          </label>
        </div>

        {confirming && (
          <div role="alertdialog" aria-label={`Delete this ${label.toLowerCase()}?`} className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
            <span>Delete this {label.toLowerCase()}?</span>
            <Button variant="primary" onClick={() => act(() => api.findingDelete(finding.id))}>Delete</Button>
            <Button autoFocus onClick={() => setConfirming(false)}>Keep</Button>
          </div>
        )}
        {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
      </article>
    </li>
  );
}
