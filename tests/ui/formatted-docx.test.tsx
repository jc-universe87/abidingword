import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeOfPosition, positionOfPlace } from "@/features/library/formatted/epubLocation";
import { DOCX_PARTS, DOCX_PIXEL, FORMATTED_DOCX } from "../support/docxFixture";
import { FORMATTED_BOOK } from "../support/epubFixture";
import { createFakePdfEngine } from "../support/fakePdfEngine";
import { createMemoryApi, type MemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The formatted ("Original") view of a Word document. It is drawn by the same
// renderer as an EPUB's, so these tests cover what is DOCX's own: that the view
// is offered, that its parts, links, notes, contents and mapping work for a
// document, and that EPUB is untouched. Everything here is invented.

// jsdom has no layout. Inside a page's shadow root every element is 20px tall in
// document order, and "scrolling" to an element puts it at the top of the view;
// the Reading view's paragraphs are 30px tall and scrolled the same way.
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
const TITLE = "A Formatted Document";

function setup(fixtures: SourceFixture[] = [FORMATTED_DOCX]) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  for (const f of fixtures) api.installFixtureSource(f);
  return { api, engine: createFakePdfEngine({ pages: 3 }) };
}

async function openPane(api: MemoryApi, engine: ReturnType<typeof createFakePdfEngine>, title = TITLE, width = 1440) {
  const { user } = await renderApp(api, { pdfEngine: engine, width });
  await user.click(await within(sourcesPane()).findByRole("button", { name: new RegExp(title) }));
  const reader = await within(sourcesPane()).findByRole("region", { name: title });
  return { user, reader };
}

async function page(reader: HTMLElement): Promise<HTMLElement> {
  const host = await within(reader).findByTestId("epub-page");
  await waitFor(() => expect(host.shadowRoot?.querySelector(".aw-doc")).not.toBeNull());
  return host.shadowRoot!.querySelector<HTMLElement>(".aw-doc")!;
}

async function original(user: Awaited<ReturnType<typeof renderApp>>["user"], reader: HTMLElement) {
  await user.click(within(reader).getByRole("button", { name: "Original" }));
  return page(reader);
}

const part = (reader: HTMLElement) => within(reader).getByRole("status").textContent;
const hostOf = (reader: HTMLElement) => within(reader).getByTestId("epub-page");

