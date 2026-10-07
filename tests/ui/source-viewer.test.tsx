import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { createFakePdfEngine, installIntersectionObserver } from "../support/fakePdfEngine";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// All library text here is invented for the tests.
const VINE: SourceFixture = {
  title: "Notes on the Vine",
  author: "J. Example",
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

const ESSAY: SourceFixture = {
  title: "Ein Aufsatz",
  format: "markdown",
  sourceType: "article",
  language: "Deutsch",
  segments: [{ text: "Bleibt in mir.", sectionPath: "Einleitung" }],
};

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });

function setup({ pages = 4, sources = [VINE, ESSAY] }: { pages?: number; sources?: SourceFixture[] } = {}) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "JHN.15";
  for (const source of sources) api.installFixtureSource(source);
  return { api, engine: createFakePdfEngine({ pages }) };
}

type User = Awaited<ReturnType<typeof renderApp>>["user"];

/** Opens the Vine notes in the full reader from the Library list. */
async function openFromLibrary(user: User, title = "Notes on the Vine") {
  await user.click(await within(sourcesPane()).findByRole("button", { name: "Open library" }));
  const library = await screen.findByRole("main");
  await user.click((await within(library).findAllByRole("button", { name: new RegExp(title) }))[0]!);
  await screen.findByRole("heading", { level: 1, name: title });
}

/** Opens the Vine notes in the Sources pane at the passage that mentions John 15:4 (page 3). */
async function openCitationInPane(user: User) {
  await user.click(await screen.findByRole("button", { name: /^Verse 4\. Show verse tools/ }));
  const list = await within(sourcesPane()).findByRole("list", { name: "Sources for John 15:4" });
  await user.click(within(list).getByRole("button", { name: /Notes on the Vine/ }));
  return within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
}

const header = () => screen.getByTestId("reader-header");
const modes = () => within(header()).queryByRole("group", { name: "View" });
const pageBox = () => screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement;

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

