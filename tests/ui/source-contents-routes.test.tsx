import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContentsItem } from "@/types/library";
import { createFakePdfEngine } from "../support/fakePdfEngine";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The same source must offer its own Contents however it was opened: from the
// library list, or from a finding's citation (which also opens at a segment).
// All text here is invented for the tests.

const page = (id: string, title: string, n: number, children: ContentsItem[] = []): ContentsItem => ({ id, title, target: { kind: "page", page: n }, children });
const spot = (id: string, title: string, position: number, children: ContentsItem[] = []): ContentsItem => ({ id, title, target: { kind: "segment", position }, children });

const OUTLINE: ContentsItem[] = [page("p0", "Part One", 1, [page("p1", "Chapter 1: Soil", 1), page("p2", "Chapter 2: Pruning", 3)]), page("p3", "Appendix", 4)];

const VINE: SourceFixture = {
  title: "Notes on the Vine",
  author: "J. Example",
  format: "pdf",
  language: "English",
  segments: [
    { text: "An opening paragraph about gardens.", pageNumber: 1 },
    { text: "Abiding is the heart of fruitfulness.", pageNumber: 2 },
    { text: "Pruning is painful but good.", pageNumber: 3 },
    { text: "A closing paragraph on page four.", pageNumber: 4 },
  ],
};

const COMMENTARY: SourceFixture = {
  title: "A Synthetic Commentary",
  author: "A. Writer",
  format: "epub",
  language: "English",
  segments: [
    { text: "Intro one.", sectionPath: "Introduction" },
    { text: "Intro two.", sectionPath: "Introduction" },
    { text: "Chapter two begins.", sectionPath: "Chapter Two" },
    { text: "Chapter two, deeper.", sectionPath: "Chapter Two › Part A" },
    { text: "Chapter three begins.", sectionPath: "Chapter Three" },
  ],
  contents: [spot("n0", "Introduction", 0), spot("n1", "Chapter Two", 2, [spot("n2", "Part A", 3)]), spot("n3", "Chapter Three", 4)],
};

const LONG: SourceFixture = {
  title: "A Very Long Book",
  format: "epub",
  language: "English",
  segments: Array.from({ length: 400 }, (_, i) => ({ text: `Paragraph number ${i}.`, sectionPath: `Part ${Math.floor(i / 100) + 1}` })),
  contents: [spot("l0", "Part 1", 0), spot("l1", "Part 3", 200), spot("l2", "Part 4", 399)],
};

const PLAIN: SourceFixture = { title: "No Contents Book", format: "epub", language: "English", segments: [{ text: "Only text.", sectionPath: "One" }, { text: "More text.", sectionPath: "One" }] };

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const contentsButton = (root: HTMLElement) => within(root).queryByRole("button", { name: "Contents" });

async function study(fixtures: SourceFixture[] = [VINE, COMMENTARY, LONG, PLAIN], width = 1440) {
  const api = createMemoryApi();
  for (const f of fixtures) api.installFixtureSource(f);
  const engine = createFakePdfEngine({ pages: 4, outline: OUTLINE });
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Series" });
  const made = await api.studyCreate({ projectId: project.id, title: "The True Vine" });
  const finding = await api.findingCreate({ studyId: made.study.id, findingType: "observation", content: "A note." });
  return { api, engine, finding, width };
}

/** Cites the segment at `position` of `title` in the finding. */
async function cite(api: ReturnType<typeof createMemoryApi>, findingId: string, title: string, position: number) {
  const source = (await api.libraryList({})).find((s) => s.title === title)!;
  const found = await api.sourceGetSegments({ sourceId: source.id, offset: position, limit: 1 });
  await api.findingSourceAdd({ findingId, segmentId: found.segments[0]!.id });
}

async function openStudy(api: ReturnType<typeof createMemoryApi>, engine: ReturnType<typeof createFakePdfEngine>, width: number) {
  const { user } = await renderApp(api, { pdfEngine: engine, width });
  await user.click(within(await screen.findByRole("list", { name: "Projects" })).getByRole("button", { name: /John Series/ }));
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /The True Vine/ }));
  const findings = await screen.findByRole("list", { name: "Findings" });
  return { user, findings };
}

