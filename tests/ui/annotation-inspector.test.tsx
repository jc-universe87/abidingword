import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

const V1 = "Fixture alpha JHN 15:1 about the vine.";

function setup() {
  const api = createMemoryApi();
  const alpha = api.installFixtureBible("FXA", "alpha");
  api.installFixtureBible("FXB", "beta");
  api.state.settings.scripturePassage = "JHN.15";
  return { api, alpha };
}

const pane = () => screen.getByRole("complementary", { name: "Scripture" });
const ready = () => waitFor(() => expect(verseText("JHN.15.1")).not.toBeNull());
const verseText = (verse: string) => pane().querySelector<HTMLElement>(`[data-verse-text="${verse}"]`)!;
const verseButton = (n: number) => within(pane()).getByRole("button", { name: new RegExp(`^Verse ${n}[.,].*Show verse tools`) });
const marker = (verse: string) => verseText(verse).closest("p")!.querySelector<HTMLButtonElement>("[data-verse-marker]");
const inspector = (n: number) => screen.findByRole("region", { name: `Tools for verse ${n}` });
const noInspector = () => expect(screen.queryByRole("region", { name: /^Tools for verse/ })).toBeNull();

async function phrase(api: MemoryApi, translationId: string, kind: "highlight" | "note") {
  return api.annotationCreate({
    reference: "JHN.15.1",
    kind,
    color: kind === "highlight" ? "green" : undefined,
    content: kind === "note" ? "Remember" : undefined,
    anchor: { translationId, start: { verse: "JHN.15.1", offset: 8 }, end: { verse: "JHN.15.1", offset: 13 }, quote: "alpha" },
  });
}

let restore: Array<() => void> = [];
afterEach(() => {
  for (const undo of restore) undo();
  restore = [];
});

describe("opening the inspector", () => {
  it("does not push the verse text down: nothing is inserted under the verse", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    const shape = () => [...verseText("JHN.15.1").closest("div")!.querySelectorAll("*")].map((el) => el.tagName);
    const before = shape();
    await user.click(verseButton(1));
    const region = await inspector(1);
    const verseBlock = verseText("JHN.15.1").closest("div")!;
    expect(verseBlock.contains(region)).toBe(false);
    expect(verseBlock.querySelector("textarea, [role='region']")).toBeNull();
    // The verse block holds exactly what it held before: no tools were added under it.
    expect(shape()).toEqual(before);
    expect(verseBlock.querySelector("[data-verse-text]")!.textContent).toBe(V1);
  });

  it("opens from the verse number, names itself, and takes focus", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    const opener = verseButton(1);
    expect(opener).toHaveAttribute("aria-expanded", "false");
    await user.click(opener);
    const region = await inspector(1);
    expect(within(region).getByRole("heading", { level: 3, name: "Tools for verse 1" })).toHaveFocus();
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(opener).toHaveAttribute("aria-controls", region.id);
    for (const name of ["Add note", "Highlight", "Bookmark", "Close"]) {
      expect(within(region).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("opens the same inspector from the marker", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "One" });
    const { user } = await renderApp(api);
    await ready();
    const m = marker("JHN.15.1")!;
    await user.click(m);
    const region = await inspector(1);
    expect(within(region).getByText("One")).toBeInTheDocument();
    expect(m).toHaveAttribute("aria-expanded", "true");
    expect(m).toHaveAttribute("aria-controls", region.id);
    // The verse number points at it too.
    expect(verseButton(1)).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps one inspector open at a time", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(1));
    await inspector(1);
    await user.click(verseButton(2));
    await inspector(2);
    expect(screen.getAllByRole("region", { name: /^Tools for verse/ })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Tools for verse 1" })).toBeNull();
    // The same opener toggles it closed.
    await user.click(verseButton(2));
    await waitFor(noInspector);
  });

  it("opens from the keyboard", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    verseButton(3).focus();
    await user.keyboard("{Enter}");
    await inspector(3);
    await user.keyboard("{Escape}");
    await waitFor(noInspector);
    verseButton(3).focus();
    await user.keyboard(" ");
    await inspector(3);
  });
});

describe("the marker", () => {
  it("is one button per verse whose name says what is there", async () => {
    const { api, alpha } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "One" });
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "Two" });
    await api.annotationCreate({ reference: "JHN.15.1", kind: "bookmark" });
    await api.annotationCreate({ reference: "JHN.15.1", kind: "highlight", color: "amber" });
    await phrase(api, alpha.id, "highlight");
    await api.annotationCreate({ reference: "JHN.15.2", kind: "bookmark" });
    await renderApp(api);
    await ready();
    expect(pane().querySelectorAll("[data-verse-marker]")).toHaveLength(2);
    expect(verseText("JHN.15.1").closest("p")!.querySelectorAll("[data-verse-marker]")).toHaveLength(1);
    expect(marker("JHN.15.1")).toHaveAccessibleName("Verse 1: 2 notes, bookmarked, highlighted Amber, has highlighted words. Show annotations");
    expect(marker("JHN.15.2")).toHaveAccessibleName("Verse 2: bookmarked. Show annotations");
    expect(marker("JHN.15.3")).toBeNull();
  });

  it("reads 'one note' for a single note", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "Only" });
    await renderApp(api);
    await ready();
    expect(marker("JHN.15.1")).toHaveAccessibleName("Verse 1: 1 note. Show annotations");
  });
});

