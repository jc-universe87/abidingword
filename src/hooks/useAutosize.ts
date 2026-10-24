import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";
import { useTranslation } from "react-i18next";

const px = (value: string) => parseFloat(value) || 0;

/** The height of `rows` lines plus the padding and border the box's height includes. */
function rowsHeight(style: CSSStyleDeclaration, rows: number): number {
  const line = style.lineHeight === "normal" ? px(style.fontSize) * 1.2 : px(style.lineHeight);
  const padding = px(style.paddingTop) + px(style.paddingBottom);
  const border = px(style.borderTopWidth) + px(style.borderBottomWidth);
  return rows * line + (style.boxSizing === "border-box" ? padding + border : 0);
}

/**
 * Fits a text area to its whole text, so the last line is never cut off
 * under its bottom border (v0.23).
 *
 * The height is measured: `scrollHeight` leaves out the border (the boxes
 * are `border-box`) and is rounded to a whole pixel, so the border and one
 * pixel for the rounding are added back — leaving them out is what hid the
 * bottom of the last line under the bottom border before. (CSS
 * `field-sizing: content` was tried and measured: it fell a fraction of a
 * pixel short of multi-line text, and not every engine has it.) It is
 * measured again when the text or placeholder changes, the width changes (a
 * resized window or pane, a folded part opened again), a font finishes
 * loading and the language changes. Only a change of width measures again,
 * so setting the height can never start a loop.
 */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, rows: number, ...watch: unknown[]) {
  const { i18n } = useTranslation();
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !(el instanceof HTMLTextAreaElement)) return;
    const style = getComputedStyle(el);
    const minimum = rowsHeight(style, rows);
    const border = style.boxSizing === "border-box" ? px(style.borderTopWidth) + px(style.borderBottomWidth) : -(px(style.paddingTop) + px(style.paddingBottom));
    el.style.height = "auto";
    // One pixel more than the rounded measure, never less than the text.
    el.style.height = `${Math.max(minimum, Math.ceil(el.scrollHeight + border) + 1)}px`;
  }, [ref, rows]);

  // `watch` is what the text area shows: its text and placeholder.
  useLayoutEffect(fit, [fit, i18n.language, ...watch]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (el.clientWidth === width) return;
            width = el.clientWidth;
            fit();
          })
        : null;
    observer?.observe(el);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", fit);
    return () => {
      observer?.disconnect();
      fonts?.removeEventListener?.("loadingdone", fit);
    };
  }, [ref, fit]);
}
