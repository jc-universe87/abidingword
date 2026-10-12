import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createFakePdfEngine } from "../support/fakePdfEngine";
import { FORMATTED_BOOK } from "../support/epubFixture";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Marks in the formatted Original of an EPUB or DOCX (v0.14): one mark, made in Reading, drawn on
// the published page too, only where its stored words are found exactly there. All text is invented.

async function markWords(api: MemoryApi, paragraph: string, words: string, kind: "highlight" | "note", color?: "green" | "rose") {
  const segment = api.state.library.segments.find((x) => x.text === paragraph)!;
  const at = segment.text.indexOf(words);
  return api.sourceAnnotationCreate({
    sourceId: segment.sourceId,
    kind,
    ...(kind === "highlight" ? { color } : { content: "A note." }),
    start: { segmentId: segment.id, offset: at },
    end: { segmentId: segment.id, offset: at + words.length },
    quote: words,
  });
}

async function openOriginal(api: MemoryApi) {
  const { user } = await renderApp(api, { pdfEngine: createFakePdfEngine({ pages: 1 }), width: 1440 });
  const sources = screen.getByRole("complementary", { name: "Sources" });
  await user.click(await within(sources).findByRole("button", { name: /A Formatted Book/ }));
  const reader = await within(sources).findByRole("region", { name: "A Formatted Book" });
  await user.click(within(reader).getByRole("button", { name: "Original" }));
  const host = await within(reader).findByTestId("epub-page");
  await waitFor(() => expect(host.shadowRoot?.querySelector(".aw-doc")).not.toBeNull());
  return { user, reader, page: () => host.shadowRoot!.querySelector<HTMLElement>(".aw-doc")! };
}

describe("marks in the formatted Original", () => {
  it("draws a highlight and noted words on the published page, across its own formatting", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.installFixtureSource(FORMATTED_BOOK);
    // "bold word" crosses the book's <strong> element.
    await markWords(api, "First paragraph with a bold word, italic too, and a note1.", "bold word", "highlight", "green");
    await markWords(api, "The middle paragraph.", "middle paragraph", "note");
    const { page } = await openOriginal(api);
    await waitFor(() => expect(page().querySelectorAll("mark[data-mark='green']").length).toBe(2));
    const green = [...page().querySelectorAll("mark[data-mark='green']")].map((m) => m.textContent).join("");
    expect(green).toBe("bold word");
    expect(page().querySelector("strong mark[data-mark='green']")).toHaveTextContent("bold");
    expect(page().querySelector("mark[data-mark='note']")).toHaveTextContent("middle paragraph");
    // The book's own text is kept exactly.
    expect(page().querySelector("p")?.textContent).toBe("First paragraph with a bold word, italic too, and a note1.");
  });

  it("draws nothing where the stored words are not found exactly on the page", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.installFixtureSource(FORMATTED_BOOK);
    await markWords(api, "First paragraph with a bold word, italic too, and a note1.", "bold word", "highlight", "rose");
    // The stored paragraph says something the page does not (as after an import of other wording).
    const segment = api.state.library.segments.find((x) => x.text.startsWith("First paragraph"))!;
    segment.text = "First paragraph with a bold word, italic too, and a different ending.";
    const { page } = await openOriginal(api);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(page().querySelector("mark[data-mark]")).toBeNull();
  });

  it("goes to a mark chosen in the Marks list and brings it into view", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.installFixtureSource(FORMATTED_BOOK);
    await markWords(api, "The middle paragraph.", "middle", "highlight", "green");
    const { user, reader, page } = await openOriginal(api);
    let shown: Element | null = null;
    const real = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      shown = this;
    };
    try {
      await user.click(within(reader).getByRole("button", { name: "Marks" }));
      const panel = await screen.findByRole("region", { name: "Marks in A Formatted Book" });
      await user.click(within(panel).getAllByRole("button").find((b) => b.closest("li"))!);
      await waitFor(() => expect(shown).toBe(page().querySelector("mark[data-mark='green']")));
    } finally {
      Element.prototype.scrollIntoView = real;
    }
  });
});

describe("marks in a formatted DOCX", () => {
  it("draws a highlight made in Reading on the document's page", async () => {
    const { FORMATTED_DOCX } = await import("../support/docxFixture");
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.installFixtureSource(FORMATTED_DOCX);
    // A paragraph of the document's first part with a few plain words in it.
    const segment = api.state.library.segments.find((x) => x.sourceId && /\w{4,} \w{4,}/.test(x.text))!;
    const words = /\w{4,} \w{4,}/.exec(segment.text)![0];
    const at = segment.text.indexOf(words);
    await api.sourceAnnotationCreate({ sourceId: segment.sourceId, kind: "highlight", color: "rose", start: { segmentId: segment.id, offset: at }, end: { segmentId: segment.id, offset: at + words.length }, quote: words });
    const { user } = await renderApp(api, { pdfEngine: createFakePdfEngine({ pages: 1 }), width: 1440 });
    const sources = screen.getByRole("complementary", { name: "Sources" });
    await user.click(await within(sources).findByRole("button", { name: /A Formatted Document/ }));
    const reader = await within(sources).findByRole("region", { name: "A Formatted Document" });
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    const host = await within(reader).findByTestId("epub-page");
    await waitFor(() => expect([...host.shadowRoot!.querySelectorAll("mark[data-mark='rose']")].map((m) => m.textContent).join("")).toBe(words));
  });
});