describe("whole-verse actions", () => {
  it("adds a note: the editor takes focus, saving lists it and returns focus", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(1));
    const region = await inspector(1);
    await user.click(within(region).getByRole("button", { name: "Add note" }));
    const field = within(region).getByLabelText("Note on verse 1");
    expect(field).toHaveFocus();
    await user.type(field, "Remain in the vine.");
    await user.click(within(region).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(api.state.annotations.map((a) => [a.kind, a.content])).toEqual([["note", "Remain in the vine."]]));
    expect(await within(region).findByText("Remain in the vine.")).toBeInTheDocument();
    expect(within(region).queryByLabelText("Note on verse 1")).toBeNull();
    expect(within(region).getByRole("button", { name: "Add note" })).toHaveFocus();
  });

  it("sets, recolours and removes the verse highlight", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(2));
    const region = await inspector(2);
    const highlight = within(region).getByRole("button", { name: "Highlight" });
    expect(highlight).toHaveAttribute("aria-pressed", "false");
    await user.click(highlight);
    const colours = within(region).getByRole("group", { name: "Highlight colour" });
    expect(within(colours).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Amber", "Green", "Blue", "Rose", "Grey"]);
    await user.click(within(colours).getByRole("button", { name: "Rose" }));
    await waitFor(() => expect(api.state.annotations[0]).toMatchObject({ kind: "highlight", color: "rose" }));
    expect(highlight).toHaveFocus();
    expect(highlight).toHaveAttribute("aria-pressed", "true");

    await user.click(highlight);
    await user.click(within(within(region).getByRole("group", { name: "Highlight colour" })).getByRole("button", { name: "Grey" }));
    await waitFor(() => expect(api.state.annotations[0]!.color).toBe("grey"));
    expect(api.state.annotations).toHaveLength(1);

    await user.click(highlight);
    await user.click(within(region).getByRole("button", { name: "Remove highlight" }));
    await waitFor(() => expect(api.state.annotations).toHaveLength(0));
    expect(region).toBeInTheDocument(); // the inspector stays, still useful
  });

  it("toggles the bookmark", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(2));
    const region = await inspector(2);
    const bookmark = within(region).getByRole("button", { name: "Bookmark" });
    expect(bookmark).toHaveAttribute("aria-pressed", "false");
    await user.click(bookmark);
    await waitFor(() => expect(bookmark).toHaveAttribute("aria-pressed", "true"));
    expect(api.state.annotations[0]).toMatchObject({ kind: "bookmark", color: null, anchor: null });
    await user.click(bookmark);
    await waitFor(() => expect(bookmark).toHaveAttribute("aria-pressed", "false"));
    expect(api.state.annotations).toHaveLength(0);
  });
});

