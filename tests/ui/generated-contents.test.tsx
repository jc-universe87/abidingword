import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContentsItem } from "@/types/library";
import { createFakePdfEngine } from "../support/fakePdfEngine";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Generated contents (v0.13): used only when a source carries no contents of its own,
// and always presented as generated. All library text here is invented.
const page = (id: string, title: string, n: number, children: ContentsItem[] = []): ContentsItem => ({ id, title, target: { kind: "page", page: n }, children });
const spot = (id: string, title: string, position: number): ContentsItem => ({ id, title, target: { kind: "segment", position }, children: [] });

const GENERATED_PDF = [page("g0", "Chapter 1 Soil", 1, [page("g1", "Pruning", 3)]), page("g2", "Chapter 2 Fruit", 4)];

const pdf = (title: string): SourceFixture => ({
  title,
  format: "pdf",
  language: "English",
  segments: [
    { text: "An opening paragraph about gardens.", pageNumber: 1 },
    { text: "Abiding is the heart of fruitfulness.", pageNumber: 2 },
    { text: "Pruning is painful but good.", pageNumber: 3 },
    { text: "A closing paragraph on page four.", pageNumber: 4 },
  ],
  generatedContents: GENERATED_PDF,
});

const NOTES: SourceFixture = {
  title: "Markdown Notes",
  format: "markdown",
  language: "English",
  segments: [
    { text: "First words.", sectionPath: "Abiding" },
    { text: "More words.", sectionPath: "Abiding › In the vine" },
    { text: "Last words.", sectionPath: "Fruit" },
  ],
  generatedContents: [spot("g0", "Abiding", 0), spot("g1", "Fruit", 2)],
};

const WITH_OWN: SourceFixture = {
  title: "Book With Its Own Contents",
  format: "epub",
  language: "English",
  segments: [
    { text: "One.", sectionPath: "One" },
    { text: "Two.", sectionPath: "Two" },
  ],
  contents: [spot("n0", "Its Own First", 0), spot("n1", "Its Own Second", 1)],
  generatedContents: [spot("g0", "Generated First", 0), spot("g1", "Generated Second", 1)],
};

const BARE: SourceFixture = { title: "Plain Text Only", format: "text", language: "English", segments: [{ text: "Nothing but text." }] };

function setup(sources: SourceFixture[], outline: ContentsItem[] = []) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  for (const source of sources) api.installFixtureSource(source);
  return { api, engine: createFakePdfEngine({ pages: 4, outline }) };
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function openFromLibrary(user: User, title: string) {
  await user.click(await within(sourcesPane()).findByRole("button", { name: "Open library" }));
  const library = await screen.findByRole("main");
  await user.click((await within(library).findAllByRole("button", { name: new RegExp(title) }))[0]!);
  await screen.findByRole("heading", { level: 1, name: title });
}
const contentsButton = () => screen.findByRole("button", { name: "Contents" });

describe("generated contents", () => {
  it("are used for a PDF without an outline, said to be generated, and lead to their page", async () => {
    const { api, engine } = setup([pdf("Garden Notes")]);
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Garden Notes");
    await user.click(await contentsButton());
    const nav = await screen.findByRole("navigation", { name: "Contents of Garden Notes" });
    expect(within(nav).getByRole("heading", { name: "Generated contents" })).toBeInTheDocument();
    expect(within(nav).getByText("Made from the headings found in this source. It is not part of the original.")).toBeInTheDocument();
    await user.click(within(nav).getByRole("button", { name: /^Pruning/ }));
    // a deliberate jump: Back is offered
    await waitFor(() => expect(screen.getByRole("button", { name: "Back to the previous place" })).toBeEnabled());
    expect(screen.getByText("Pruning is painful but good.")).toBeInTheDocument();
  });

  it("give way to the PDF's own outline", async () => {
    const { api, engine } = setup([pdf("Outlined Notes")], [page("p0", "Outline Part One", 1), page("p1", "Outline Part Two", 3)]);
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Outlined Notes");
    await user.click(await contentsButton());
    const nav = await screen.findByRole("navigation", { name: "Contents of Outlined Notes" });
    expect(within(nav).getByRole("heading", { name: "Contents" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /^Outline Part Two/ })).toBeInTheDocument();
    expect(within(nav).queryByText("Pruning")).toBeNull();
  });

  it("give way to an EPUB's own contents, and serve a Markdown file", async () => {
    const { api, engine } = setup([WITH_OWN, NOTES]);
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Book With Its Own Contents");
    await user.click(await contentsButton());
    let nav = await screen.findByRole("navigation", { name: /^Contents of Book With/ });
    expect(within(nav).getByRole("heading", { name: "Contents" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /^Its Own Second/ })).toBeInTheDocument();
    expect(within(nav).queryByText("Generated Second")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    const library = await screen.findByRole("main");
    await user.click((await within(library).findAllByRole("button", { name: /Markdown Notes/ }))[0]!);
    await screen.findByRole("heading", { level: 1, name: "Markdown Notes" });
    await user.click(await contentsButton());
    nav = await screen.findByRole("navigation", { name: "Contents of Markdown Notes" });
    expect(within(nav).getByRole("heading", { name: "Generated contents" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /^Fruit/ })).toBeInTheDocument();
  });

  it("are not offered when nothing could be generated", async () => {
    const { api, engine } = setup([BARE]);
    const { user } = await renderApp(api, { pdfEngine: engine });
    await openFromLibrary(user, "Plain Text Only");
    await screen.findByText("Nothing but text.");
    expect(screen.queryByRole("button", { name: "Contents" })).toBeNull();
  });
});
