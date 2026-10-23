import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronRight, FileText, Lightbulb, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { Pending } from "@/features/teaching/AssistPanel";
import { changes, wordDiff } from "@/features/teaching/diff";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { Evidence, ExcerptInput, Inquiry, InquiryPreview, InquiryReply, InquiryScope, InsightPoint, PointKind, SharedBlock, SourceLink } from "@/types/inquiry";
import { FINDING_TYPES, type Finding, type FindingType } from "@/types/studies";
import { findingLabel } from "@/features/studies/labels";
import { inquiryGroups, kindLabel } from "./inquiryLabels";

/** The longest question in the person's words (as the core allows). */
const REQUEST_MAX = 1_000;
/** The most source passages one kept note cites (as the core allows). */
const CITATIONS_MAX = 3;

/** Where accepted help can be kept: a Bible Study (and a part of it). */
export interface KeepTarget {
  studyId: string;
  studyTitle: string;
  sectionId: string | null;
}

export interface InquiryPanelProps {
  /** "Help with “Observations”". */
  title: string;
  /** What the help is about; null while it cannot be asked (the reason is in `problem`). */
  scope: InquiryScope | null;
  /** The kinds of help offered here. */
  actions: readonly Inquiry[];
  initialAction?: Inquiry;
  /** What to look at (the Study's focus choice, the selected source words…), shown first. */
  focus?: ReactNode;
  /** More choices that change what is sent (include a study…), shown before the preview. */
  extra?: ReactNode;
  /** Why help cannot be asked here, when the page already knows. */
  problem?: string | null;
  /**
   * New wording the person chose: replaces their original words. False when
   * those words have changed since asking (then nothing changes).
   */
  onApplyWording?: (original: string, suggestion: string) => boolean;
  /** Where help can be kept as a note; null: nowhere (said in `keepNote`). */
  keep: KeepTarget | null;
  keepNote?: string;
  onKept?: (finding: Finding) => void;
  /** Opens a source at quoted words. */
  onOpenSource?: (link: SourceLink) => void;
  onClose: () => void;
}

/**
 * Help for one question about one piece of the person's work (v0.20): shown
 * in this temporary panel, never mixed into their writing. It says exactly
 * what would be sent and to whom before anything is sent; asks only when the
 * person says so; shows each point with what it rests on; and changes their
 * study only when they accept a piece of it. Escape closes it.
 */