describe("Reading and Original", () => {
  it("opens in Reading, the existing extracted-text reader", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    const view = within(modes()!);
    expect(view.getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByText("An opening paragraph about gardens.")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-viewer")).toBeNull();
    expect(engine.opened).toEqual([]); // nothing is read until Original is chosen
  });

  it("offers Original for a PDF and no broken Original for a format without one", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Ein Aufsatz");
    expect(modes()).toBeNull();
    expect(screen.queryByRole("button", { name: "Original" })).toBeNull();
    expect(await screen.findByText("Bleibt in mir.")).toBeInTheDocument();
  });

  it("shows the viewer with every control", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(within(modes()!).getByRole("button", { name: "Original" }));

    const toolbar = await screen.findByRole("toolbar", { name: "Original document controls" });
    for (const name of ["Previous page", "Next page", "Zoom in", "Zoom out", "Fit width", "Fit page"]) {
      expect(within(toolbar).getByRole("button", { name })).toBeInTheDocument();
    }
    await waitFor(() => expect(pageBox()).toHaveValue("1"));
    expect(within(toolbar).getByText("/ 4")).toBeInTheDocument();
    expect(within(toolbar).getByRole("status")).toHaveTextContent("Page 1 of 4");
    // Fit width is the default, and the reader is still the same source.
    expect(within(toolbar).getByRole("button", { name: "Fit width" })).toHaveAttribute("aria-pressed", "true");
    expect(engine.opened).toHaveLength(1);
    expect(await screen.findByRole("group", { name: "Page 1" })).toBeInTheDocument();
  });

  it("moves between pages and zooms", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(within(modes()!).getByRole("button", { name: "Original" }));
    const toolbar = await screen.findByRole("toolbar", { name: "Original document controls" });
    await waitFor(() => expect(pageBox()).toHaveValue("1"));
    expect(within(toolbar).getByRole("button", { name: "Previous page" })).toBeDisabled();

    await user.click(within(toolbar).getByRole("button", { name: "Next page" }));
    expect(pageBox()).toHaveValue("2");
    await user.click(within(toolbar).getByRole("button", { name: "Next page" }));
    await user.click(within(toolbar).getByRole("button", { name: "Next page" }));
    expect(pageBox()).toHaveValue("4");
    expect(within(toolbar).getByRole("button", { name: "Next page" })).toBeDisabled();
    await user.click(within(toolbar).getByRole("button", { name: "Previous page" }));
    expect(pageBox()).toHaveValue("3");

    await user.clear(pageBox());
    await user.type(pageBox(), "2{Enter}");
    expect(pageBox()).toHaveValue("2");
    await user.clear(pageBox());
    await user.type(pageBox(), "99{Enter}");
    expect(pageBox()).toHaveValue("4"); // clamped to the last page

    const zoom = screen.getByTestId("pdf-zoom");
    await user.click(within(toolbar).getByRole("button", { name: "Zoom in" }));
    const bigger = Number(zoom.textContent!.replace(/\D/g, ""));
    expect(within(toolbar).getByRole("button", { name: "Fit width" })).toHaveAttribute("aria-pressed", "false");
    await user.click(within(toolbar).getByRole("button", { name: "Zoom out" }));
    await user.click(within(toolbar).getByRole("button", { name: "Zoom out" }));
    expect(Number(zoom.textContent!.replace(/\D/g, ""))).toBeLessThan(bigger);
    await user.click(within(toolbar).getByRole("button", { name: "Fit page" }));
    expect(within(toolbar).getByRole("button", { name: "Fit page" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(toolbar).getByRole("button", { name: "Fit width" }));
    expect(within(toolbar).getByRole("button", { name: "Fit width" })).toHaveAttribute("aria-pressed", "true");
  });

  it("draws only the pages near the screen of a long document", async () => {
    restore = installIntersectionObserver((el) => ["1", "2"].includes((el as HTMLElement).dataset.page ?? ""));
    const { api, engine } = setup({ pages: 600 });
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(within(modes()!).getByRole("button", { name: "Original" }));
    expect(await screen.findByRole("group", { name: "Page 600" })).toBeInTheDocument(); // an empty sheet
    await waitFor(() => expect([...engine.rendered].sort()).toEqual([1, 2]));
    expect(document.querySelectorAll("canvas")).toHaveLength(2);
    expect(document.querySelectorAll("[data-page]")).toHaveLength(600);
  });

  it("keeps Reading available when the original cannot be shown", async () => {
    const { api, engine } = setup();
    engine.failOpen = true;
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(within(modes()!).getByRole("button", { name: "Original" }));
    expect(await screen.findByText("The original could not be shown. You can still read the extracted text.")).toBeInTheDocument();
    expect(screen.queryByText(/synthetic/)).toBeNull(); // no raw error text

    await user.click(within(modes()!).getByRole("button", { name: "Reading" }));
    expect(await screen.findByText("An opening paragraph about gardens.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("reports a page that fails to draw the same way", async () => {
    const { api, engine } = setup();
    engine.failRender = true;
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(within(modes()!).getByRole("button", { name: "Original" }));
    expect(await screen.findByText(/The original could not be shown/)).toBeInTheDocument();
    await user.click(within(modes()!).getByRole("button", { name: "Reading" }));
    expect(await screen.findByText("An opening paragraph about gardens.")).toBeInTheDocument();
  });

  it("uses the interface language for every label", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    await user.click(within(header()).getByRole("button", { name: "Original" }));
    const toolbar = await screen.findByRole("toolbar", { name: "Steuerung des Originaldokuments" });
    for (const name of ["Vorherige Seite", "Nächste Seite", "Vergrößern", "Verkleinern", "Breite anpassen", "Seite einpassen"]) {
      expect(within(toolbar).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(toolbar).getByRole("textbox", { name: "Seitenzahl" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("status")).toHaveTextContent("Seite 1 von 4");
    expect(within(header()).getByRole("group", { name: "Ansicht" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Originaldokument" })).toBeInTheDocument();
    for (const english of ["Previous page", "Next page", "Zoom in", "Fit width", "Page number"]) {
      expect(screen.queryByRole("button", { name: english })).toBeNull();
    }
  });

  it("keeps focus on the mode switch while changing mode", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    const original = within(modes()!).getByRole("button", { name: "Original" });
    await user.click(original);
    await screen.findByTestId("pdf-viewer");
    expect(original).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeInTheDocument();
  });
});

describe("Original inside the Sources pane", () => {
  const pane = () => within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });

  it("offers Reading | Original in the pane for a PDF, and Reading stays the default", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await pane();
    const view = within(within(reader).getByRole("group", { name: "View" }));
    expect(view.getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "false");
    expect(within(reader).getByRole("button", { name: "Open full reader" })).toBeInTheDocument();
    expect(within(reader).queryByTestId("pdf-viewer")).toBeNull();
    expect(engine.opened).toEqual([]);
  });

  it("shows the real PDF inside the pane while Scripture and the Study stay on screen", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await pane();
    const originalTab = within(reader).getByRole("button", { name: "Original" });
    await user.click(originalTab);

    expect(await within(reader).findByTestId("pdf-viewer")).toBeInTheDocument();
    expect(originalTab).toHaveFocus(); // changing view does not move focus away
    expect(within(sourcesPane()).getByRole("toolbar", { name: "Original document controls" })).toBeInTheDocument();
    // Still the workspace: no full reader took over.
    expect(screen.getByRole("main", { name: "Study" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Scripture" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Notes on the Vine" })).toBeNull();
    expect(engine.opened).toHaveLength(1);

    // And back to Reading without leaving.
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    expect(await within(reader).findByText("An opening paragraph about gardens.")).toBeInTheDocument();
    expect(within(reader).queryByTestId("pdf-viewer")).toBeNull();
    expect(screen.getByRole("main", { name: "Study" })).toBeInTheDocument();
  });

  it("keeps Back, the view switch and Open full reader outside whatever scrolls", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await pane();
    const controls = [
      within(reader).getByRole("button", { name: "Back to Sources" }),
      within(reader).getByRole("button", { name: "Open full reader" }),
      within(reader).getByRole("group", { name: "View" }),
    ];
    const outsideScrolling = (scroller: Element) => controls.every((el) => !scroller.contains(el));
    // Reading: the text scrolls in its own body.
    const body = within(reader).getByTestId("reader-body");
    expect(body.className).toMatch(/overflow-y-auto/);
    expect(outsideScrolling(body)).toBe(true);
    // Original: the page area scrolls; the pane's controls are still outside it.
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    const pages = await within(reader).findByRole("region", { name: "Original document" });
    expect(pages.className).toMatch(/overflow-auto/);
    expect(outsideScrolling(pages)).toBe(true);
    expect(reader.firstElementChild).toBe(screen.getByTestId("reader-header"));
  });

  it("does not offer Original for a source without an original view", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click(await within(sourcesPane()).findByRole("button", { name: /^Ein Aufsatz/ }));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Ein Aufsatz" });
    expect(within(reader).queryByRole("group", { name: "View" })).toBeNull();
    expect(within(reader).queryByRole("button", { name: "Original" })).toBeNull();
    expect(within(reader).getByRole("button", { name: "Open full reader" })).toBeInTheDocument();
  });

  it("keeps Reading usable when the original cannot be shown in the pane", async () => {
    const { api, engine } = setup();
    engine.failOpen = true;
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await pane();
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    expect(await within(reader).findByText("The original could not be shown. You can still read the extracted text.")).toBeInTheDocument();
    expect(screen.queryByText(/synthetic/)).toBeNull();
    // Nothing closed or navigated; Reading is one click away.
    expect(within(reader).getByRole("button", { name: "Back to Sources" })).toBeInTheDocument();
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    expect(await within(reader).findByText("An opening paragraph about gardens.")).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Study" })).toBeInTheDocument();
  });

  it("uses the interface language for the pane's controls", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await pane();
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(within(reader).getByRole("group", { name: "Ansicht" })).toBeInTheDocument();
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    const toolbar = await within(reader).findByRole("toolbar", { name: "Steuerung des Originaldokuments" });
    for (const name of ["Vorherige Seite", "Nächste Seite", "Vergrößern", "Verkleinern", "Breite anpassen", "Seite einpassen"]) {
      expect(within(toolbar).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("keeps every essential control reachable in a narrow pane (labels may shrink to icons)", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine, width: 1100 });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await pane();
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    const toolbar = await within(reader).findByRole("toolbar", { name: "Original document controls" });
    for (const name of ["Previous page", "Next page", "Zoom in", "Zoom out", "Fit width", "Fit page"]) {
      const button = within(toolbar).getByRole("button", { name });
      expect(button).toHaveAccessibleName(name);
      expect(button.getAttribute("title") ?? button.textContent).toBeTruthy();
    }
    expect(within(toolbar).getByRole("textbox", { name: "Page number" })).toBeInTheDocument();
    // The toolbar wraps rather than forcing the pane to scroll sideways, and
    // the text beside the fit icons collapses (but stays readable to assistive technology) when narrow.
    expect(toolbar.className).toMatch(/flex-wrap/);
    expect(toolbar.className).toMatch(/@container/);
    expect(within(toolbar).getByText("Fit width").className).toMatch(/@max-md:sr-only/);
  });

  it("does not redraw pages while the pane is being resized", async () => {
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
    const restoreObserver = () => {
      globalThis.ResizeObserver = previous;
    };
    restore = restoreObserver;
    const { api, engine } = setup({ pages: 600 });
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await pane();
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    const region = await within(reader).findByRole("region", { name: "Original document" });
    await waitFor(() => expect(engine.rendered.size).toBeGreaterThan(0));
    const drawn = new Set(engine.rendered);

    // Drag the pane edge through many widths, quickly.
    for (const width of [500, 450, 400, 380, 360, 340]) {
      Object.defineProperty(region, "clientWidth", { configurable: true, value: width });
      for (const callback of callbacks) callback([], {} as ResizeObserver);
    }
    await new Promise((r) => setTimeout(r, 300));
    // Only pages that were already near the screen were drawn; the other 600 were not.
    expect([...engine.rendered].every((page) => drawn.has(page))).toBe(true);
    expect(engine.rendered.size).toBeLessThan(10);
  });
});

