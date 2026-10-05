import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubItem } from "@/types/library";
import { placeOfPosition, positionOfPlace } from "@/features/library/formatted/epubLocation";
import { createFakePdfEngine } from "../support/fakePdfEngine";
import { FORMATTED_BOOK, PIXEL } from "../support/epubFixture";
import { createMemoryApi, type MemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The formatted ("Original") view of an EPUB: what it shows, how it moves,
// and what it will not do. Everything here is invented.

// jsdom has no layout. This gives pages one: inside a page's shadow root every element is 20px
// tall in document order, and "scrolling" to an element puts it at the top of the view; the
// Reading view's paragraphs are 30px tall and scrolled the same way.
const realRect = Element.prototype.getBoundingClientRect;
const bases = new WeakMap<object, number>();
let readingTop = 0;
const indexIn = (el: Element): { root: ShadowRoot; index: number } | null => {
  const root = el.getRootNode();
  if (!(root instanceof ShadowRoot)) return null;
  return { root, index: [...root.querySelectorAll(".aw-doc *")].indexOf(el) };
};
beforeEach(() => {
  readingTop = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    const el = this as HTMLElement;
    const inPage = indexIn(el);
    if (inPage && inPage.index >= 0) bases.set(inPage.root, inPage.index);
    const position = el.dataset.segPosition ?? (el.hasAttribute("data-section-marker") ? (el.nextElementSibling as HTMLElement | null)?.dataset.segPosition : undefined);
    if (position !== undefined) readingTop = Number(position);
  };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    const box = (y: number, h: number) => ({ top: y, bottom: y + h, left: 0, right: 600, width: 600, height: h, x: 0, y, toJSON: () => ({}) }) as DOMRect;
    const inPage = indexIn(el);
    if (inPage && inPage.index >= 0) return box((inPage.index - (bases.get(inPage.root) ?? 0)) * 20, 20);
    if (el.dataset?.segPosition !== undefined) return box((Number(el.dataset.segPosition) - readingTop) * 30, 30);
    if (el.dataset?.testid === "reader-body") return box(0, 300);
    return realRect.call(this);
  };
});
afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
  Element.prototype.getBoundingClientRect = realRect;
});

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const back = (root: HTMLElement) => within(root).getByRole("button", { name: "Back to the previous place" });
const forward = (root: HTMLElement) => within(root).getByRole("button", { name: "Forward to the next place" });

function setup(fixtures: SourceFixture[] = [FORMATTED_BOOK]) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  for (const f of fixtures) api.installFixtureSource(f);
  return { api, engine: createFakePdfEngine({ pages: 3 }) };
}

async function openPane(api: MemoryApi, engine: ReturnType<typeof createFakePdfEngine>, title = "A Formatted Book", width = 1440) {
  const { user } = await renderApp(api, { pdfEngine: engine, width });
  await user.click(await within(sourcesPane()).findByRole("button", { name: new RegExp(title) }));
  const reader = await within(sourcesPane()).findByRole("region", { name: title });
  return { user, reader };
}

async function original(user: Awaited<ReturnType<typeof renderApp>>["user"], reader: HTMLElement) {
  await user.click(within(reader).getByRole("button", { name: "Original" }));
  return page(reader);
}

/** The drawn page, found through its shadow root, as a container the queries can use. */
async function page(reader: HTMLElement): Promise<HTMLElement> {
  const host = await within(reader).findByTestId("epub-page");
  await waitFor(() => expect(host.shadowRoot?.querySelector(".aw-doc")).not.toBeNull());
  return host.shadowRoot!.querySelector<HTMLElement>(".aw-doc")!;
}

const part = (reader: HTMLElement) => within(reader).getByRole("status").textContent;

