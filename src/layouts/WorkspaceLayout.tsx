import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PaneControlsProvider, type PaneControls } from "@/design-system/PaneHeader";
import { Splitter } from "@/design-system/Splitter";
import type { PaneId, SidePaneId, WorkspaceLayoutState } from "./layoutPrefs";

/** No side pane can be dragged narrower than this. */
const SIDE_MIN = 240;
/** The Study pane always keeps at least this much room. */
const STUDY_MIN = 360;

const PANE_NAMES: Record<PaneId, string> = { scripture: "Scripture", study: "Study", sources: "Sources" };

interface WorkspaceLayoutProps {
  layout: WorkspaceLayoutState;
  scripture: ReactNode;
  study: ReactNode;
  sources: ReactNode;
}

/**
 * The three-pane research desk, Scripture | Study | Sources by default.
 *
 * The user chooses the order (each pane header has Move left / Move right)
 * and the widths of the Scripture and Sources panes (drag or keyboard on the
 * dividers); the Study pane takes the remaining room. Side panes can be
 * hidden. All of this is remembered on this device (see layoutPrefs.ts).
 *
 * A window too small for the saved widths shrinks the side panes on screen
 * without changing what is saved, so widening the window restores them.
 */
export function WorkspaceLayout({ layout, scripture, study, sources }: WorkspaceLayoutProps) {
  const { order, widths, open, setOrder, setWidth } = layout;
  const container = useRef<HTMLDivElement>(null);
  const room = useWidth(container);
  const visible = useMemo(() => order.filter((pane) => pane === "study" || open[pane]), [order, open]);

  // After a move, keep keyboard focus on the moved pane's button (moving
  // the pane in the page can drop focus), or on its other one at an edge.
  const moved = useRef<{ pane: PaneId; direction: -1 | 1 } | null>(null);
  useEffect(() => {
    if (!moved.current) return;
    const { pane, direction } = moved.current;
    moved.current = null;
    const prefix = `pane-${pane}-move-`;
    const same = document.getElementById(prefix + (direction < 0 ? "left" : "right")) as HTMLButtonElement | null;
    const other = document.getElementById(prefix + (direction < 0 ? "right" : "left")) as HTMLButtonElement | null;
    (same && !same.disabled ? same : other)?.focus();
  }, [order]);

  const controls = useMemo(() => {
    const move = (pane: PaneId, direction: -1 | 1) => {
      // Swap with the nearest visible neighbour, skipping hidden panes.
      const index = order.indexOf(pane);
      let target = index + direction;
      while (target >= 0 && target < order.length && !visible.includes(order[target]!)) target += direction;
      if (target < 0 || target >= order.length) return;
      const next = [...order];
      [next[index], next[target]] = [next[target]!, next[index]!];
      moved.current = { pane, direction };
      setOrder(next);
    };
    return Object.fromEntries(
      visible.map((pane, i): [PaneId, PaneControls] => [
        pane,
        {
          name: PANE_NAMES[pane],
          idPrefix: `pane-${pane}`,
          canMoveLeft: i > 0,
          canMoveRight: i < visible.length - 1,
          move: (direction) => move(pane, direction),
        },
      ]),
    ) as Partial<Record<PaneId, PaneControls>>;
  }, [order, visible, setOrder]);

  /** The widest a side pane may be dragged while the Study pane keeps its room. */
  const maxWidth = (pane: SidePaneId) => {
    const others = visible.reduce((sum, p) => (p !== "study" && p !== pane ? sum + widths[p] : sum), 0);
    return Math.max(SIDE_MIN, room - STUDY_MIN - others);
  };

  const content: Record<PaneId, ReactNode> = { scripture, study, sources };
  const renderPane = (pane: PaneId) => {
    const body = <PaneControlsProvider value={controls[pane] ?? null}>{content[pane]}</PaneControlsProvider>;
    if (pane === "study") {
      return (
        <main
          id="pane-study"
          aria-labelledby="pane-study-title"
          style={{ minWidth: Math.min(STUDY_MIN, room) }}
          className="flex min-w-0 flex-1 flex-col bg-bg"
        >
          {body}
        </main>
      );
    }
    return (
      <aside
        id={`pane-${pane}`}
        aria-labelledby={`pane-${pane}-title`}
        // Flex may shrink a side pane below its saved width when the window
        // is small; the saved width is kept for when there is room again.
        style={{ width: widths[pane] }}
        className="flex min-w-0 shrink flex-col bg-bg-secondary"
      >
        {body}
      </aside>
    );
  };

  const studyAt = visible.indexOf("study");
  return (
    <div ref={container} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {visible.map((pane, i) => {
        // A divider resizes the side pane on its far side from Study, so the
        // divider always follows the pointer and Study takes up the slack.
        const resized = (studyAt >= i ? visible[i - 1] : pane) as SidePaneId | undefined;
        return (
          <Fragment key={pane}>
            {i > 0 && resized && (
              <Splitter
                label={`Resize ${PANE_NAMES[resized]} pane`}
                controls={`pane-${resized}`}
                value={widths[resized]}
                min={SIDE_MIN}
                max={maxWidth(resized)}
                direction={studyAt >= i ? 1 : -1}
                onChange={(width) => setWidth(resized, width)}
              />
            )}
            {renderPane(pane)}
          </Fragment>
        );
      })}
    </div>
  );
}

/** The element's width, following window resizes; the window width until measured. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || window.innerWidth);
    measure();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);
  return width;
}
