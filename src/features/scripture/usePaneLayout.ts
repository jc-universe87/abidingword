import { useLayoutEffect, useState, type RefObject } from "react";

/** How the annotation inspector is laid out. */
export type InspectorLayout = "panel" | "sheet";

/**
 * Below this width of the Scripture reader itself (not the window) the
 * inspector becomes a full-width sheet with stacked controls: a compact row
 * of buttons and the five colour swatches no longer fit comfortably.
 */
export const SHEET_BELOW_PX = 480;

/**
 * Chooses the inspector layout from the width the reader actually has, and
 * follows the pane as it is resized. Where width cannot be measured (it is
 * 0), the wide layout stays.
 */
export function usePaneLayout(ref: RefObject<HTMLElement | null>, ready: boolean): InspectorLayout {
  const [layout, setLayout] = useState<InspectorLayout>("panel");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) setLayout(width < SHEET_BELOW_PX ? "sheet" : "panel");
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, ready]);
  return layout;
}