describe("the Original view of an EPUB", () => {
  it("is offered next to Reading, and Reading is unchanged", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    expect(within(reader).getByRole("group", { name: "View" })).toBeInTheDocument();
    expect(within(reader).getByText("Jump to chapter two or the middle.")).toBeInTheDocument();
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    expect(within(reader).getByText("Jump to chapter two or the middle.")).toBeInTheDocument();
  });

  it("is not offered for an EPUB without a formatted view, or whose structure cannot be read", async () => {
    const plain: SourceFixture = { title: "Plain Book", format: "epub", segments: [{ text: "Only text.", sectionPath: "One" }] };
    const { api, engine } = setup([plain]);
    const { reader } = await openPane(api, engine, "Plain Book");
    expect(within(reader).queryByRole("group", { name: "View" })).not.toBeInTheDocument();
  });

  it("is not offered when the structure cannot be read, and says nothing to the user", async () => {
    const broken = setup();
    broken.api.libraryEpubStructure = async () => {
      throw new Error("synthetic");
    };
    const log = vi.spyOn(broken.api, "logError");
    const second = await openPane(broken.api, broken.engine);
    await waitFor(() => expect(log).toHaveBeenCalled());
    await waitFor(() => expect(within(second.reader).queryByRole("group", { name: "View" })).not.toBeInTheDocument());
    expect(within(second.reader).getByText("Jump to chapter two or the middle.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the book's structure: headings, text styles, quotations, lists, a table, an image", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    expect(doc.getByRole("heading", { level: 1, name: /Chapter One · Εἰς τὸ ὄνομα/ })).toBeInTheDocument();
    expect(doc.getByText("bold").tagName).toBe("STRONG");
    expect(doc.getByText("italic").tagName).toBe("EM");
    expect(doc.getByText("A quotation.").closest("blockquote")).not.toBeNull();
    const lists = doc.getAllByRole("list");
    expect(lists).toHaveLength(3); // an ordered list, with a nested list in it, and a list in that
    expect(lists[0]).toHaveAttribute("start", "3");
    expect(doc.getByText("Deep")).toBeInTheDocument();
    expect(doc.getByRole("table")).toBeInTheDocument();
    expect(doc.getByRole("columnheader", { name: "Head" })).toBeInTheDocument();
    expect(doc.getByRole("img", { name: "A small picture" })).toHaveAttribute("src", PIXEL);
    // A wide table scrolls inside itself, reachable by keyboard.
    expect(doc.getByRole("group", { name: "Table" })).toHaveAttribute("tabindex", "0");
    expect(part(reader)).toBe("Part 1 of 3");
  });

  it("keeps the book's own style inside the page, away from the app", async () => {
    const { api, engine } = setup();
    const before = document.querySelectorAll("style").length;
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    const host = await within(reader).findByTestId("epub-page");
    const style = host.shadowRoot!.querySelector("style")!;
    expect(style.textContent).toContain(".note { color: #333; }");
    expect(document.querySelectorAll("style").length).toBe(before);
    expect(host.shadowRoot!.querySelector(".aw-doc")).toHaveClass("book");
    expect(document.head.textContent).not.toContain("text-indent");
  });

  it("moves between the parts of the book without keeping history for it", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    expect(within(reader).getByRole("button", { name: "Previous part" })).toBeDisabled();
    await user.click(within(reader).getByRole("button", { name: "Next part" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    expect(within(await page(reader)).getByRole("heading", { name: "Chapter Two" })).toBeInTheDocument();
    expect(back(reader)).toBeDisabled();
    await user.click(within(reader).getByRole("button", { name: "Previous part" }));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
  });
});

describe("Contents, links and Back / Forward in the Original view", () => {
  it("goes to a Contents entry's place in the formatted page, and Back and Forward return", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(await screen.findByRole("button", { name: /^Chapter Two/ }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    expect(within(await page(reader)).getByRole("heading", { name: "Chapter Two" })).toBeInTheDocument();
    expect(back(reader)).toBeEnabled();
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    await user.click(forward(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
  });

  it("follows a footnote marker to the note, and the app's Back returns where the marker is", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByText("1"));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
    expect(within(await page(reader)).getByText(/First note\./)).toBeInTheDocument();
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    const host = await within(reader).findByTestId("epub-page");
    // The place returned to is the element the marker is in or just after, near the top of the view.
    await waitFor(() => expect(host.shadowRoot!.querySelector("#top, #r1")).not.toBeNull());
    await user.click(forward(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
  });

  it("follows the book's own backlink, and a link to another chapter", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByText("1"));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
    await user.click(within(await page(reader)).getByText("↩"));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    await user.click(within(await page(reader)).getByRole("link", { name: "chapter two" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    // Three jumps: Back three times returns to the start, with nothing needed from the book.
    for (const expected of ["Part 1 of 3", "Part 3 of 3", "Part 1 of 3"]) {
      await user.click(back(reader));
      await waitFor(() => expect(part(reader)).toBe(expected));
    }
    expect(back(reader)).toBeDisabled();
  });

  it("puts a link into another part at the element it names, not at the top of that part", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(await screen.findByRole("button", { name: /^Chapter Two/ }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    await user.click(within(await page(reader)).getByRole("link", { name: "the marker" }));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    const host = await within(reader).findByTestId("epub-page");
    // In this test's stand-in layout an element scrolled to the top of the view is at 0.
    await waitFor(() => expect(host.shadowRoot!.getElementById("r1")!.getBoundingClientRect().top).toBe(0));
  });

  it("keeps keyboard focus in the page when a link from the keyboard leads to another part", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    const host = await within(reader).findByTestId("epub-page");
    const link = doc.getByRole("link", { name: "chapter two" });
    link.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    const newHost = await within(reader).findByTestId("epub-page");
    // Focus is on the element the link names, in the new part: not on the body, not at the app's start.
    await waitFor(() => expect(newHost.shadowRoot!.activeElement?.id).toBe("sec"));
    expect(document.activeElement).toBe(newHost);
    expect(host.isConnected && host !== newHost ? host.shadowRoot!.activeElement : null).toBeNull();
    // The destination is a stop only while it has focus: ordinary text does not become a tab stop.
    await user.tab();
    expect(newHost.shadowRoot!.querySelector("#sec")!.hasAttribute("tabindex")).toBe(false);
    // (Where Tab goes next is checked in the real runtime: jsdom's tab order does not enter shadow roots.)
    // Back and Forward are the same as ever.
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    await user.click(forward(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
  });

  it("does not move focus for a link followed with the pointer", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByRole("link", { name: "chapter two" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    const host = await within(reader).findByTestId("epub-page");
    await waitFor(() => expect(host.shadowRoot!.querySelector("#sec")).not.toBeNull());
    expect(host.shadowRoot!.activeElement).toBeNull();
  });

  it("opens a link to the web in the system browser, as a link and not as history", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByRole("link", { name: "the web page" }));
    await waitFor(() => expect(api.state.library.openedLinks).toEqual(["https://example.org/page"]));
    expect(part(reader)).toBe("Part 1 of 3");
    expect(back(reader)).toBeDisabled();
    // A link inside the book still goes through the reader, not the opener.
    await user.click(doc.getByRole("link", { name: "chapter two" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    expect(api.state.library.openedLinks).toHaveLength(1);
  });

  it("follows a link within the same part to the element it names", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByRole("link", { name: "the middle" }));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    expect(back(reader)).toBeEnabled();
    await user.click(back(reader));
    expect(forward(reader)).toBeEnabled();
  });

  it("can be followed by keyboard", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    doc.getByText("1").focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
  });

  it("does not record the switch between Reading and Original as a jump", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    expect(back(reader)).toBeDisabled();
    expect(forward(reader)).toBeDisabled();
  });

  it("keeps the place when switching: Reading's text on top is where Original opens, and back again", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(await screen.findByRole("button", { name: /^Chapter Two/ }));
    await waitFor(() => expect(readingTop).toBe(4));
    await original(user, reader);
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    await user.click(within(reader).getByRole("button", { name: "Next part" }));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(readingTop).toBe(6)); // the notes' first text
  });

  it("keeps place and history from the pane to the full reader", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByText("1"));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
    await user.click(within(reader).getByRole("button", { name: "Open full reader" }));
    const full = await screen.findByRole("main");
    await within(full).findByTestId("epub-page");
    expect(part(full)).toBe("Part 3 of 3");
    expect(back(full)).toBeEnabled();
    await user.click(back(full));
    await waitFor(() => expect(part(full)).toBe("Part 1 of 3"));
  });

  it("works in a narrow window's full reader", async () => {
    const { api, engine } = setup();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Series" });
    const made = await api.studyCreate({ projectId: project.id, title: "The True Vine" });
    const finding = await api.findingCreate({ studyId: made.study.id, findingType: "observation", content: "A note." });
    const source = (await api.libraryList({})).find((s) => s.title === "A Formatted Book")!;
    const cited = (await api.sourceGetSegments({ sourceId: source.id, offset: 0, limit: 1 })).segments[0]!;
    await api.findingSourceAdd({ findingId: finding.id, segmentId: cited.id });
    const { user } = await renderApp(api, { pdfEngine: engine, width: 700 });
    await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /The True Vine/ }));
    await user.click(await within(await screen.findByRole("list", { name: "Findings" })).findByTitle("Open this source at the cited place"));
    const full = await screen.findByRole("main");
    await user.click(await within(full).findByRole("button", { name: "Original" }));
    await within(full).findByTestId("epub-page");
    expect(part(full)).toBe("Part 1 of 3");
  });

  it("starts a different source with no history of the last one", async () => {
    const other: SourceFixture = { ...FORMATTED_BOOK, title: "Another Book" };
    const { api, engine } = setup([FORMATTED_BOOK, other]);
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByText("1"));
    await user.click(within(reader).getByRole("button", { name: "Back to Sources" }));
    await user.click(await within(sourcesPane()).findByRole("button", { name: /Another Book/ }));
    const next = await within(sourcesPane()).findByRole("region", { name: "Another Book" });
    expect(back(next)).toBeDisabled();
  });
});