describe("the Original view of a Word document", () => {
  it("is offered next to Reading, and Reading is unchanged", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    expect(within(reader).getByRole("group", { name: "View" })).toBeInTheDocument();
    expect(within(reader).getByText("Go to part two, the middle1 and an endnotei.")).toBeInTheDocument();
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    expect(within(reader).getByText("Go to part two, the middle1 and an endnotei.")).toBeInTheDocument();
  });

  it("is not offered without a formatted view", async () => {
    const plain: SourceFixture = { title: "Plain Document", format: "docx", segments: [{ text: "Only text." }] };
    const { api, engine } = setup([plain]);
    const { reader } = await openPane(api, engine, "Plain Document");
    expect(within(reader).queryByRole("group", { name: "View" })).not.toBeInTheDocument();
  });

  it("is not offered when its structure cannot be read, and says nothing", async () => {
    const broken = setup();
    broken.api.libraryDocxStructure = async () => {
      throw new Error("synthetic");
    };
    const log = vi.spyOn(broken.api, "logError");
    const second = await openPane(broken.api, broken.engine);
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(String(log.mock.calls[0]![0])).toContain("DOCX");
    await waitFor(() => expect(within(second.reader).queryByRole("group", { name: "View" })).not.toBeInTheDocument());
    expect(within(second.reader).getByText("Go to part two, the middle1 and an endnotei.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows headings, text styles, lists, a table, a figure and a picture that is not there", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    expect(doc.getByRole("heading", { level: 1, name: /Chapter One · Εἰς τὸ ὄνομα/ })).toBeInTheDocument();
    expect(doc.getByText("bold").tagName).toBe("STRONG");
    expect(doc.getByText("italic").tagName).toBe("EM");
    expect(doc.getByText("underline").tagName).toBe("U");
    expect(doc.getByText("struck").tagName).toBe("S");
    expect(doc.getAllByText("2").map((n) => n.tagName)).toEqual(expect.arrayContaining(["SUP", "SUB"]));
    expect(doc.getByText(/Plain/, { selector: "p" })).toHaveStyle({ textAlign: "center" });
    // Ordered, nested and typed lists keep their structure.
    const lists = doc.getAllByRole("list");
    expect(lists).toHaveLength(3);
    expect(lists[1]).toHaveAttribute("type", "a");
    expect(lists[2]).toHaveAttribute("type", "i");
    expect(within(lists[2]!).getByText("Deep i")).toBeInTheDocument();
    // A table with header cells and a merged cell, a figure with its caption, and a picture.
    expect(doc.getByRole("table")).toBeInTheDocument();
    expect(doc.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Term", "Meaning"]);
    expect(doc.getByRole("cell", { name: "μένω" })).toHaveAttribute("rowspan", "2");
    expect(doc.getByRole("img", { name: "A small picture" })).toHaveAttribute("src", DOCX_PIXEL);
    expect(doc.getByText("A caption.").tagName).toBe("FIGCAPTION");
    expect(doc.getByRole("group", { name: "Table" })).toHaveAttribute("tabindex", "0");
    expect(doc.getByRole("doc-pagebreak")).toBeInTheDocument();
    expect(part(reader)).toBe("Part 1 of 3");
    // The page is a light sheet of its own and the page's own style stays inside it.
    const host = hostOf(reader);
    const css = host.shadowRoot!.querySelector("style")!.textContent!;
    expect(css).toContain("background: #fff");
    expect(css).toContain(".aw-title");
    expect(document.querySelector("body > style")).toBeNull();
  });

  it("says how many pictures could not be shown, and shows what stands in", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Next part" }));
    const doc = within(await page(reader));
    expect(doc.getByText("a picture")).toHaveClass("aw-missing-image");
    expect(within(reader).getByText("1 picture could not be shown.")).toBeInTheDocument();
  });

  it("draws a wide table inside itself so the document does not widen", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Next part" }));
    const doc = within(await page(reader));
    const group = doc.getByRole("group", { name: "Table" });
    expect(group).toHaveClass("aw-table-scroll");
    expect(within(group).getAllByRole("columnheader")).toHaveLength(8);
    const css = hostOf(reader).shadowRoot!.querySelector("style")!.textContent!;
    expect(css).toContain(".aw-table-scroll { overflow-x: auto");
  });
});

