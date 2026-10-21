import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePdfEngine, textItem } from "../support/fakePdfEngine";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The interactive Original PDF (v0.13): Scripture references on the page itself, pages
// without text of their own, find marks, and the view remembered per source. All text is invented.
const VINE: SourceFixture = {
  title: "Notes on the Vine",
  format: "pdf",
  language: "English",
  segments: [
    { text: "An opening paragraph about gardens; see Romans 8:1 here.", pageNumber: 1 },
    { text: "Abiding is the heart of fruitfulness.", pageNumber: 2 },
    { text: "Pruning is painful but good.", pageNumber: 3 },
    { text: "A closing paragraph on page four.", pageNumber: 4 },
  ],
};

function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "JHN.15";
  api.installFixtureSource(VINE);
  const engine = createFakePdfEngine({ pages: 4 });
  engine.pageTexts = {
    1: [
      textItem("NOTES ON THE VINE — Psalm 23", { top: 0.02 }), // a running header: never linked
      textItem("An opening paragraph about gardens; see "),
      textItem("Romans 8:1 here."),
      textItem("Rom 6", { dir: "rtl" }), // right-to-left text: never linked
    ],
    2: [], // a scanned page: no text of its own
    3: [textItem("Pruning is painful but good."), textItem("A drawn caption: pruning shears")],
  };
  return { api, engine };
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const scripture = () => screen.getByRole("complementary", { name: "Scripture" });
type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function openFromLibrary(user: User, title = "Notes on the Vine") {
  await user.click(await within(sourcesPane()).findByRole("button", { name: "Open library" }));
  const library = await screen.findByRole("main");
  await user.click((await within(library).findAllByRole("button", { name: new RegExp(title) }))[0]!);
  await screen.findByRole("heading", { level: 1, name: title });
}
const pageSheet = (n: number) => screen.getByRole("group", { name: `Page ${n}` });

afterEach(() => {
  window.localStorage.clear();
});

describe("the interactive Original PDF", () => {
  it("offers Open in Bible on a reference drawn on the page, and Scripture moves", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(screen.getByRole("button", { name: "Original" }));
    const ref = await within(pageSheet(1)).findByRole("button", { name: "Romans 8:1 (Scripture reference)" });
    // placed with the page-text map, as a share of the page
    expect(ref.closest("[data-pdf-reference]")).toHaveStyle({ left: "0%", top: "20%" });
    // the header and the right-to-left text are not linked
    expect(within(pageSheet(1)).queryByRole("button", { name: /Psalm 23/ })).toBeNull();
    expect(within(pageSheet(1)).queryByRole("button", { name: /Romans 6/ })).toBeNull();
    await user.click(ref);
    await user.click(within(pageSheet(1)).getByRole("menuitem", { name: "Open in Bible" }));
    expect(await within(scripture()).findByText(/showing Romans 8:1/)).toBeInTheDocument();
    // the reader stays in the original
    expect(screen.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");
  });

  it("links a bookless reference on the page as the imported text resolved it, in Reading and Original", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.state.settings.scripturePassage = "PSA.23";
    api.installFixtureSource({
      title: "Sermon Notes",
      format: "pdf",
      language: "English",
      segments: [{ text: "John 15:1 opens it; then 15:4 says remain.", pageNumber: 1 }],
      // as the core indexes it: the explicit reference, and the bookless one resolved from it
      mentions: [
        { segment: 0, reference: "JHN.15.1", matchedText: "John 15:1" },
        { segment: 0, reference: "JHN.15.4", matchedText: "15:4" },
      ],
    });
    const engine = createFakePdfEngine({ pages: 2 });
    engine.pageTexts = { 1: [textItem("John 15:1 opens it; then 15:4 says remain.")], 2: [textItem("Elsewhere 15:4 is just text.")] };
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Sermon Notes");
    // Reading: from the stored index
    expect(await screen.findByRole("button", { name: "John 15:4 (Scripture reference)" })).toHaveTextContent("15:4");
    await user.click(screen.getByRole("button", { name: "Original" }));
    const ref = await within(pageSheet(1)).findByRole("button", { name: "John 15:4 (Scripture reference)" });
    expect(ref).toHaveTextContent("15:4");
    // the same visible text on a page where the imported text resolved nothing stays plain
    await waitFor(() => expect(engine.textReads).toContain(2));
    expect(within(pageSheet(2)).queryByRole("button", { name: /Scripture reference/ })).toBeNull();
  });

  it("says when a page has no text of its own, and only then", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(screen.getByRole("button", { name: "Original" }));
    expect(await within(pageSheet(2)).findByRole("note")).toHaveTextContent("This page has no selectable text");
    await waitFor(() => expect(engine.textReads).toContain(3));
    expect(within(pageSheet(1)).queryByRole("note")).toBeNull();
    expect(within(pageSheet(3)).queryByRole("note")).toBeNull();
  });

  it("marks the current find match on the page when the page's text agrees, and not when it is ambiguous", async () => {
    const { api, engine } = setup();
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(screen.getByRole("button", { name: "Find" }));
    await user.type(screen.getByRole("searchbox", { name: "Find in this source" }), "gardens{Enter}");
    await waitFor(() => expect(screen.getByRole("search", { name: "Find in this source" })).toHaveTextContent("1 of 1"));
    await user.click(screen.getByRole("button", { name: "Original" }));
    // the query and the current match carry over to the original
    expect(screen.getByRole("searchbox", { name: "Find in this source" })).toHaveValue("gardens");
    await waitFor(() => expect(pageSheet(1).querySelector("[data-pdf-find]")).not.toBeNull());

    // "pruning": once on page 3 in the text, twice in what page 3 draws: the page opens, unmarked
    await user.clear(screen.getByRole("searchbox", { name: "Find in this source" }));
    await user.type(screen.getByRole("searchbox", { name: "Find in this source" }), "pruning{Enter}");
    await waitFor(() => expect(screen.getByRole("search", { name: "Find in this source" })).toHaveTextContent("1 of 1"));
    await waitFor(() => expect(pageSheet(1).querySelector("[data-pdf-find]")).toBeNull());
    expect(pageSheet(3).querySelector("[data-pdf-find]")).toBeNull();
  });

  it("opens a source in the view last chosen for it, and only that source", async () => {
    const { api, engine } = setup();
    api.installFixtureSource({ ...VINE, title: "Another PDF" });
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user);
    await user.click(screen.getByRole("button", { name: "Original" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    const library = await screen.findByRole("main");
    await user.click((await within(library).findAllByRole("button", { name: /Notes on the Vine/ }))[0]!);
    expect(await screen.findByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click((await within(await screen.findByRole("main")).findAllByRole("button", { name: /Another PDF/ }))[0]!);
    await screen.findByRole("heading", { level: 1, name: "Another PDF" });
    expect(screen.getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
  });
});
