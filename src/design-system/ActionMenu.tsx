import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export interface MenuAction {
  label: string;
  /** Told the menu's button, where focus can go back to afterwards. */
  onSelect: (opener: HTMLButtonElement | null) => void;
  icon?: ReactNode;
}

/**
 * A quiet "⋯" button with a short list of actions, for things that should be
 * at hand without crowding a row. A real menu: Enter or Space opens it on its
 * first item, arrow keys move, Escape closes it and gives focus back to the
 * button, Tab leaves it. The menu is part of the page flow, never a modal.
 */
export function ActionMenu({ label, actions, className = "" }: { label: string; actions: MenuAction[]; className?: string }) {
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
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-9 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-text-strong"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
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
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onSelect(button.current);
              }}
              className="flex min-h-10 items-center gap-2 whitespace-nowrap rounded-[4px] px-3 text-left text-[0.9375rem] text-text-strong hover:bg-bg-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