describe("links, notes and Back / Forward in a Word document", () => {
  it("follows a link to a bookmark in another part, and Back and Forward return", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByRole("link", { name: "part two" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    expect(within(await page(reader)).getByRole("heading", { name: "Chapter Two" })).toBeInTheDocument();
    expect(back(reader)).toBeEnabled();
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    await user.click(forward(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
  });

  it("follows a link within the same part to the bookmark it names", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByRole("link", { name: "middle" }));
    await waitFor(() => expect(hostOf(reader).shadowRoot!.getElementById("bm-middle")!.getBoundingClientRect().top).toBe(0));
    expect(part(reader)).toBe("Part 1 of 3");
    expect(back(reader)).toBeEnabled();
  });

  it("follows a footnote marker to the note and Back returns to the marker", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByText("1"));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
    expect(within(await page(reader)).getByText(/The first footnote\./)).toBeInTheDocument();
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    await user.click(forward(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
  });

  it("follows an endnote marker, and the note's own backlink, and Back works without one", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByText("i"));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
    const notes = within(await page(reader));
    expect(notes.getByText(/An endnote\./)).toBeInTheDocument();
    // The numbering of the note is the list's own: roman numerals for an endnote.
    expect(notes.getAllByRole("list")[1]).toHaveAttribute("type", "i");
    await user.click(notes.getAllByText("↩")[1]!);
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    // Two jumps: Back twice returns to the start.
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    expect(back(reader)).toBeDisabled();
  });

  it("can be followed from the keyboard, with focus kept in the page", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    doc.getByRole("link", { name: "part two" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    const host = await within(reader).findByTestId("epub-page");
    // The bookmark is an empty marker: the block after it takes focus.
    await waitFor(() => expect(host.shadowRoot!.activeElement).not.toBeNull());
    expect(host.shadowRoot!.activeElement!.tagName).toBe("P");
    expect(document.activeElement).toBe(host);
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
    await user.click(forward(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
  });

  it("does not move focus for a link followed with the pointer", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByRole("link", { name: "part two" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    const host = await within(reader).findByTestId("epub-page");
    await waitFor(() => expect(host.shadowRoot!.querySelector("h1")).not.toBeNull());
    expect(host.shadowRoot!.activeElement).toBeNull();
  });

  it("uses the headings as Contents, and moving there is history", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    await user.click(await within(reader).findByRole("button", { name: "Contents" }));
    // made from the headings, and said so
    expect(await screen.findByRole("heading", { name: "Generated contents" })).toBeInTheDocument();
    expect(screen.getByText(/not part of the original/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /^Chapter Two/ }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    expect(back(reader)).toBeEnabled();
    await user.click(back(reader));
    await waitFor(() => expect(part(reader)).toBe("Part 1 of 3"));
  });
});

describe("links to the web in a Word document", () => {
  const ADDRESS = "https://example.org/page?q=1&r=2";
  const opened = (api: MemoryApi) => api.state.library.openedLinks;

  it("shows a safe web address as a link, and only that one", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    const link = doc.getByRole("link", { name: "the web page" });
    expect(link).toHaveAttribute("href", "#"); // never the address itself
    expect(link).toHaveAttribute("title", ADDRESS);
    // An address the interface will not open is plain text, whatever the core sent.
    expect(doc.queryByRole("link", { name: "a script" })).not.toBeInTheDocument();
    expect(doc.queryByRole("link", { name: "an ftp site" })).not.toBeInTheDocument();
    expect(doc.getByText(/ a script /)).toBeInTheDocument();
    expect(opened(api)).toEqual([]); // nothing is opened by drawing
  });

  it("opens the exact address in the system browser on a click, and leaves the reader where it was", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    const hash = window.location.hash;
    await user.click(doc.getByRole("link", { name: "the web page" }));
    await waitFor(() => expect(opened(api)).toEqual([ADDRESS]));
    expect(part(reader)).toBe("Part 1 of 3");
    expect(back(reader)).toBeDisabled(); // no history entry
    expect(forward(reader)).toBeDisabled();
    expect(window.location.hash).toBe(hash);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Still the same page, and it still works.
    await user.click(doc.getByRole("link", { name: "part two" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    expect(opened(api)).toEqual([ADDRESS]);
  });

  it("can be opened from the keyboard", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    doc.getByRole("link", { name: "the web page" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(opened(api)).toEqual([ADDRESS]));
    expect(back(reader)).toBeDisabled();
    expect(part(reader)).toBe("Part 1 of 3");
  });

  it("does not use the opener for a link inside the document", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByRole("link", { name: "part two" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    expect(opened(api)).toEqual([]);
    expect(back(reader)).toBeEnabled();
  });

  it("stays usable, says so simply and logs only the host when the system cannot open it", async () => {
    const { api, engine } = setup();
    api.state.library.openLinkFails = true;
    const log = vi.spyOn(api, "logError");
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    const hash = window.location.hash;
    await user.click(doc.getByRole("link", { name: "the web page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The link could not be opened.");
    expect(screen.queryByText(/synthetic/)).not.toBeInTheDocument();
    await waitFor(() => expect(log).toHaveBeenCalled());
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("example.org");
    expect(line).not.toContain("q=1");
    expect(window.location.hash).toBe(hash);
    expect(part(reader)).toBe("Part 1 of 3");
    await user.click(doc.getByRole("link", { name: "part two" }));
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
  });
});

describe("moving between Reading and Original in a Word document", () => {
  it("does not record the switch as a jump", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    expect(back(reader)).toBeDisabled();
    expect(forward(reader)).toBeDisabled();
  });

  it("keeps the place when switching, in either direction", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine);
    await user.click(await within(reader).findByRole("button", { name: "Contents" }));
    await user.click(await screen.findByRole("button", { name: /^Chapter Two/ }));
    await waitFor(() => expect(readingTop).toBe(DOCX_PARTS.d0));
    await original(user, reader);
    await waitFor(() => expect(part(reader)).toBe("Part 2 of 3"));
    await user.click(within(reader).getByRole("button", { name: "Next part" }));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(readingTop).toBe(DOCX_PARTS.d0 + DOCX_PARTS.d1)); // the notes' first text
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
    await user.click(back(full));
    await waitFor(() => expect(part(full)).toBe("Part 1 of 3"));
  });

  it("works in a narrow window's full reader", async () => {
    const { api, engine } = setup();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Series" });
    const made = await api.studyCreate({ projectId: project.id, title: "The True Vine" });
    const finding = await api.findingCreate({ studyId: made.study.id, findingType: "observation", content: "A note." });
    const source = (await api.libraryList({})).find((s) => s.title === TITLE)!;
    const cited = (await api.sourceGetSegments({ sourceId: source.id, offset: 0, limit: 1 })).segments[0]!;
    await api.findingSourceAdd({ findingId: finding.id, segmentId: cited.id });
    const { user } = await renderApp(api, { pdfEngine: engine, width: 700 });
    await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /The True Vine/ }));
    await user.click(await within(await screen.findByRole("list", { name: "Other notes" })).findByTitle("Open this source at the cited place"));
    const full = await screen.findByRole("main");
    await user.click(await within(full).findByRole("button", { name: "Original" }));
    await within(full).findByTestId("epub-page");
    expect(part(full)).toBe("Part 1 of 3");
  });

  it("starts a different source with no history of the last one", async () => {
    const other: SourceFixture = { ...FORMATTED_DOCX, title: "Another Document" };
    const { api, engine } = setup([FORMATTED_DOCX, other]);
    const { user, reader } = await openPane(api, engine);
    const doc = within(await original(user, reader));
    await user.click(doc.getByText("1"));
    await user.click(within(reader).getByRole("button", { name: "Back to Sources" }));
    await user.click(await within(sourcesPane()).findByRole("button", { name: /Another Document/ }));
    const next = await within(sourcesPane()).findByRole("region", { name: "Another Document" });
    expect(back(next)).toBeDisabled();
  });
});

