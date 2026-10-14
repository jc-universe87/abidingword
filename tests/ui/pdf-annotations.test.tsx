import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePdfEngine, textItem } from "../support/fakePdfEngine";
import { createMemoryApi, type MemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Marks on the Original PDF (v0.14): drawn where the stored words are placed exactly on the
// drawn page, made from a selection on the page, and kept per page. All text is invented.
const BOOK: SourceFixture = {
  title: "Fruit and Pruning",
  format: "pdf",
  language: "English",
  segments: [
    { text: "Abiding is the heart of fruitfulness.", pageNumber: 1 },
    { text: "Every branch that bears fruit is pruned.", pageNumber: 1 },
    { text: "Pruning is painful but good.", pageNumber: 2 },
  ],
};

function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  api.installFixtureSource(BOOK);
  const engine = createFakePdfEngine({ pages: 3 });
  engine.pageTexts = {
    1: [
      textItem("FRUIT AND PRUNING", { top: 0.02 }), // a running header
      textItem("Abiding is the heart of fruit-"),
      textItem("fulness."),
      textItem("Every branch that bears fruit is pruned."),
    ],
    2: [textItem("Pruning is painful but good.")],
    3: [], // a scanned page
  };
  return { api, engine };
}

type User = Awaited<ReturnType<typeof renderApp>>["user"];
const pageSheet = (n: number) => screen.getByRole("group", { name: `Page ${n}` });
const live = (api: MemoryApi) => api.state.library.annotations.filter((a) => !a.deleted);

async function openOriginal(user: User) {
  await user.click(await within(screen.getByRole("complementary", { name: "Sources" })).findByRole("button", { name: "Open library" }));
  await user.click((await within(await screen.findByRole("main")).findAllByRole("button", { name: /Fruit and Pruning/ }))[0]!);
  await screen.findByRole("heading", { level: 1, name: "Fruit and Pruning" });
  await user.click(screen.getByRole("button", { name: "Original" }));
  await waitFor(() => expect(pageSheet(1).querySelectorAll(".textLayer span").length).toBeGreaterThan(0));
}

