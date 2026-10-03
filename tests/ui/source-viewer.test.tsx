import { act, screen, waitFor, within } from "@testing-library/react";
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
  const list = await within(sourcesPane()).findByRole("list", { name: "Sources mentioning John 15:4" });
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

describe("the page follows the reader between modes", () => {
  it("opens the original on the physical page of the passage that was open", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    const pane = await openCitationInPane(user);
    // The mention is on physical page 3.
    await waitFor(() => expect(pane.querySelector("[data-target]")).toHaveAttribute("data-seg-page", "3"));
    await user.click(within(pane).getByRole("button", { name: "Open original" }));

    await screen.findByRole("toolbar", { name: "Original document controls" });
    await waitFor(() => expect(pageBox()).toHaveValue("3"));
    expect(screen.getByRole("heading", { level: 1, name: "Notes on the Vine" })).toBeInTheDocument();
  });

  it("returns to the text of the page the original was on", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    const pane = await openCitationInPane(user);
    await user.click(within(pane).getByRole("button", { name: "Open original" }));
    await screen.findByRole("toolbar", { name: "Original document controls" });
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
    await user.click(within(modes()!).getByRole("button", { name: "Reading" }));
    expect(await screen.findByText("Abiding is the heart of fruitfulness.")).toBeInTheDocument();
    await waitFor(() => expect(scrolled.some((el) => el.dataset.segPage === "2")).toBe(true));
    expect(within(modes()!).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
  });

  it("goes back to the workspace, with the source still open in the pane", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    const pane = await openCitationInPane(user);
    await user.click(within(pane).getByRole("button", { name: "Open original" }));
    await screen.findByRole("toolbar", { name: "Original document controls" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("main", { name: "Study" })).toBeInTheDocument();
    expect(await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" })).toBeInTheDocument();
  });
});

describe("the Sources pane", () => {
  it("offers Open original for a PDF, next to Open full reader", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Notes on the Vine/ }))[0]!);
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    expect(within(reader).getByRole("button", { name: "Open original" })).toBeInTheDocument();
    expect(within(reader).getByRole("button", { name: "Open full reader" })).toBeInTheDocument();
    // The pane itself stays the text reader.
    expect(within(reader).queryByTestId("pdf-viewer")).toBeNull();
    expect(engine.opened).toEqual([]);
  });

  it("does not offer it for a source without an original view", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await user.click(await within(sourcesPane()).findByRole("button", { name: /^Ein Aufsatz/ }));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Ein Aufsatz" });
    expect(within(reader).queryByRole("button", { name: "Open original" })).toBeNull();
    expect(within(reader).getByRole("button", { name: "Open full reader" })).toBeInTheDocument();
  });
});