/** Opens `title` from the finding's citation and waits until it is on the cited paragraph. */
async function openCited(title: string, position: number, fixtures?: SourceFixture[]) {
  const { api, engine, finding, width } = await study(fixtures);
  await cite(api, finding.id, title, position);
  const { user, findings } = await openStudy(api, engine, width);
  await user.click(await within(findings).findByTitle("Open this source at the cited place"));
  const reader = await within(sourcesPane()).findByRole("region", { name: title });
  await waitFor(() => expect(reader.querySelector("[data-target]")).not.toBeNull());
  return { api, engine, user, reader, findings };
}

const scrolled: HTMLElement[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this as HTMLElement);
  };
});
afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
});

describe("Contents is there however the source was opened", () => {
  it.each([
    ["PDF", "Notes on the Vine", 2],
    ["EPUB", "A Synthetic Commentary", 3],
  ])("%s: opened from the library list and from a finding's citation", async (_kind, title, position) => {
    const { api, engine, finding, width } = await study();
    await cite(api, finding.id, title, position);
    const { user, findings } = await openStudy(api, engine, width);

    // A. From the Sources pane's own list.
    await user.click(await within(sourcesPane()).findByRole("button", { name: new RegExp(`^${title}`) }));
    const reader = await within(sourcesPane()).findByRole("region", { name: title });
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull());
    await user.click(within(reader).getByRole("button", { name: "Back to Sources" }));

    // B. From the citation in the study (opens at a segment).
    await user.click(await within(findings).findByTitle("Open this source at the cited place"));
    const cited = await within(sourcesPane()).findByRole("region", { name: title });
    await waitFor(() => expect(cited.querySelector("[data-target]")).not.toBeNull()); // opened at the cited paragraph
    await waitFor(() => expect(contentsButton(cited)).not.toBeNull());
  });
});

describe("a failed read does not hide Contents for good", () => {
  it("a PDF whose outline fails to read once still gets Contents, however it was opened", async () => {
    const { api, engine, finding, width } = await study();
    engine.outlineFailures = 1; // a transient failure on the first read only
    await cite(api, finding.id, "Notes on the Vine", 2);
    const { user, findings } = await openStudy(api, engine, width);
    await user.click(await within(findings).findByTitle("Open this source at the cited place"));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull(), { timeout: 4000 });
    expect(engine.outlineReads.length).toBeGreaterThanOrEqual(2);
  });

  it("an EPUB whose contents fail to read once still gets Contents", async () => {
    const { api, engine, finding, width } = await study();
    let failures = 1;
    const read = api.librarySourceContents;
    api.librarySourceContents = async (id) => {
      if (failures-- > 0) throw new Error("synthetic: transient");
      return read(id);
    };
    await cite(api, finding.id, "A Synthetic Commentary", 3);
    const { user, findings } = await openStudy(api, engine, width);
    await user.click(await within(findings).findByTitle("Open this source at the cited place"));
    const reader = await within(sourcesPane()).findByRole("region", { name: "A Synthetic Commentary" });
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull(), { timeout: 4000 });
  });

  it("gives up quietly (no Contents, a working reader, a logged reason) when it keeps failing", async () => {
    const { api, engine, finding, width } = await study();
    engine.failOutline = true;
    await cite(api, finding.id, "Notes on the Vine", 2);
    const { user, findings } = await openStudy(api, engine, width);
    await user.click(await within(findings).findByTitle("Open this source at the cited place"));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    await waitFor(() => expect(engine.outlineReads.length).toBe(4), { timeout: 8000 }); // first try + three retries
    expect(contentsButton(reader)).toBeNull();
    expect(reader.querySelector("[data-target]")).not.toBeNull(); // still reading the cited place
  }, 15000);
});