/** Selects drawn text on a page from (span, offset) to (span, offset), as a user would. */
async function selectOnPage(page: number, from: [number, number], to: [number, number]) {
  const spans = pageSheet(page).querySelectorAll<HTMLElement>(".textLayer span");
  const range = document.createRange();
  range.setStart(spans[from[0]]!.firstChild!, from[1]);
  range.setEnd(spans[to[0]]!.firstChild!, to[1]);
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

afterEach(() => {
  window.localStorage.clear();
});

describe("marks on the Original PDF", () => {
  it("highlights a selection on the page, anchored in the stored text, and draws it", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openOriginal(user);
    // "heart of fruitfulness" runs across the broken word: stored as one word.
    const first = "Abiding is the heart of fruit-";
    await selectOnPage(1, [1, first.indexOf("heart")], [2, "fulness".length]);
    const bar = await screen.findByRole("group", { name: "Mark the selected text" });
    expect(within(bar).getByTestId("source-selection-quote")).toHaveTextContent("heart of fruitfulness");
    await user.click(within(bar).getByRole("button", { name: "Highlight" }));
    await user.click(within(bar).getByRole("button", { name: "Green" }));
    await waitFor(() => expect(live(api)).toHaveLength(1));
    const made = live(api)[0]!;
    const stored = BOOK.segments[0]!.text;
    expect(made).toMatchObject({ kind: "highlight", color: "green", quote: "heart of fruitfulness" });
    expect(made.start).toMatchObject({ offset: stored.indexOf("heart") });
    // Drawn on the page (over both drawn lines), and listed by the page's marker.
    await waitFor(() => expect(pageSheet(1).querySelectorAll("[data-pdf-mark='green']").length).toBe(2));
    expect(within(pageSheet(1)).getByRole("button", { name: "1 mark here: Highlight" })).toBeInTheDocument();
    // The same mark in Reading.
    await user.click(screen.getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(screen.getByTestId("reader-body").querySelector("[data-source-highlight='green']")).toHaveTextContent("heart of fruitfulness"));
  });

  it("does not offer to mark a running header, and says so", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openOriginal(user);
    await selectOnPage(1, [0, 0], [0, 5]);
    expect(await screen.findByText(/cannot be marked here exactly/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mark the selected text" })).toBeNull();
  });

  it("draws a mark made in Reading on its page, and keeps it there when zoomed", async () => {
    const { api, engine } = setup();
    const segment = api.state.library.segments.find((x) => x.text.startsWith("Every branch"))!;
    const at = segment.text.indexOf("bears fruit");
    await api.sourceAnnotationCreate({ sourceId: segment.sourceId, kind: "note", content: "Fruit is pruned.", start: { segmentId: segment.id, offset: at }, end: { segmentId: segment.id, offset: at + 11 }, quote: "bears fruit" });
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openOriginal(user);
    const note = await waitFor(() => {
      const found = pageSheet(1).querySelector<HTMLElement>("[data-pdf-mark='note']");
      expect(found).not.toBeNull();
      return found!;
    });
    // A share of the page: item 3 starts at character 0; "bears fruit" from 23 on (fake layout: 1% per character).
    expect(note).toHaveStyle({ left: `${at}%` });
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(pageSheet(1).querySelector("[data-pdf-mark='note']")).toHaveStyle({ left: `${at}%` }));
    // The page's marker opens the note, which can be read and edited there.
    await user.click(within(pageSheet(1)).getByRole("button", { name: "1 mark here: Note" }));
    const panel = await screen.findByRole("region", { name: "Marks here" });
    expect(within(panel).getByText("Fruit is pruned.")).toBeInTheDocument();
  });

  it("bookmarks the page in view, and a page without text too", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openOriginal(user);
    const header = screen.getByTestId("reader-header");
    await user.click(within(header).getByRole("button", { name: "Bookmark this place" }));
    await waitFor(() => expect(live(api)).toHaveLength(1));
    const bookmark = live(api)[0]!;
    expect(bookmark).toMatchObject({ kind: "bookmark", pageNumber: 1 });
    // It belongs to the page's first paragraph too, so Reading shows it there.
    expect(bookmark.start?.segmentId).toBe(api.state.library.segments.find((x) => x.text.startsWith("Abiding"))!.id);
    expect(await within(header).findByRole("button", { name: "Remove the bookmark here" })).toHaveAttribute("aria-pressed", "true");
    expect(await within(pageSheet(1)).findByRole("button", { name: "1 mark here: Bookmark" })).toBeInTheDocument();

    // A scanned page (no text of its own): the page itself is bookmarked.
    const pageBox = screen.getByRole("textbox", { name: "Page number" });
    await user.clear(pageBox);
    await user.type(pageBox, "3{Enter}");
    await user.click(await within(header).findByRole("button", { name: "Bookmark this place" }));
    await waitFor(() => expect(live(api)).toHaveLength(2));
    expect(live(api)[1]).toMatchObject({ kind: "bookmark", pageNumber: 3, start: null });
    expect(await within(pageSheet(3)).findByRole("button", { name: "1 mark here: Bookmark" })).toBeInTheDocument();
  });

  it("writes a note on the page in view from the keyboard", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openOriginal(user);
    within(screen.getByTestId("reader-header")).getByRole("button", { name: "Add note here" }).focus();
    await user.keyboard("{Enter}");
    const bar = await screen.findByRole("group", { name: "Mark the selected text" });
    expect(within(bar).getByText("Note on this paragraph")).toBeInTheDocument();
    await user.keyboard("Read this page again.");
    await user.click(within(bar).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(live(api)).toHaveLength(1));
    expect(live(api)[0]).toMatchObject({ kind: "note", content: "Read this page again.", pageNumber: 1, quote: null });
  });
});
