import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface SheetProps {
  /** The id of the heading inside that names the sheet. */
  labelledBy: string;
  children: ReactNode;
}

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/**
 * A larger task over the current page (adding a Bible, editing a template):
 * the page stays visible, dimmed, behind it and keeps its place, open
 * sections and scroll position. Tab stays inside; when the sheet closes,
 * focus goes back to what opened it. The content brings its own Back/Close
 * and handles Escape itself (it may need to tidy up first, or refuse while
 * busy). The backdrop does not close it, so a click beside it loses nothing.
 */
export function Sheet({ labelledBy, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  // Taken while rendering, before the content moves focus inside.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const root = panel.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !root) return;
      // A dialog opened from inside the sheet keeps Tab itself.
      const modals = document.querySelectorAll("[aria-modal='true']");
      if (modals[modals.length - 1] !== root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled") && !el.closest("[hidden]"));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
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
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  return createPortal(
    <div className="fixed inset-0 z-40 bg-[rgba(22,39,31,0.35)]">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid="sheet"
        className="absolute inset-2 flex flex-col overflow-hidden rounded-[var(--aw-radius-lg)] border border-border bg-bg text-text shadow-2xl sm:inset-4 md:left-auto md:w-[min(48rem,calc(100%-6rem))]"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
