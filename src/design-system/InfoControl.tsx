import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";
import { toApiError } from "@/lib/api";
import { Button } from "./Button";

/**
 * Information about a project, a study or a teaching (v0.19), opened on
 * request from a compact control and shown in a panel anchored to it. The
 * work underneath stays exactly as it was.
 *
 * Its fields are a draft. Nothing is written while they change: Save applies
 * the whole draft at once and closes the panel, or keeps it open with the
 * reason when saving fails. Cancel, the close button, Escape and a click
 * outside close it and discard the draft; never saved silently. When a
 * draft with changes is discarded a short note says so.
 *
 * `actions` holds what acts at once by its own button (add a passage,
 * duplicate, delete with its own confirmation): explicit actions, not fields.
 */
export function InfoControl<T>({
  title,
  buttonLabel,
  initial,
  current,
  save,
  fields,
  actions,
  className = "",
}: {
  /** The panel's heading and the control's accessible name: "Bible Study information". */
  title: string;
  /** The short visible text of the control ("Info"). */
  buttonLabel: string;
  /** The saved state, read when the panel opens: the draft starts from it. */
  initial: () => T;
  /** The stored state now, read just before saving: when it differs from what the draft started from, it was changed elsewhere. */
  current?: () => Promise<T>;
  /** Applies the whole draft. Throwing keeps the panel open with the message. */
  save: (draft: T) => Promise<void>;
  fields: (draft: T, setDraft: (next: T) => void) => ReactNode;
  actions?: (close: () => void) => ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<T | null>(null);
  const [draft, setDraftState] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const buttonId = useId();
  const dirty = open && draft !== null && JSON.stringify(draft) !== JSON.stringify(start);

  const show = () => {
    const saved = initial();
    setStart(saved);
    setDraftState(saved);
    setError(null);
    setNotice("");
    setOpen(true);
  };
  const close = useCallback(
    (discarded: boolean) => {
      setOpen(false);
      setError(null);
      if (discarded) setNotice(t("common.info.discarded"));
      // Back to the control it was opened from (found by id: this also runs from the panel's own actions).
      requestAnimationFrame(() => document.getElementById(buttonId)?.focus());
    },
    [t, buttonId],
  );
  const dismiss = () => close(dirty);
  const apply = async () => {
    if (busy || draft === null) return;
    if (!dirty) return close(false);
    setBusy(true);
    setError(null);
    try {
      if (current && JSON.stringify(await current()) !== JSON.stringify(start)) {
        setError(t("common.info.changedElsewhere"));
        return;
      }
      await save(draft);
      close(false);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  // The note about a discarded draft goes away by itself.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        ref={button}
        id={buttonId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onClick={() => (open ? dismiss() : show())}
        className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-hover hover:text-text-strong"
      >
        <Info className="size-4" aria-hidden="true" />
        <span aria-hidden="true">{buttonLabel}</span>
      </button>
      <span role="status" className="text-[0.9375rem] text-text-muted">
        {notice}
      </span>
      {open && draft !== null && (
        <InfoPanel title={title} anchor={button} onDismiss={dismiss}>
          <div className="flex flex-col gap-4">{fields(draft, (next) => setDraftState(next))}</div>
          {error && (
            <p role="alert" className="m-0 text-[0.9375rem] text-danger">
              {error}
            </p>
          )}
          <div data-info-actions className="flex flex-wrap items-center justify-end gap-2">
            {dirty && <span className="mr-auto text-[0.9375rem] text-text-muted">{t("common.info.unsaved")}</span>}
            <Button onClick={dismiss}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={busy || !dirty} onClick={() => void apply()}>
              {t("common.save")}
            </Button>
          </div>
          {actions && <div className="flex flex-col gap-4 border-t border-border-subtle pt-4">{actions(() => close(false))}</div>}
        </InfoPanel>
      )}
    </span>
  );
}

/**
 * The panel itself: anchored under its control and kept inside the window,
 * scrolling when it is taller than the space; across the width of a narrow
 * window. It takes focus, keeps Tab inside while open, and closes on Escape
 * or a click outside. Not a full-screen modal: nothing behind is dimmed.
 */
function InfoPanel({ title, anchor, onDismiss, children }: { title: string; anchor: React.RefObject<HTMLElement | null>; onDismiss: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect();
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const width = Math.min(560, vw - 16);
      const below = (rect?.bottom ?? 0) + 6;
      // When there is little room below, the panel starts higher, never above the window.
      const top = vh - below < 320 ? Math.max(8, vh - Math.min(vh - 16, 640) - 8) : below;
      const left = Math.min(Math.max(8, rect?.left ?? 8), vw - width - 8);
      setPlace({ top, left, width, maxHeight: vh - top - 8 });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor]);

  useEffect(() => {
    const root = panel.current;
    root?.querySelector<HTMLElement>("input, select, textarea, button:not([data-info-close])")?.focus();
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      dismissRef.current();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [anchor]);

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          dismissRef.current();
          return;
        }
        if (e.key !== "Tab") return;
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []).filter(
          (el) => !el.hasAttribute("disabled"),
        );
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      style={place ? { top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight } : undefined}
      className="fixed z-40 flex flex-col gap-4 overflow-y-auto rounded-[var(--aw-radius-lg)] border border-border bg-raised p-5 text-text shadow-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="type-worktitle m-0">
          {title}
        </h2>
        <button
          type="button"
          data-info-close
          onClick={() => dismissRef.current()}
          aria-label={t("common.close")}
          className="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-aw text-text-muted hover:bg-hover hover:text-text-strong"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