describe("the place is kept between the pane and the full reader", () => {
  const pane = () => within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });

  it("opens the original in the pane on the physical page of the passage that was open", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    const reader = await openCitationInPane(user);
    await waitFor(() => expect(reader.querySelector("[data-target]")).toHaveAttribute("data-seg-page", "3"));
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    await within(reader).findByRole("toolbar", { name: "Original document controls" });
    await waitFor(() => expect(pageBox()).toHaveValue("3"));
    expect(screen.queryByRole("heading", { level: 1, name: "Notes on the Vine" })).toBeNull();
  });

  it("returns to the text of the page the original was on", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    const reader = await openCitationInPane(user);
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    await waitFor(() => expect(pageBox()).toHaveValue("3"));
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(pageBox()).toHaveValue("2");

    const scrolled: HTMLElement[] = [];
    // jsdom has no scrollIntoView; record what the reader scrolls to.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this as HTMLElement);
    };
    restore = () => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    };
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    expect(await within(reader).findByText("Abiding is the heart of fruitfulness.")).toBeInTheDocument();
    await waitFor(() => expect(scrolled.some((el) => el.dataset.segPage === "2")).toBe(true));
  });

  it("opens the full reader on the same view and page, and brings them back to the pane", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    const reader = await openCitationInPane(user);
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    await waitFor(() => expect(pageBox()).toHaveValue("3"));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(pageBox()).toHaveValue("4");

    // Expand: still Original, still page 4 (not Reading from the start).
    await user.click(within(reader).getByRole("button", { name: "Open full reader" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Notes on the Vine" })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Study" })).toBeNull();
    await screen.findByRole("toolbar", { name: "Original document controls" });
    await waitFor(() => expect(pageBox()).toHaveValue("4"));
    expect(within(header()).getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");

    // Go on in the full reader, then return: the pane continues at that page, same view.
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(pageBox()).toHaveValue("2");
    await user.click(within(header()).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("main", { name: "Study" })).toBeInTheDocument();
    const back = await pane();
    expect(await within(back).findByTestId("pdf-viewer")).toBeInTheDocument();
    await waitFor(() => expect(pageBox()).toHaveValue("2"));
    expect(within(back).getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the reading location too when expanding and returning in Reading", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    const reader = await openCitationInPane(user);
    await user.click(within(reader).getByRole("button", { name: "Open full reader" }));
    await screen.findByRole("heading", { level: 1, name: "Notes on the Vine" });
    // Reading in the full reader, at the marked passage on page 3.
    await waitFor(() => expect(screen.getByTestId("reader-body").querySelector("[data-target]")).toHaveAttribute("data-seg-page", "3"));
    await user.click(within(header()).getByRole("button", { name: "Back" }));
    const back = await pane();
    expect(within(back).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(back.querySelector("[data-target]")).toHaveAttribute("data-seg-page", "3"));
  });

  it("starts a different source in Reading, not in the previous source's Original", async () => {
    const other: SourceFixture = { ...VINE, title: "Notes on Pruning", mentions: [] };
    const { api, engine } = setup({ sources: [VINE, other] });
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await pane();
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    await within(reader).findByTestId("pdf-viewer");
    await user.click(within(reader).getByRole("button", { name: "Back to Sources" }));

    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on Pruning/ }))[0]!);
    const second = await within(sourcesPane()).findByRole("region", { name: "Notes on Pruning" });
    expect(within(second).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
    expect(within(second).queryByTestId("pdf-viewer")).toBeNull();
    expect(await within(second).findByText("An opening paragraph about gardens.")).toBeInTheDocument();
    expect(engine.opened).toHaveLength(1); // only the first source's original was ever read
  });
});

