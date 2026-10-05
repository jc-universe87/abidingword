import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentsItem, SourceLink } from "@/types/library";
import { createFakePdfEngine, type FakePdfEngine } from "../support/fakePdfEngine";
import { createMemoryApi, type MemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Link-following, footnotes and Back / Forward in the source reader. Every
// document and every word here is invented for the tests.

type User = Awaited<ReturnType<typeof renderApp>>["user"];

const page = (id: string, title: string, n: number): ContentsItem => ({ id, title, target: { kind: "page", page: n }, children: [] });
const spot = (id: string, title: string, position: number): ContentsItem => ({ id, title, target: { kind: "segment", position }, children: [] });

const PDF: SourceFixture = {
  title: "Notes on the Vine",
  format: "pdf",
  language: "English",
  segments: [1, 2, 3, 4, 5, 6].map((n) => ({ text: `Text of page ${n}.`, pageNumber: n })),
};

const link = (position: number, start: number, end: number, target: number): SourceLink => ({ position, start, end, target });

const EPUB: SourceFixture = {
  title: "A Synthetic Commentary",
  format: "epub",
  language: "English",
  segments: [
    { text: "Body text with a note1 and a cross reference.", sectionPath: "Chapter One" }, // 0
    { text: "More body text.", sectionPath: "Chapter One" }, // 1
    { text: "Footnote one. back", sectionPath: "Notes" }, // 2
    { text: "Chapter two begins.", sectionPath: "Chapter Two" }, // 3
    { text: "Chapter two continues.", sectionPath: "Chapter Two" }, // 4
  ],
  contents: [spot("n0", "Chapter One", 0), spot("n1", "Chapter Two", 3)],
  links: [
    link(0, 17, 22, 2), // "note1" -> the footnote
    link(0, 29, 44, 3), // "cross reference" -> Chapter Two
    link(2, 14, 18, 0), // "back" -> where the note was cited
  ],
};

const LONG: SourceFixture = {
  title: "A Very Long Book",
  format: "epub",
  language: "English",
  segments: Array.from({ length: 400 }, (_, i) => ({ text: i === 2 ? "Go to the end." : `Paragraph number ${i}.`, sectionPath: `Part ${Math.floor(i / 100) + 1}` })),
  links: [link(2, 6, 13, 350)],
};

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const back = (root: HTMLElement) => within(root).getByRole("button", { name: "Back to the previous place" });
const forward = (root: HTMLElement) => within(root).getByRole("button", { name: "Forward to the next place" });

// jsdom has no layout. This gives the reader's text one: every paragraph is 30px tall, and
// "scrolling" to a paragraph puts it at the top of a 300px view, so the reader's idea of
// where it is (the top paragraph) behaves as it does in a browser.
let top = 0;
const realRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  top = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    const el = this as HTMLElement;
    const at = el.dataset.segPosition ?? (el.hasAttribute("data-section-marker") ? (el.nextElementSibling as HTMLElement | null)?.dataset.segPosition : undefined);
    if (at !== undefined) top = Number(at);
  };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    const box = (y: number, h: number) => ({ top: y, bottom: y + h, left: 0, right: 600, width: 600, height: h, x: 0, y, toJSON: () => ({}) }) as DOMRect;
    if (el.dataset?.segPosition !== undefined) return box((Number(el.dataset.segPosition) - top) * 30, 30);
    if (el.dataset?.testid === "reader-body") return box(0, 300);
    return realRect.call(this);
  };
});
afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
  Element.prototype.getBoundingClientRect = realRect;
});

function setup(fixtures: SourceFixture[] = [PDF, EPUB, LONG]) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  for (const f of fixtures) api.installFixtureSource(f);
  const engine = createFakePdfEngine({ pages: 6, outline: [page("p1", "Chapter 1", 1), page("p2", "Chapter 5", 5)] });
  // Page 1: a footnote marker (to page 5, half way down), a cross reference (page 3), and links that lead nowhere.
  engine.pageLinks[1] = [
    { x: 60, y: 80, width: 120, height: 16, dest: "fn1" },
    { x: 60, y: 200, width: 60, height: 12, dest: "see-p3" },
    { x: 60, y: 300, width: 60, height: 12, dest: "nowhere" },
  ];
  engine.destinations = { fn1: { page: 5, fraction: 0.5 }, "see-p3": { page: 3, fraction: 0 } };
  return { api, engine };
}

