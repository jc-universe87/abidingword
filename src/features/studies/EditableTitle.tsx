import { useCallback, useState } from "react";
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

  return (
    <div>
      <h1 className="m-0">
        <input
          aria-label={label}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) schedule(e.target.value);
          }}
          onBlur={() => {
            if (blank) setText(saved);
            else flush();
          }}
          aria-invalid={blank || undefined}
          className="w-full rounded-aw border border-transparent bg-transparent px-2 py-1 -mx-2 font-display text-[1.875rem] font-heading leading-tight text-text-strong hover:border-border-subtle focus:border-border"
        />
      </h1>
      {blank && (
        <p role="alert" className="m-0 mt-1 text-[0.9375rem] text-danger">
          A title is required. Leaving the field keeps the previous title.
        </p>
      )}
    </div>
  );
}
