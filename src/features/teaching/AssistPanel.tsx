import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ExternalLink, Image as ImageIcon, Lightbulb, Loader2, MessageSquare, Search, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { ScriptureRef } from "@/types/scripture";
import type {
  AssistAction,
  AssistPreview,
  AssistReply,
  FoundImage,
  GeneratedImage,
  KeepTeachingMaterial,
  TeachingPart,
  VisualIdea,
} from "@/types/teaching";
import { changes, wordDiff } from "./diff";
import { assistLabel } from "./labels";

/** What the person asked for help with. */
export interface AssistTarget {
  part: TeachingPart;
  pointId: string | null;
  /** The part's name as shown, e.g. "Introduction". */
  label: string;
  /** The text worked on: the whole part, or the selected words. */
  text: string;
  /** Where the selected words are in the part, when only they are worked on. */
  selection: { start: number; end: number } | null;
}

/** Actions that ask the person for a few words first. */
const NEEDS_REQUEST = new Set<AssistAction>(["question", "story", "free"]);
const OPTIONAL_REQUEST = new Set<AssistAction>(["transition", "phrasing", "visual"]);

type Material = Omit<KeepTeachingMaterial, "preparationId" | "pointId">;

/** The longest request in the person's words (as the core allows). */
const REQUEST_MAX = 1_000;

/** After this long, a waiting message adds that it is taking longer than usual. */
export const SLOW_AFTER_MS = 20_000;

/**
 * A long operation under way: said at once, in words, and to screen readers.
 * No percentages (none are known); after a while it says it is slow, and,
 * where it is safe, offers to stop waiting.
 */
export function Pending({ message, onStop }: { message: string; onStop?: () => void }) {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);
  // A live region is announced reliably only when its text changes after it is there: filled a moment later.
  const [said, setSaid] = useState(false);
  useEffect(() => {
    const say = setTimeout(() => setSaid(true), 50);
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(say);
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-aw border border-border-subtle bg-bg px-3 py-2" data-testid="pending">
      <Loader2 className="size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1 text-text-strong">
        <span aria-hidden="true">{message}</span>
        {slow && (
          <span aria-hidden="true" className="block text-[0.875rem] text-text-muted">
            {t("studies.teaching.assist.slow")}
          </span>
        )}
        <span role="status" className="sr-only">
          {said ? message : ""}
          {slow ? ` ${t("studies.teaching.assist.slow")}` : ""}
        </span>
      </p>
      {onStop && (
        // Asking disables what had the focus; it moves here, so Escape and Stop stay at hand.
        <Button className="min-h-11" autoFocus onClick={onStop}>
          {t("studies.teaching.assist.stop")}
        </Button>
      )}
    </div>
  );
}

interface AssistPanelProps {
  preparationId: string;
  target: AssistTarget;
  action: AssistAction;
  /**
   * New wording, chosen by the person: replaces the text (or the selection), or goes before it.
   * False when the text has changed since asking (then nothing is changed).
   */
  onApply: (text: string, placement: "replace" | "start") => boolean;
  /** An alternative, chosen by the person, added below their text (absent: there is nowhere to add it). */
  onInsertBelow?: (text: string) => void;
  /** A one-line part: an alternative replaces it instead of being added below. */
  singleLine?: boolean;
  onKeep: (material: Material) => Promise<void>;
  onAddPassage: (reference: ScriptureRef) => Promise<void>;
  onClose: () => void;
  canGenerateImages: boolean;
  canFindImages: boolean;
  /** Why images cannot be made, when they cannot. */
  imagesNote?: "off" | "unsupported" | null;
}

/**
 * The assistant, for one request about one part of the person's teaching.
 * It says first what will be shared and where it goes; it asks only when the
 * person says so; what comes back is a suggestion, shown apart from their
 * writing, with its standing, and applied only by an explicit choice.
 * Escape or Dismiss leaves everything as it was.
 */
