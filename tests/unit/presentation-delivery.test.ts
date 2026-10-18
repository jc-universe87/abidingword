import { describe, expect, it } from "vitest";
import { commandForKey, deliver, elapsedOf, guidance, startDelivery, type DeliveryState, type PresenterCommand } from "@/features/presentation/delivery";

// The delivery state (v0.18): what happens while presenting, driven by one
// small set of commands that the Presenter View, its keys, a clicker and a
// future phone remote all send. None of it is saved.

const passage = { label: "John 15:5", bible: "WEB", verses: [{ chapter: 15, verse: 5, text: "I am the vine." }] };
const run = (state: DeliveryState, ...commands: PresenterCommand[]) => commands.reduce(deliver, state);

describe("delivery commands", () => {
  it("move through the slides and never past either end", () => {
    const s = startDelivery(4, 0);
    expect(run(s, { type: "next" }, { type: "next" }).index).toBe(2);
    expect(run(s, { type: "previous" }).index).toBe(0);
    expect(run(s, { type: "last" }, { type: "next" }).index).toBe(3);
    expect(run(s, { type: "goTo", index: 2 }, { type: "first" }).index).toBe(0);
    expect(run(s, { type: "goTo", index: 99 }).index).toBe(3);
    expect(run(s, { type: "goTo", index: 1.5 }).index).toBe(0);
  });

  it("blank the audience screen without moving, and bring back exactly the same slide", () => {
    const s = run(startDelivery(5, 0), { type: "goTo", index: 3 });
    const blank = run(s, { type: "toggleBlank" });
    expect(blank).toMatchObject({ index: 3, blank: true });
    expect(run(blank, { type: "toggleBlank" })).toMatchObject({ index: 3, blank: false });
    // Moving on ends the blank screen and shows the new slide.
    expect(run(blank, { type: "next" })).toMatchObject({ index: 4, blank: false });
  });

  it("show a passage for a moment and return to the same slide", () => {
    const s = run(startDelivery(5, 0), { type: "goTo", index: 2 }, { type: "toggleBlank" });
    const showing = run(s, { type: "showScripture", scripture: passage });
    expect(showing).toMatchObject({ index: 2, blank: false, scripture: passage });
    expect(run(showing, { type: "returnToSlide" })).toMatchObject({ index: 2, blank: false, scripture: null });
    expect(run(showing, { type: "next" }).scripture).toBeNull();
  });

  it("keep the pointer and highlighter on the slide, for this slide only", () => {
    const s = run(startDelivery(3, 0), { type: "pointer", at: [1.4, -1] });
    expect(s.marks.pointer).toEqual([1, 0]);
    const drawn = run(s, { type: "penDown", at: [0.1, 0.1] }, { type: "penMove", at: [0.2, 0.2] }, { type: "penDown", at: [0.5, Number.NaN] });
    expect(drawn.marks.strokes).toEqual([
      [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
      [[0.5, 0]],
    ]);
    // A stroke starts with the pointer put away.
    expect(drawn.marks.pointer).toBeNull();
    expect(run(drawn, { type: "clearMarks" }).marks).toEqual({ pointer: null, strokes: [] });
    expect(run(drawn, { type: "next" }).marks.strokes).toEqual([]);
    expect(run(drawn, { type: "toggleBlank" }).marks.strokes).toHaveLength(2);
  });

  it("count time, pause it and start again", () => {
    const s = startDelivery(3, 1000);
    expect(elapsedOf(s.timer, 61_000)).toBe(60_000);
    const paused = run(s, { type: "timerPause", at: 31_000 });
    expect(elapsedOf(paused.timer, 999_000)).toBe(30_000);
    const again = run(paused, { type: "timerStart", at: 100_000 });
    expect(elapsedOf(again.timer, 110_000)).toBe(40_000);
    expect(elapsedOf(run(again, { type: "timerReset", at: 200_000 }).timer, 205_000)).toBe(5_000);
    // Moving through the slides never touches the timer.
    expect(run(again, { type: "next" }, { type: "toggleBlank" }).timer).toEqual(again.timer);
  });

  it("leave the state passed in untouched", () => {
    const s = startDelivery(3, 0);
    const copy = structuredClone(s);
    run(s, { type: "next" }, { type: "toggleBlank" }, { type: "penDown", at: [0.3, 0.3] });
    expect(s).toEqual(copy);
  });
});

describe("keys and clickers", () => {
  it("turn Page Down, the right arrow and Space into Next, Page Up and the left arrow into Back, B into a blank screen", () => {
    for (const key of ["ArrowRight", "PageDown", " ", "ArrowDown"]) expect(commandForKey(key)).toEqual({ type: "next" });
    for (const key of ["ArrowLeft", "PageUp", "ArrowUp", "Backspace"]) expect(commandForKey(key)).toEqual({ type: "previous" });
    expect(commandForKey("b")).toEqual({ type: "toggleBlank" });
    expect(commandForKey("B")).toEqual({ type: "toggleBlank" });
    expect(commandForKey("Home")).toEqual({ type: "first" });
    expect(commandForKey("End")).toEqual({ type: "last" });
    expect(commandForKey("x")).toBeNull();
    expect(commandForKey("Escape")).toBeNull();
  });
});

describe("a future phone remote", () => {
  it("drives the same presentation with the same commands, serialisable as plain data", () => {
    // What a remote would send over the wire: plain JSON, no screen involved.
    const wire = JSON.parse(
      JSON.stringify([
        { type: "next" },
        { type: "next" },
        { type: "toggleBlank" },
        { type: "toggleBlank" },
        { type: "showScripture", scripture: passage },
        { type: "returnToSlide" },
        { type: "goTo", index: 0 },
        { type: "timerPause", at: 5000 },
      ]),
    ) as PresenterCommand[];
    const end = run(startDelivery(6, 0), ...wire);
    expect(end).toMatchObject({ index: 0, blank: false, scripture: null });
    expect(elapsedOf(end.timer, 60_000)).toBe(5000);
  });
});

describe("time guidance", () => {
  it("is quiet without a target and says on time, nearly there or over with one", () => {
    expect(guidance(10_000, null)).toBeNull();
    expect(guidance(10_000, 0)).toBeNull();
    expect(guidance(0, 30)).toEqual({ state: "normal", minutes: 30 });
    expect(guidance(20 * 60_000 + 1, 30)).toEqual({ state: "normal", minutes: 10 });
    // The last tenth (here three minutes) is "nearly there".
    expect(guidance(27 * 60_000, 30)).toEqual({ state: "near", minutes: 3 });
    // At least the last two minutes, even for a short talk.
    expect(guidance(8 * 60_000 + 30_000, 10)).toEqual({ state: "near", minutes: 2 });
    expect(guidance(30 * 60_000, 30)).toEqual({ state: "near", minutes: 0 });
    expect(guidance(31 * 60_000, 30)).toEqual({ state: "over", minutes: 1 });
    expect(guidance(30 * 60_000 + 1, 30)).toEqual({ state: "over", minutes: 1 });
    expect(guidance(45 * 60_000, 30)).toEqual({ state: "over", minutes: 15 });
  });
});