describe("existing marks", () => {
  it("edits a note: the editor takes focus; Escape cancels back to Edit; Save keeps the change", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "First thought" });
    const { user } = await renderApp(api);
    await ready();
    await user.click(marker("JHN.15.1")!);
    const region = await inspector(1);
    await user.click(within(region).getByRole("button", { name: "Edit" }));
    const field = within(region).getByLabelText("Edit note");
    expect(field).toHaveFocus();
    await user.type(field, " — changed");
    await user.keyboard("{Escape}");
    // Only the editor closed: the inspector is still there and Edit has focus.
    expect(region).toBeInTheDocument();
    await waitFor(() => expect(within(region).getByRole("button", { name: "Edit" })).toHaveFocus());
    expect(api.state.annotations[0]!.content).toBe("First thought");

    await user.click(within(region).getByRole("button", { name: "Edit" }));
    const again = within(region).getByLabelText("Edit note");
    await user.clear(again);
    await user.type(again, "Second thought");
    await user.click(within(region).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.state.annotations[0]!.content).toBe("Second thought"));
    expect(await within(region).findByText("Second thought")).toBeInTheDocument();
  });

  it("deletes a note and keeps focus inside the inspector", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "Only note" });
    const { user } = await renderApp(api);
    await ready();
    await user.click(marker("JHN.15.1")!);
    const region = await inspector(1);
    await user.click(within(region).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.state.annotations).toHaveLength(0));
    expect(region).toBeInTheDocument();
    expect(region.contains(document.activeElement)).toBe(true);
    // With nothing left the marker is gone, and the verse number is still there.
    await waitFor(() => expect(marker("JHN.15.1")).toBeNull());
    expect(verseButton(1)).toBeInTheDocument();
  });

  it("lists phrase highlights and phrase notes with their words and colour names", async () => {
    const { api, alpha } = setup();
    await phrase(api, alpha.id, "highlight");
    await phrase(api, alpha.id, "note");
    const { user } = await renderApp(api);
    await ready();
    await user.click(marker("JHN.15.1")!);
    const region = await inspector(1);
    const marks = within(region).getByRole("list", { name: "Highlighted words in verse 1" });
    expect(within(marks).getByText("Green")).toBeInTheDocument(); // the colour is a word, not only a colour
    expect(within(marks).getByText("alpha")).toBeInTheDocument();
    const notes = within(region).getByRole("list", { name: "Notes on verse 1" });
    expect(within(notes).getByText("Remember")).toBeInTheDocument();
    expect(within(notes).getByText("alpha")).toBeInTheDocument();
    expect(within(region).queryByText("Not shown in this wording")).toBeNull();
    // No raw anchor data.
    expect(region.textContent).not.toMatch(/sha256|offset|\b8\b.*\b13\b/);
  });

  it("recolours and removes a phrase highlight", async () => {
    const { api, alpha } = setup();
    await phrase(api, alpha.id, "highlight");
    const { user } = await renderApp(api);
    await ready();
    await user.click(marker("JHN.15.1")!);
    const region = await inspector(1);
    const item = within(within(region).getByRole("list", { name: "Highlighted words in verse 1" })).getByTestId("phrase-highlight");
    await user.click(within(item).getByRole("button", { name: "Highlight colour" }));
    await user.click(within(within(item).getByRole("group", { name: "Highlight colour" })).getByRole("button", { name: "Blue" }));
    await waitFor(() => expect(api.state.annotations[0]!.color).toBe("blue"));
    expect(await within(region).findByText("Blue")).toBeInTheDocument();

    await user.click(within(region).getByRole("button", { name: /^Remove highlight on/ }));
    await waitFor(() => expect(api.state.annotations).toHaveLength(0));
    expect(region.contains(document.activeElement)).toBe(true);
  });

  it("says 'Not shown in this wording' for a phrase from other wording, and never mutates it", async () => {
    const { api, alpha } = setup();
    await phrase(api, alpha.id, "highlight");
    await phrase(api, alpha.id, "note");
    const { user } = await renderApp(api);
    await ready();
    const before = JSON.stringify(api.state.annotations);
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");
    await waitFor(() => expect(verseText("JHN.15.1").textContent).toBe("Fixture beta JHN 15:1 about the vine."));
    expect(JSON.stringify(api.state.annotations)).toBe(before);

    await user.click(marker("JHN.15.1")!);
    const region = await inspector(1);
    expect(within(region).getAllByText(/Not shown in this wording/)).toHaveLength(2); // the highlight and the note
    expect(within(region).getByText("Remember")).toBeInTheDocument(); // the note itself is still there
  });
});