async function openPane(api: MemoryApi, engine: FakePdfEngine, title: string, width = 1440) {
  const { user } = await renderApp(api, { pdfEngine: engine, width });
  await user.click(await within(sourcesPane()).findByRole("button", { name: new RegExp(title) }));
  const reader = await within(sourcesPane()).findByRole("region", { name: title });
  return { user, reader };
}

async function original(user: User, reader: HTMLElement) {
  await user.click(within(reader).getByRole("button", { name: "Original" }));
  await within(reader).findByTestId("pdf-viewer");
  await within(reader).findAllByRole("button", { name: "Go to the linked place" });
}

const pageBox = (root: HTMLElement) => within(root).getByRole("textbox", { name: "Page number" });
const links = (root: HTMLElement) => within(root).getAllByRole("button", { name: "Go to the linked place" });

describe("PDF internal links", () => {
  it("follows a footnote marker to its page, and Back and Forward return and replay it", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    expect(pageBox(reader)).toHaveValue("1");
    expect(back(reader)).toBeDisabled();
    expect(forward(reader)).toBeDisabled();

    await user.click(links(reader)[0]!);
    await waitFor(() => expect(pageBox(reader)).toHaveValue("5"));
    expect(back(reader)).toBeEnabled();
    expect(forward(reader)).toBeDisabled();

    await user.click(back(reader));
    await waitFor(() => expect(pageBox(reader)).toHaveValue("1"));
    expect(back(reader)).toBeDisabled();
    expect(forward(reader)).toBeEnabled();

    await user.click(forward(reader));
    await waitFor(() => expect(pageBox(reader)).toHaveValue("5"));
    expect(forward(reader)).toBeDisabled();
  });

  it("goes back and forward repeatedly through several jumps", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    await user.click(links(reader)[1]!); // cross reference: page 3
    await waitFor(() => expect(pageBox(reader)).toHaveValue("3"));
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(await screen.findByRole("button", { name: "Chapter 5" })); // contents: page 5
    await waitFor(() => expect(pageBox(reader)).toHaveValue("5"));

    for (const expected of ["3", "1"]) {
      await user.click(back(reader));
      await waitFor(() => expect(pageBox(reader)).toHaveValue(expected));
    }
    expect(back(reader)).toBeDisabled();
    for (const expected of ["3", "5"]) {
      await user.click(forward(reader));
      await waitFor(() => expect(pageBox(reader)).toHaveValue(expected));
    }
    expect(forward(reader)).toBeDisabled();
  });

  it("a new jump after going Back drops what was ahead", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    await user.click(links(reader)[0]!);
    await waitFor(() => expect(pageBox(reader)).toHaveValue("5"));
    await user.click(back(reader));
    await waitFor(() => expect(pageBox(reader)).toHaveValue("1"));
    await user.click(links(reader)[1]!);
    await waitFor(() => expect(pageBox(reader)).toHaveValue("3"));
    expect(forward(reader)).toBeDisabled();
    await user.click(back(reader));
    await waitFor(() => expect(pageBox(reader)).toHaveValue("1"));
  });

  it("leaves the reader where it is for a link that leads nowhere, and notes it without any text", async () => {
    const { api, engine } = setup();
    const log = vi.spyOn(api, "logError");
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    await user.click(links(reader)[2]!);
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(pageBox(reader)).toHaveValue("1");
    expect(back(reader)).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(String(log.mock.calls[0]![0])).not.toMatch(/Text of page/);
  });

  it("puts each link on the page as shares of the page itself, so zoom, density and panning cannot move it", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    const marker = links(reader)[0]!;
    const place = () => ({ left: marker.style.left, top: marker.style.top, width: marker.style.width, height: marker.style.height });
    // 60/600, 80/800, 120/600, 16/800 of the page.
    expect(place()).toEqual({ left: "10%", top: "10%", width: "20%", height: "2%" });
    expect(marker.closest("[data-page]")).toHaveAttribute("data-page", "1");
    await user.click(within(reader).getByRole("button", { name: "Zoom in" }));
    await user.click(within(reader).getByRole("button", { name: "Zoom in" }));
    expect(place()).toEqual({ left: "10%", top: "10%", width: "20%", height: "2%" });
    // Panning moves the scroller, never the link: it is inside the page.
    const scroller = within(reader).getByRole("region", { name: "Original document" });
    act(() => {
      scroller.scrollLeft = 120;
      fireEvent.scroll(scroller);
    });
    expect(place()).toEqual({ left: "10%", top: "10%", width: "20%", height: "2%" });
    expect(marker.closest("[data-page]")).not.toBeNull();
  });

  it("can be followed by keyboard", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    links(reader)[0]!.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(pageBox(reader)).toHaveValue("5"));
    back(reader).focus();
    await user.keyboard(" ");
    await waitFor(() => expect(pageBox(reader)).toHaveValue("1"));
  });

  it("does not record the switch between Reading and Original as a jump", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    expect(back(reader)).toBeDisabled();
    expect(forward(reader)).toBeDisabled();
  });

  it("keeps the history when the reader moves between the pane and the full reader", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    await user.click(links(reader)[0]!);
    await waitFor(() => expect(pageBox(reader)).toHaveValue("5"));
    await user.click(within(reader).getByRole("button", { name: "Open full reader" }));
    const full = await screen.findByRole("main");
    await within(full).findByTestId("pdf-viewer");
    expect(back(full)).toBeEnabled();
    await user.click(back(full));
    await waitFor(() => expect(pageBox(full)).toHaveValue("1"));
    expect(forward(full)).toBeEnabled();
  });

  it("starts a different source with no history of the last one", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await original(user, reader);
    await user.click(links(reader)[0]!);
    await waitFor(() => expect(pageBox(reader)).toHaveValue("5"));
    await user.click(within(reader).getByRole("button", { name: "Back to Sources" }));
    await user.click(await within(sourcesPane()).findByRole("button", { name: /A Synthetic Commentary/ }));
    const next = await within(sourcesPane()).findByRole("region", { name: "A Synthetic Commentary" });
    expect(back(next)).toBeDisabled();
    expect(forward(next)).toBeDisabled();
  });
});

