import { useRef, type KeyboardEvent, type PointerEvent } from "react";

interface SplitterProps {
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  /** +1 when dragging right should grow the pane, -1 when it should shrink it. */
  direction: 1 | -1;
  onChange: (value: number) => void;
}

const KEY_STEP = 24;

/**
 * A draggable, keyboard-operable divider between panes
 * (WAI-ARIA "window splitter" pattern: arrows resize, Home/End jump to limits).
 */
export function Splitter({ label, controls, value, min, max, direction, onChange }: SplitterProps) {
  const drag = useRef<{ startX: number; startValue: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Start from the width on screen: a narrow window may show the pane
    // narrower than its saved width, and the drag should follow the pointer.
    const shown = document.getElementById(controls)?.getBoundingClientRect().width;
    drag.current = { startX: event.clientX, startValue: shown ? clamp(shown) : value };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Keeps the drag from selecting text in the panes beside it.
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(clamp(drag.current.startValue + direction * (event.clientX - drag.current.startX)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: value - direction * KEY_STEP,
      ArrowRight: value + direction * KEY_STEP,
      Home: min,
      End: max,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      onChange(clamp(next));
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="group relative w-px shrink-0 cursor-col-resize touch-none bg-border focus-visible:outline-offset-0"
    >
      {/* Wider invisible grab area; the visible line stays a hairline. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5 group-hover:bg-accent/30" />
    </div>
  );
}
