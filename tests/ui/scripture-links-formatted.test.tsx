import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pageTexts } from "@/features/library/formatted/epubDocument";
import type { EpubElement, EpubItem, EpubNode } from "@/types/library";
import { createFakePdfEngine } from "../support/fakePdfEngine";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Scripture links in the formatted (Original) view of EPUB and Word sources (v0.11). Invented text.

const el = (t: string, c: EpubNode[] = [], a: Record<string, string> = {}, l?: { item: string; id?: string }): EpubElement => ({ t, ...(Object.keys(a).length ? { a } : {}), ...(c.length ? { c } : {}), ...(l ? { l } : {}) });

const page: EpubItem = {
  id: "p1",
  css: "",
  root: {},
  missingImages: 0,
  nodes: [
    el("h1", ["Chapter One"], { id: "top" }),
    el("p", ["Compare ", el("em", ["carefully"]), ": John 15:5, Romans 6:1-4."], { id: "a" }),
    el("p", ["A link ", el("a", ["John 3:16"], {}, { item: "p1", id: "notes" }), " and the web ", { t: "a", c: ["Romans 8:1"], x: "https://example.org/r" }, "."], { id: "b" }),
    el("table", [el("tbody", [el("tr", [el("td", ["Psalm 23 in a cell"]), el("td", ["plain"])])])]),
    el("p", ["A note", el("a", ["1"], { role: "doc-noteref" }, { item: "p1", id: "notes" }), "."]),
    el("ol", [el("li", ["See John 15:4."], { id: "notes" })]),
  ],
};

function fixture(kind: "epub" | "docx"): SourceFixture {
  return {
    title: kind === "epub" ? "Formatted Vine Book" : "Formatted Vine Document",
    format: kind,
    language: "English",
    segments: [
      { text: "Compare carefully: John 15:5, Romans 6:1-4.", sectionPath: "Chapter One" },
      { text: "A link John 3:16 and the web Romans 8:1.", sectionPath: "Chapter One" },
      { text: "Psalm 23 in a cell", sectionPath: "Chapter One" },
      { text: "See John 15:4.", sectionPath: "Chapter One" },
    ],
    formatted: { kind, structure: [{ id: "p1", startSegment: 0, segmentCount: 4, anchors: { top: 0, a: 0, b: 1, notes: 3 } }], items: { p1: page } },
  };
}

