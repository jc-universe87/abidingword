import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Where a dragged item would land: before the item at this index (the length: at the end). */
export interface ListDrag {
  from: number;
  to: number;
}

/** How close to the top or bottom edge (px) the list starts scrolling, and how fast at most (px per frame). */
const EDGE = 56;
const SPEED = 18;

/** The nearest ancestor that scrolls vertically, or null for the page itself. */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Drag-and-drop ordering for a vertical list, by a handle (pointer events,
 * so mouse, pen and touch alike). It only reports where an item was moved;
 * the list itself stays as it is until the move is saved. Esc cancels. The
 * list's items carry `data-drag-item` in their order.
 */
export function useListDrag(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<ListDrag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const state = useRef<{ from: number; to: number; pointerId: number; y: number; frame: number | null } | null>(null);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  /** The insertion place for a pointer at `y` (viewport), from the items' middles. */
  const placeAt = useCallback((y: number): number => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>(":scope > [data-drag-item]") ?? []);
    for (let i = 0; i < items.length; i++) {
      const r = items[i]!.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return items.length;
  }, []);

  const stop = useCallback((commit: boolean) => {
    const s = state.current;
    if (!s) return;
    if (s.frame !== null) cancelAnimationFrame(s.frame);
    state.current = null;
    setDrag(null);
    // Dropping just before or just after itself changes nothing.
    if (commit && s.to !== s.from && s.to !== s.from + 1) onMoveRef.current(s.from, s.to > s.from ? s.to - 1 : s.to);
  }, []);

  // Near the top or bottom edge of the scrolling area, keep scrolling while the pointer stays there.
  const scrollStep = useRef<() => void>(() => undefined);
  useEffect(() => {
    scrollStep.current = () => {
      const s = state.current;
      if (!s) return;
      const box = scroller(listRef.current);
      const top = box ? box.getBoundingClientRect().top : 0;
      const bottom = box ? box.getBoundingClientRect().bottom : window.innerHeight;
      let delta = 0;
      if (s.y < top + EDGE) delta = -Math.ceil(((top + EDGE - s.y) / EDGE) * SPEED);
      else if (s.y > bottom - EDGE) delta = Math.ceil(((s.y - (bottom - EDGE)) / EDGE) * SPEED);
      if (delta !== 0) {
        if (box) box.scrollTop += delta;
        else window.scrollBy(0, delta);
        const to = placeAt(s.y);
        if (to !== s.to) {
          s.to = to;
          setDrag({ from: s.from, to });
        }
      }
      s.frame = requestAnimationFrame(() => scrollStep.current());
    };
  }, [placeAt]);

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        stop(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag, stop]);
  useEffect(() => () => stop(false), [stop]);

  /** Props for an item's drag handle. */
  const handle = (index: number) => ({
    "data-drag-handle": "",
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button > 0 || state.current) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      state.current = { from: index, to: index, pointerId: e.pointerId, y: e.clientY, frame: null };
      setDrag({ from: index, to: index });
      state.current.frame = requestAnimationFrame(() => scrollStep.current());
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const s = state.current;
      if (!s || s.pointerId !== e.pointerId) return;
      s.y = e.clientY;
      const to = placeAt(e.clientY);
      if (to !== s.to) {
        s.to = to;
        setDrag({ from: s.from, to });
      }
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      if (state.current?.pointerId === e.pointerId) stop(true);
    },
    onPointerCancel: () => stop(false),
    onLostPointerCapture: () => {
      // Only a lost capture while still dragging (e.g. the window lost focus) cancels.
      if (state.current) stop(false);
    },
  });

  return { drag, listRef, handle };
}