describe("a Word document's page that cannot be shown", () => {
  it("says so simply in its own words, logs the detail privately, and leaves Reading working", async () => {
    const { api, engine } = setup();
    api.libraryDocxItem = async () => {
      throw new Error("synthetic: the part could not be read");
    };
    const log = vi.spyOn(api, "logError");
    const { user, reader } = await openPane(api, engine);
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    expect(await within(reader).findByRole("alert")).toHaveTextContent("This document’s original view can’t be shown. Reading still works.");
    expect(within(reader).queryByText(/synthetic/)).not.toBeInTheDocument();
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(String(log.mock.calls[0]![0])).toContain("DOCX");
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    expect(within(reader).getByText("Go to part two, the middle1 and an endnotei.")).toBeInTheDocument();
  });

  it("leaves a formatted EPUB exactly as it was", async () => {
    const { api, engine } = setup([FORMATTED_DOCX, FORMATTED_BOOK]);
    const { user, reader } = await openPane(api, engine, "A Formatted Book");
    const doc = within(await original(user, reader));
    expect(doc.getByText("bold").tagName).toBe("STRONG");
    expect(part(reader)).toBe("Part 1 of 3");
    await user.click(doc.getByText("1"));
    await waitFor(() => expect(part(reader)).toBe("Part 3 of 3"));
  });
});

describe("mapping a Word document's segments", () => {
  const structure = FORMATTED_DOCX.formatted!.structure;

  it("places a segment at its own paragraph, and finds a paragraph's segment", () => {
    const at = DOCX_PARTS.d0 + 1; // the second text of the second part
    expect(placeOfPosition(structure, at)).toEqual({ item: "d1", fragment: `p${at}`, offset: 0 });
    expect(placeOfPosition(structure, 0)).toEqual({ item: "d0", fragment: null, offset: 0 });
    expect(positionOfPlace(structure, { item: "d1", fragment: `p${at}` })).toBe(at);
    expect(positionOfPlace(structure, { item: "d0", fragment: "bm-middle" })).toBe(structure[0]!.anchors["bm-middle"]);
    expect(positionOfPlace(structure, { item: "notes", fragment: "en3" })).toBe(DOCX_PARTS.d0 + DOCX_PARTS.d1 + 1);
  });
});
