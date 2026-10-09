import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import type { MemoryApi } from "../support/memoryApi";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

const V1 = "Fixture alpha JHN 15:1 about the vine.";

async function seeded({ extra = 0 }: { extra?: number } = {}) {
  const api = createMemoryApi();
  const alpha = api.installFixtureBible("FXA", "alpha");
  api.installFixtureBible("FXB", "beta");
  api.state.settings.scripturePassage = "JHN.15";
  const at = V1.indexOf("about the vine");
  await api.annotationCreate({ reference: "ROM.8.28", kind: "note", content: "Everything works together" });
  await api.annotationCreate({ reference: "JHN.15.4", kind: "note", content: "Abide means to stay close" });
  await api.annotationCreate({ reference: "JHN.15.5", kind: "highlight", color: "green" });
  await api.annotationCreate({ reference: "GEN.1.1", kind: "bookmark" });
  await api.annotationCreate({ reference: "ROM.8.1", kind: "highlight", color: "blue" });
  await api.annotationCreate({
    reference: "JHN.15.1",
    kind: "highlight",
    color: "rose",
    anchor: { translationId: alpha.id, start: { verse: "JHN.15.1", offset: at }, end: { verse: "JHN.15.1", offset: at + 14 }, quote: "about the vine" },
  });
  await api.annotationCreate({
    reference: "JHN.15.1",
    kind: "note",
    content: "The vine is Christ",
    anchor: { translationId: alpha.id, start: { verse: "JHN.15.1", offset: at }, end: { verse: "JHN.15.1", offset: at + 14 }, quote: "about the vine" },
  });
  for (let i = 1; i <= extra; i += 1) await api.annotationCreate({ reference: `PSA.23.${i}`, kind: "bookmark" });
  return api;
}

const pane = () => screen.getByRole("complementary", { name: "Scripture" });
const switchTo = (name: "Bible" | "Marks") => screen.getByRole("button", { name });
const view = () => screen.getByRole("group", { name: "Scripture view" });
const kinds = () => within(pane()).getByRole("group", { name: "Show" });
const kind = (name: string) => within(kinds()).getByRole("button", { name });
const cards = () => within(pane()).getAllByRole("button", { name: /^(Genesis|John|Romans|Psalm)/ });
const labels = () => cards().map((c) => c.querySelector("span.font-medium")?.textContent);

