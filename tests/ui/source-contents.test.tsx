import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentsItem } from "@/types/library";
import { createFakePdfEngine } from "../support/fakePdfEngine";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// All library text here is invented for the tests.
const page = (id: string, title: string, n: number, children: ContentsItem[] = []): ContentsItem => ({ id, title, target: { kind: "page", page: n }, children });
const spot = (id: string, title: string, position: number, children: ContentsItem[] = []): ContentsItem => ({ id, title, target: { kind: "segment", position }, children });

const PDF_OUTLINE: ContentsItem[] = [
  page("p0", "Part One: Gardens", 1, [page("p1", "Chapter 1: Soil", 1), page("p2", "Chapter 2: Pruning", 3, [page("p3", "Section: Painful but good", 3)])]),
  { id: "p4", title: "Appendices", target: null, children: [page("p5", "Appendix A", 4)] },
];

const VINE: SourceFixture = {
  title: "Notes on the Vine",
  format: "pdf",
  language: "English",
  segments: [
    { text: "An opening paragraph about gardens.", pageNumber: 1 },
    { text: "Abiding is the heart of fruitfulness.", pageNumber: 2 },
    { text: "Pruning is painful but good; see John 15:4 here.", pageNumber: 3 },
    { text: "A closing paragraph on page four.", pageNumber: 4 },
  ],
  mentions: [{ segment: 2, reference: "JHN.15.4", matchedText: "John 15:4" }],
};

// An EPUB: six segments across three chapters, with a nested contents.
const BOOK: SourceFixture = {
  title: "A Synthetic Commentary",
  format: "epub",
  language: "English",
  segments: [
    { text: "Intro one.", sectionPath: "Introduction" },
    { text: "Intro two.", sectionPath: "Introduction" },
    { text: "Chapter two begins.", sectionPath: "Chapter Two" },
    { text: "Chapter two, deeper, see John 15:4.", sectionPath: "Chapter Two › Part A" },
    { text: "Chapter three begins.", sectionPath: "Chapter Three" },
    { text: "The end.", sectionPath: "Chapter Three" },
  ],
  mentions: [{ segment: 3, reference: "JHN.15.4", matchedText: "John 15:4" }],
  contents: [
    spot("n0", "Introduction", 0),
    spot("n1", "Chapter Two", 2, [spot("n2", "Part A", 3)]),
    spot("n3", "Chapter Three", 4),
  ],
};

const PLAIN: SourceFixture = { title: "No Contents Book", format: "epub", language: "English", segments: [{ text: "Only text.", sectionPath: "One" }] };

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });

function setup({ outline = PDF_OUTLINE, sources = [VINE, BOOK, PLAIN] }: { outline?: ContentsItem[]; sources?: SourceFixture[] } = {}) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "JHN.15";
  for (const source of sources) api.installFixtureSource(source);
  return { api, engine: createFakePdfEngine({ pages: 4, outline }) };
}

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function openFromLibrary(user: User, title: string) {
  await user.click(await within(sourcesPane()).findByRole("button", { name: "Open library" }));
  const library = await screen.findByRole("main");
  await user.click((await within(library).findAllByRole("button", { name: new RegExp(title) }))[0]!);
  await screen.findByRole("heading", { level: 1, name: title });
}

async function openInPane(user: User, title: string) {
  await user.click(await screen.findByRole("button", { name: /^Verse 4\. Show verse tools/ }));
  const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:4" });
  await user.click(within(list).getByRole("button", { name: new RegExp(title) }));
  return within(sourcesPane()).findByRole("region", { name: title });
}

const toggle = () => screen.queryByRole("button", { name: /Contents/ });
const panel = () => screen.queryByRole("navigation", { name: /^Contents of / });

// jsdom has no layout: choose the width the reader "has", and which paragraph is at the top.
let restoreWidth: (() => void) | null = null;
function readerWidth(width: number) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return String(this.className).includes("relative flex min-h-0 flex-1 flex-col") ? width : 0;
    },
  });
  restoreWidth = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  };
}

const scrolled: HTMLElement[] = [];
function trackScrolling() {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this as HTMLElement);
  };
}

afterEach(() => {
  restoreWidth?.();
  restoreWidth = null;
  vi.restoreAllMocks();
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
});