describe("a page that cannot be shown, and a page that tries something", () => {
  it("says so simply, logs the technical detail privately, and leaves Reading working", async () => {
    const { api, engine } = setup();
    api.libraryEpubItem = async () => {
      throw new Error("synthetic: the page could not be read");
    };
    const log = vi.spyOn(api, "logError");
    const { user, reader } = await openPane(api, engine);
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    expect(await within(reader).findByRole("alert")).toHaveTextContent("This book’s original view can’t be shown. Reading still works.");
    expect(within(reader).queryByText(/synthetic/)).not.toBeInTheDocument();
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(String(log.mock.calls[0]![0])).not.toMatch(/paragraph/i);
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    expect(within(reader).getByText("Jump to chapter two or the middle.")).toBeInTheDocument();
  });

  it("draws nothing from a page that carries scripts, handlers, remote images or odd styles", async () => {
    const evil: EpubItem = {
      id: "c1",
      css: "@import url(http://evil.example/x.css); .aw-doc { color: red }",
      root: { class: "book", id: "bodyid", onclick: "window.pwned = 1" },
      missingImages: 0,
      nodes: [
        { t: "script", c: ["window.pwned = 1"] },
        { t: "iframe", a: { src: "http://evil.example/" } },
        { t: "p", a: { onclick: "window.pwned = 1", onmouseover: "x()", style: "background: url(http://evil.example/t.png); color: blue", role: "button", href: "http://evil.example/" }, c: ["Plain text"] },
        { t: "img", a: { src: "http://evil.example/p.png", alt: "remote" } },
        { t: "img", a: { src: "data:text/html;base64,PHNjcmlwdD4=", alt: "html in an image" } },
        { t: "a", a: { href: "javascript:alert(1)" }, c: ["not a link"] },
        { t: "a", a: { href: "https://evil.example/" }, l: { item: "c1" }, c: ["a link with a web href"] },
        { t: "unknowntag", c: ["inside unknown"] },
        { t: "object", c: ["x"] },
      ],
    };
    const book: SourceFixture = { ...FORMATTED_BOOK, title: "Hostile Book", formatted: { structure: FORMATTED_BOOK.formatted!.structure, items: { ...FORMATTED_BOOK.formatted!.items, c1: evil } } };
    const { api, engine } = setup([book]);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const hash = window.location.hash;
    const { user, reader } = await openPane(api, engine, "Hostile Book");
    const page = await original(user, reader);
    const doc = within(page);
    const host = await within(reader).findByTestId("epub-page");
    const shadow = host.shadowRoot!;
    expect(shadow.querySelector("script, iframe, object, embed")).toBeNull();
    expect(shadow.querySelector("[onclick], [onmouseover], [href^='http']")).toBeNull();
    expect(doc.getByText("Plain text").getAttribute("style")).toBe("color: blue;");
    expect(doc.getByText("Plain text")).not.toHaveAttribute("role");
    expect(shadow.querySelectorAll("img[src]")).toHaveLength(0);
    expect(shadow.querySelector("style")!.textContent).not.toContain("@import");
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(doc.getByText("not a link").closest("a")).toBeNull();
    expect(doc.queryByText("inside unknown")).not.toBeInTheDocument(); // an element outside the list is not drawn at all
    // A link never goes to the web: it is handled by the reader.
    await user.click(doc.getByRole("link", { name: "a link with a web href" }));
    expect(open).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(hash);
    // Nothing of the page reached the app's own document.
    expect(document.querySelector("body > style, head > style[data-evil]")).toBeNull();
    expect(host.shadowRoot!.querySelector(".aw-doc")).not.toHaveAttribute("id");
    open.mockRestore();
    await act(async () => undefined);
  });
});

describe("mapping between Reading and the formatted view", () => {
  const structure = FORMATTED_BOOK.formatted!.structure;

  it("places a segment in its document, at the nearest element before it", () => {
    expect(placeOfPosition(structure, 0)).toEqual({ item: "c1", fragment: null, offset: 0 });
    expect(placeOfPosition(structure, 3)).toEqual({ item: "c1", fragment: "mid", offset: 0 });
    expect(placeOfPosition(structure, 5)).toEqual({ item: "c2", fragment: "deep", offset: 0 });
    expect(placeOfPosition(structure, 6)).toEqual({ item: "nt", fragment: null, offset: 0 });
    expect(placeOfPosition([], 3)).toBeNull();
  });

  it("finds the segment of a place: the element's own, else its document's first", () => {
    expect(positionOfPlace(structure, { item: "c2", fragment: "deep" })).toBe(5);
    expect(positionOfPlace(structure, { item: "c2", fragment: null })).toBe(4);
    expect(positionOfPlace(structure, { item: "c2", fragment: "unknown" })).toBe(4);
    expect(positionOfPlace(structure, { item: "nope", fragment: null })).toBeNull();
  });
});
