import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAutosave } from "@/hooks/useAutosave";

interface EditableTitleProps {
  /** Accessible name, e.g. "Study title". */
  label: string;
  value: string;
  onSave: (title: string) => Promise<unknown>;
}

/**
 * A page heading the user can edit in place. Saves automatically; a blank
 * title is never saved and is restored when the field is left.
 */
export function EditableTitle({ label, value, onSave }: EditableTitleProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);

  const save = useCallback(
    async (title: string) => {
      await onSave(title);
      setSaved(title.trim());
    },
    [onSave],
  );
  const { schedule, flush } = useAutosave(save);
  const blank = !text.trim();
  const area = useRef<HTMLTextAreaElement>(null);

  // A long title wraps and stays whole; the field grows to fit it.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <div>
      <h1 className="m-0">
        <textarea
          ref={area}
          rows={1}
          aria-label={label}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) schedule(e.target.value);
          }}
          onKeyDown={(e) => {
            // A title is one line of meaning: Enter finishes it, it does not break it.
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (blank) setText(saved);
            else flush();
          }}
          aria-invalid={blank || undefined}
          className="block w-full resize-none overflow-hidden break-words rounded-aw border border-transparent border-b-border-subtle bg-transparent px-2 py-1 -mx-2 font-display text-[1.625rem] font-heading leading-tight text-text-strong hover:border-border-subtle focus:border-border"
        />
      </h1>
      {blank && (
        <p role="alert" className="m-0 mt-1 text-[0.9375rem] text-danger">
          {t("studies.titleRequiredOnBlur")}
        </p>
      )}
    </div>
  );
}
