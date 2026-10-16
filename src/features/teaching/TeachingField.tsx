import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";
import { useAutosave } from "@/hooks/useAutosave";
import type { ScriptureRef } from "@/types/scripture";
import type { AssistAction, KeepTeachingMaterial, TeachingPart } from "@/types/teaching";
import { DetectedReferences } from "@/features/studies/DetectedReferences";
import { AssistMenu } from "./AssistMenu";
import { AssistPanel, type AssistTarget } from "./AssistPanel";

/** What a field needs to offer the assistant (absent when it is turned off). */
export interface AssistantHooks {
  preparationId: string;
  canFindImages: boolean;
  canGenerateImages: boolean;
  keep: (material: Omit<KeepTeachingMaterial, "preparationId">) => Promise<void>;
  addPassage: (reference: ScriptureRef, pointId: string | null) => Promise<void>;
}

interface TeachingFieldProps {
  label: string;
  value: string;
  save: (value: string) => Promise<unknown>;
  part: TeachingPart;
  pointId?: string | null;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  /** A short explanation under the label. */
  hint?: string;
  assistant: AssistantHooks | null;
  onRevealScripture?: () => void;
  autoFocus?: boolean;
  /** For headings of points: a larger, plainer field. */
  emphasis?: boolean;
  /** A stable id for the field, so focus can be moved to it. */
  fieldId?: string;
}

/**
 * One part of the teaching: the person's own writing, saved as they type.
 * Beside it, when the assistant is on, a quiet "Help" menu. Whatever the
 * assistant suggests is shown apart, below; the text changes only when the
 * person chooses "Use this", and they can undo that straight away.
 */
export function TeachingField(props: TeachingFieldProps) {
  const { label, value, save, part, pointId = null, multiline = true, rows = 3, placeholder, hint, assistant, onRevealScripture, autoFocus, emphasis, fieldId } = props;
  const { t } = useTranslation();
  const generated = useId();
  const id = generated;
  const fid = fieldId ?? `${generated}-field`;
  const [text, setText] = useState(value);
  const [action, setAction] = useState<{ action: AssistAction; target: AssistTarget } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const area = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const { schedule, flush } = useAutosave(save);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !(el instanceof HTMLTextAreaElement)) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useLayoutEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const change = useCallback(
    (next: string) => {
      setText(next);
      schedule(next);
    },
    [schedule],
  );

  const choose = (chosen: AssistAction) => {
    flush();
    const el = area.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    const selected = end > start && text.slice(start, end).trim().length > 0;
    setNotice("");
    setAction({
      action: chosen,
      target: {
        part,
        pointId,
        label,
        text: selected ? text.slice(start, end) : text,
        selection: selected ? { start, end } : null,
      },
    });
  };

  const close = () => {
    setAction(null);
    requestAnimationFrame(() => area.current?.focus({ preventScroll: true }));
  };

  /** One line for a single-line part (an input cannot hold line breaks). */
  const fit = (value: string) => (multiline ? value : value.replace(/\s*\n+\s*/g, " "));

  /**
   * The person chose the suggestion: it goes in, and can be undone. Refused (false) when the text
   * it was made for has changed since asking, so nothing typed meanwhile is ever overwritten.
   */
  const apply = (suggestion: string, placement: "replace" | "start"): boolean => {
    if (!action) return false;
    const { selection, text: asked } = action.target;
    const current = selection ? text.slice(selection.start, selection.end) : text;
    if (current !== asked) return false;
    const words = fit(suggestion.trim());
    let next: string;
    if (placement === "start") {
      // A transition goes just before the words it leads into.
      const at = selection ? selection.start : 0;
      const after = text.slice(at);
      const lead = /^\s*/.exec(after)![0];
      next = `${text.slice(0, at)}${lead}${words} ${after.slice(lead.length)}`;
    } else if (selection) {
      // The selection's own spaces and line breaks stay where they were.
      const lead = /^\s*/.exec(asked)![0];
      const trail = /\s*$/.exec(asked)![0];
      next = text.slice(0, selection.start) + lead + words + trail + text.slice(selection.end);
    } else {
      next = words;
    }
    setUndo(text);
    change(next);
    flush();
    setNotice(t("studies.teaching.assist.applied"));
    close();
    return true;
  };

  const insertBelow = (option: string) => {
    setUndo(text);
    change(text.trim() ? `${text.trimEnd()}\n\n${option.trim()}` : option.trim());
    flush();
    setNotice(t("studies.teaching.assist.applied"));
    close();
  };

  const field = emphasis
    ? "block w-full rounded-aw border border-border-subtle bg-transparent px-3 py-2 font-display text-[1.25rem] font-heading text-text-strong placeholder:text-text-muted placeholder:font-ui placeholder:text-[1rem] hover:border-border focus:border-border"
    : "reading block w-full resize-none overflow-hidden rounded-aw border border-border-subtle bg-bg px-3 py-2 text-text placeholder:text-text-muted hover:border-border focus:border-border";

  return (
    <div className="flex flex-col gap-1">
      {emphasis ? (
        <label htmlFor={fid} className="sr-only">
          {label}
        </label>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-x-2">
          <label htmlFor={fid} className="text-[0.9375rem] font-semibold text-text-strong">
            {label}
          </label>
          {assistant && !action && <AssistMenu part={part} partLabel={label} onChoose={choose} />}
        </div>
      )}
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-[0.875rem] text-text-muted">
          {hint}
        </p>
      )}
      {multiline ? (
        <textarea
          id={fid}
          ref={(el) => {
            area.current = el;
          }}
          rows={rows}
          value={text}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            setUndo(null);
            change(e.target.value);
          }}
          onBlur={flush}
          className={field}
        />
      ) : (
        <div className="flex items-center gap-1">
          <input
            id={fid}
            ref={(el) => {
              area.current = el;
            }}
            value={text}
            placeholder={placeholder}
            aria-describedby={hint ? `${id}-hint` : undefined}
            onChange={(e) => {
              setUndo(null);
              change(e.target.value);
            }}
            onBlur={flush}
            className={`${field} h-11 min-w-0 flex-1`}
          />
          {emphasis && assistant && !action && <AssistMenu part={part} partLabel={label} onChoose={choose} />}
        </div>
      )}
      {onRevealScripture && multiline && <DetectedReferences text={text} onOpen={onRevealScripture} />}
      {undo !== null && (
        <div className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
          <span className="text-text-muted">{t("studies.teaching.assist.applied")}</span>
          <button
            type="button"
            onClick={() => {
              change(undo);
              flush();
              setUndo(null);
              setNotice(t("studies.teaching.assist.undone"));
              area.current?.focus();
            }}
            className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-text-strong underline underline-offset-2 hover:bg-bg-secondary"
          >
            <Undo2 className="size-4" aria-hidden="true" />
            {t("studies.teaching.assist.undo")}
          </button>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>
      {assistant && action && (
        <AssistPanel
          key={action.action}
          preparationId={assistant.preparationId}
          target={action.target}
          action={action.action}
          onApply={apply}
          onInsertBelow={multiline ? insertBelow : undefined}
          singleLine={!multiline}
          onKeep={(material) => assistant.keep({ ...material, pointId })}
          onAddPassage={(reference) => assistant.addPassage(reference, pointId)}
          onClose={close}
          canFindImages={assistant.canFindImages}
          canGenerateImages={assistant.canGenerateImages}
        />
      )}
    </div>
  );
}