export function InquiryPanel(props: InquiryPanelProps) {
  const { title, scope, actions, initialAction, focus, extra, onApplyWording, keep, keepNote, onKept, onOpenSource, onClose } = props;
  const { t, i18n } = useTranslation();
  const api = useApi();
  const id = useId();
  const [action, setAction] = useState<Inquiry>(initialAction && actions.includes(initialAction) ? initialAction : actions[0]!);
  const [request, setRequest] = useState("");
  const [preview, setPreview] = useState<InquiryPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<InquiryReply | null>(null);
  const [status, setStatus] = useState("");
  // Each request has a number: an answer the person stopped waiting for, or one to an older question, is ignored.
  const asking = useRef(0);
  const askButton = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const input = useMemo(() => (scope ? { scope, action, request, uiLanguage: i18n.language } : null), [scope, action, request, i18n.language]);

  // A new question starts afresh: the last preview and answer belonged to the last one.
  const [shownFor, setShownFor] = useState(input);
  if (shownFor !== input) {
    setShownFor(input);
    setPreview(null);
    setReply(null);
    setBusy(false);
  }
  // The question now, so an answer to an older one is ignored.
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  }, [input]);

  // What would be sent, kept current as the choices change. An answer to an older choice is dropped.
  useEffect(() => {
    if (!input) return;
    let active = true;
    const timer = setTimeout(() => {
      api.inquiryPreview(input).then(
        (p) => {
          if (!active) return;
          setPreview(p);
          setProblem(null);
        },
        (e) => {
          if (!active) return;
          setProblem(toApiError(e).message);
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, input]);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  const needsRequest = action === "free" && !request.trim();

  const ask = async () => {
    if (busy || !preview || !input || needsRequest) return;
    const n = ++asking.current;
    const asked = input;
    const stale = () => n !== asking.current || latest.current !== asked;
    setBusy(true);
    setProblem(null);
    setReply(null);
    setStatus("");
    try {
      const answer = await api.inquiryAsk(input, preview.fingerprint);
      if (stale()) return;
      setReply(answer);
      setStatus(t("studies.inquiry.ready"));
      requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: false }));
    } catch (e) {
      if (stale()) return;
      const error = toApiError(e);
      setProblem(error.message);
      setStatus(t("studies.inquiry.failed"));
      // What would be sent changed: look again, so the person sees the new version first.
      if (error.code === "inquiry.changed") {
        setPreview(null);
        api.inquiryPreview(input).then(setPreview, () => undefined);
      }
    } finally {
      if (n === asking.current) setBusy(false);
    }
  };

  const stop = () => {
    asking.current += 1;
    setBusy(false);
    setStatus(t("studies.inquiry.stopped"));
    requestAnimationFrame(() => askButton.current?.focus());
  };

  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !reply) {
      e.preventDefault();
      void ask();
    }
  };

  const groups = inquiryGroups(actions);
  const shownProblem = props.problem ?? problem;

  return (
    <section
      aria-labelledby={`${id}-title`}
      onKeyDown={keys}
      data-testid="inquiry-panel"
      className="@container flex flex-col gap-3 rounded-aw border border-border border-l-[4px] border-l-accent bg-bg-secondary px-4 py-3 font-ui text-[0.9375rem]"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 ref={titleRef} tabIndex={-1} id={`${id}-title`} className="type-group m-0 flex items-center gap-2">
          <Lightbulb className="size-4 shrink-0 text-accent" aria-hidden="true" />
          {title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("studies.inquiry.close")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-aw text-text-muted hover:bg-hover hover:text-text-strong"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p className="m-0 type-meta">{t("studies.inquiry.standing")}</p>

      {focus}

      <label className="flex flex-col gap-1">
        <span className="text-text-strong">{t("studies.inquiry.kindLabel")}</span>
        <select
          value={action}
          disabled={busy}
          onChange={(e) => setAction(e.target.value as Inquiry)}
          className="aw-input h-11 w-full min-w-0 px-2"
        >
          {groups.map((g) => (
            <optgroup key={g.key} label={t(`studies.inquiry.group.${g.key}`)}>
              {g.actions.map((a) => (
                <option key={a} value={a}>
                  {t(`studies.inquiry.action.${a}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {!(action === "clarify" || action === "grammar") && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-request`} className="text-text-strong">
            {action === "free" ? t("studies.inquiry.requestRequired") : t("studies.inquiry.requestOptional")}
          </label>
          <textarea
            id={`${id}-request`}
            rows={2}
            maxLength={REQUEST_MAX}
            value={request}
            disabled={busy}
            onChange={(e) => setRequest(e.target.value)}
            className="aw-input w-full px-3 py-2"
          />
        </div>
      )}
      {extra}

      {!reply && (
        <>
          {preview && <Shared preview={preview} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button ref={askButton} variant="primary" className="min-h-11" disabled={busy || !preview || needsRequest} onClick={() => void ask()}>
              {t("studies.inquiry.ask")}
            </Button>
            <Button className="min-h-11" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            {!busy && preview && <span className="type-meta">{t("studies.inquiry.askHint")}</span>}
          </div>
          {busy && <Pending message={t("studies.inquiry.pending")} onStop={stop} />}
        </>
      )}

      {shownProblem && (
        <p role="alert" className="m-0 text-danger">
          {shownProblem}
        </p>
      )}

      {reply && (
        <div className="flex flex-col gap-3">
          <Result
            reply={reply}
            heading={resultHeading}
            preview={preview}
            onApplyWording={
              onApplyWording &&
              ((original, suggestion) => {
                const done = onApplyWording(original, suggestion);
                setStatus(done ? t("studies.inquiry.proposal.used") : "");
                if (!done) setProblem(t("studies.inquiry.proposal.changedMeanwhile"));
                return done;
              })
            }
            keep={keep}
            keepNote={keepNote}
            onKept={(f) => {
              setStatus(t("studies.inquiry.keep.done"));
              onKept?.(f);
            }}
            onOpenSource={onOpenSource}
          />
          <p className="m-0 type-meta">{t("studies.inquiry.from", { assistant: reply.assistant })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              onClick={() => {
                setReply(null);
                requestAnimationFrame(() => askButton.current?.focus());
              }}
            >
              {t("studies.inquiry.again")}
            </Button>
            <Button className="min-h-11" onClick={onClose}>
              {t("studies.inquiry.done")}
            </Button>
          </div>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}

/** "Before you ask": who answers, where the text goes, and every block, word for word. */
function Shared({ preview }: { preview: InquiryPreview }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-aw bg-bg px-3 py-2" data-testid="inquiry-preview">
      <p className="m-0 font-medium text-text-strong">
        {preview.remote ? t("studies.inquiry.shared.remote", { assistant: preview.assistant }) : t("studies.inquiry.shared.local", { assistant: preview.assistant })}
      </p>
      <p className="m-0 text-text">{t("studies.inquiry.shared.count", { count: preview.blocks.length })}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {preview.blocks.map((b) => (
          <li key={b.id}>
            <SharedItem block={b} />
          </li>
        ))}
      </ul>
      <p className="m-0 type-meta">
        {preview.sourceText ? t("studies.inquiry.shared.sourceText") : t("studies.inquiry.shared.noSourceText")} {t("studies.inquiry.shared.noSearch")}
      </p>
    </div>
  );
}

function blockName(b: Pick<SharedBlock, "kind" | "label" | "reference" | "translation">) {
  if (b.kind === "scripture" && b.reference) return b.translation ? `${referenceLabel(b.reference)} (${b.translation})` : referenceLabel(b.reference);
  return b.label;
}

function SharedItem({ block }: { block: SharedBlock }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="rounded-aw border border-border-subtle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-start gap-2 rounded-aw px-2 py-1.5 text-left hover:bg-hover"
      >
        <ChevronRight className={`mt-1 size-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="caps-label mr-2 text-text-muted">{t(`studies.inquiry.block.${block.kind}`)}</span>
          <span className="break-words text-text-strong">{blockName(block)}</span>
        </span>
      </button>
      <div id={bodyId} hidden={!open} className="reading max-h-60 overflow-auto whitespace-pre-wrap border-t border-border-subtle px-3 py-2 text-[0.9375rem] text-text">
        {block.text}
      </div>
    </div>
  );
}

interface ResultProps {
  reply: InquiryReply;
  preview: InquiryPreview | null;
  heading: React.RefObject<HTMLHeadingElement | null>;
  onApplyWording?: (original: string, suggestion: string) => boolean;
  keep: KeepTarget | null;
  keepNote?: string;
  onKept: (finding: Finding) => void;
  onOpenSource?: (link: SourceLink) => void;
}

function Result({ reply, heading, onApplyWording, keep, keepNote, onKept, onOpenSource }: ResultProps) {
  const { t } = useTranslation();
  const result = reply.result;
  const [used, setUsed] = useState(false);

  if (result.type === "proposal") {
    const same = !changes(result.original, result.suggestion);
    return (
      <div className="flex flex-col gap-2">
        <h4 ref={heading} tabIndex={-1} className="type-group m-0">
          {t("studies.inquiry.proposal.heading")}
        </h4>
        <p className="m-0 text-text-muted">{t("studies.inquiry.proposal.notYet")}</p>
        {same ? <p className="m-0 text-text-strong">{t("studies.inquiry.proposal.same")}</p> : <WordDiff before={result.original} after={result.suggestion} />}
        {result.changes && <p className="m-0 text-text">{t("studies.inquiry.proposal.changes", { changes: result.changes })}</p>}
        {!same && onApplyWording && !used && (
          <div>
            <Button variant="primary" className="min-h-11" onClick={() => setUsed(onApplyWording(result.original, result.suggestion))}>
              {t("studies.inquiry.proposal.use")}
            </Button>
          </div>
        )}
        {used && <p className="m-0 text-text-strong">{t("studies.inquiry.proposal.used")}</p>}
      </div>
    );
  }

  const whole = [result.summary, ...result.points.map((p) => `• ${p.text}`)].filter(Boolean).join("\n");
  const citations = firstPerSource(result.points.flatMap((p) => p.evidence));
  return (
    <div className="flex flex-col gap-2">
      <h4 ref={heading} tabIndex={-1} className="type-group m-0">
        {result.verdict ? t("studies.inquiry.compareHeading") : t("studies.inquiry.heading")}
      </h4>
      {result.verdict && (
        <p className={`m-0 font-medium ${result.verdict === "insufficient" ? "text-text-muted" : "text-text-strong"}`} data-testid="inquiry-verdict">
          {t(`studies.inquiry.verdict.${result.verdict}`)}
        </p>
      )}
      {result.summary && <p className="m-0 text-text">{result.summary}</p>}
      {result.points.length === 0 && <p className="m-0 text-text-muted">{t("studies.inquiry.none")}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {result.points.map((p, i) => (
          <li key={i}>
            <PointCard point={p} assistant={reply.assistant} keep={keep} onKept={onKept} onOpenSource={onOpenSource} />
          </li>
        ))}
      </ul>
      {(result.unverified > 0 || result.downgraded > 0) && (
        <p className="m-0 type-meta" data-testid="inquiry-checked">
          {result.unverified > 0 && t("studies.inquiry.unverified", { count: result.unverified })} {result.downgraded > 0 && t("studies.inquiry.downgradedCount", { count: result.downgraded })}
        </p>
      )}
      {keep ? (
        result.points.length > 0 && (
          <KeepForm
            label={result.verdict ? t("studies.inquiry.keep.comparison") : t("studies.inquiry.keep.all")}
            initial={whole}
            initialType={result.verdict ? "interpretation" : "observation"}
            citations={citations}
            assistant={reply.assistant}
            keep={keep}
            onKept={onKept}
          />
        )
      ) : (
        keepNote && <p className="m-0 type-meta">{keepNote}</p>
      )}
    </div>
  );
}

/** One quotation of each source passage, in order: what a kept note cites. */
function firstPerSource(evidence: Evidence[]): Evidence[] {
  const out: Evidence[] = [];
  for (const e of evidence) if (e.source && !out.some((o) => o.block === e.block)) out.push(e);
  return out.slice(0, CITATIONS_MAX);
}

const STRONG_KINDS: readonly PointKind[] = ["text", "source", "writing", "position", "agreement", "disagreement"];

function PointCard({ point, assistant, keep, onKept, onOpenSource }: { point: InsightPoint; assistant: string; keep: KeepTarget | null; onKept: (f: Finding) => void; onOpenSource?: (link: SourceLink) => void }) {
  const { t } = useTranslation();
  const { goTo } = useScripture();
  const [keeping, setKeeping] = useState(false);
  const strong = STRONG_KINDS.includes(point.kind);
  return (
    <article className={`flex flex-col gap-1.5 rounded-aw border bg-bg px-3 py-2 ${strong ? "border-border" : "border-dashed border-border-subtle"}`} data-kind={point.kind}>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2">
        <span className={`caps-label ${point.kind === "unsupported" || point.downgraded ? "text-danger" : "text-text-muted"}`}>{kindLabel(t, point.kind)}</span>
        {point.aboutLabel && <span className="type-meta">{point.aboutLabel}</span>}
      </p>
      <p className="m-0 text-text-strong">{point.text}</p>
      {point.downgraded && <p className="m-0 type-meta">{t("studies.inquiry.downgraded")}</p>}
      {point.evidence.map((e, i) => (
        <EvidenceQuote key={i} evidence={e} onOpenSource={onOpenSource} />
      ))}
      {point.references.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="type-meta">{t("studies.inquiry.references")}</span>
          {point.references.map((r) => (
            <button key={r.canonical} type="button" onClick={() => goTo(r)} className="min-h-11 rounded-aw px-2 text-link underline underline-offset-2 hover:bg-hover">
              {referenceLabel(r)}
            </button>
          ))}
        </div>
      )}
      {keep &&
        (keeping ? (
          <KeepForm
            label={t("studies.inquiry.keep.point")}
            initial={point.text}
            initialType={typeFor(point.kind)}
            citations={firstPerSource(point.evidence)}
            assistant={assistant}
            keep={keep}
            onKept={(f) => {
              setKeeping(false);
              onKept(f);
            }}
            onCancel={() => setKeeping(false)}
            open
          />
        ) : (
          <div>
            <Button className="min-h-11" onClick={() => setKeeping(true)}>
              {t("studies.inquiry.keep.open")}
            </Button>
          </div>
        ))}
    </article>
  );
}

function typeFor(kind: PointKind): FindingType {
  switch (kind) {
    case "text":
      return "observation";
    case "question":
    case "uncertain":
      return "question";
    case "assumption":
    case "unsupported":
      return "unresolved_issue";
    case "source":
      return "quotation";
    default:
      return "interpretation";
  }
}

function EvidenceQuote({ evidence, onOpenSource }: { evidence: Evidence; onOpenSource?: (link: SourceLink) => void }) {
  const { t } = useTranslation();
  const link = evidence.source;
  return (
    <figure className="m-0 border-l-[3px] border-border pl-3">
      <blockquote className="reading m-0 text-[0.9375rem] text-text">“{evidence.quote}”</blockquote>
      <figcaption className="flex flex-wrap items-center gap-x-2 type-meta">
        {evidence.kind === "scripture" ? <BookOpen className="size-3.5" aria-hidden="true" /> : evidence.kind === "source" ? <FileText className="size-3.5" aria-hidden="true" /> : null}
        <span>
          {t(`studies.inquiry.evidence.${evidence.kind}`)}: {evidence.label}
        </span>
        {link && onOpenSource && (
          <button type="button" onClick={() => onOpenSource(link)} className="min-h-11 rounded-aw px-1 text-link underline underline-offset-2 hover:bg-hover">
            {t("studies.inquiry.openSource")}
          </button>
        )}
      </figcaption>
    </figure>
  );
}

function WordDiff({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation();
  return (
    <p data-testid="inquiry-diff" className="reading m-0 whitespace-pre-wrap rounded-aw border border-border-subtle bg-bg px-3 py-2 text-[1.0625rem] text-text-strong">
      {wordDiff(before, after).map((part, i) =>
        part.kind === "same" ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === "removed" ? (
          <del key={i} className="mx-0.5 rounded-sm px-0.5 text-text-muted line-through decoration-danger decoration-2">
            <span className="sr-only">{t("studies.inquiry.proposal.removed")} </span>
            {part.text}
          </del>
        ) : (
          <ins key={i} className="mx-0.5 rounded-sm bg-note px-0.5 font-semibold text-text-strong no-underline [text-decoration-line:underline] decoration-accent decoration-2 underline-offset-2">
            <span className="sr-only">{t("studies.inquiry.proposal.added")} </span>
            {part.text}
          </ins>
        ),
      )}
    </p>
  );
}

interface KeepFormProps {
  label: string;
  initial: string;
  initialType: FindingType;
  citations: Evidence[];
  assistant: string;
  keep: KeepTarget;
  onKept: (finding: Finding) => void;
  onCancel?: () => void;
  /** Open at once (a point's form, opened by its button). */
  open?: boolean;
}

/** Accepting help: the person's own wording of the note (prefilled, editable), its kind, and what it cites. */
function KeepForm({ label, initial, initialType, citations, assistant, keep, onKept, onCancel, open: startOpen = false }: KeepFormProps) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [open, setOpen] = useState(startOpen);
  const [content, setContent] = useState(initial);
  const [type, setType] = useState<FindingType>(initialType);
  const [cite, setCite] = useState<Set<number>>(() => new Set(citations.map((_, i) => i)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) area.current?.focus();
  }, [open]);
  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const chosen: ExcerptInput[] = citations
        .filter((_, i) => cite.has(i))
        .map((e) => ({ sourceId: e.source!.sourceId, start: e.source!.start, end: e.source!.end, quote: e.source!.quote }));
      const finding = await api.inquiryKeep({ studyId: keep.studyId, sectionId: keep.sectionId, findingType: type, content, assistant, citations: chosen });
      setDone(true);
      onKept(finding);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }, [api, citations, cite, keep, type, content, assistant, onKept]);

  if (done) return <p className="m-0 text-text-strong">{t("studies.inquiry.keep.doneIn", { study: keep.studyTitle })}</p>;
  if (!open)
    return (
      <div>
        <Button className="min-h-11" onClick={() => setOpen(true)}>
          {label}
        </Button>
      </div>
    );
  return (
    <form
      className="flex flex-col gap-2 rounded-aw border border-border-subtle bg-bg-secondary px-3 py-2"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="m-0 type-meta">{t("studies.inquiry.keep.explain", { study: keep.studyTitle })}</p>
      <label htmlFor={`${id}-content`} className="text-text-strong">
        {t("studies.inquiry.keep.wording")}
      </label>
      <textarea id={`${id}-content`} ref={area} rows={4} value={content} onChange={(e) => setContent(e.target.value)} className="aw-input reading w-full px-3 py-2" />
      <label className="flex flex-wrap items-center gap-2">
        <span className="text-text-strong">{t("studies.inquiry.keep.kind")}</span>
        <select value={type} onChange={(e) => setType(e.target.value as FindingType)} className="aw-input h-11 min-w-0 px-2">
          {FINDING_TYPES.map((k) => (
            <option key={k} value={k}>
              {findingLabel(t, k)}
            </option>
          ))}
        </select>
      </label>
      {citations.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-text-strong">{t("studies.inquiry.keep.cites")}</legend>
          {citations.map((c, i) => (
            <label key={i} className="flex min-h-11 items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={cite.has(i)}
                onChange={(e) =>
                  setCite((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
              <span>
                “{c.source!.quote}” <span className="type-meta">— {c.source!.title}, {c.source!.location}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="m-0 type-meta">{t("studies.inquiry.keep.marked", { assistant })}</p>
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" className="min-h-11" disabled={saving || !content.trim()}>
          {t("studies.inquiry.keep.add")}
        </Button>
        <Button
          className="min-h-11"
          onClick={() => {
            setOpen(false);
            onCancel?.();
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
