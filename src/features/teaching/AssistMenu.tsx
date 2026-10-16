import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb } from "lucide-react";
import type { AssistAction, TeachingPart } from "@/types/teaching";
import { assistGroups, assistLabel } from "./labels";

/**
 * "Help" beside a part of the teaching: a short menu in three groups
 * (wording, comments, ideas). Only shown when the assistant is turned on.
 * Opening it changes nothing; choosing an action only opens the assistant's
 * panel, which says what would be shared before anything is sent.
 * A real menu: arrow keys move, Escape closes it and gives focus back.
 */
export function AssistMenu({ part, partLabel, onChoose }: { part: TeachingPart; partLabel: string; onChoose: (action: AssistAction) => void }) {
  const { t } = useTranslation();
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

  const move = (step: number) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t("studies.teaching.assist.menuLabel", { part: partLabel })}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong"
      >
        <Lightbulb className="size-4" aria-hidden="true" />
        {t("studies.teaching.assist.menu")}
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={t("studies.teaching.assist.menuLabel", { part: partLabel })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              button.current?.focus();
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
          className="absolute right-0 top-full z-20 mt-1 flex max-h-[70vh] w-72 flex-col overflow-y-auto rounded-aw border border-border bg-bg py-1 shadow-lg"
        >
          {assistGroups(part).map(({ group, actions }) => (
            <div key={group} role="group" aria-label={t(`studies.teaching.assist.group.${group}`)} className="flex flex-col py-1">
              <span aria-hidden="true" className="px-3 pb-1 pt-1 text-[0.8125rem] font-semibold uppercase tracking-wide text-text-muted">
                {t(`studies.teaching.assist.group.${group}`)}
              </span>
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setOpen(false);
                    onChoose(action);
                  }}
                  className="min-h-11 px-3 text-left text-[0.9375rem] text-text-strong hover:bg-bg-secondary focus:bg-bg-secondary"
                >
                  {assistLabel(t, action)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
