import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { GripHorizontal, Lightbulb, Minus } from "lucide-react";

/** Where the panel was put and how big it was made: kept for the session. */
let remembered: {
  left: number;
  top: number;
  width: number;
  /** Only once the person has resized it; until then it fits its content. */
  height?: number;
} | null = null;

const DEFAULT_WIDTH = 420;
const MARGIN = 12;

/**
 * The place to open: the upper right of the window, over the side pane on that
 * side (secondary to the teaching), so the teaching's text and its AI Help
 * buttons stay uncovered wherever there is room.
 */
function defaultPlace(width: number) {
  const pane = document.getElementById("pane-study")?.getBoundingClientRect();
  const right = window.innerWidth;
  const top = pane && pane.height > 0 ? pane.top : 64;
  const height = Math.min(
    Math.round(window.innerHeight * 0.7),
    Math.max(240, window.innerHeight - top - 2 * MARGIN),
  );
  return {
    left: Math.max(MARGIN, right - width - MARGIN),
    top: top + MARGIN,
    width,
    height,
  };
}

const clamp = (box: {
  left: number;
  top: number;
  width: number;
  height: number;
}) => ({
  ...box,
  left: Math.min(
    Math.max(MARGIN, box.left),
    Math.max(MARGIN, window.innerWidth - box.width - MARGIN),
  ),
  top: Math.min(
    Math.max(MARGIN, box.top),
    Math.max(MARGIN, window.innerHeight - 80),
  ),
});

interface FloatingPanelProps {
  /** What the panel is about, e.g. "Make it clearer · Introduction": shown when minimised. */
  label: string;
  children: ReactNode;
}

/**
 * The AI Assistant's panel, floating over the workspace instead of being put
 * into the teaching: opening it never moves the person's text. It can be
 * moved (drag the top bar, or its move button with the arrow keys), resized (the lower corner), minimised to a small
 * "AI" chip and opened again, and it stays open while the person writes
 * elsewhere. It is a non-modal dialog: the teaching stays usable. The content
 * (the assistant's panel) has its own heading, Close and Escape.
 */