describe("opened at a citation, the source is still the whole source", () => {
  it("PDF: Contents jumps elsewhere in Reading and in Original, and survives switching between them", async () => {
    const { user, reader } = await openCited("Notes on the Vine", 1); // cited on page 2
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull());

    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(within(reader).getByRole("button", { name: "Chapter 2: Pruning" }));
    await waitFor(() => expect(scrolled.some((el) => el.dataset.segPage === "3")).toBe(true));
    expect(within(reader).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(reader).getByRole("button", { name: "Original" }));
    await within(reader).findByRole("toolbar", { name: "Original document controls" });
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull());
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(within(reader).getByRole("button", { name: "Appendix" }));
    expect(within(reader).getByRole("textbox", { name: "Page number" })).toHaveValue("4");

    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull());
  });

  it("EPUB: Contents jumps to a chapter from the cited paragraph", async () => {
    const { user, reader } = await openCited("A Synthetic Commentary", 1);
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull());
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(within(reader).getByRole("button", { name: "Chapter Three" }));
    await waitFor(() => expect(scrolled.at(-1)).toHaveTextContent("Chapter Three"));
  });

  it("a long book opened at a citation can still be read earlier and later, and jumped around with Contents", async () => {
    const { user, reader } = await openCited("A Very Long Book", 200);
    expect(reader.querySelector("[data-target]")).toHaveTextContent("Paragraph number 200.");
    // The window is around the citation, not locked to it.
    const earlier = within(reader).getByRole("button", { name: "Show earlier text" });
    const later = within(reader).getByRole("button", { name: "Show more text" });
    const before = reader.querySelectorAll("[data-seg-position]").length;
    await user.click(earlier);
    await waitFor(() => expect(reader.querySelectorAll("[data-seg-position]").length).toBeGreaterThan(before));
    await user.click(later);
    // And Contents reaches parts that are not in the window at all.
    await user.click(within(reader).getByRole("button", { name: "Contents" }));
    await user.click(within(reader).getByRole("button", { name: "Part 4" }));
    await waitFor(() => expect(reader.querySelector('[data-seg-position="399"]')).not.toBeNull());
    await waitFor(() => expect(scrolled.some((el) => el.dataset.segPosition === "399" || el.nextElementSibling?.getAttribute("data-seg-position") === "399")).toBe(true));
  });
});

describe("Contents belongs to the source, not to the last one opened", () => {
  it("a source with none shows none, opened either way, and does not inherit the previous source's", async () => {
    const { api, engine, finding, width } = await study();
    await cite(api, finding.id, "Notes on the Vine", 2);
    await cite(api, finding.id, "No Contents Book", 0);
    const { user, findings } = await openStudy(api, engine, width);

    // A source that has contents, then one that has none (opened from its own citation).
    const chips = await within(findings).findAllByTitle("Open this source at the cited place");
    await user.click(chips[0]!);
    const first = await within(sourcesPane()).findByRole("region", { name: /Notes on the Vine|No Contents Book/ });
    const firstTitle = first.getAttribute("aria-label")!;
    if (firstTitle === "Notes on the Vine") await waitFor(() => expect(contentsButton(first)).not.toBeNull());
    await user.click(within(first).getByRole("button", { name: "Back to Sources" }));
    await user.click(chips[1]!);
    const second = await within(sourcesPane()).findByRole("region", { name: /Notes on the Vine|No Contents Book/ });
    expect(second.getAttribute("aria-label")).not.toBe(firstTitle);
    if (second.getAttribute("aria-label") === "No Contents Book") {
      await within(second).findByText("Only text.");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(contentsButton(second)).toBeNull();
    } else {
      await waitFor(() => expect(contentsButton(second)).not.toBeNull());
    }
  });

  it("a source with no contents has none from a citation either", async () => {
    const { reader } = await openCited("No Contents Book", 0);
    await within(reader).findByText("Only text.");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(contentsButton(reader)).toBeNull();
  });
});

