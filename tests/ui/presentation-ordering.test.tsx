import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Ordering slides (v0.18.1): a slide is dragged by its handle to a new
// place, or moved earlier/later with the keyboard. Only the presentation's
// order changes — never the teaching, the slides' wording or their notes.
// All text is invented.

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  const prep = await api.teachingCreate({ studyId: study.id, title: "Remain in the vine", kind: "sermon", points: [{ title: "Stay connected" }, { title: "Bear fruit" }] });
  await api.teachingUpdate({ id: prep.id, introduction: "Have you ever pruned a rose?", centralMessage: "Fruit comes from abiding." });
  await api.teachingPassageAdd({ preparationId: prep.id, reference: "JHN.15.1-JHN.15.5" });
  return api;
}

async function slides(user: User) {
  const pane = () => screen.getByRole("main", { name: "Study" });
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(pane()).findByRole("textbox", { name: "Study title" });
  await user.click(within(pane()).getByRole("button", { name: "Bible Teaching" }));
  await user.click(await within(pane()).findByRole("button", { name: "Presentation" }));
  const region = await within(pane()).findByRole("region", { name: "Presentation of “Remain in the vine”" });
  await user.click(within(region).getByRole("button", { name: "Make slides from the teaching" }));
  const list = await within(region).findByRole("list", { name: "Slides" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
  return { region, list };
}

const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("aria-label")!.replace(/^Slide \d+: /, ""));

const ORDER = ["Remain in the vine", "Introduction", "John 15:1–5", "Fruit comes from abiding.", "Stay connected", "Bear fruit"];

/** Rows 100 px apart, 90 px high (jsdom has no layout). */
function lay(list: HTMLElement) {
  list.querySelectorAll<HTMLElement>(":scope > [data-drag-item]").forEach((li, i) => {
    li.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 90, height: 90, left: 0, right: 600, width: 600, x: 0, y: i * 100, toJSON: () => ({}) }) as DOMRect;
  });
}

/** Drags slide `from` (0-based) by its handle and lets go at `y`. */
function drag(list: HTMLElement, from: number, y: number, { drop = true } = {}) {
  lay(list);
  const handle = list.querySelectorAll<HTMLElement>("[data-drag-handle]")[from]!;
  fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientY: from * 100 + 45 });
  fireEvent.pointerMove(handle, { pointerId: 7, clientY: y });
  if (drop) fireEvent.pointerUp(handle, { pointerId: 7, clientY: y });
  return handle;
}