export function FloatingPanel({ label, children }: FloatingPanelProps) {
  const { t } = useTranslation();
  const [box, setBox] = useState(() => {
    const place = defaultPlace(
      Math.min(
        remembered?.width ?? DEFAULT_WIDTH,
        window.innerWidth - 2 * MARGIN,
      ),
    );
    return clamp(
      remembered
        ? { ...place, ...remembered, height: remembered.height ?? place.height }
        : place,
    );
  });
  const [minimised, setMinimised] = useState(false);
  // Resized by the person (the browser's corner): from then on it keeps that height.
  const [sized, setSized] = useState(Boolean(remembered?.height));
  const panel = useRef<HTMLElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const wasMinimised = useRef(false);

  /** After the browser's own resize corner was used: remember that size for this session. */
  const rememberSize = () => {
    const el = panel.current;
    if (!el || !el.style.height) return;
    const next = { left: box.left, top: box.top, width: el.offsetWidth, height: el.offsetHeight };
    remembered = next;
    setBox(next);
    setSized(true);
  };

  /** Moves the panel with the arrow keys on its top bar: dragging is never the only way. */
  const nudge = (dx: number, dy: number) => {
    const next = clamp({ ...box, left: box.left + dx, top: box.top + dy });
    setBox(next);
    remembered = { ...remembered, left: next.left, top: next.top, width: next.width };
  };

  // Keep it inside the window when the window gets smaller.
  useEffect(() => {
    const fit = () => setBox((b) => clamp(b));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Focus follows minimising and opening again, so the keyboard never loses its place.
  useLayoutEffect(() => {
    if (minimised) chip.current?.focus();
    else if (wasMinimised.current)
      panel.current?.querySelector<HTMLElement>("h4, [tabindex='-1']")?.focus();
    wasMinimised.current = minimised;
  }, [minimised]);

  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const moveDrag = (e: ReactPointerEvent) => {
    const start = drag.current;
    if (!start) return;
    const next = clamp({
      ...box,
      left: start.left + e.clientX - start.x,
      top: start.top + e.clientY - start.y,
    });
    setBox(next);
    remembered = {
      ...remembered,
      left: next.left,
      top: next.top,
      width: panel.current?.offsetWidth || next.width,
    };
  };
  const endDrag = () => {
    drag.current = null;
  };

  // While minimised the panel stays mounted (hidden), so what was typed or asked is kept.
  return createPortal(
    <>
      {minimised && (
        <button
          ref={chip}
          type="button"
          onClick={() => setMinimised(false)}
          title={t("studies.teaching.assist.restore")}
          className="fixed bottom-4 right-4 z-30 inline-flex min-h-11 max-w-[min(24rem,calc(100vw-2rem))] items-center gap-2 rounded-full border border-border bg-bg px-4 text-[0.9375rem] font-medium text-text-strong shadow-lg hover:bg-bg-secondary"
        >
          <Lightbulb
            className="size-4 shrink-0 text-accent"
            aria-hidden="true"
          />
          <span className="truncate">
            {t("studies.teaching.assist.menu")} · {label}
          </span>
        </button>
      )}
      <section
        ref={panel}
        hidden={minimised}
        role="dialog"
        aria-modal="false"
        aria-label={t("studies.teaching.assist.panelLabel", { label })}
        data-testid="assist-floating"
        onPointerUp={rememberSize}
        // Until the person resizes it, it is as tall as its content (up to most of the window).
        style={
          sized
            ? {
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
              }
            : {
                left: box.left,
                top: box.top,
                width: box.width,
                maxHeight: box.height,
              }
        }
        className="fixed z-30 flex min-h-48 [&[hidden]]:hidden min-w-72 max-w-[calc(100vw-1.5rem)] resize flex-col overflow-hidden rounded-[var(--aw-radius-lg)] border border-border bg-bg-secondary shadow-2xl"
      >
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            // Escape on the top bar minimises (the content's own Escape closes it).
            if (e.key === "Escape") {
              e.stopPropagation();
              setMinimised(true);
            }
          }}
          className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-border-subtle px-3 py-1 text-[0.8125rem] text-text-muted"
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 80 : 20;
              const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
              const move = moves[e.key];
              if (!move) return;
              e.preventDefault();
              nudge(...move);
            }}
            aria-label={t("studies.teaching.assist.move")}
            title={t("studies.teaching.assist.move")}
            className="-ml-2 inline-flex size-11 cursor-move items-center justify-center rounded-aw hover:bg-bg hover:text-text-strong"
          >
            <GripHorizontal className="size-4" aria-hidden="true" />
          </button>
          <span className="flex-1 truncate font-medium">
            {t("studies.teaching.assist.menuTitle")}
          </span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMinimised(true)}
            aria-label={t("studies.teaching.assist.minimise")}
            title={t("studies.teaching.assist.minimise")}
            className="inline-flex size-11 items-center justify-center rounded-aw hover:bg-bg hover:text-text-strong"
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </>,
    document.body,
  );
}

/**
 * Only one assistant panel at a time: the part that opened it last owns it,
 * and the panel of the part it moved from closes.
 */
interface Dock {
  owner: string | null;
  claim: (owner: string) => void;
  release: (owner: string) => void;
}

const DockContext = createContext<Dock>({
  owner: null,
  claim: () => {},
  release: () => {},
});

export function AssistDockProvider({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<string | null>(null);
  const claim = useCallback((next: string) => setOwner(next), []);
  const release = useCallback(
    (who: string) => setOwner((current) => (current === who ? null : current)),
    [],
  );
  const value = useMemo(
    () => ({ owner, claim, release }),
    [owner, claim, release],
  );
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export const useAssistDock = () => useContext(DockContext);