describe("a PDF's outline is read reliably, and failing is not the same as having none", () => {
  const SECOND: SourceFixture = { ...VINE, title: "Another Notebook", segments: VINE.segments.map((x) => ({ ...x })) };

  it("a slow read still ends in Contents", async () => {
    const { api, engine, finding, width } = await study();
    engine.outlineDelay = 700;
    await cite(api, finding.id, "Notes on the Vine", 2);
    const { user, findings } = await openStudy(api, engine, width);
    await user.click(await within(findings).findByTitle("Open this source at the cited place"));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    expect(contentsButton(reader)).toBeNull(); // not yet
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull(), { timeout: 4000 });
  });

  it("when the reader's own read keeps failing, Original's open document still supplies Contents (and it stays in Reading)", async () => {
    const { api, engine, finding, width } = await study();
    engine.failOutline = true;
    await cite(api, finding.id, "Notes on the Vine", 2);
    const { user, findings } = await openStudy(api, engine, width);
    await user.click(await within(findings).findByTitle("Open this source at the cited place"));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    expect(contentsButton(reader)).toBeNull();
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    await waitFor(() => expect(contentsButton(reader)).not.toBeNull());
    await user.click(within(reader).getByRole("button", { name: "Reading" }));
    expect(contentsButton(reader)).not.toBeNull();
  });

  it("a PDF that truly has no outline stays without Contents, in Reading and in Original", async () => {
    const { api, engine, finding, width } = await study();
    engine.outlineItems = [];
    await cite(api, finding.id, "Notes on the Vine", 2);
    const { user, findings } = await openStudy(api, engine, width);
    await user.click(await within(findings).findByTitle("Open this source at the cited place"));
    const reader = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    await waitFor(() => expect(engine.outlineReads.length).toBe(1)); // asked, and answered "none"
    await user.click(within(reader).getByRole("button", { name: "Original" }));
    await within(reader).findByRole("toolbar", { name: "Original document controls" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(contentsButton(reader)).toBeNull();
    expect(engine.outlineReads.length).toBe(1); // "none" is final: no retries
  });

  it("another PDF never inherits the previous PDF's outline", async () => {
    const { api, engine, finding, width } = await study([VINE, SECOND, PLAIN]);
    const sources = await api.libraryList({});
    const vine = sources.find((s) => s.title === "Notes on the Vine")!;
    engine.outlineItems = []; // by default a PDF has none…
    engine.outlineBySource = { [vine.id]: OUTLINE }; // …but this one does
    await cite(api, finding.id, "Notes on the Vine", 2);
    await cite(api, finding.id, "Another Notebook", 1);
    const { user, findings } = await openStudy(api, engine, width);
    const chips = await within(findings).findAllByTitle("Open this source at the cited place");
    await user.click(chips[0]!);
    const first = await within(sourcesPane()).findByRole("region", { name: /Notes on the Vine|Another Notebook/ });
    const firstHasContents = first.getAttribute("aria-label") === "Notes on the Vine";
    if (firstHasContents) await waitFor(() => expect(contentsButton(first)).not.toBeNull());
    await user.click(within(first).getByRole("button", { name: "Back to Sources" }));
    await user.click(chips[1]!);
    const second = await within(sourcesPane()).findByRole("region", { name: /Notes on the Vine|Another Notebook/ });
    expect(second.getAttribute("aria-label")).not.toBe(first.getAttribute("aria-label"));
    if (firstHasContents) {
      await waitFor(() => expect(engine.outlineReads.length).toBe(2));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(contentsButton(second)).toBeNull(); // the first one's outline did not carry over
    } else {
      await waitFor(() => expect(contentsButton(second)).not.toBeNull());
    }
  });

  it("the full reader and the pane both keep Contents across Reading and Original", async () => {
    const { api, engine, finding, width } = await study();
    await cite(api, finding.id, "Notes on the Vine", 2);
    const { user, findings } = await openStudy(api, engine, width);
    await user.click(await within(findings).findByTitle("Open this source at the cited place"));
    const pane = await within(sourcesPane()).findByRole("region", { name: "Notes on the Vine" });
    await waitFor(() => expect(contentsButton(pane)).not.toBeNull());
    await user.click(within(pane).getByRole("button", { name: "Open full reader" }));
    const full = await screen.findByRole("main");
    await waitFor(() => expect(contentsButton(full)).not.toBeNull());
    await user.click(within(full).getByRole("button", { name: "Original" }));
    await within(full).findByRole("toolbar", { name: "Original document controls" });
    expect(contentsButton(full)).not.toBeNull();
    await user.click(within(full).getByRole("button", { name: "Reading" }));
    expect(contentsButton(full)).not.toBeNull();
  });
});