function setup(kind: "epub" | "docx") {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.1";
  api.installFixtureSource(fixture(kind));
  return api;
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const scripture = () => screen.getByRole("complementary", { name: "Scripture" });

async function originalPage(api: ReturnType<typeof setup>, title: string) {
  const { user } = await renderApp(api, { pdfEngine: createFakePdfEngine({ pages: 1 }), width: 1440 });
  await user.click((await within(sourcesPane()).findAllByRole("button", { name: new RegExp(`^${title}`) }))[0]!);
  const reader = await within(sourcesPane()).findByRole("region", { name: title });
  await user.click(within(reader).getByRole("button", { name: "Original" }));
  const host = await within(reader).findByTestId("epub-page");
  await waitFor(() => expect(host.shadowRoot?.querySelector(".aw-doc")).not.toBeNull());
  const doc = host.shadowRoot!.querySelector<HTMLElement>(".aw-doc")!;
  await waitFor(() => expect(doc.querySelector("[data-scripture-ref]")).not.toBeNull());
  return { user, reader, doc };
}

const ref = (doc: HTMLElement, passage: string) => within(doc).getByRole("button", { name: `${passage} (Scripture reference)` });

describe("the pieces of a page that may hold references", () => {
  it("skips text inside links and text without digits, and lists each piece once", () => {
    const texts = pageTexts(page.nodes);
    expect(texts).toContain(": John 15:5, Romans 6:1-4.");
    expect(texts).toContain("Psalm 23 in a cell");
    expect(texts).toContain("See John 15:4.");
    expect(texts).not.toContain("John 3:16");
    expect(texts).not.toContain("Romans 8:1");
    expect(texts).not.toContain("plain");
    expect(new Set(texts).size).toBe(texts.length);
  });
});

for (const kind of ["epub", "docx"] as const) {
  const title = kind === "epub" ? "Formatted Vine Book" : "Formatted Vine Document";
  describe(`Scripture references in a formatted ${kind === "epub" ? "EPUB" : "Word"} page`, () => {
    it("draws references in text, keeps the formatting and the text, and leaves links alone", async () => {
      const api = setup(kind);
      const { doc } = await originalPage(api, title);
      expect(ref(doc, "John 15:5")).toBeInTheDocument();
      expect(ref(doc, "Romans 6:1–4")).toBeInTheDocument();
      expect(ref(doc, "Psalm 23")).toBeInTheDocument();
      expect(ref(doc, "John 15:4")).toBeInTheDocument();
      // the paragraph reads exactly as before, its emphasis still there
      const first = doc.querySelector("#a")!;
      expect(first.textContent).toBe("Compare carefully: John 15:5, Romans 6:1-4.");
      expect(first.querySelector("em")?.textContent).toBe("carefully");
      // the table cell and the note are intact
      expect(doc.querySelector("td")!.textContent).toBe("Psalm 23 in a cell");
      expect(doc.querySelector("#notes")!.textContent).toBe("See John 15:4.");
      // references inside links stay plain links: no control inside a link
      expect(within(doc).queryByRole("button", { name: /John 3:16/ })).toBeNull();
      expect(within(doc).queryByRole("button", { name: /Romans 8:1 / })).toBeNull();
      expect(doc.querySelector("a [data-scripture-ref], a button")).toBeNull();
      const web = within(doc).getByRole("link", { name: "Romans 8:1" });
      expect(web).toHaveAttribute("href", "#");
      expect(web).toHaveAttribute("title", "https://example.org/r");
      // found once for the page, by the core, in the source's language
      expect(api.detectCalls).toHaveLength(1);
    });

    it("Open in Bible moves Scripture, and Escape returns focus to the reference", async () => {
      const api = setup(kind);
      const { user, doc } = await originalPage(api, title);
      const romans = ref(doc, "Romans 6:1–4");
      await user.click(romans);
      expect(within(doc).getByRole("menuitem", { name: "Open in Bible" })).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(within(doc).queryByRole("menu")).toBeNull();
      expect(doc.getRootNode() instanceof ShadowRoot && (doc.getRootNode() as ShadowRoot).activeElement).toBe(romans);
      await user.click(romans);
      await user.click(within(doc).getByRole("menuitem", { name: "Open in Bible" }));
      expect(await within(scripture()).findByText(/showing Romans 6:1–4/)).toBeInTheDocument();
    });

    it("an internal link in the page still works", async () => {
      const api = setup(kind);
      const { user, doc } = await originalPage(api, title);
      await user.click(within(doc).getByRole("link", { name: "John 3:16" }));
      // still the same page, and nothing went to Scripture
      expect(within(scripture()).getByRole("heading", { level: 2 })).toHaveTextContent("Psalm 1");
    });
  });
}

describe("PDF sources", () => {
  const PDF: SourceFixture = {
    title: "Vine Lecture PDF",
    format: "pdf",
    language: "English",
    segments: [
      { text: "An opening paragraph.", pageNumber: 1 },
      { text: "Pruning is good; see John 15:2 here.", pageNumber: 2 },
    ],
    mentions: [{ segment: 1, reference: "JHN.15.2", matchedText: "John 15:2" }],
  };

  it("offers references in Reading, and leaves the PDF Original untouched (no guessed overlay)", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.installFixtureSource(PDF);
    const { user } = await renderApp(api, { pdfEngine: createFakePdfEngine({ pages: 2 }), width: 1440 });
    await user.click((await within(sourcesPane()).findAllByRole("button", { name: /^Vine Lecture PDF/ }))[0]!);
    const reader = await within(sourcesPane()).findByRole("region", { name: "Vine Lecture PDF" });
    expect(await within(reader).findByRole("button", { name: "John 15:2 (Scripture reference)" })).toBeInTheDocument();

    await user.click(within(reader).getByRole("button", { name: "Original" }));
    await within(reader).findByTestId("pdf-viewer");
    expect(within(reader).queryByRole("button", { name: /Scripture reference/ })).toBeNull();
    expect(reader.querySelector("[data-scripture-ref]")).toBeNull();
    expect(api.detectCalls).toHaveLength(0);
  });
});