describe("Contents control", () => {
  it("appears only when the source carries contents", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "No Contents Book");
    await screen.findByText("Only text.");
    expect(toggle()).toBeNull();
  });

  it("is absent for a PDF whose outline is empty or cannot be read, and the reader still works", async () => {
    for (const mode of ["empty", "failing"]) {
      const { api, engine } = setup({ outline: [] });
      engine.failOutline = mode === "failing";
      const { user } = await renderApp(api, { pdfEngine: engine });
      await openFromLibrary(user, "Notes on the Vine");
      await screen.findByText("An opening paragraph about gardens.");
      await waitFor(() => expect(engine.outlineReads).toEqual([expect.any(String)]));
      expect(toggle()).toBeNull();
      cleanup();
    }
  });

  it("shows the empty state in the panel itself", async () => {
    const { ContentsPanel } = await import("@/features/library/ContentsPanel");
    const { render } = await import("@testing-library/react");
    await import("../support/render");
    const { default: i18n } = await import("@/i18n");
    await i18n.changeLanguage("en");
    render(<ContentsPanel title="X" items={[]} currentId={null} layout="drawer" onSelect={() => undefined} onClose={() => undefined} />);
    expect(screen.getByText("No contents available")).toBeInTheDocument();
  });
});

describe("Contents in the full reader (PDF)", () => {
  it("lists the nested outline, with groups that only head their children", async () => {
    readerWidth(900);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Notes on the Vine");
    await user.click(await screen.findByRole("button", { name: "Contents" }));
    const nav = await screen.findByRole("navigation", { name: "Contents of Notes on the Vine" });
    expect(nav).toHaveAttribute("data-layout", "drawer");
    const top = within(nav).getAllByRole("list")[0]!;
    const topItems = within(top).getAllByRole("listitem", {}).filter((li) => li.parentElement === top);
    expect(topItems).toHaveLength(2);
    // Nested lists carry the hierarchy.
    const part = topItems[0]!;
    expect(within(part).getByRole("button", { name: "Part One: Gardens" })).toBeInTheDocument();
    const chapter2 = within(part).getByRole("button", { name: "Chapter 2: Pruning" }).closest("li")!;
    expect(within(chapter2).getByRole("button", { name: "Section: Painful but good" })).toBeInTheDocument();
    // A group without a target is text, not a button.
    expect(within(nav).queryByRole("button", { name: "Appendices" })).toBeNull();
    expect(within(nav).getByText("Appendices")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Appendix A" })).toBeInTheDocument();
  });

  it("in Original, jumps to the page and keeps the zoom", async () => {
    readerWidth(900);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Notes on the Vine");
    await user.click(screen.getByRole("button", { name: "Original" }));
    await screen.findByRole("toolbar", { name: "Original document controls" });
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoom = screen.getByTestId("pdf-zoom").textContent;
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1"));

    await user.click(screen.getByRole("button", { name: "Contents" }));
    await user.click(screen.getByRole("button", { name: "Chapter 2: Pruning" }));
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("3");
    expect(screen.getByTestId("pdf-zoom").textContent).toBe(zoom);
    expect(panel()).toBeNull();
    expect(screen.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");

    // A later entry works too (a new request each time), and the panel names where we are.
    await user.click(screen.getByRole("button", { name: "Contents" }));
    const current = screen.getByRole("button", { name: /Section: Painful but good/ });
    expect(current).toHaveAttribute("aria-current", "location"); // deepest entry at or before page 3
    expect(current).toHaveTextContent("Current section");
    await user.click(screen.getByRole("button", { name: "Appendix A" }));
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("4");
  });

  it("in Reading, stays in Reading and shows that page's text", async () => {
    readerWidth(900);
    trackScrolling();
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Notes on the Vine");
    await user.click(await screen.findByRole("button", { name: "Contents" }));
    await user.click(screen.getByRole("button", { name: "Chapter 2: Pruning" }));
    await waitFor(() => expect(scrolled.some((el) => el.dataset.segPage === "3")).toBe(true));
    expect(screen.getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
    expect(engine.opened).toEqual([]); // no PDF was opened for this
    // Original is still there to switch to afterwards.
    await user.click(screen.getByRole("button", { name: "Original" }));
    await screen.findByRole("toolbar", { name: "Original document controls" });
  });

  it("keeps navigation right when the view is switched between jumps", async () => {
    readerWidth(900);
    trackScrolling();
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Notes on the Vine");
    await user.click(await screen.findByRole("button", { name: "Original" }));
    await screen.findByRole("toolbar", { name: "Original document controls" });
    await user.click(screen.getByRole("button", { name: "Contents" }));
    await user.click(screen.getByRole("button", { name: "Appendix A" }));
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("4");
    await user.click(screen.getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(scrolled.some((el) => el.dataset.segPage === "4")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Contents" }));
    await user.click(screen.getByRole("button", { name: /^Chapter 1: Soil/ }));
    await waitFor(() => expect(scrolled.at(-1)?.dataset.segPage).toBe("1"));
    await user.click(screen.getByRole("button", { name: "Original" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1"));
  });
});

describe("Contents in the Sources pane", () => {
  it("opens inside the pane, narrow as a full-width sheet", async () => {
    readerWidth(400);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openInPane(user, "Notes on the Vine");
    await user.click(within(sourcesPane()).getByRole("button", { name: "Contents" }));
    const nav = within(sourcesPane()).getByRole("navigation", { name: "Contents of Notes on the Vine" });
    expect(nav).toHaveAttribute("data-layout", "sheet");
    expect(nav.className).toMatch(/\binset-0\b/);
    // Scripture and the Study stay on screen.
    expect(screen.getByRole("button", { name: /^Verse 4\. Show verse tools/ })).toBeInTheDocument();
  });

  it("is a compact drawer when the pane is wide", async () => {
    readerWidth(700);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openInPane(user, "Notes on the Vine");
    await user.click(within(sourcesPane()).getByRole("button", { name: "Contents" }));
    const nav = within(sourcesPane()).getByRole("navigation", { name: /^Contents of / });
    expect(nav).toHaveAttribute("data-layout", "drawer");
    expect(nav.className).toMatch(/\bw-80\b/);
    expect(nav.className).not.toMatch(/\binset-0\b/);
  });

  it("navigates in the pane's Original", async () => {
    readerWidth(700);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openInPane(user, "Notes on the Vine");
    await user.click(within(sourcesPane()).getByRole("button", { name: "Original" }));
    await within(sourcesPane()).findByRole("toolbar", { name: "Original document controls" });
    await user.click(within(sourcesPane()).getByRole("button", { name: "Contents" }));
    await user.click(within(sourcesPane()).getByRole("button", { name: "Appendix A" }));
    expect(within(sourcesPane()).getByRole("textbox", { name: "Page number" })).toHaveValue("4");
  });
});

describe("Contents for an EPUB", () => {
  it("lists the nested contents and jumps to the chapter's first segment in Reading", async () => {
    readerWidth(900);
    trackScrolling();
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "A Synthetic Commentary");
    await screen.findByText("Chapter three begins.");
    expect(screen.queryByRole("button", { name: "Original" })).toBeNull(); // no EPUB Original yet
    await user.click(screen.getByRole("button", { name: "Contents" }));
    const nav = screen.getByRole("navigation", { name: /^Contents of / });
    const chapter2 = within(nav).getByRole("button", { name: "Chapter Two" }).closest("li")!;
    expect(within(chapter2).getByRole("button", { name: "Part A" })).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "Part A" }));
    await waitFor(() => expect(scrolled.at(-1)?.dataset.segPosition ?? scrolled.at(-1)?.nextElementSibling?.getAttribute("data-seg-position")).toBe("3"));
    expect(document.activeElement).toHaveTextContent("Chapter two, deeper, see John 15:4.");
    // and keeps it: closing the panel does not take it back to the Contents button a frame later
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toHaveTextContent("Chapter two, deeper, see John 15:4.");
    expect(panel()).toBeNull();
    expect(engine.outlineReads).toEqual([]); // an EPUB never goes through the PDF engine
  });

  it("scrolls to the heading before a chapter's first paragraph", async () => {
    readerWidth(900);
    trackScrolling();
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "A Synthetic Commentary");
    await screen.findByText("Chapter three begins.");
    await user.click(screen.getByRole("button", { name: "Contents" }));
    await user.click(screen.getByRole("button", { name: "Chapter Three" }));
    await waitFor(() => expect(scrolled.at(-1)).toHaveAttribute("data-section-marker"));
    expect(scrolled.at(-1)).toHaveTextContent("Chapter Three");
  });

  it("marks the entry containing the visible text", async () => {
    readerWidth(900);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "A Synthetic Commentary");
    await screen.findByText("Chapter three begins.");
    // Paragraphs 0-2 are above the top of the reading area; 3 is the first in view.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const position = this.dataset.segPosition;
      if (position === undefined) return { top: 0, bottom: 600, left: 0, right: 100, width: 100, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      const bottom = Number(position) < 3 ? -10 : 40;
      return { top: bottom - 20, bottom, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    await user.click(screen.getByRole("button", { name: "Contents" }));
    const current = screen.getByRole("button", { name: /Part A/ });
    expect(current).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("button", { name: /^Chapter Two/ })).not.toHaveAttribute("aria-current");
  });

  it("works in the Sources pane too", async () => {
    readerWidth(700);
    trackScrolling();
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openInPane(user, "A Synthetic Commentary");
    await user.click(within(sourcesPane()).getByRole("button", { name: "Contents" }));
    await user.click(within(sourcesPane()).getByRole("button", { name: "Chapter Three" }));
    await waitFor(() => expect(scrolled.at(-1)).toHaveTextContent("Chapter Three"));
  });
});

describe("Contents panel keyboard and focus", () => {
  async function open() {
    readerWidth(900);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "A Synthetic Commentary");
    await screen.findByText("Chapter three begins.");
    const opener = screen.getByRole("button", { name: "Contents" });
    await user.click(opener);
    return { user, opener };
  }

  it("moves focus into the panel, and Escape closes it and returns focus to the opener", async () => {
    const { user, opener } = await open();
    const nav = screen.getByRole("navigation", { name: /^Contents of / });
    expect(nav).toContainElement(document.activeElement as HTMLElement);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(opener).toHaveAttribute("aria-controls", nav.id);
    await user.keyboard("{Escape}");
    expect(panel()).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(opener).toHaveAttribute("aria-expanded", "false");
  });

  it("closes with the Close button and returns focus to the opener", async () => {
    const { user, opener } = await open();
    await user.click(screen.getByRole("button", { name: "Close contents" }));
    expect(panel()).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("reaches every entry with Tab and opens one with Enter or Space", async () => {
    trackScrolling();
    const { user, opener } = await open();
    const entry = screen.getByRole("button", { name: /^Introduction/ });
    entry.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Chapter Two" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(scrolled.at(-1)).toHaveTextContent("Chapter Two"));
    await waitFor(() => expect(panel()).toBeNull());
    // A jump in Reading focuses the paragraph it lands on (docs/source-navigation-v0.7.md), never
    // the Contents button, whatever the timing: wait a frame so a late refocus would show.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement?.getAttribute("data-seg-position")).not.toBeNull();
    expect(opener).not.toHaveFocus();
    await user.click(opener);
    screen.getByRole("button", { name: "Chapter Three" }).focus();
    await user.keyboard(" ");
    await waitFor(() => expect(scrolled.at(-1)).toHaveTextContent("Chapter Three"));
  });

  it("toggles from the same button", async () => {
    const { user, opener } = await open();
    await user.click(opener);
    expect(panel()).toBeNull();
  });
});

describe("Contents does not leave stale requests behind", () => {
  it("does not replay an old jump when Original is opened again", async () => {
    readerWidth(900);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Notes on the Vine");
    await user.click(await screen.findByRole("button", { name: "Original" }));
    await screen.findByRole("toolbar", { name: "Original document controls" });
    await user.click(screen.getByRole("button", { name: "Contents" }));
    await user.click(screen.getByRole("button", { name: "Appendix A" }));
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("4");
    await user.click(screen.getByRole("button", { name: "Reading" }));
    await user.click(screen.getByRole("button", { name: "Original" }));
    await screen.findByRole("toolbar", { name: "Original document controls" });
    // Reading was never moved off the first page, so Original opens there, and stays there.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
  });

  it("closes the panel when the view is switched, so it never names a stale place", async () => {
    readerWidth(900);
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Notes on the Vine");
    await user.click(await screen.findByRole("button", { name: "Contents" }));
    expect(panel()).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Original" }));
    expect(panel()).toBeNull();
    expect(screen.getByRole("button", { name: "Contents" })).toHaveAttribute("aria-expanded", "false");
  });
});
