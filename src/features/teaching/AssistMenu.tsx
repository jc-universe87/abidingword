import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Lightbulb, MessageSquarePlus } from "lucide-react";
import type { AssistAction, TeachingPart } from "@/types/teaching";
import { assistCategories, assistLabel, type AssistCategory } from "./labels";

/**
 * "Help" beside a part of the teaching. A short first level of plain
 * categories (improve my wording, review what I wrote…), each opening its own
 * few actions, and "Ask for something else…" for a request in the person's
 * own words. Only shown when the assistant is turned on. Opening it changes
 * nothing; choosing an action only opens the assistant's panel, which says
 * what would be shared before anything is sent.
 *
 * A real menu: arrow keys move; Enter or → opens a category; ← or Escape goes
 * back a level; Escape at the first level closes it and gives focus back.
 */
export function AssistMenu({
  part,
  partLabel,
  onChoose,
  imagesNote = null,
}: {
  part: TeachingPart;
  partLabel: string;
  onChoose: (action: AssistAction) => void;
  /** Why images cannot be made, shown with the picture ideas. */
  imagesNote?: "off" | "unsupported" | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<AssistCategory | null>(null);
  // The category to focus when coming back to the first level.
  const returnTo = useRef<AssistCategory | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const categories = assistCategories(part);
  const actions = categories.find((c) => c.category === category)?.actions ?? [];

  useEffect(() => {
    if (!open) return;
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
    const back = returnTo.current && !category ? items.find((i) => i.dataset.category === returnTo.current) : null;
    // In a category, the first action (not "Back") has the focus.
    (back ?? (category ? items[1] : items[0]))?.focus();
  }, [open, category]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function close(focusButton: boolean) {
    setOpen(false);
    setCategory(null);
    returnTo.current = null;
    if (focusButton) button.current?.focus();
  }

  const enter = (next: AssistCategory) => {
    returnTo.current = next;
    setCategory(next);
  };
  const leave = () => setCategory(null);

  const choose = (action: AssistAction) => {
    close(false);
    onChoose(action);
  };

  const move = (step: number) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  const keys = (e: KeyboardEvent) => {
    const focused = document.activeElement as HTMLElement | null;
    if (e.key === "Escape" || (e.key === "ArrowLeft" && category)) {
      e.preventDefault();
      e.stopPropagation();
      if (category) leave();
      else if (e.key === "Escape") close(true);
    } else if (e.key === "ArrowRight" && !category && focused?.dataset.category) {
      e.preventDefault();
      enter(focused.dataset.category as AssistCategory);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
      (e.key === "Home" ? items[0] : items[items.length - 1])?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const item =
    "flex min-h-11 w-full items-center gap-2 px-3 text-left text-[0.9375rem] text-text-strong outline-none hover:bg-bg-secondary focus-visible:bg-bg-secondary focus-visible:shadow-[inset_3px_0_0_var(--aw-primary)]";
  const menuName = category ? t(`studies.teaching.assist.category.${category}`) : t("studies.teaching.assist.menuLabel", { part: partLabel });

  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t("studies.teaching.assist.menuLabel", { part: partLabel })}
        title={t("studies.teaching.assist.menuTitle")}
        onClick={() => (open ? close(false) : setOpen(true))}
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
          aria-label={menuName}
          onKeyDown={keys}
          className="absolute right-0 top-full z-20 mt-1 flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-aw border border-border bg-bg py-1 shadow-lg"
        >
          {category ? (
            <>
              <button type="button" role="menuitem" tabIndex={-1} onClick={leave} className={`${item} text-text-muted`}>
                <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
                {t("studies.teaching.assist.allHelp")}
              </button>
              <p aria-hidden="true" className="m-0 border-t border-border-subtle px-3 pb-1 pt-2 text-[0.875rem] font-semibold text-text-strong">
                {menuName}
              </p>
              <div role="group" aria-label={menuName} className="flex flex-col pb-1">
                {actions.map((action) => (
                  <button key={action} type="button" role="menuitem" tabIndex={-1} onClick={() => choose(action)} className={`${item} pl-5`}>
                    {assistLabel(t, action)}
                  </button>
                ))}
              </div>
              {category === "ideas" && imagesNote && (
                <p role="none" className="m-0 border-t border-border-subtle px-3 py-1.5 text-[0.8125rem] text-text-muted">
                  {t(`studies.teaching.assist.visuals.cannotMake.${imagesNote}`)}
                </p>
              )}
            </>
          ) : (
            <>
              <p aria-hidden="true" className="m-0 px-3 pb-1 pt-1.5 text-[0.8125rem] text-text-muted">
                {t("studies.teaching.assist.menuIntro")}
              </p>
              {categories.map(({ category: c }) => (
                <button key={c} type="button" role="menuitem" tabIndex={-1} data-category={c} onClick={() => enter(c)} className={item}>
                  <span className="flex-1">{t(`studies.teaching.assist.category.${c}`)}</span>
                  <ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                </button>
              ))}
              <div role="separator" className="my-1 border-t border-border-subtle" />
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose("free")} className={`${item} font-medium`}>
                <MessageSquarePlus className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                {t("studies.teaching.assist.action.free")}
              </button>
            </>
          )}
        </div>
      )}
    </span>
  );
}