describe("ordering slides by dragging", () => {
  it("moves the first slide to the middle, the last to the front, and neighbours past each other", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const { list } = await slides(user);
    expect(names(list)).toEqual(ORDER);

    // First → fourth place: let go between the fourth and fifth slides.
    drag(list, 0, 400);
    await waitFor(() => expect(names(list)).toEqual([ORDER[1], ORDER[2], ORDER[3], ORDER[0], ORDER[4], ORDER[5]]));
    // The moved slide keeps the keyboard and the move is announced.
    await waitFor(() => expect(within(list).getByRole("listitem", { name: "Slide 4: Remain in the vine" }).querySelector("[aria-expanded]")).toHaveFocus());
    expect(screen.getAllByText("Slide moved to place 4.").length).toBeGreaterThan(0);

    // Last → first.
    drag(list, 5, 10);
    await waitFor(() => expect(names(list)[0]).toBe(ORDER[5]));

    // Neighbours: the second slide after the third.
    const before = names(list);
    drag(list, 1, 290);
    await waitFor(() => expect(names(list)).toEqual([before[0], before[2], before[1], before[3], before[4], before[5]]));

    // Saved: the presentation keeps the new order after it is read again.
    const saved = await api.presentationGet(api.state.presentation.presentations[0]!.id);
    expect(saved.items.map((i) => i.id)).toEqual(api.state.presentation.presentations[0]!.items.map((i) => i.id));
    expect(saved.items).toHaveLength(6);
  });

  it("shows where the slide would land, and changes nothing when it is put back, dropped in its own place or cancelled", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const { list } = await slides(user);
    const revision = api.state.presentation.presentations[0]!.revision;
    const handle = drag(list, 1, 290, { drop: false });
    expect(list).toHaveAttribute("data-dragging");
    // The line is before the fourth slide (between the third and the fourth).
    const lines = list.querySelectorAll("[data-drop-line]");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.closest("li")!.getAttribute("aria-label")).toBe("Slide 4: Fruit comes from abiding.");
    expect(list.querySelectorAll("[data-drag-item]")[1]!.className).toMatch(/opacity-50/);
    // Esc cancels.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(list).not.toHaveAttribute("data-dragging");
    fireEvent.pointerUp(handle, { pointerId: 7, clientY: 290 });
    // Dropped where it already is.
    drag(list, 2, 230);
    drag(list, 2, 260);
    await new Promise((r) => setTimeout(r, 50));
    expect(names(list)).toEqual(ORDER);
    expect(api.state.presentation.presentations[0]!.revision).toBe(revision);
    // The presenter stays in the editor (Esc during a drag does not leave anything).
    expect(screen.getByRole("list", { name: "Slides" })).toBe(list);
  });

  it("moves only the order: a left-out slide stays left out, notes and wording stay, the teaching is untouched", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const { list } = await slides(user);
    const p = api.state.presentation.presentations[0]!;
    const introduction = p.items[1]!.id;
    await api.presentationItemUpdate({ id: introduction, notes: "Smile first.", skipped: true });
    await api.presentationItemUpdate({ id: p.items[4]!.id, heading: "Joined to him", followHeading: false });
    const teaching = structuredClone(api.state.teaching.preparations[0]!);
    const before = new Map(api.state.presentation.presentations[0]!.items.map((i) => [i.id, structuredClone(i)]));

    drag(list, 1, 590);
    await waitFor(() => expect(api.state.presentation.presentations[0]!.items.at(-1)!.id).toBe(introduction));
    for (const item of api.state.presentation.presentations[0]!.items) {
      const { position: _a, ...now } = item as typeof item & { position?: number };
      const { position: _b, ...was } = before.get(item.id)! as typeof item & { position?: number };
      void _a;
      void _b;
      expect(now).toEqual(was);
    }
    expect(api.state.presentation.presentations[0]!.items.at(-1)!).toMatchObject({ notes: "Smile first.", skipped: true });
    expect(api.state.teaching.preparations[0]).toEqual(teaching);
  });

  it("never starts a drag from a slide's text fields, and keeps an open slide open after it moves", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const { list } = await slides(user);
    const slide = within(list).getByRole("listitem", { name: "Slide 2: Introduction" });
    await user.click(within(slide).getByRole("button", { name: /Introduction/ }));
    const notes = within(slide).getByRole("textbox", { name: "Speaker notes" });
    fireEvent.pointerDown(notes, { button: 0, pointerId: 3, clientY: 150 });
    fireEvent.pointerMove(notes, { pointerId: 3, clientY: 500 });
    expect(list).not.toHaveAttribute("data-dragging");
    drag(list, 1, 590);
    const moved = await within(list).findByRole("listitem", { name: "Slide 6: Introduction" });
    expect(within(moved).getByRole("textbox", { name: "Speaker notes" })).toBeInTheDocument();
  });
});

describe("ordering slides by keyboard", () => {
  it("moves a slide earlier and later with buttons, keeping the keyboard on the moved slide", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const { list } = await slides(user);
    await user.click(within(list).getByRole("button", { name: "Move slide 3 later" }));
    await waitFor(() => expect(names(list)[3]).toBe(ORDER[2]));
    await waitFor(() => expect(within(list).getByRole("button", { name: "Move slide 4 later" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(names(list)[4]).toBe(ORDER[2]));
    await user.click(within(list).getByRole("button", { name: "Move slide 1 later" }));
    await waitFor(() => expect(names(list)[1]).toBe(ORDER[0]));
    await user.click(within(list).getByRole("button", { name: "Move slide 2 earlier" }));
    await waitFor(() => expect(names(list)[0]).toBe(ORDER[0]));
    // At the first place "earlier" is unavailable: the keyboard goes to "later".
    await waitFor(() => expect(within(list).getByRole("button", { name: "Move slide 1 later" })).toHaveFocus());
    expect(within(list).getByRole("button", { name: "Move slide 1 earlier" })).toBeDisabled();
  });
});