describe("Reading view of a PDF", () => {
  it("records a Contents jump in Reading and returns to where the reader was", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "Notes on the Vine");
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(await screen.findByRole("button", { name: /^Chapter 5/ }));
    await waitFor(() => expect(top).toBe(4)); // the paragraph of page 5 is at the top of the view
    expect(back(reader)).toBeEnabled();
    await user.click(back(reader));
    await waitFor(() => expect(top).toBe(0));
    await user.click(forward(reader));
    await waitFor(() => expect(top).toBe(4));
  });
});

describe("EPUB internal links", () => {
  const linkIn = (reader: HTMLElement, text: string) => within(reader).getByRole("link", { name: text });
  const focusedPosition = () => (document.activeElement as HTMLElement | null)?.dataset.segPosition;

  it("shows only the words that are links as links, among plain text", async () => {
    const { api, engine } = setup();
    const { reader } = await openPane(api, engine, "A Synthetic Commentary");
    await within(reader).findByRole("link", { name: "note1" });
    const body = linkIn(reader, "note1").closest("p")!;
    expect(body).toHaveTextContent("Body text with a note1 and a cross reference.");
    expect(within(body).getAllByRole("link")).toHaveLength(2);
    expect(linkIn(reader, "note1")).toHaveAttribute("title", "Go to the linked place");
  });

  it("can be followed by keyboard", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "A Synthetic Commentary");
    (await within(reader).findByRole("link", { name: "note1" })).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(focusedPosition()).toBe("2"));
  });

  it("jumps from a footnote marker to the note, and Back returns to the paragraph it came from", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "A Synthetic Commentary");
    await user.click(await within(reader).findByRole("link", { name: "note1" }));
    await waitFor(() => expect(focusedPosition()).toBe("2"));
    expect(back(reader)).toBeEnabled();
    await user.click(back(reader));
    await waitFor(() => expect(focusedPosition()).toBe("0"));
    expect(forward(reader)).toBeEnabled();
    await user.click(forward(reader));
    await waitFor(() => expect(focusedPosition()).toBe("2"));
  });

  it("works without a link back in the book: the note's own link and the app's Back both return", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "A Synthetic Commentary");
    await user.click(await within(reader).findByRole("link", { name: "note1" }));
    await waitFor(() => expect(focusedPosition()).toBe("2"));
    await user.click(linkIn(reader, "back")); // the book's own return link
    await waitFor(() => expect(focusedPosition()).toBe("0"));
    // Two jumps were made: Back twice goes to the start, with nothing from the book needed.
    await user.click(back(reader));
    await waitFor(() => expect(focusedPosition()).toBe("2"));
    await user.click(back(reader));
    await waitFor(() => expect(focusedPosition()).toBe("0"));
    expect(back(reader)).toBeDisabled();
  });

  it("follows a link to another chapter, and Contents enters the same history", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "A Synthetic Commentary");
    // Where the reader is, not which control holds focus: choosing a Contents entry both lands on
    // its paragraph and gives focus back to the Contents button (a frame later), and either can
    // finish last. `top` is the paragraph at the top of the view (see the layout stand-in above).
    await user.click(await within(reader).findByRole("link", { name: "cross reference" }));
    await waitFor(() => expect(top).toBe(3));
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(await screen.findByRole("button", { name: /^Chapter One/ }));
    await waitFor(() => expect(top).toBe(0));
    expect(within(reader).getByText(/^Body text with a/)).toBeInTheDocument();
    await user.click(back(reader));
    await waitFor(() => expect(top).toBe(3));
    expect(within(reader).getByText("Chapter two begins.")).toBeInTheDocument();
    await user.click(back(reader));
    await waitFor(() => expect(top).toBe(0));
    expect(back(reader)).toBeDisabled();
    expect(forward(reader)).toBeEnabled();
    await user.click(forward(reader));
    await waitFor(() => expect(top).toBe(3));
  });

  it("jumps within a long normalized book to text that is not loaded yet, and Back returns", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openPane(api, engine, "A Very Long Book");
    await user.click(await within(reader).findByRole("link", { name: "the end" }));
    await waitFor(() => expect(within(reader).getByText("Paragraph number 350.")).toBeInTheDocument());
    await waitFor(() => expect(focusedPosition()).toBe("350"));
    await user.click(back(reader));
    await waitFor(() => expect(within(reader).getByRole("link", { name: "the end" })).toBeInTheDocument());
    await waitFor(() => expect(focusedPosition()).toBe("2"));
  });

  it("ignores a link whose target is outside the text", async () => {
    const broken: SourceFixture = { ...EPUB, title: "Broken Links", links: [link(0, 17, 22, 999)] };
    const { api, engine } = setup([broken]);
    const log = vi.spyOn(api, "logError");
    const { user, reader } = await openPane(api, engine, "Broken Links");
    await user.click(await within(reader).findByRole("link", { name: "note1" }));
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(back(reader)).toBeDisabled();
    expect(within(reader).getByText(/Body text with a/)).toBeInTheDocument();
  });

  /** Opens `title` from a finding's citation of the segment at `position`; the pane when it is shown, else the full reader. */
  async function openCited(api: MemoryApi, engine: FakePdfEngine, title: string, position: number, width = 1440) {
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Series" });
    const made = await api.studyCreate({ projectId: project.id, title: "The True Vine" });
    const finding = await api.findingCreate({ studyId: made.study.id, findingType: "observation", content: "A note." });
    const source = (await api.libraryList({})).find((s) => s.title === title)!;
    const cited = (await api.sourceGetSegments({ sourceId: source.id, offset: position, limit: 1 })).segments[0]!;
    await api.findingSourceAdd({ findingId: finding.id, segmentId: cited.id });
    const { user } = await renderApp(api, { pdfEngine: engine, width });
    await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /The True Vine/ }));
    await user.click(await within(await screen.findByRole("list", { name: "Findings" })).findByTitle("Open this source at the cited place"));
    const reader = width >= 1000 ? await within(sourcesPane()).findByRole("region", { name: title }) : await screen.findByRole("main");
    await waitFor(() => expect(reader.querySelector("[data-target]")).not.toBeNull());
    return { user, reader };
  }

  it("opens from a citation, follows a link, and Back returns to the cited place", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openCited(api, engine, "A Synthetic Commentary", 0);
    await user.click(await within(reader).findByRole("link", { name: "note1" }));
    await waitFor(() => expect(focusedPosition()).toBe("2"));
    await user.click(back(reader));
    await waitFor(() => expect(focusedPosition()).toBe("0"));
    expect(reader.querySelector("[data-target]")).toHaveAttribute("data-seg-position", "0");
  });

  it("fits a narrow window: the full reader has the controls and the links, and they work", async () => {
    const { api, engine } = setup();
    const { user, reader } = await openCited(api, engine, "A Synthetic Commentary", 0, 700);
    expect(back(reader)).toBeDisabled();
    await user.click(await within(reader).findByRole("link", { name: "note1" }));
    await waitFor(() => expect(focusedPosition()).toBe("2"));
    await user.click(back(reader));
    await waitFor(() => expect(focusedPosition()).toBe("0"));
    expect(forward(reader)).toBeEnabled();
  });
});
