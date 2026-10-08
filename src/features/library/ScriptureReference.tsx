import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { referenceLabel } from "@/i18n/scripture";
import type { ScriptureRef } from "@/types/scripture";

export interface ScriptureReferenceClasses {
  wrap: string;
  trigger: string;
  menu: string;
  item: string;
}

/** The look inside the app (the Reading view). A formatted page draws its own in its shadow root. */
export const APP_REFERENCE_CLASSES: ScriptureReferenceClasses = {
  wrap: "relative inline",
  trigger:
    "inline cursor-pointer rounded-sm p-0 text-left align-baseline font-[inherit] text-[length:inherit] text-inherit underline decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary aria-expanded:bg-note",
  menu: "absolute left-0 top-full z-20 mt-1 flex min-w-max flex-col rounded-aw border border-border bg-surface p-1 font-ui shadow-md",
  item: "min-h-10 whitespace-nowrap rounded-[4px] px-3 text-left text-[0.9375rem] text-text-strong hover:bg-bg-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
};

interface ScriptureReferenceProps {
  reference: ScriptureRef;
  /** The reference exactly as written in the source. */
  children: ReactNode;
  onOpen: (reference: ScriptureRef) => void;
  classes?: ScriptureReferenceClasses;
}

/**
 * A Scripture reference written in a source: quiet link styling, and on
 * activation a small menu with **Open in Bible**. It never navigates by
 * itself, so a stray click while reading moves nothing. Escape closes the menu
 * and returns focus to the reference; so does a click elsewhere (without
 * taking focus).
 */
export function ScriptureReference({ reference, children, onOpen, classes = APP_REFERENCE_CLASSES }: ScriptureReferenceProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const menuId = useId();
  const passage = referenceLabel(reference);

  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const root = (wrap.current?.getRootNode() ?? document) as Document | ShadowRoot;
    const away = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    root.addEventListener("pointerdown", away);
    return () => root.removeEventListener("pointerdown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <span ref={wrap} className={classes.wrap} data-scripture-ref={reference.canonical}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("library.scriptureRef.label", { passage })}
        title={t("library.scriptureRef.label", { passage })}
        onClick={() => setOpen((v) => !v)}
        className={classes.trigger}
      >
        {children}
      </button>
      {open && (
        <span
          id={menuId}
          role="menu"
          aria-label={t("library.scriptureRef.actions", { passage })}
          className={classes.menu}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          <button
            ref={item}
            type="button"
            role="menuitem"
            className={classes.item}
            onClick={() => {
              setOpen(false);
              onOpen(reference);
            }}
          >
            {t("library.scriptureRef.open")}
          </button>
        </span>
      )}
    </span>
  );
}
