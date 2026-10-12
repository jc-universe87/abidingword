import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi, type MemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// All library text here is invented for the tests.
const SERMON: SourceFixture = {
  title: "The True Vine",
  author: "J. Example",
  format: "markdown",
  language: "English",
  segments: [
    { text: "Abide in me, and I in you.", sectionPath: "The Vine" },
    { text: "As the branch cannot bear fruit by itself, neither can you.", sectionPath: "The Vine" },
    { text: "By this my Father is glorified, that you bear much fruit.", sectionPath: "Fruit" },
  ],
};

async function openReader(api: MemoryApi = createMemoryApi()) {
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  api.installFixtureSource(SERMON);
  const result = await renderApp(api);
  const { user } = result;
  await user.click(await within(screen.getByRole("complementary", { name: "Sources" })).findByRole("button", { name: "Open library" }));
  const library = await screen.findByRole("main");
  await user.click((await within(library).findAllByRole("button", { name: /The True Vine/ }))[0]!);
  await screen.findByRole("heading", { level: 1, name: "The True Vine" });
  await within(screen.getByTestId("reader-body")).findByText(/Abide in me/);
  return { ...result, api };
}

const paragraph = (index: number) => screen.getByTestId("reader-body").querySelectorAll<HTMLElement>("[data-segment-id]")[index]!;

/** The text node and offset `offset` UTF-16 units into a paragraph's own text (marks' buttons left out). */
function point(element: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("[data-aw-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let left = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) return [node, left];
    left -= length;
  }
  throw new Error("offset beyond the paragraph");
}