export function AssistPanel(props: AssistPanelProps) {
  const { preparationId, target, action, onKeep, onAddPassage, onClose, canGenerateImages, canFindImages, imagesNote = null, singleLine = false } = props;
  const { t, i18n } = useTranslation();
  const api = useApi();
  const id = useId();
  const [request, setRequest] = useState("");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState("");
  const [preview, setPreview] = useState<AssistPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each request has a number; a request the person stopped waiting for is ignored when it answers.
  const asking = useRef(0);
  const [reply, setReply] = useState<AssistReply | null>(null);
  const [status, setStatus] = useState("");
  const [kept, setKept] = useState<Set<string>>(new Set());
  const first = useRef<HTMLElement | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const input = useCallback(
    () => ({
      preparationId,
      action,
      part: target.part,
      pointId: target.pointId,
      text: target.text,
      selected: target.selection !== null,
      request,
      audience,
      language,
      uiLanguage: i18n.language,
    }),
    [preparationId, action, target, request, audience, language, i18n.language],
  );

  // What would be shared, kept current while the person types their request.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api.assistantPreview(input()).then(
        (p) => {
          if (!active) return;
          setPreview(p);
          setProblem(null);
        },
        (e) => {
          if (!active) return;
          setPreview(null);
          setProblem(toApiError(e).message);
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, input]);

  const askButton = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const placed = useRef(false);
  // Focus starts where the person acts: the input when one is needed, else Ask once it can be used
  // (or the title, when the assistant cannot help with this, so the reason is read next).
  useEffect(() => {
    if (placed.current) return;
    if (first.current) {
      placed.current = true;
      first.current.focus({ preventScroll: true });
    } else if (preview) {
      placed.current = true;
      askButton.current?.focus({ preventScroll: true });
    } else if (problem) {
      placed.current = true;
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [preview, problem]);

  const needsInput =
    (NEEDS_REQUEST.has(action) && !request.trim()) || (action === "audience" && !audience.trim()) || (action === "translate" && !language.trim());

  const ask = async () => {
    if (busy || !preview || needsInput) return;
    const n = ++asking.current;
    setBusy(true);
    setProblem(null);
    setReply(null);
    setStatus("");
    try {
      const answer = await api.assistantAsk(input());
      if (n !== asking.current) return;
      setReply(answer);
      setStatus(t("studies.teaching.assist.ready"));
      requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: false }));
    } catch (e) {
      if (n !== asking.current) return;
      setProblem(toApiError(e).message);
      setStatus(t("studies.teaching.assist.failed"));
    } finally {
      if (n === asking.current) setBusy(false);
    }
  };

  /** Stops waiting: asking changes nothing, so a late answer can simply be ignored. */
  const stop = () => {
    asking.current += 1;
    setBusy(false);
    setStatus(t("studies.teaching.assist.stopped"));
    requestAnimationFrame(() => askButton.current?.focus());
  };

  const keep = async (key: string, material: Material) => {
    try {
      await onKeep(material);
      setKept((prev) => new Set(prev).add(key));
      setStatus(t("studies.teaching.assist.kept"));
    } catch (e) {
      setProblem(toApiError(e).message);
    }
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

  const field = "h-11 min-w-0 flex-1 basis-56 rounded-aw border border-border bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted";
  const requestLabel = NEEDS_REQUEST.has(action) || OPTIONAL_REQUEST.has(action) ? t(`studies.teaching.assist.request.${action as "question"}`) : null;

  return (
    <section
      aria-labelledby={`${id}-title`}
      onKeyDown={keys}
      data-testid="assist-panel"
      className="flex flex-col gap-3 rounded-aw border border-border border-l-[4px] border-l-accent bg-bg-secondary px-4 py-3 font-ui text-[0.9375rem]"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 ref={titleRef} tabIndex={-1} id={`${id}-title`} className="m-0 text-[1rem] font-semibold text-text-strong">
          {t("studies.teaching.assist.title", { action: assistLabel(t, action), part: target.label })}
        </h4>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("studies.teaching.assist.close")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-aw text-text-muted hover:bg-bg hover:text-text-strong"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {target.selection && <p className="m-0 text-text-muted">{t("studies.teaching.assist.selectionOnly")}</p>}

      {!reply && (
        <>
          {requestLabel && action === "free" && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-request`} className="text-text-strong">
                {requestLabel}
              </label>
              <textarea
                id={`${id}-request`}
                ref={(el) => {
                  first.current = el;
                }}
                rows={3}
                maxLength={REQUEST_MAX}
                value={request}
                disabled={busy}
                onChange={(e) => setRequest(e.target.value)}
                aria-describedby={`${id}-request-hint`}
                placeholder={t("studies.teaching.assist.freePlaceholder")}
                className="w-full rounded-aw border border-border bg-bg px-3 py-2 text-[0.9375rem] placeholder:text-text-muted"
              />
              <p id={`${id}-request-hint`} className="m-0 text-[0.875rem] text-text-muted">
                {t("studies.teaching.assist.freeHint")}
              </p>
            </div>
          )}
          {requestLabel && action !== "free" && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-text-strong">{requestLabel}</span>
              <input
                ref={(el) => {
                  first.current = el;
                }}
                value={request}
                maxLength={REQUEST_MAX}
                disabled={busy}
                onChange={(e) => setRequest(e.target.value)}
                className={field}
              />
            </label>
          )}
          {action === "audience" && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-text-strong">{t("studies.teaching.assist.audienceLabel")}</span>
              <input
                ref={(el) => {
                  first.current = el;
                }}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder={t("studies.teaching.assist.audiencePlaceholder")}
                className={field}
              />
            </label>
          )}
          {action === "translate" && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-text-strong">{t("studies.teaching.assist.languageLabel")}</span>
              <input
                ref={(el) => {
                  first.current = el;
                }}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder={t("studies.teaching.assist.languagePlaceholder")}
                className={field}
              />
            </label>
          )}
          {preview && <Shared preview={preview} target={target} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={askButton}
              variant="primary"
              className="min-h-11"
              disabled={busy || !preview || needsInput}
              onClick={() => void ask()}
            >
              {t("studies.teaching.assist.ask")}
            </Button>
            <Button className="min-h-11" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            {!busy && <span className="text-[0.875rem] text-text-muted">{t("studies.teaching.assist.askHint")}</span>}
          </div>
          {busy && <Pending message={action === "story" ? t("studies.teaching.assist.pending.story") : t("studies.teaching.assist.pending.ask")} onStop={stop} />}
        </>
      )}

      {problem && (
        <p role="alert" className="m-0 text-danger">
          {problem}
        </p>
      )}

      {reply && (
        <div className="flex flex-col gap-3">
          <Result
            reply={reply}
            target={target}
            heading={resultHeading}
            kept={kept}
            onApply={(text, placement) => {
              const done = props.onApply(text, placement);
              if (!done) setProblem(t("studies.teaching.assist.changedMeanwhile"));
              return done;
            }}
            onInsertBelow={props.onInsertBelow}
            singleLine={singleLine}
            onKeep={keep}
            onAddPassage={onAddPassage}
            canFindImages={canFindImages}
            canGenerateImages={canGenerateImages}
            imagesNote={imagesNote}
          />
          <p className="m-0 text-[0.8125rem] text-text-muted">{t("studies.teaching.assist.from", { assistant: reply.assistant })}</p>
          <div>
            <Button className="min-h-11" onClick={onClose}>
              {t("studies.teaching.assist.done")}
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

/** "What will be shared": where it goes and which pieces, in plain words. */
function Shared({ preview, target }: { preview: AssistPreview; target: AssistTarget }) {
  const { t } = useTranslation();
  const items: string[] = [];
  const count = (kind: string) => preview.shared.filter((s) => s.kind === kind);
  if (count("text").length) items.push(target.selection ? t("studies.teaching.assist.shared.selection") : t("studies.teaching.assist.shared.text", { part: target.label }));
  const asked = count("request")[0];
  if (asked) items.push(t("studies.teaching.assist.shared.request"));
  if (count("teaching").length) items.push(t("studies.teaching.assist.shared.teaching"));
  if (count("nearby").length) items.push(t("studies.teaching.assist.shared.nearby", { count: count("nearby").length }));
  const passages = count("passage")
    .map((p) => (p.reference ? referenceLabel(p.reference) : p.label))
    .join(", ");
  if (passages) items.push(t("studies.teaching.assist.shared.passages", { passages }));
  const findings = Number(count("finding")[0]?.label ?? 0);
  if (findings) items.push(t("studies.teaching.assist.shared.findings", { count: findings }));
  const quotes = Number(count("source")[0]?.label ?? 0);
  if (quotes) items.push(t("studies.teaching.assist.shared.quotes", { count: quotes }));
  return (
    <div className="flex flex-col gap-1 rounded-aw bg-bg px-3 py-2">
      <p className="m-0 font-medium text-text-strong">
        {preview.remote
          ? t("studies.teaching.assist.shared.remote", { assistant: preview.assistant })
          : t("studies.teaching.assist.shared.local", { assistant: preview.assistant })}
      </p>
      <ul className="m-0 list-disc pl-5 text-text">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {preview.searches && <p className="m-0 text-text-muted">{t("studies.teaching.assist.shared.searches")}</p>}
    </div>
  );
}

interface ResultProps {
  reply: AssistReply;
  target: AssistTarget;
  heading: React.RefObject<HTMLHeadingElement | null>;
  kept: Set<string>;
  onApply: AssistPanelProps["onApply"];
  onInsertBelow: AssistPanelProps["onInsertBelow"];
  singleLine: boolean;
  onKeep: (key: string, material: Material) => Promise<void>;
  onAddPassage: AssistPanelProps["onAddPassage"];
  canFindImages: boolean;
  canGenerateImages: boolean;
  imagesNote: "off" | "unsupported" | null;
}

function Heading({ heading, children, icon }: { heading: ResultProps["heading"]; children: ReactNode; icon: ReactNode }) {
  return (
    <h5 ref={heading} tabIndex={-1} className="m-0 flex items-center gap-2 text-[1rem] font-semibold text-text-strong">
      {icon}
      {children}
    </h5>
  );
}

function Result(props: ResultProps) {
  const { reply, target, heading, kept, onApply, onInsertBelow, singleLine, onKeep, onAddPassage } = props;
  const { t } = useTranslation();
  const { goTo } = useScripture();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const result = reply.result;
  const keptLabel = <span className="text-text-muted">{t("studies.teaching.assist.keptLabel")}</span>;

  if (result.type === "proposal") {
    const same = !changes(target.text, result.suggestion);
    const parts = result.placement === "replace" ? wordDiff(target.text, result.suggestion) : [{ kind: "added" as const, text: result.suggestion }];
    return (
      <div className="flex flex-col gap-2">
        <Heading heading={heading} icon={<MessageSquare className="size-4" aria-hidden="true" />}>
          {result.placement === "start" ? t("studies.teaching.assist.proposal.headingStart") : t("studies.teaching.assist.proposal.heading")}
        </Heading>
        <p className="m-0 text-text-muted">{t("studies.teaching.assist.proposal.notYet")}</p>
        {same ? (
          <p className="m-0 text-text-strong">{t("studies.teaching.assist.proposal.same")}</p>
        ) : (
          <p data-testid="assist-diff" className="reading m-0 whitespace-pre-wrap rounded-aw border border-border-subtle bg-bg px-3 py-2 text-[1.0625rem] text-text-strong">
            {parts.map((part, i) =>
              part.kind === "same" ? (
                <span key={i}>{part.text}</span>
              ) : part.kind === "removed" ? (
                <del key={i} className="mx-0.5 rounded-sm px-0.5 text-text-muted line-through decoration-danger decoration-2">
                  <span className="sr-only">{t("studies.teaching.assist.proposal.removed")} </span>
                  {part.text}
                </del>
              ) : (
                <ins key={i} className="mx-0.5 rounded-sm bg-note px-0.5 font-semibold text-text-strong no-underline [text-decoration-line:underline] decoration-accent decoration-2 underline-offset-2">
                  <span className="sr-only">{t("studies.teaching.assist.proposal.added")} </span>
                  {part.text}
                </ins>
              ),
            )}
          </p>
        )}
        {result.changes && <p className="m-0 text-text">{t("studies.teaching.assist.proposal.changes", { changes: result.changes })}</p>}
        {!same && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" className="min-h-11" onClick={() => onApply(result.suggestion, result.placement)}>
              {result.placement === "start" ? t("studies.teaching.assist.proposal.useStart") : t("studies.teaching.assist.proposal.use")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (result.type === "comments") {
    return (
      <div className="flex flex-col gap-2">
        <Heading heading={heading} icon={<MessageSquare className="size-4" aria-hidden="true" />}>
          {t("studies.teaching.assist.comments.heading")}
        </Heading>
        {result.summary && <p className="m-0 text-text">{result.summary}</p>}
        {result.comments.length === 0 && <p className="m-0 text-text-muted">{t("studies.teaching.assist.comments.none")}</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {result.comments.map((c, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-aw border border-border-subtle bg-bg px-3 py-2">
              {c.excerpt && <q className="text-text-muted">{c.excerpt}</q>}
              <p className="m-0 text-text-strong">{c.comment}</p>
              <p className="m-0 text-[0.8125rem] text-text-muted">{t(`studies.teaching.assist.basis.${c.basis}`)}</p>
              {c.passages.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.875rem] text-text-muted">{t("studies.teaching.assist.comments.suggested")}</span>
                  {c.passages.map((p) => {
                    const name = referenceLabel(p);
                    const key = `${i}-${p.canonical}`;
                    return (
                      <span key={p.canonical} className="inline-flex flex-wrap items-center gap-1">
                        <button type="button" onClick={() => goTo(p)} className="min-h-11 rounded-aw px-2 text-link underline underline-offset-2 hover:bg-bg-secondary">
                          {name}
                        </button>
                        {added.has(key) ? (
                          keptLabel
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onAddPassage(p).then(() => setAdded((prev) => new Set(prev).add(key)))}
                            aria-label={t("studies.teaching.assist.comments.addPassage", { passage: name })}
                            className="min-h-11 rounded-aw border border-border px-2 text-[0.875rem] hover:bg-bg-secondary"
                          >
                            {t("studies.teaching.assist.comments.add")}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.type === "options") {
    const invented = result.standing === "hypothetical";
    return (
      <div className="flex flex-col gap-2">
        <Heading heading={heading} icon={<Lightbulb className="size-4" aria-hidden="true" />}>
          {invented ? t("studies.teaching.assist.options.headingInvented") : t("studies.teaching.assist.options.heading")}
        </Heading>
        {invented && <p className="m-0 font-medium text-text-strong">{t("studies.teaching.assist.options.invented")}</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {result.options.map((o, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-aw border border-border-subtle bg-bg px-3 py-2">
              <p className="reading m-0 whitespace-pre-wrap text-text-strong">{o.text}</p>
              {o.note && <p className="m-0 text-[0.875rem] text-text-muted">{o.note}</p>}
              <div className="flex flex-wrap gap-2">
                {!invented && singleLine && (
                  <Button className="min-h-11" onClick={() => onApply(o.text, "replace")}>
                    {t("studies.teaching.assist.options.use")}
                  </Button>
                )}
                {!invented && !singleLine && onInsertBelow && (
                  <Button className="min-h-11" onClick={() => onInsertBelow(o.text)}>
                    {t("studies.teaching.assist.options.insert")}
                  </Button>
                )}
                {invented &&
                  (kept.has(`o${i}`) ? (
                    keptLabel
                  ) : (
                    <Button
                      className="min-h-11"
                      onClick={() =>
                        void onKeep(`o${i}`, {
                          kind: "illustration",
                          standing: "hypothetical",
                          title: "",
                          content: o.text,
                          assistant: reply.assistant,
                        })
                      }
                    >
                      {t("studies.teaching.assist.options.keepIdea")}
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.type === "stories") {
    return (
      <div className="flex flex-col gap-2">
        <Heading heading={heading} icon={<Search className="size-4" aria-hidden="true" />}>
          {t("studies.teaching.assist.stories.heading")}
        </Heading>
        {result.stories.length === 0 ? (
          <p className="m-0 font-medium text-text-strong">{t("studies.teaching.assist.stories.none")}</p>
        ) : (
          <p className="m-0 text-text-muted">{t("studies.teaching.assist.stories.checkNote")}</p>
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {result.stories.map((s, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-aw border border-border-subtle bg-bg px-3 py-2">
              <p className="m-0 font-semibold text-text-strong">{s.title}</p>
              <p className={`m-0 text-[0.875rem] font-medium ${s.standing === "verified" ? "text-text-strong" : "text-danger"}`}>
                {s.standing === "verified" ? t("studies.teaching.standing.verified") : t("studies.teaching.standing.unverified")}
              </p>
              <p className="m-0 text-text">{s.summary}</p>
              <Sources sources={s.sources} />
              {kept.has(`s${i}`) ? (
                keptLabel
              ) : (
                <div>
                  <Button
                    className="min-h-11"
                    onClick={() =>
                      void onKeep(`s${i}`, {
                        kind: "story",
                        standing: s.standing,
                        title: s.title,
                        content: s.summary,
                        sources: s.sources,
                        assistant: reply.assistant,
                      })
                    }
                  >
                    {t("studies.teaching.assist.stories.keep")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return <Visuals {...props} ideas={result.ideas} />;
}

/** Links to the pages a search returned, opened in the browser on a click. */
export function Sources({ sources }: { sources: { title: string; url: string; site: string }[] }) {
  const { t } = useTranslation();
  const api = useApi();
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.8125rem] font-medium text-text-muted">{t("studies.teaching.assist.stories.sources")}</span>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {sources.map((s) => (
          <li key={s.url}>
            <button
              type="button"
              onClick={() => void api.openExternalLink(s.url)}
              className="inline-flex min-h-11 items-center gap-1 rounded-aw px-1 text-left text-link underline underline-offset-2 hover:bg-bg-secondary"
            >
              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {s.title || s.url} <span className="text-text-muted">({s.site})</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Visuals({ reply, heading, kept, onKeep, canFindImages, canGenerateImages, imagesNote, ideas }: ResultProps & { ideas: VisualIdea[] }) {
  const { t } = useTranslation();
  const api = useApi();
  const [found, setFound] = useState<Record<number, FoundImage[] | "loading">>({});
  const [made, setMade] = useState<Record<number, GeneratedImage | "loading">>({});
  const [error, setError] = useState<string | null>(null);

  const find = async (i: number, terms: string) => {
    if (found[i] === "loading") return;
    setError(null);
    setFound((prev) => ({ ...prev, [i]: "loading" }));
    try {
      const images = await api.assistantFindImages(terms);
      setFound((prev) => ({ ...prev, [i]: images }));
    } catch (e) {
      setFound((prev) => ({ ...prev, [i]: [] }));
      setError(toApiError(e).message);
    }
  };
  const make = async (i: number, description: string) => {
    if (made[i] === "loading") return;
    setError(null);
    setMade((prev) => ({ ...prev, [i]: "loading" }));
    try {
      const image = await api.assistantGenerateImage(description);
      setMade((prev) => ({ ...prev, [i]: image }));
    } catch (e) {
      setMade((prev) => {
        const next = { ...prev };
        delete next[i];
        return next;
      });
      setError(toApiError(e).message);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Heading heading={heading} icon={<ImageIcon className="size-4" aria-hidden="true" />}>
        {t("studies.teaching.assist.visuals.heading")}
      </Heading>
      {ideas.length === 0 && <p className="m-0 text-text-muted">{t("studies.teaching.assist.comments.none")}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {ideas.map((idea, i) => {
          const images = found[i];
          const generated = made[i];
          return (
            <li key={i} className="flex flex-col gap-2 rounded-aw border border-border-subtle bg-bg px-3 py-2">
              <p className="m-0 text-text-strong">
                <span className="font-medium">{t(`studies.teaching.assist.visuals.kind.${idea.kind}`)}:</span> {idea.description}
              </p>
              <p className="m-0 text-[0.8125rem] text-text-muted">{t("studies.teaching.standing.suggestion")}</p>
              <div className="flex flex-wrap gap-2">
                {canFindImages && (
                  <Button className="min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-60" aria-disabled={images === "loading"} onClick={() => void find(i, idea.searchTerms || idea.description)}>
                    <Search className="size-4" aria-hidden="true" />
                    {t("studies.teaching.assist.visuals.find")}
                  </Button>
                )}
                {canGenerateImages ? (
                  <Button className="min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-60" aria-disabled={generated === "loading"} onClick={() => void make(i, idea.description)}>
                    <ImageIcon className="size-4" aria-hidden="true" />
                    {t("studies.teaching.assist.visuals.make")}
                  </Button>
                ) : (
                  imagesNote && (
                    // Not available: shown, with the reason, so it is clear why (finding images still works).
                    <Button className="min-h-11" disabled aria-describedby={`no-make-${i}`}>
                      <ImageIcon className="size-4" aria-hidden="true" />
                      {t("studies.teaching.assist.visuals.make")}
                    </Button>
                  )
                )}
                {kept.has(`v${i}`) ? (
                  <span className="self-center text-text-muted">{t("studies.teaching.assist.keptLabel")}</span>
                ) : (
                  <Button
                    className="min-h-11"
                    onClick={() =>
                      void onKeep(`v${i}`, { kind: "visual", standing: "suggestion", title: "", content: idea.description, assistant: reply.assistant })
                    }
                  >
                    {t("studies.teaching.assist.visuals.keepIdea")}
                  </Button>
                )}
              </div>
              {!canGenerateImages && imagesNote && (
                <p id={`no-make-${i}`} className="m-0 text-[0.8125rem] text-text-muted">
                  {t(`studies.teaching.assist.visuals.cannotMake.${imagesNote}`)}
                </p>
              )}
              {images === "loading" && <Pending message={t("studies.teaching.assist.pending.findImages")} />}
              {Array.isArray(images) && images.length === 0 && <p className="m-0 text-text-muted">{t("studies.teaching.assist.images.none")}</p>}
              {Array.isArray(images) && images.length > 0 && (
                <ul aria-label={t("studies.teaching.assist.images.found")} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2 p-0">
                  {images.map((image) => (
                    <li key={image.url} className="flex flex-col gap-1">
                      {image.thumbData ? (
                        <img src={image.thumbData} alt={image.title} className="aspect-[4/3] w-full rounded-aw border border-border-subtle object-cover" />
                      ) : (
                        <span className="flex aspect-[4/3] items-center justify-center rounded-aw border border-border-subtle text-text-muted">
                          <ImageIcon className="size-6" aria-hidden="true" />
                        </span>
                      )}
                      <span className="text-[0.8125rem] text-text">{image.title}</span>
                      <span className="text-[0.8125rem] text-text-muted">{t("studies.teaching.standing.found", { licence: image.licence })}</span>
                      {image.author && <span className="text-[0.8125rem] text-text-muted">{t("studies.teaching.assist.images.by", { author: image.author })}</span>}
                      <button
                        type="button"
                        onClick={() => void api.openExternalLink(image.pageUrl)}
                        className="inline-flex min-h-11 items-center gap-1 rounded-aw px-1 text-left text-[0.8125rem] text-link underline underline-offset-2"
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        {t("studies.teaching.assist.images.source")}
                      </button>
                      {kept.has(image.url) ? (
                        <span className="text-text-muted">{t("studies.teaching.assist.keptLabel")}</span>
                      ) : (
                        <Button
                          className="min-h-11"
                          aria-label={t("studies.teaching.assist.images.keepLabel", { title: image.title })}
                          onClick={() =>
                            void onKeep(image.url, {
                              kind: "image",
                              standing: "found",
                              title: image.title,
                              content: idea.description,
                              image: {
                                url: image.url,
                                pageUrl: image.pageUrl,
                                thumbUrl: image.thumbUrl,
                                licence: image.licence,
                                licenceUrl: image.licenceUrl,
                                author: image.author,
                                attribution: image.attribution,
                              },
                            })
                          }
                        >
                          {t("studies.teaching.assist.images.keep")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {generated === "loading" && <Pending message={t("studies.teaching.assist.pending.makeImage")} />}
              {generated && generated !== "loading" && (
                <div className="flex flex-col gap-1">
                  <img src={generated.dataUrl} alt={t("studies.teaching.assist.images.generatedAlt", { description: idea.description })} className="w-full max-w-sm rounded-aw border border-border-subtle" />
                  <span className="text-[0.875rem] font-medium text-text-strong">{t("studies.teaching.standing.generated")}</span>
                  {kept.has(generated.file) ? (
                    <span className="text-text-muted">{t("studies.teaching.assist.keptLabel")}</span>
                  ) : (
                    <div>
                      <Button
                        className="min-h-11"
                        onClick={() =>
                          void onKeep(generated.file, {
                            kind: "image",
                            standing: "generated",
                            title: "",
                            content: idea.description,
                            image: { file: generated.file },
                            assistant: generated.assistant,
                          })
                        }
                      >
                        {t("studies.teaching.assist.images.keep")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
      <p className="m-0 flex items-center gap-1 text-[0.8125rem] text-text-muted">
        <BookOpen className="size-3.5" aria-hidden="true" />
        {t("studies.teaching.assist.images.nothingPlaced")}
      </p>
    </div>
  );
}
