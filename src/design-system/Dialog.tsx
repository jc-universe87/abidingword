import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface DialogProps {
  /** The dialog's heading; also its accessible name. */
  title: ReactNode;
  children: ReactNode;
  /** Buttons, right-aligned at the foot. */
  actions: ReactNode;
  /** Escape, the backdrop and Cancel all call this. */
  onClose: () => void;
}

/**
 * A small modal dialog for a confirmation. It takes focus when it opens
 * (the first button in `actions` unless another element asks with
 * `autoFocus`), keeps Tab inside, closes on Escape, and gives focus back to
 * whatever had it before. The page behind is dimmed and cannot be used.
 */
export function Dialog({ title, children, actions, onClose }: DialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    if (root && !root.contains(document.activeElement)) {
      root.querySelector<HTMLElement>("[data-dialog-actions] button")?.focus();
    }
    const focusable = () =>
      Array.from(root?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []).filter(
        (el) => !el.hasAttribute("disabled"),
      );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
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
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(22,39,31,0.45)] p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-4 rounded-aw border border-border bg-bg p-6 text-text shadow-xl"
      >
        <h2 id={titleId} className="m-0 font-display text-[1.25rem] font-heading text-text-strong">
          {title}
        </h2>
        <div className="flex flex-col gap-2">{children}</div>
        <div data-dialog-actions className="flex flex-wrap justify-end gap-2 pt-2">
          {actions}
        </div>
      </div>
    </div>,
    document.body,
  );
}
