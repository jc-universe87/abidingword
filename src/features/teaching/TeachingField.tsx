import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";
import { useAutosave } from "@/hooks/useAutosave";
import { useAutosize } from "@/hooks/useAutosize";
import type { ScriptureRef } from "@/types/scripture";
import type { AssistAction, KeepTeachingMaterial, TeachingPart } from "@/types/teaching";
import { DetectedReferences } from "@/features/studies/DetectedReferences";
import { AssistMenu } from "./AssistMenu";
import { AssistPanel, type AssistTarget } from "./AssistPanel";
import { FloatingPanel, useAssistDock } from "./FloatingPanel";
import { assistLabel } from "./labels";

/** What a field needs to offer the assistant (absent when it is turned off). */
export interface AssistantHooks {
  preparationId: string;
  canFindImages: boolean;
  canGenerateImages: boolean;
  /** Why images cannot be made, when they cannot ("off" in Settings, the service cannot, or its key is missing). */
  imagesNote: "off" | "unsupported" | "noKey" | null;
  /** The service images are sent to, by name. */
  imageService: string;
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
  /**
   * A title written by the person, on one line under its own label (shown to
   * assistive technology only): "title" for the open teaching's name, true
   * for the title of a point or question.
   */
  emphasis?: boolean | "title";
  /**
   * How the label reads (v0.18.4): "section" for a part of the whole teaching
   * (Central message, Introduction), "field" for a field inside a point or the
   * teaching's details.
   */
  level?: "section" | "field";
  /** A stable id for the field, so focus can be moved to it. */
  fieldId?: string;
  /** The label is said by a heading next to the field (v0.19: notes for oneself): read out only. */
  labelHidden?: boolean;
}

/**
 * One part of the teaching: the person's own writing, saved as they type.
 * Beside it, when the assistant is on, a quiet "Help" menu. Whatever the
 * assistant suggests is shown apart, below; the text changes only when the
 * person chooses "Use this", and they can undo that straight away.
 */
export function TeachingField(props: TeachingFieldProps) {
  const { label, value, save, part, pointId = null, multiline = true, rows = 3, placeholder, hint, assistant, onRevealScripture, autoFocus, emphasis, level = "section", fieldId, labelHidden = false } = props;
  const { t } = useTranslation();
  const generated = useId();
  const id = generated;
  const fid = fieldId ?? `${generated}-field`;
  const [text, setText] = useState(value);
  const [action, setAction] = useState<{ action: AssistAction; target: AssistTarget } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  // Each request gets its own panel: an earlier answer can never be applied to a later selection,
  // and a minimised panel opens again for a new request.
  const [request, setRequest] = useState(0);
  const [notice, setNotice] = useState("");
  const area = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // One assistant panel at a time, over the workspace: this part's shows only while it owns it.
  const dock = useAssistDock();
  const { schedule, flush } = useAutosave(save);

  // Fits the text area to its text; a title also refits when the pane's width changes.
  useAutosize(area as RefObject<HTMLTextAreaElement | null>, emphasis === "title" ? 1 : rows, text, placeholder);

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
    dock.claim(fid);
    setRequest((n) => n + 1);
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

  /** Closes the panel. Focus goes back to this part's AI Help button, or to the text after a change was put in. */
  const close = (toText = false) => {
    setAction(null);
    dock.release(fid);
    requestAnimationFrame(() =>
      (toText ? area.current : root.current?.querySelector<HTMLElement>("button[aria-haspopup='menu']"))?.focus({ preventScroll: true }),
    );
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
    close(true);
    return true;
  };

  const insertBelow = (option: string) => {
    setUndo(text);
    change(text.trim() ? `${text.trimEnd()}\n\n${option.trim()}` : option.trim());
    flush();
    setNotice(t("studies.teaching.assist.applied"));
    close(true);
  };

  // Titles are a line to write on; other fields a soft fill (no outline until hovered or in use).
  const field = emphasis
    ? `block w-full rounded-aw border border-transparent border-b-border-subtle bg-transparent px-2 -mx-2 text-text-strong placeholder:text-text-muted placeholder:font-ui placeholder:text-[1rem] placeholder:font-normal hover:border-border-subtle focus:border-border ${
        emphasis === "title" ? "type-worktitle" : "reading font-semibold"
      }`
    : "reading block w-full resize-none overflow-hidden rounded-aw border border-transparent bg-field px-3 py-2 text-text placeholder:text-text-muted hover:border-border-subtle focus:border-border";

  return (
    <div ref={root} className="flex flex-col gap-1">
      {emphasis ? (
        <label htmlFor={fid} className="sr-only">
          {label}
        </label>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-x-2">
          <label htmlFor={fid} className={labelHidden ? "sr-only" : level === "section" ? "type-section" : "type-subhead"}>
            {label}
          </label>
          {assistant && <AssistMenu part={part} partLabel={label} onChoose={choose} imagesNote={assistant.imagesNote} />}
        </div>
      )}
      {hint && (
        <p id={`${id}-hint`} className="type-meta m-0">
          {hint}
        </p>
      )}
      {multiline || emphasis === "title" ? (
        <textarea
          id={fid}
          ref={(el) => {
            area.current = el;
          }}
          rows={emphasis === "title" ? 1 : rows}
          value={text}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          // The teaching's title wraps in a narrow pane instead of being cut off, but stays one line of text.
          onKeyDown={
            emphasis === "title"
              ? (e) => {
                  // Not while an input method is composing (Korean): its Enter commits the syllable.
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    flush();
                  }
                }
              : undefined
          }
          onChange={(e) => {
            setUndo(null);
            change(emphasis === "title" ? e.target.value.replace(/[\r\n]+/g, " ") : e.target.value);
          }}
          onBlur={flush}
          className={emphasis === "title" ? `${field} resize-none overflow-hidden py-0.5` : `${field}`}
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
          {emphasis && assistant && <AssistMenu part={part} partLabel={label} onChoose={choose} imagesNote={assistant.imagesNote} />}
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
            className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-text-strong underline underline-offset-2 hover:bg-hover"
          >
            <Undo2 className="size-4" aria-hidden="true" />
            {t("studies.teaching.assist.undo")}
          </button>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>
      {assistant && action && dock.owner === fid && (
        <FloatingPanel key={request} label={`${assistLabel(t, action.action)} · ${label}`}>
        <AssistPanel
          key={request}
          preparationId={assistant.preparationId}
          target={action.target}
          action={action.action}
          onApply={apply}
          onInsertBelow={multiline ? insertBelow : undefined}
          singleLine={!multiline}
          onKeep={(material) => assistant.keep({ ...material, pointId })}
          onAddPassage={(reference) => assistant.addPassage(reference, pointId)}
          onClose={() => close()}
          canFindImages={assistant.canFindImages}
          canGenerateImages={assistant.canGenerateImages}
          imagesNote={assistant.imagesNote}
          imageService={assistant.imageService}
        />
        </FloatingPanel>
      )}
    </div>
  );
}