/** Selects text as a user would, from one paragraph offset to another. */
async function select(from: [number, number], to: [number, number]) {
  const range = document.createRange();
  range.setStart(...point(paragraph(from[0]), from[1]));
  range.setEnd(...point(paragraph(to[0]), to[1]));
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

const strip = () => screen.findByRole("group", { name: "Mark the selected text" });
const live = (api: MemoryApi) => api.state.library.annotations.filter((a) => !a.deleted);

describe("marking a source in Reading", () => {
  it("highlights selected words in the chosen colour, with a spoken marker", async () => {
    const { api, user } = await openReader();
    const text = SERMON.segments[1]!.text;
    const at = text.indexOf("bear fruit");
    await select([1, at], [1, at + "bear fruit".length]);
    const bar = await strip();
    expect(within(bar).getByTestId("source-selection-quote")).toHaveTextContent("bear fruit");
    await user.click(within(bar).getByRole("button", { name: "Highlight" }));
    await user.click(within(bar).getByRole("button", { name: "Green" }));

    await waitFor(() => expect(live(api)).toHaveLength(1));
    const made = live(api)[0]!;
    expect(made).toMatchObject({ kind: "highlight", color: "green", quote: "bear fruit" });
    expect(made.start).toMatchObject({ offset: at });
    expect(made.end).toMatchObject({ offset: at + 10 });
    // Drawn in the text, and named by the paragraph's marker (never colour alone).
    await waitFor(() => expect(paragraph(1).querySelector("[data-source-highlight='green']")).toHaveTextContent("bear fruit"));
    expect(within(paragraph(1)).getByRole("button", { name: "1 mark here: Highlight" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mark the selected text" })).toBeNull();
  });

  it("joins a selection across paragraphs with a line break, as the core does", async () => {
    const { api, user } = await openReader();
    const first = SERMON.segments[0]!.text;
    await select([0, first.indexOf("I in you")], [1, "As the branch".length]);
    const bar = await strip();
    await user.click(within(bar).getByRole("button", { name: "Highlight" }));
    await user.click(within(bar).getByRole("button", { name: "Amber" }));
    await waitFor(() => expect(live(api)).toHaveLength(1));
    expect(live(api)[0]!.quote).toBe("I in you.\nAs the branch");
    await waitFor(() => expect(paragraph(1).querySelector("[data-source-highlight='amber']")).toHaveTextContent("As the branch"));
    expect(paragraph(0).querySelector("[data-source-highlight='amber']")).toHaveTextContent("I in you.");
  });

  it("adds a note on words, then reads, edits and deletes it from the paragraph's marker", async () => {
    const { api, user } = await openReader();
    const text = SERMON.segments[2]!.text;
    const at = text.indexOf("much fruit");
    await select([2, at], [2, at + 10]);
    const bar = await strip();
    await user.click(within(bar).getByRole("button", { name: "Add note" }));
    await user.type(within(bar).getByRole("textbox", { name: "Note" }), "Fruit is the evidence.");
    await user.click(within(bar).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(live(api)).toHaveLength(1));
    expect(live(api)[0]).toMatchObject({ kind: "note", content: "Fruit is the evidence.", quote: "much fruit" });
    await waitFor(() => expect(paragraph(2).querySelector("[data-source-note]")).toHaveTextContent("much fruit"));

    const marker = within(paragraph(2)).getByRole("button", { name: "1 mark here: Note" });
    await user.click(marker);
    const panel = await screen.findByRole("region", { name: "Marks here" });
    expect(within(panel).getByText("Fruit is the evidence.")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Edit note" }));
    const field = within(panel).getByRole("textbox", { name: "Note" });
    await user.clear(field);
    await user.type(field, "Fruit shows abiding.");
    await user.click(within(panel).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(live(api)[0]!.content).toBe("Fruit shows abiding."));
    await user.click(within(await screen.findByRole("region", { name: "Marks here" })).getByRole("button", { name: "Delete note" }));
    await waitFor(() => expect(live(api)).toHaveLength(0));
    await waitFor(() => expect(within(paragraph(2)).queryByRole("button", { name: /mark here/ })).toBeNull());
  });

  it("closes the marks panel with Escape and gives focus back to the marker", async () => {
    const api = createMemoryApi();
    const { user } = await openReader(api);
    const segment = api.state.library.segments.find((x) => x.text.startsWith("Abide"))!;
    await api.sourceAnnotationCreate({ sourceId: segment.sourceId, kind: "bookmark", place: { segmentId: segment.id } });
    // Reading again (another source would): open it once more.
    await user.click(within(screen.getByTestId("reader-header")).getByRole("button", { name: "Back" }));
    const library = await screen.findByRole("main");
    await user.click((await within(library).findAllByRole("button", { name: /The True Vine/ }))[0]!);
    const marker = await within(screen.getByTestId("reader-body")).findByRole("button", { name: "1 mark here: Bookmark" });
    await user.click(marker);
    const panel = await screen.findByRole("region", { name: "Marks here" });
    await waitFor(() => expect(within(panel).getByRole("heading", { name: "Marks here" })).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Marks here" })).toBeNull());
    await waitFor(() => expect(marker).toHaveFocus());
  });

  it("recolours a highlight from the marks panel", async () => {
    const { api, user } = await openReader();
    await select([0, 0], [0, "Abide in me".length]);
    const bar = await strip();
    await user.click(within(bar).getByRole("button", { name: "Highlight" }));
    await user.click(within(bar).getByRole("button", { name: "Amber" }));
    await user.click(await within(paragraph(0)).findByRole("button", { name: "1 mark here: Highlight" }));
    const panel = await screen.findByRole("region", { name: "Marks here" });
    expect(within(panel).getByText("Colour: Amber")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Change colour" }));
    await user.click(within(panel).getByRole("button", { name: "Rose" }));
    await waitFor(() => expect(live(api)[0]!.color).toBe("rose"));
    await waitFor(() => expect(paragraph(0).querySelector("[data-source-highlight='rose']")).not.toBeNull());
  });
});

describe("marking a place without selecting words", () => {
  it("bookmarks the place the reader is at, and removes it again (one button, pressed state)", async () => {
    const { api, user } = await openReader();
    const header = screen.getByTestId("reader-header");
    const add = within(header).getByRole("button", { name: "Bookmark this place" });
    expect(add).toHaveAttribute("aria-pressed", "false");
    await user.click(add);
    await waitFor(() => expect(live(api)).toHaveLength(1));
    expect(live(api)[0]).toMatchObject({ kind: "bookmark", quote: null });
    const remove = await within(header).findByRole("button", { name: "Remove the bookmark here" });
    expect(remove).toHaveAttribute("aria-pressed", "true");
    await user.click(remove);
    await waitFor(() => expect(live(api)).toHaveLength(0));
  });

  it("adds a note on a paragraph from the keyboard, with focus returned afterwards", async () => {
    const { api, user } = await openReader();
    const button = within(screen.getByTestId("reader-header")).getByRole("button", { name: "Add note here" });
    button.focus();
    await user.keyboard("{Enter}");
    const bar = await strip();
    const field = within(bar).getByRole("textbox", { name: "Note" });
    await waitFor(() => expect(field).toHaveFocus());
    expect(within(bar).getByText("Note on this paragraph")).toBeInTheDocument();
    await user.keyboard("A note for Sunday.");
    await user.click(within(bar).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(live(api)).toHaveLength(1));
    expect(live(api)[0]).toMatchObject({ kind: "note", content: "A note for Sunday.", quote: null });
    await waitFor(() => expect(button).toHaveFocus());

    // Escape leaves without saving, and focus comes back too.
    await user.keyboard("{Enter}");
    await strip();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("group", { name: "Mark the selected text" })).toBeNull());
    await waitFor(() => expect(button).toHaveFocus());
    expect(live(api)).toHaveLength(1);
  });

  it("highlights a whole paragraph without a mouse selection", async () => {
    const { api, user } = await openReader();
    await user.click(within(screen.getByTestId("reader-header")).getByRole("button", { name: "Add note here" }));
    const bar = await strip();
    await user.click(within(bar).getByRole("button", { name: "Highlight this paragraph" }));
    await user.click(within(bar).getByRole("button", { name: "Blue" }));
    await waitFor(() => expect(live(api)).toHaveLength(1));
    expect(live(api)[0]).toMatchObject({ kind: "highlight", color: "blue", quote: SERMON.segments[0]!.text });
  });
});