describe("moving across a zoomed page", () => {
  const scroller = () =>
    screen.getByTestId("pdf-canvas").parentElement as HTMLElement;

  /** jsdom has no layout: give the scroller the measurements a real one would have. */
  function measure(
    el: HTMLElement,
    m: {
      scrollWidth: number;
      scrollHeight: number;
      clientWidth: number;
      clientHeight: number;
    },
  ) {
    for (const [key, value] of Object.entries(m))
      Object.defineProperty(el, key, { configurable: true, get: () => value });
  }

  async function openOriginal() {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(
      within(modes()!).getByRole("button", { name: "Original" }),
    );
    await screen.findByTestId("pdf-canvas");
    await waitFor(() => expect(pageBox()).toHaveValue("1"));
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null)))); // the opening jump
    return user;
  }

  it("lays pages on a canvas at least as wide as the view and its widest page, with no auto margins", async () => {
    await openOriginal();
    const canvas = screen.getByTestId("pdf-canvas");
    expect(canvas).toHaveClass("min-w-full", "w-max", "items-center");
    expect(scroller()).toHaveClass("overflow-auto");
    for (const sheet of document.querySelectorAll("[data-page]")) {
      expect(sheet).not.toHaveClass("mx-auto");
      expect(sheet).toHaveClass("shrink-0"); // never squeezed to the view's width
    }
  });

  it("keeps the same document point in the middle when zooming in and out", async () => {
    const user = await openOriginal();
    const el = scroller();
    measure(el, {
      scrollWidth: 2000,
      scrollHeight: 8000,
      clientWidth: 500,
      clientHeight: 600,
    });
    el.scrollLeft = 750; // centre at 1000 of 2000
    el.scrollTop = 3700; // centre at 4000 of 8000
    const toolbar = screen.getByRole("toolbar", {
      name: "Original document controls",
    });
    await user.click(within(toolbar).getByRole("button", { name: "Zoom in" }));
    expect(el.scrollLeft).toBe(750); // 0.5 * 2000 - 250
    expect(el.scrollTop).toBe(3700);

    measure(el, {
      scrollWidth: 1000,
      scrollHeight: 4000,
      clientWidth: 500,
      clientHeight: 600,
    });
    el.scrollLeft = 250;
    el.scrollTop = 1700;
    await user.click(within(toolbar).getByRole("button", { name: "Zoom out" }));
    expect(el.scrollLeft).toBe(250); // 0.5 * 1000 - 250, never snapped to 0
    expect(el.scrollTop).toBe(1700);
  });

  it("pans by dragging the page background", async () => {
    await openOriginal();
    const el = scroller();
    measure(el, {
      scrollWidth: 2000,
      scrollHeight: 8000,
      clientWidth: 500,
      clientHeight: 600,
    });
    el.scrollLeft = 300;
    el.scrollTop = 300;
    const sheet = document.querySelector("[data-page='1']")!;
    fireEvent.mouseDown(sheet, { button: 0, clientX: 200, clientY: 200 });
    expect(el).toHaveAttribute("data-panning", "true");
    fireEvent.mouseMove(window, { clientX: 150, clientY: 180 });
    expect(el.scrollLeft).toBe(350);
    expect(el.scrollTop).toBe(320);
    fireEvent.mouseUp(window);
    expect(el).not.toHaveAttribute("data-panning");
  });

  it("leaves a press on the words alone so text selection works", async () => {
    await openOriginal();
    const el = scroller();
    measure(el, {
      scrollWidth: 2000,
      scrollHeight: 8000,
      clientWidth: 500,
      clientHeight: 600,
    });
    const layer = document.querySelector(".textLayer")!;
    const word = document.createElement("span");
    word.textContent = "word";
    layer.append(word);
    expect(
      fireEvent.mouseDown(word, { button: 0, clientX: 10, clientY: 10 }),
    ).toBe(true); // not cancelled
    expect(el).not.toHaveAttribute("data-panning");
    expect(layer).not.toHaveClass("pointer-events-none");
    expect(el).not.toHaveClass("select-none");
  });

  it("does not hijack the mouse when the page already fits", async () => {
    await openOriginal();
    const el = scroller();
    measure(el, {
      scrollWidth: 500,
      scrollHeight: 500,
      clientWidth: 500,
      clientHeight: 500,
    });
    fireEvent.mouseDown(document.querySelector("[data-page='1']")!, {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    expect(el).not.toHaveAttribute("data-panning");
  });

  it("scrolls the same way inside the Sources pane", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    const region = await openCitationInPane(user);
    await user.click(within(region).getByRole("button", { name: "Original" }));
    const canvas = await within(sourcesPane()).findByTestId("pdf-canvas");
    expect(canvas).toHaveClass("min-w-full", "w-max");
    expect(canvas.parentElement).toHaveClass("overflow-auto");
  });
});