describe("Escape and focus", () => {
  it("closes the colours first, then the inspector, and returns focus to what opened it", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    const opener = verseButton(2);
    await user.click(opener);
    const region = await inspector(2);
    await user.click(within(region).getByRole("button", { name: "Highlight" }));
    expect(within(region).getByRole("group", { name: "Highlight colour" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(within(region).queryByRole("group", { name: "Highlight colour" })).toBeNull();
    expect(region).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Highlight" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(noInspector);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("returns focus to the marker when the marker opened it", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "One" });
    const { user } = await renderApp(api);
    await ready();
    const m = marker("JHN.15.1")!;
    await user.click(m);
    await inspector(1);
    await user.keyboard("{Escape}");
    await waitFor(noInspector);
    await waitFor(() => expect(m).toHaveFocus());
  });

  it("cancelling a new note puts focus back on Add note, with the draft discarded", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(1));
    const region = await inspector(1);
    await user.click(within(region).getByRole("button", { name: "Add note" }));
    await user.type(within(region).getByLabelText("Note on verse 1"), "unsaved");
    await user.keyboard("{Escape}");
    expect(region).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Add note" })).toHaveFocus();
    expect(api.state.annotations).toHaveLength(0);
  });

  it("closes with the Close button and also returns focus", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    const opener = verseButton(1);
    await user.click(opener);
    await user.click(within(await inspector(1)).getByRole("button", { name: "Close" }));
    await waitFor(noInspector);
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("errors", () => {
  it("shows a translated error, keeps the inspector open and keeps the typed note", async () => {
    const { api } = setup();
    api.annotationCreate = async () => {
      throw { kind: "invalidInput", message: "This note is too long to save.", code: "annotations.tooLong", params: {} };
    };
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(1));
    const region = await inspector(1);
    await user.click(within(region).getByRole("button", { name: "Add note" }));
    await user.type(within(region).getByLabelText("Note on verse 1"), "A long thought");
    await user.click(within(region).getByRole("button", { name: "Save note" }));

    expect(await within(region).findByRole("alert")).toHaveTextContent("This note is too long to save.");
    expect(region).toBeInTheDocument();
    expect(within(region).getByLabelText("Note on verse 1")).toHaveValue("A long thought");
  });
});

describe("narrow and wide Scripture panes", () => {
  /** Lets a test say how wide the reader is, and tell the page it changed. */
  function controllable() {
    const callbacks: ResizeObserverCallback[] = [];
    const previous = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    restore.push(() => {
      globalThis.ResizeObserver = previous;
    });
    return async (width: number) => {
      const reader = verseText("JHN.15.1").closest(".reading")!.parentElement!;
      Object.defineProperty(reader, "clientWidth", { configurable: true, value: width });
      await act(async () => {
        for (const callback of callbacks) callback([], {} as ResizeObserver);
      });
    };
  }

  it("uses a sheet when the Scripture pane is narrow, whatever the window width", async () => {
    const resize = controllable();
    const { api } = setup();
    const { user } = await renderApp(api, { width: 1600 }); // a wide window
    await ready();
    await resize(380); // a narrow pane
    await user.click(verseButton(1));
    expect(await inspector(1)).toHaveAttribute("data-layout", "sheet");
  });

  it("uses the wide panel when the pane is wide, even in a narrow window", async () => {
    const resize = controllable();
    const { api } = setup();
    const { user } = await renderApp(api, { width: 1100 }); // the narrowest window that shows the pane
    await ready();
    await resize(720);
    await user.click(verseButton(1));
    expect(await inspector(1)).toHaveAttribute("data-layout", "panel");
  });

  it("follows the pane as it is resized, and the sheet keeps every control and fits its width", async () => {
    const resize = controllable();
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "A note" });
    const { user } = await renderApp(api);
    await ready();
    await resize(700);
    await user.click(verseButton(1));
    const region = await inspector(1);
    expect(region).toHaveAttribute("data-layout", "panel");
    await resize(360);
    expect(region).toHaveAttribute("data-layout", "sheet");
    for (const name of ["Add note", "Highlight", "Bookmark", "Close", "Edit", "Delete"]) {
      expect(within(region).getByRole("button", { name })).toBeInTheDocument();
    }
    // It scrolls inside itself rather than overflowing the pane, and its text fields fill its width.
    expect(region.className).toMatch(/overflow-y-auto/);
    expect(region.className).toMatch(/min-w-0/);
    await user.click(within(region).getByRole("button", { name: "Add note" }));
    expect(within(region).getByLabelText("Note on verse 1").className).toMatch(/w-full/);
    await resize(700);
    expect(region).toHaveAttribute("data-layout", "panel");
  });
});

describe("staleness and the rest of the reader", () => {
  it("closes when the chapter changes", async () => {
    const { api } = setup();
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(1));
    await inspector(1);
    await user.click(within(pane()).getByRole("button", { name: "Next chapter" }));
    await waitFor(noInspector);
    await waitFor(() => expect(within(pane()).getByRole("heading", { level: 2 })).toHaveTextContent("John 16"));
    // Back on the first chapter, nothing reopens by itself.
    await user.click(within(pane()).getByRole("button", { name: "Previous chapter" }));
    await waitFor(() => expect(within(pane()).getByRole("heading", { level: 2 })).toHaveTextContent("John 15"));
    noInspector();
  });

  it("closes when the translation changes, and the marks are unchanged", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "bookmark" });
    const { user } = await renderApp(api);
    await ready();
    await user.click(marker("JHN.15.1")!);
    await inspector(1);
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");
    await waitFor(noInspector);
    expect(api.state.annotations).toHaveLength(1);
    await waitFor(() => expect(marker("JHN.15.1")).toHaveAccessibleName("Verse 1: bookmarked. Show annotations"));
  });

  it("leaves the selection toolbar working, with the inspector open", async () => {
    const { api, alpha } = setup();
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(1));
    await inspector(1);
    const node = verseText("JHN.15.1").firstChild!;
    const range = document.createRange();
    range.setStart(node, 8);
    range.setEnd(node, 13);
    await act(async () => {
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    const bar = await screen.findByRole("group", { name: "Actions for the selected words" });
    expect(screen.getByRole("region", { name: "Tools for verse 1" })).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Highlight" }));
    await user.click(within(bar).getByRole("button", { name: "Blue" }));
    await waitFor(() => expect(api.state.annotations.some((a) => a.anchor?.quote === "alpha" && a.color === "blue" && a.translationId === alpha.id)).toBe(true));
  });
});
