import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";

interface HelpTipProps {
  /** The button's accessible name, e.g. "About the theme". */
  name: string;
  children: ReactNode;
  /** Which side the explanation opens towards (it never pushes the page down). */
  align?: "start" | "end";
}

/**
 * A quiet "?" beside a label that opens a short explanation over the page,
 * so explanations do not make the page taller. Hover shows it on a desktop;
 * a click, a tap, or Enter/Space on the focused button opens it and keeps it
 * open; Escape, the button again, or a click elsewhere closes it.
 *
 * Only explanations go here (what an option means, why it exists, privacy
 * details). What the person must see, such as a missing key or a failed
 * check, stays in the page.
 *
 * The explanation follows the button in the document (the disclosure
 * pattern), so a screen reader reaches it next.
 */
export function HelpTip({ name, children, align = "start" }: HelpTipProps) {
  const id = useId();
  // "pinned": opened by a click, tap or key; "peek": shown while hovered.
  const [state, setState] = useState<"closed" | "peek" | "pinned">("closed");
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const open = state !== "closed";

  useEffect(() => {
    if (state !== "pinned") return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setState("closed");
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [state]);

  return (
    <span
      ref={box}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setState((s) => (s === "closed" ? "peek" : s))}
      onMouseLeave={() => setState((s) => (s === "peek" ? "closed" : s))}
      // Focus leaving it (Tab onwards) closes it, so a later Escape belongs to the page again.
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) setState("closed");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          // Closes only the explanation, not the page it sits in.
          e.preventDefault();
          e.stopPropagation();
          setState("closed");
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={name}
        aria-expanded={state === "pinned"}
        aria-controls={id}
        onClick={() => setState((s) => (s === "pinned" ? "closed" : "pinned"))}
        className="-my-2 inline-flex size-11 items-center justify-center rounded-full text-text-muted hover:bg-hover hover:text-text-strong"
      >
        <CircleHelp className="size-[1.125rem]" aria-hidden="true" />
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        className={`absolute top-full z-30 mt-1 block w-max max-w-[min(20rem,calc(100vw-2rem))] aw-popover px-3 py-2 text-left text-[0.875rem] font-normal leading-snug text-text shadow-lg ${align === "end" ? "right-0" : "left-0"}`}
      >
        {children}
      </span>
    </span>
  );
}
