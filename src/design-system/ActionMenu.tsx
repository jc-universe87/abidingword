import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export interface MenuAction {
  label: string;
  /** Told the menu's button, where focus can go back to afterwards. */
  onSelect: (opener: HTMLButtonElement | null) => void;
  icon?: ReactNode;
  /** A line under the label saying what the action makes or does. */
  description?: string;
}

/**
 * A quiet "⋯" button with a short list of actions, for things that should be
 * at hand without crowding a row. A real menu: Enter or Space opens it on its
 * first item, arrow keys move, Escape closes it and gives focus back to the
 * button, Tab leaves it. The menu is part of the page flow, never a modal.
 */
export function ActionMenu({
  label,
  actions,
  className = "",
  trigger,
  buttonId,
}: {
  label: string;
  actions: MenuAction[];
  className?: string;
  /** Visible content of the button (a word and an icon); without it the button is a quiet "⋯". */
  trigger?: ReactNode;
  buttonId?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const move = (step: number) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  if (actions.length === 0) return null;
  return (
    <span data-aw-skip="" className={`relative inline-flex select-none ${className}`}>
      <button
        ref={button}
        id={buttonId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        // A visible word names the button itself; the "⋯" needs a name.
        aria-label={trigger ? undefined : label}
        title={trigger ? undefined : label}
        onClick={() => setOpen((v) => !v)}
        className={
          trigger
            ? "inline-flex min-h-11 items-center gap-1.5 rounded-aw px-2 text-[0.9375rem] font-medium text-text-strong hover:bg-bg-secondary"
            : "inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-text-strong"
        }
      >
        {trigger ?? <MoreHorizontal className="size-4" aria-hidden="true" />}
      </button>
      {open && (
        <div
          id={id}
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Tab") {
              setOpen(false);
            }
          }}
          className="absolute right-0 top-full z-30 mt-1 flex min-w-max flex-col rounded-aw border border-border bg-bg p-1 font-ui shadow-md"
        >
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              // The item is named by its label; the line under it describes it.
              aria-describedby={action.description ? `${id}-d${index}` : undefined}
              onClick={() => {
                setOpen(false);
                action.onSelect(button.current);
              }}
              className={`flex min-h-11 items-center gap-2 rounded-[4px] px-3 text-left text-[0.9375rem] text-text-strong hover:bg-bg-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                action.description ? "max-w-80 py-1.5" : "whitespace-nowrap"
              }`}
            >
              {action.icon}
              {action.description ? (
                <span className="flex flex-col">
                  <span>{action.label}</span>
                  <span id={`${id}-d${index}`} aria-hidden="true" className="type-meta">
                    {action.description}
                  </span>
                </span>
              ) : (
                action.label
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
