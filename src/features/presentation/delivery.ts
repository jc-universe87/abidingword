import { NO_MARKS, type LiveMarks, type ScriptureOverlay, type SlidePoint } from "@/types/presentation";

/**
 * What is happening while presenting (v0.18). None of it is ever saved:
 * where the speaker is, a blank audience screen, a passage shown for a
 * moment, the pointer and pen, the timer. The saved presentation (order,
 * slides, notes, background, target time) is never changed from here.
 */
export interface DeliveryState {
  index: number;
  total: number;
  blank: boolean;
  scripture: ScriptureOverlay | null;
  marks: LiveMarks;
  timer: { startedAt: number | null; before: number };
}

/**
 * The commands that drive a presentation. The Presenter View, its keys, a
 * clicker on the audience screen and (later) a phone used as a remote all
 * send these; none of them depends on how the screen is drawn.
 */
export type PresenterCommand =
  | { type: "next" }
  | { type: "previous" }
  | { type: "first" }
  | { type: "last" }
  | { type: "goTo"; index: number }
  | { type: "toggleBlank" }
  | { type: "showScripture"; scripture: ScriptureOverlay }
  | { type: "returnToSlide" }
  | { type: "timerStart"; at: number }
  | { type: "timerPause"; at: number }
  | { type: "timerReset"; at: number }
  | { type: "pointer"; at: SlidePoint | null }
  | { type: "penDown"; at: SlidePoint }
  | { type: "penMove"; at: SlidePoint }
  | { type: "clearMarks" };

/** A new presentation; the timer runs from `now`, or waits (null) until it is started. */
export function startDelivery(total: number, now: number | null): DeliveryState {
  return { index: 0, total, blank: false, scripture: null, marks: NO_MARKS, timer: { startedAt: now, before: 0 } };
}

/** At most this many pen strokes of this many points, as on the audience screen. */
const STROKES_MAX = 50;
const POINTS_MAX = 500;
/** A pen point closer than this to the last one (a share of the slide) adds nothing visible. */
const POINT_STEP = 0.004;

const share = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const onSlide = ([x, y]: SlidePoint): SlidePoint => [share(x), share(y)];

export function elapsedOf(timer: DeliveryState["timer"], now: number): number {
  return timer.before + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt));
}

/** One command applied: a new state, the old one untouched. */
export function deliver(state: DeliveryState, command: PresenterCommand): DeliveryState {
  const goTo = (to: number): DeliveryState => {
    const index = Math.max(0, Math.min(state.total - 1, to));
    // Moving on takes the passage, a blank screen and the marks away from the audience.
    return { ...state, index, blank: false, scripture: null, marks: NO_MARKS };
  };
  switch (command.type) {
    case "next":
      return goTo(state.index + 1);
    case "previous":
      return goTo(state.index - 1);
    case "first":
      return goTo(0);
    case "last":
      return goTo(state.total - 1);
    case "goTo":
      return Number.isInteger(command.index) ? goTo(command.index) : state;
    case "toggleBlank":
      // The slide stays where it is; only the audience screen goes blank and comes back.
      return { ...state, blank: !state.blank };
    case "showScripture":
      return { ...state, scripture: command.scripture, blank: false, marks: NO_MARKS };
    case "returnToSlide":
      return { ...state, scripture: null, blank: false, marks: NO_MARKS };
    case "timerStart":
      return state.timer.startedAt === null ? { ...state, timer: { ...state.timer, startedAt: command.at } } : state;
    case "timerPause":
      return state.timer.startedAt === null ? state : { ...state, timer: { startedAt: null, before: elapsedOf(state.timer, command.at) } };
    case "timerReset":
      return { ...state, timer: { startedAt: command.at, before: 0 } };
    case "pointer":
      return { ...state, marks: { ...state.marks, pointer: command.at ? onSlide(command.at) : null } };
    case "penDown":
      if (state.marks.strokes.length >= STROKES_MAX) return state;
      return { ...state, marks: { pointer: null, strokes: [...state.marks.strokes, [onSlide(command.at)]] } };
    case "penMove": {
      const strokes = state.marks.strokes;
      const last = strokes[strokes.length - 1];
      if (!last || last.length >= POINTS_MAX) return state;
      const point = onSlide(command.at);
      const end = last[last.length - 1]!;
      if (Math.hypot(point[0] - end[0], point[1] - end[1]) < POINT_STEP) return state;
      return { ...state, marks: { ...state.marks, strokes: [...strokes.slice(0, -1), [...last, point]] } };
    }
    case "clearMarks":
      return { ...state, marks: NO_MARKS };
  }
}

/**
 * The keys a speaker and a presentation clicker use, as commands. Clickers
 * send Page Down / Page Up or the arrow keys, so they work without setup.
 * Escape, Enter (after a number) and O are handled by the Presenter View.
 */
export function commandForKey(key: string): PresenterCommand | null {
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(key)) return { type: "next" };
  if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(key)) return { type: "previous" };
  if (key === "Home") return { type: "first" };
  if (key === "End") return { type: "last" };
  if (key === "b" || key === "B" || key === ".") return { type: "toggleBlank" };
  return null;
}

/** Quiet guidance against a target time: on time, nearly there, or over. */
export type TimeGuidance = { state: "normal" | "near" | "over"; minutes: number } | null;

export function guidance(elapsedMs: number, targetMinutes: number | null | undefined): TimeGuidance {
  if (!targetMinutes) return null;
  const target = targetMinutes * 60_000;
  const left = target - elapsedMs;
  if (left < 0) return { state: "over", minutes: Math.max(1, Math.floor(-left / 60_000)) };
  // Nearly there: the last tenth, at least the last two minutes.
  const near = Math.max(2 * 60_000, target / 10);
  return { state: left <= near ? "near" : "normal", minutes: Math.ceil(left / 60_000) };
}