async function openMarks(api: MemoryApi) {
  const { user } = await renderApp(api);
  await waitFor(() => expect(pane().querySelector('[data-verse-text="JHN.15.1"]')).not.toBeNull());
  await user.click(switchTo("Marks"));
  await screen.findByRole("heading", { level: 2, name: "Marks" });
  await waitFor(() => expect(within(pane()).queryByText("Loading your marks…")).toBeNull());
  return user;
}

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("Bible and Marks", () => {
  it("opens in the Bible, with one plain switch to Marks and back", async () => {
    const api = await seeded();
    const { user } = await renderApp(api);
    await waitFor(() => expect(pane().querySelector('[data-verse-text="JHN.15.1"]')).not.toBeNull());
    expect(switchTo("Bible")).toHaveAttribute("aria-pressed", "true");
    expect(switchTo("Marks")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("heading", { level: 2, name: "Marks" })).toBeNull();
    await user.click(switchTo("Marks"));
    expect(switchTo("Marks")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Marks" })).toBeInTheDocument();
    // Bible, Marks and (v0.12) Concordance: still one plain switch
    expect(within(view()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Bible", "Marks", "Concordance"]);
    await user.click(switchTo("Bible"));
    expect(screen.queryByRole("heading", { level: 2, name: "Marks" })).toBeNull();
    expect(within(pane()).getByRole("heading", { level: 2, name: /John 15/ })).toBeInTheDocument();
  });

  it("brings the reader back to where they were, scroll position included", async () => {
    const api = await seeded();
    const { user } = await renderApp(api);
    await waitFor(() => expect(pane().querySelector('[data-verse-text="JHN.15.1"]')).not.toBeNull());
    const scroller = pane().querySelector<HTMLElement>("[data-scroll-root]")!;
    scroller.scrollTop = 240;
    await user.click(switchTo("Marks"));
    expect(scroller.scrollTop).toBe(0);
    await user.click(switchTo("Bible"));
    expect(scroller.scrollTop).toBe(240);
    expect(within(pane()).getByRole("heading", { level: 2, name: /John 15/ })).toBeInTheDocument();
  });

  it("offers no switch (and nothing to explain) until a Bible is installed", async () => {
    await renderApp(createMemoryApi());
    expect(screen.queryByRole("group", { name: "Scripture view" })).toBeNull();
  });
});

describe("the list", () => {
  it("shows every kind together in Scripture order, in plain words", async () => {
    await openMarks(await seeded());
    expect(labels()).toEqual(["Genesis 1:1", "John 15:1", "John 15:1", "John 15:4", "John 15:5", "Romans 8:1", "Romans 8:28"]);
    expect(kind("All")).toHaveAttribute("aria-pressed", "true");
    // Nothing technical is shown: no ids, offsets, hashes or dates.
    expect(pane().textContent).not.toMatch(/JHN\.|[0-9a-f]{8}-|offset|hash|revision|20\d\d-/i);
  });

  it("narrows to notes, highlights or bookmarks", async () => {
    const user = await openMarks(await seeded());
    await user.click(kind("Notes"));
    await waitFor(() => expect(labels()).toEqual(["John 15:1", "John 15:4", "Romans 8:28"]));
    expect(kind("Notes")).toHaveAttribute("aria-pressed", "true");
    expect(kind("All")).toHaveAttribute("aria-pressed", "false");
    await user.click(kind("Highlights"));
    await waitFor(() => expect(labels()).toEqual(["John 15:1", "John 15:5", "Romans 8:1"]));
    await user.click(kind("Bookmarks"));
    await waitFor(() => expect(labels()).toEqual(["Genesis 1:1"]));
    await user.click(kind("All"));
    await waitFor(() => expect(cards()).toHaveLength(7));
  });

  it("narrows to one book", async () => {
    const user = await openMarks(await seeded());
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Book" }), "Romans");
    await waitFor(() => expect(labels()).toEqual(["Romans 8:1", "Romans 8:28"]));
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Book" }), "All books");
    await waitFor(() => expect(cards()).toHaveLength(7));
  });

  it("offers a colour only while looking at highlights", async () => {
    const user = await openMarks(await seeded());
    expect(within(pane()).queryByRole("combobox", { name: "Colour" })).toBeNull();
    await user.click(kind("Notes"));
    expect(within(pane()).queryByRole("combobox", { name: "Colour" })).toBeNull();
    await user.click(kind("Highlights"));
    const colour = within(pane()).getByRole("combobox", { name: "Colour" });
    await user.selectOptions(colour, "Green");
    await waitFor(() => expect(labels()).toEqual(["John 15:5"]));
    await user.selectOptions(colour, "Rose");
    await waitFor(() => expect(labels()).toEqual(["John 15:1"]));
    // Leaving highlights forgets the colour rather than hiding a filter that still applies.
    await user.click(kind("All"));
    await waitFor(() => expect(cards()).toHaveLength(7));
    expect(within(pane()).queryByRole("combobox", { name: "Colour" })).toBeNull();
  });
});

describe("searching notes", () => {
  it("finds words in notes, ignoring case, and clears again", async () => {
    const user = await openMarks(await seeded());
    const box = within(pane()).getByRole("searchbox", { name: "Search your notes" });
    await user.type(box, "ABIDE");
    await waitFor(() => expect(labels()).toEqual(["John 15:4"]));
    expect(kinds()).toBeInTheDocument();
    await user.clear(box);
    await waitFor(() => expect(cards()).toHaveLength(7));
  });

  it("is offered with All and Notes only, since only notes have words", async () => {
    const user = await openMarks(await seeded());
    expect(within(pane()).getByRole("searchbox")).toBeInTheDocument();
    await user.click(kind("Highlights"));
    expect(within(pane()).queryByRole("searchbox")).toBeNull();
    await user.click(kind("Bookmarks"));
    expect(within(pane()).queryByRole("searchbox")).toBeNull();
    await user.click(kind("Notes"));
    expect(within(pane()).getByRole("searchbox")).toBeInTheDocument();
  });

  it("says plainly when nothing matches", async () => {
    const user = await openMarks(await seeded());
    await user.type(within(pane()).getByRole("searchbox"), "zebra");
    expect(await within(pane()).findByText("No notes match your search.")).toBeInTheDocument();
    expect(within(pane()).queryAllByRole("button", { name: /^John/ })).toHaveLength(0);
  });
});

describe("empty and long lists", () => {
  it("is warm and short when there are no marks yet", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.state.settings.scripturePassage = "JHN.15";
    await openMarks(api);
    expect(screen.getByText("No marks yet.")).toBeInTheDocument();
    expect(screen.getByText("Highlights, notes and bookmarks you add while reading will appear here.")).toBeInTheDocument();
  });

  it("says so when a choice leaves nothing", async () => {
    const user = await openMarks(await seeded());
    await user.click(kind("Bookmarks"));
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Book" }), "Romans");
    expect(await within(pane()).findByText("Nothing here matches. Try another book or colour.")).toBeInTheDocument();
  });

  it("loads a moderate page and then more on request", async () => {
    const user = await openMarks(await seeded({ extra: 40 }));
    expect(cards()).toHaveLength(30);
    const more = within(pane()).getByRole("button", { name: "Load more" });
    await user.click(more);
    await waitFor(() => expect(cards()).toHaveLength(47));
    expect(within(pane()).queryByRole("button", { name: "Load more" })).toBeNull();
    // Still in Scripture order: Genesis first, Psalm 23 before John.
    expect(labels().slice(0, 3)).toEqual(["Genesis 1:1", "Psalm 23:1", "Psalm 23:2"]);
  });
});

describe("what each mark says", () => {
  it("names books in the interface language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    const api = await seeded();
    const { user } = await renderApp(api);
    await waitFor(() => expect(document.querySelector('[data-verse-text="JHN.15.1"]')).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Anmerkungen" }));
    expect(await screen.findByText("Johannes 15,4")).toBeInTheDocument();
    expect(screen.getByText("Genesis 1,1")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/JHN\.|GEN\./);
  });

  it("shows a note's words, and a phrase note's quote above them", async () => {
    await openMarks(await seeded());
    const plain = within(pane()).getByRole("button", { name: /John 15:4/ });
    expect(plain).toHaveTextContent("Note");
    expect(plain).toHaveTextContent("Abide means to stay close");
    const phrase = within(pane()).getAllByRole("button", { name: /John 15:1/ }).find((c) => c.textContent?.includes("The vine is Christ"))!;
    expect(phrase).toHaveTextContent("“about the vine”");
    expect(phrase.textContent!.indexOf("about the vine")).toBeLessThan(phrase.textContent!.indexOf("The vine is Christ"));
  });

  it("names a highlight's colour in words, and tells a phrase from a whole verse", async () => {
    await openMarks(await seeded());
    const whole = within(pane()).getByRole("button", { name: /John 15:5/ });
    expect(whole).toHaveTextContent("Highlight");
    expect(whole).toHaveTextContent("Green");
    expect(whole).toHaveTextContent("Whole verse");
    const phrase = within(pane()).getAllByRole("button", { name: /John 15:1/ }).find((c) => c.textContent?.includes("Rose"))!;
    expect(phrase).toHaveTextContent("“about the vine”");
    expect(phrase).not.toHaveTextContent("Whole verse");
  });

  it("marks a bookmark simply", async () => {
    await openMarks(await seeded());
    const mark = within(pane()).getByRole("button", { name: /Genesis 1:1/ });
    expect(mark).toHaveTextContent("Bookmark");
    expect(mark).not.toHaveTextContent("Whole verse");
  });

  it("says when a phrase is not shown in the wording being read, and not otherwise", async () => {
    const api = await seeded();
    const user = await openMarks(api);
    const phrase = () => within(pane()).getAllByRole("button", { name: /John 15:1/ }).find((c) => c.textContent?.includes("Rose"))!;
    expect(phrase()).not.toHaveTextContent("Not shown in this wording");
    await user.click(switchTo("Bible"));
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");
    await user.click(switchTo("Marks"));
    await waitFor(() => expect(phrase()).toHaveTextContent("Not shown in this wording"));
  });
});

describe("going back to the passage", () => {
  it("shows the verse in the Bible, in the same translation", async () => {
    const user = await openMarks(await seeded());
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Book" }), "Romans");
    await user.click(await within(pane()).findByRole("button", { name: /Romans 8:28/ }));
    expect(screen.queryByRole("heading", { level: 2, name: "Marks" })).toBeNull();
    expect(await within(pane()).findByRole("heading", { level: 2, name: /Romans 8/ })).toBeInTheDocument();
    expect(switchTo("Bible")).toHaveAttribute("aria-pressed", "true");
    // The destination is apparent, and nothing switched the Bible.
    expect(within(pane()).getByText(/showing Romans 8:28/)).toBeInTheDocument();
    expect((within(pane()).getByRole("combobox", { name: "Translation" }) as HTMLSelectElement).selectedOptions[0]).toHaveTextContent("FXA");
  });

  it("keeps the other Bible when a mark from a different wording is opened", async () => {
    const api = await seeded();
    const user = await openMarks(api);
    await user.click(switchTo("Bible"));
    const translation = within(pane()).getByRole("combobox", { name: "Translation" });
    await user.selectOptions(translation, "FXB");
    await user.click(switchTo("Marks"));
    await user.click(await within(pane()).findByRole("button", { name: /John 15:5/ }));
    expect(await within(pane()).findByText(/showing John 15:5/)).toBeInTheDocument();
    expect((within(pane()).getByRole("combobox", { name: "Translation" }) as HTMLSelectElement).selectedOptions[0]).toHaveTextContent("FXB");
  });

  it("still lets the verse tools and the selection toolbar work afterwards", async () => {
    const api = await seeded();
    const user = await openMarks(api);
    await user.click(await within(pane()).findByRole("button", { name: /John 15:4/ }));
    const verse = await within(pane()).findByRole("button", { name: /^Verse 4[.,].*Show verse tools/ });
    await user.click(verse);
    const tools = await screen.findByRole("region", { name: /Tools for/ });
    await user.click(within(tools).getByRole("button", { name: "Bookmark" }));
    await waitFor(() => expect(api.state.annotations.some((a) => a.kind === "bookmark" && a.reference.canonical === "JHN.15.4")).toBe(true));
    // Select words: the toolbar appears as before.
    const text = pane().querySelector<HTMLElement>('[data-verse-text="JHN.15.2"]')!;
    const node = text.firstChild!;
    const range = document.createRange();
    range.setStart(node, 8);
    range.setEnd(node, 13);
    await act(async () => {
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(await screen.findByRole("group", { name: "Actions for the selected words" })).toBeInTheDocument();
  });
});

describe("keyboard, narrow panes and structure", () => {
  it("reaches the switch, filters, search and every mark with Tab, and opens one with Enter", async () => {
    const user = await openMarks(await seeded());
    switchTo("Marks").focus();
    await user.tab(); // Concordance (v0.12), the last of the switch
    await user.tab();
    expect(kind("All")).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(kind("Bookmarks")).toHaveFocus();
    await user.tab();
    expect(within(pane()).getByRole("combobox", { name: "Book" })).toHaveFocus();
    await user.tab();
    expect(within(pane()).getByRole("searchbox", { name: "Search your notes" })).toHaveFocus();
    await user.tab();
    const first = within(pane()).getAllByRole("button", { name: /^Genesis 1:1/ })[0]!;
    expect(first).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await within(pane()).findByRole("heading", { level: 2, name: /Genesis 1/ })).toBeInTheDocument();
  });

  it("stacks as a list of cards with wrapping controls, never a table or a wide row", async () => {
    await openMarks(await seeded());
    expect(within(pane()).queryByRole("table")).toBeNull();
    expect(within(pane()).getByRole("list")).toHaveClass("flex-col");
    expect(kinds().className).toMatch(/\bflex-wrap\b/);
    expect(within(pane()).getByRole("combobox", { name: "Book" }).closest("div")?.className).toMatch(/\bflex-wrap\b/);
    for (const card of cards()) expect(card.className).toMatch(/\bw-full\b/);
    expect(within(pane()).getByRole("searchbox").className).toMatch(/\bmin-w-0\b/);
  });

  it("says how many marks are listed to assistive technology without adding clutter", async () => {
    await openMarks(await seeded());
    expect(within(pane()).getByText("7 marks")).toHaveClass("sr-only");
  });
});

describe("focus after loading more", () => {
  it("moves to the first mark that arrived, even when the button has gone", async () => {
    const user = await openMarks(await seeded({ extra: 40 }));
    await user.click(within(pane()).getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(cards()).toHaveLength(47));
    expect(within(pane()).queryByRole("button", { name: "Load more" })).toBeNull();
    expect(cards()[30]).toHaveFocus();
  });
});
