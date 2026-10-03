import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { highlightPaint, phraseSegments } from "@/lib/annotationRender";
import { HIGHLIGHT_COLORS, type Annotation } from "@/types/scripture";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

const V1 = "Fixture alpha JHN 15:1 about the vine.";
const V2 = "Fixture alpha JHN 15:2.";

function withBible() {
  const api = createMemoryApi();
  const alpha = api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "JHN.15";
  return { api, alpha };
}

const pane = () => screen.getByRole("complementary", { name: "Scripture" });
const verseText = (verse: string) => pane().querySelector<HTMLElement>(`[data-verse-text="${verse}"]`)!;

/** The text node and offset that sit `offset` UTF-16 units into a verse's text. */
function point(verse: string, offset: number): [Node, number] {
  const walker = document.createTreeWalker(verseText(verse), NodeFilter.SHOW_TEXT);
  let left = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) return [node, left];
    left -= length;
  }
  throw new Error("offset beyond the verse");
}

/** Selects words as a user would, from one verse offset to another. */
async function select(from: [string, number], to: [string, number]) {
  const range = document.createRange();
  range.setStart(...point(...from));
  range.setEnd(...point(...to));
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** Waits until the chapter is on screen (drawn phrases split the text into parts). */
const reading = () => waitFor(() => expect(verseText("JHN.15.1")).not.toBeNull());

const toolbar = () => screen.findByRole("group", { name: "Actions for the selected words" });
const queryToolbar = () => screen.queryByRole("group", { name: "Actions for the selected words" });

const phrases = (api: MemoryApi) => api.state.annotations.filter((a) => a.anchor);

describe("selection toolbar", () => {
  it("appears for a Scripture selection and goes when it is cleared", async () => {
    const { api } = withBible();
    await renderApp(api);
    await reading();
    expect(queryToolbar()).toBeNull();

    await select(["JHN.15.1", 8], ["JHN.15.1", 13]);
    const bar = await toolbar();
    expect(within(bar).getByTestId("selection-quote")).toHaveTextContent("alpha");
    // Phrases can be noted and highlighted; a bookmark is for whole verses.
    expect(within(bar).getByRole("button", { name: "Add note" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Highlight" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Bookmark" })).toBeNull();

    await act(async () => {
      document.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    await waitFor(() => expect(queryToolbar()).toBeNull());
  });

  it("offers exactly the five approved colours, named in the interface language", async () => {
    const { api } = withBible();
    const { user } = await renderApp(api);
    await reading();
    await select(["JHN.15.1", 8], ["JHN.15.1", 13]);
    await user.click(within(await toolbar()).getByRole("button", { name: "Highlight" }));

    const picker = within(await toolbar()).getByRole("group", { name: "Highlight colour" });
    const swatches = within(picker).getAllByRole("button");
    expect(HIGHLIGHT_COLORS).toEqual(["amber", "green", "blue", "rose", "grey"]);
    expect(swatches.map((b) => b.getAttribute("data-color"))).toEqual([...HIGHLIGHT_COLORS]);
    expect(swatches.map((b) => b.getAttribute("aria-label"))).toEqual(["Amber", "Green", "Blue", "Rose", "Grey"]);
    for (const language of ["en", "de", "ko", "fr", "es", "pt"]) {
      await i18n.changeLanguage(language);
      for (const color of HIGHLIGHT_COLORS) {
        const name = i18n.t(`scripture.colors.${color}`);
        expect(name).not.toBe(`scripture.colors.${color}`);
        expect(within(picker).getByRole("button", { name }).getAttribute("data-color")).toBe(color);
      }
    }
    await i18n.changeLanguage("de");
    expect(i18n.t("scripture.colors.amber")).toBe("Bernstein");
    await i18n.changeLanguage("en");
  });

  it("saves a phrase highlight with the exact anchor, clears the selection and draws it", async () => {
    const { api, alpha } = withBible();
    const { user } = await renderApp(api);
    await reading();
    await select(["JHN.15.1", 8], ["JHN.15.1", 13]);
    await user.click(within(await toolbar()).getByRole("button", { name: "Highlight" }));
    await user.click(within(await toolbar()).getByRole("button", { name: "Amber" }));

    await waitFor(() => expect(phrases(api)).toHaveLength(1));
    const saved = phrases(api)[0]!;
    expect(saved.kind).toBe("highlight");
    expect(saved.color).toBe("amber");
    expect(saved.reference.canonical).toBe("JHN.15.1");
    expect(saved.translationId).toBe(alpha.id);
    expect(saved.anchor).toMatchObject({
      start: { verse: "JHN.15.1", offset: 8 },
      end: { verse: "JHN.15.1", offset: 13 },
      quote: "alpha",
      translationShortName: "FXA",
    });

    // The native selection is cleared and the phrase stays drawn.
    await waitFor(() => expect(queryToolbar()).toBeNull());
    expect(document.getSelection()!.isCollapsed).toBe(true);
    const drawn = await waitFor(() => {
      const mark = verseText("JHN.15.1").querySelector("mark[data-phrase-color='amber']");
      expect(mark).not.toBeNull();
      return mark!;
    });
    expect(drawn).toHaveTextContent("alpha");
    // Drawing never changes the Bible text.
    expect(verseText("JHN.15.1").textContent).toBe(V1);
  });

  it("saves a phrase note with the exact anchor and one marker for the verse", async () => {
    const { api } = withBible();
    const { user } = await renderApp(api);
    await reading();
    await select(["JHN.15.1", 14], ["JHN.15.1", 22]);
    await user.click(within(await toolbar()).getByRole("button", { name: "Add note" }));
    const bar = await toolbar();
    expect(within(bar).getByTestId("selection-quote")).toHaveTextContent("JHN 15:1");
    const save = within(bar).getByRole("button", { name: "Save note" });
    expect(save).toBeDisabled();
    await user.type(within(bar).getByLabelText("Note on the selected words"), "Abide.");
    await user.click(save);

    await waitFor(() => expect(phrases(api)).toHaveLength(1));
    const note = phrases(api)[0]!;
    expect(note).toMatchObject({ kind: "note", content: "Abide." });
    expect(note.anchor).toMatchObject({ start: { verse: "JHN.15.1", offset: 14 }, end: { verse: "JHN.15.1", offset: 22 }, quote: "JHN 15:1" });
    await waitFor(() => expect(queryToolbar()).toBeNull());
    await waitFor(() => expect(verseText("JHN.15.1").querySelector("mark[data-phrase-note]")).not.toBeNull());
    expect(pane().querySelectorAll("[data-verse-marker]")).toHaveLength(1);
  });

  it("cancelling the note keeps nothing and clears the selection", async () => {
    const { api } = withBible();
    const { user } = await renderApp(api);
    await reading();
    await select(["JHN.15.1", 8], ["JHN.15.1", 13]);
    await user.click(within(await toolbar()).getByRole("button", { name: "Add note" }));
    await user.click(within(await toolbar()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(queryToolbar()).toBeNull());
    expect(api.state.annotations).toHaveLength(0);
    expect(document.getSelection()!.isCollapsed).toBe(true);
  });

  it("can be used from the keyboard, and Escape leaves a started step", async () => {
    const { api } = withBible();
    const { user } = await renderApp(api);
    await reading();
    await select(["JHN.15.1", 8], ["JHN.15.1", 13]);
    const bar = await toolbar();
    const addNote = within(bar).getByRole("button", { name: "Add note" });
    addNote.focus();
    await user.keyboard("{Enter}");
    const field = within(await toolbar()).getByLabelText("Note on the selected words");
    expect(field).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(queryToolbar()).toBeNull());
    expect(api.state.annotations).toHaveLength(0);
  });

  it("keeps start and end offsets for a selection across a verse boundary", async () => {
    const { api } = withBible();
    const { user } = await renderApp(api);
    await reading();
    await select(["JHN.15.1", 29], ["JHN.15.2", 7]);
    const bar = await toolbar();
    expect(within(bar).getByTestId("selection-quote")).toHaveTextContent("the vine. Fixture");
    await user.click(within(bar).getByRole("button", { name: "Highlight" }));
    await user.click(within(await toolbar()).getByRole("button", { name: "Blue" }));

    await waitFor(() => expect(phrases(api)).toHaveLength(1));
    const saved = phrases(api)[0]!;
    expect(saved.reference.canonical).toBe("JHN.15.1-JHN.15.2");
    expect(saved.anchor).toMatchObject({
      start: { verse: "JHN.15.1", offset: 29 },
      end: { verse: "JHN.15.2", offset: 7 },
      quote: `${V1.slice(29)} ${V2.slice(0, 7)}`,
    });
  });

  it("measures offsets in UTF-16 units", async () => {
    const { api, alpha } = withBible();
    const chapter = api.state.text.get(alpha.id)!.get("JHN|15")!;
    chapter[2]!.text = "Fixture 🍇 grapes JHN 15:3.";
    const { user } = await renderApp(api);
    await reading();
    await select(["JHN.15.3", 11], ["JHN.15.3", 17]);
    await user.click(within(await toolbar()).getByRole("button", { name: "Highlight" }));
    await user.click(within(await toolbar()).getByRole("button", { name: "Rose" }));
    await waitFor(() => expect(phrases(api)).toHaveLength(1));
    expect(phrases(api)[0]!.anchor).toMatchObject({
      start: { verse: "JHN.15.3", offset: 11 },
      end: { verse: "JHN.15.3", offset: 17 },
      quote: "grapes",
    });
  });

  it("shows the core's coded error in the interface language", async () => {
    const { api } = withBible();
    api.annotationCreate = async () => {
      // What the native command returns for a refused phrase.
      throw { kind: "invalidInput", message: "A marked phrase must stay within one chapter.", code: "annotations.oneChapter", params: {} };
    };
    const { user } = await renderApp(api);
    await reading();
    await select(["JHN.15.1", 8], ["JHN.15.1", 13]);
    await user.click(within(await toolbar()).getByRole("button", { name: "Highlight" }));
    await user.click(within(await toolbar()).getByRole("button", { name: "Green" }));
    expect(await within(await toolbar()).findByRole("alert")).toHaveTextContent("Selected words must stay within one chapter.");
  });
});

describe("saved annotations in the reader", () => {
  async function savedPhrase(api: MemoryApi, alphaId: string, kind: "highlight" | "note" = "highlight") {
    return api.annotationCreate({
      reference: "JHN.15.1",
      kind,
      color: kind === "highlight" ? "green" : undefined,
      content: kind === "note" ? "Remember" : undefined,
      anchor: { translationId: alphaId, start: { verse: "JHN.15.1", offset: 8 }, end: { verse: "JHN.15.1", offset: 13 }, quote: "alpha" },
    });
  }

  it("draws a phrase highlight only while the wording is the same", async () => {
    const { api, alpha } = withBible();
    api.installFixtureBible("FXB", "beta");
    await savedPhrase(api, alpha.id);
    const { user } = await renderApp(api);
    await reading();
    expect(verseText("JHN.15.1").querySelector("mark[data-phrase-color='green']")).toHaveTextContent("alpha");

    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");
    await waitFor(() => expect(verseText("JHN.15.1").textContent).toBe("Fixture beta JHN 15:1 about the vine."));
    expect(verseText("JHN.15.1").querySelector("mark")).toBeNull();
    expect(api.state.annotations).toHaveLength(1);
    expect(verseText("JHN.15.1").textContent).toBe("Fixture beta JHN 15:1 about the vine.");

    // The annotation is still listed for the verse, marked as not shown in this wording.
    await user.click(within(pane()).getByRole("button", { name: /^Verse 1[.,].*Show verse tools/ }));
    const list = within(pane()).getByRole("list", { name: "Highlighted words in verse 1" });
    expect(within(list).getByText("Not shown in this wording")).toBeInTheDocument();

    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXA");
    await waitFor(() => expect(verseText("JHN.15.1").querySelector("mark[data-phrase-color='green']")).not.toBeNull());
  });

  it("does not draw a phrase whose wording changed", async () => {
    const { api, alpha } = withBible();
    await savedPhrase(api, alpha.id);
    api.state.text.get(alpha.id)!.get("JHN|15")![0]!.text = "Fixture alpha JHN 15:1 revised.";
    await renderApp(api);
    await waitFor(() => expect(verseText("JHN.15.1").textContent).toBe("Fixture alpha JHN 15:1 revised."));
    expect(pane().querySelector("mark")).toBeNull();
    expect(api.state.annotations).toHaveLength(1);
  });

  it("underlines a phrase note only where it is shown, but always lists it", async () => {
    const { api, alpha } = withBible();
    api.installFixtureBible("FXB", "beta");
    await savedPhrase(api, alpha.id, "note");
    const { user } = await renderApp(api);
    await reading();
    expect(verseText("JHN.15.1").querySelector("mark[data-phrase-note]")).toHaveTextContent("alpha");
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");
    await waitFor(() => expect(verseText("JHN.15.1").textContent).toBe("Fixture beta JHN 15:1 about the vine."));
    expect(verseText("JHN.15.1").querySelector("mark")).toBeNull();
    expect(pane().querySelectorAll("[data-verse-marker]")).toHaveLength(1);
  });

  it("keeps a whole-verse highlight in every translation and highlights nothing else", async () => {
    const { api } = withBible();
    api.installFixtureBible("FXB", "beta");
    await api.annotationCreate({ reference: "JHN.15.1", kind: "highlight", color: "blue" });
    const { user } = await renderApp(api);
    await reading();
    const verse = () => verseText("JHN.15.1").closest("[data-verse-highlight]");
    expect(verse()).toHaveAttribute("data-verse-highlight", "blue");
    expect(pane().querySelectorAll("[data-verse-highlight]")).toHaveLength(1);
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");
    await within(pane()).findByText("Fixture beta JHN 15:1 about the vine.");
    expect(verse()).toHaveAttribute("data-verse-highlight", "blue");
    // A verse highlight is not a drawn phrase.
    expect(pane().querySelector("mark")).toBeNull();
  });

  it("highlights a whole verse from the verse tools with a chosen colour", async () => {
    const { api } = withBible();
    const { user } = await renderApp(api);
    await reading();
    await user.click(within(pane()).getByRole("button", { name: /^Verse 2\. Show verse tools/ }));
    const tools = within(pane()).getByRole("region", { name: "Tools for verse 2" });
    await user.click(within(tools).getByRole("button", { name: "Highlight" }));
    const picker = within(tools).getByRole("group", { name: "Highlight colour" });
    expect(within(picker).getAllByRole("button")).toHaveLength(5);
    await user.click(within(picker).getByRole("button", { name: "Rose" }));
    await waitFor(() => expect(api.state.annotations).toHaveLength(1));
    expect(api.state.annotations[0]).toMatchObject({ kind: "highlight", color: "rose" });
    expect(api.state.annotations[0]!.anchor).toBeNull();

    // Another colour recolours the same highlight; removing deletes it.
    await user.click(within(tools).getByRole("button", { name: "Highlight" }));
    await user.click(within(within(tools).getByRole("group", { name: "Highlight colour" })).getByRole("button", { name: "Grey" }));
    await waitFor(() => expect(api.state.annotations[0]!.color).toBe("grey"));
    expect(api.state.annotations).toHaveLength(1);
    await user.click(within(tools).getByRole("button", { name: "Highlight" }));
    await user.click(within(tools).getByRole("button", { name: "Remove highlight" }));
    await waitFor(() => expect(api.state.annotations).toHaveLength(0));
  });

  it("bookmarks a whole verse with one marker and no colour", async () => {
    const { api } = withBible();
    const { user } = await renderApp(api);
    await reading();
    await user.click(within(pane()).getByRole("button", { name: /^Verse 2\. Show verse tools/ }));
    await user.click(within(within(pane()).getByRole("region", { name: "Tools for verse 2" })).getByRole("button", { name: "Bookmark" }));
    await waitFor(() => expect(api.state.annotations).toHaveLength(1));
    expect(api.state.annotations[0]).toMatchObject({ kind: "bookmark", color: null, anchor: null });
    await waitFor(() => expect(pane().querySelectorAll("[data-verse-marker]")).toHaveLength(1));
  });

  it("shows one marker per annotated verse however many annotations it has", async () => {
    const { api, alpha } = withBible();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "one" });
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "two" });
    await api.annotationCreate({ reference: "JHN.15.1", kind: "bookmark" });
    await savedPhrase(api, alpha.id, "note");
    await api.annotationCreate({ reference: "JHN.15.2", kind: "bookmark" });
    await renderApp(api);
    await reading();
    expect(pane().querySelectorAll("[data-verse-marker]")).toHaveLength(2);
    expect(verseText("JHN.15.1").closest("p")!.querySelectorAll("[data-verse-marker]")).toHaveLength(1);
  });
});

describe("what is drawn where highlights meet", () => {
  const ann = (id: string, color: Annotation["color"], start: number, end: number): Annotation =>
    ({
      id,
      kind: "highlight",
      color,
      anchor: { start: { verse: "JHN.15.1", offset: start }, end: { verse: "JHN.15.1", offset: end }, quote: "", translationShortName: "X", shown: true },
    }) as unknown as Annotation;

  it("cuts non-overlapping phrases into separate coloured stretches", () => {
    const segments = phraseSegments("JHN.15.1", 20, [ann("a", "amber", 2, 5), ann("b", "blue", 10, 12)]);
    expect(segments.map((s) => [s.start, s.end, s.colors])).toEqual([
      [0, 2, []],
      [2, 5, ["amber"]],
      [5, 10, []],
      [10, 12, ["blue"]],
      [12, 20, []],
    ]);
    expect(highlightPaint(["amber"])).toBe("amber");
  });

  it("paints what the core's split leaves: blue | rose | blue", () => {
    const segments = phraseSegments("JHN.15.1", 30, [ann("l", "blue", 0, 10), ann("m", "rose", 10, 20), ann("r", "blue", 20, 30)]);
    expect(segments.map((s) => highlightPaint(s.colors))).toEqual(["blue", "rose", "blue"]);
  });

  it("paints a colour once where the same colour overlaps itself", () => {
    const segments = phraseSegments("JHN.15.1", 20, [ann("a", "blue", 0, 12), ann("b", "blue", 8, 20)]);
    expect(segments.map((s) => highlightPaint(s.colors))).toEqual(["blue", "blue", "blue"]);
  });

  it("paints nothing, and does not fail, for older data where colours still overlap", () => {
    const segments = phraseSegments("JHN.15.1", 20, [ann("a", "blue", 0, 12), ann("b", "rose", 8, 20)]);
    expect(segments.map((s) => [s.start, s.end, highlightPaint(s.colors)])).toEqual([
      [0, 8, "blue"],
      [8, 12, null],
      [12, 20, "rose"],
    ]);
  });

  it("draws the stretches the core saved, in the reader", async () => {
    const { api, alpha } = withBible();
    const at = (start: number, end: number, color: "blue" | "rose") =>
      api.annotationCreate({
        reference: "JHN.15.1",
        kind: "highlight",
        color,
        anchor: { translationId: alpha.id, start: { verse: "JHN.15.1", offset: start }, end: { verse: "JHN.15.1", offset: end }, quote: V1.slice(start, end) },
      });
    await at(0, 8, "blue");
    await at(8, 13, "rose");
    await at(13, 22, "blue");
    await renderApp(api);
    await reading();
    const marks = [...verseText("JHN.15.1").querySelectorAll("mark[data-phrase-color]")];
    expect(marks.map((m) => [m.getAttribute("data-phrase-color"), m.textContent])).toEqual([
      ["blue", "Fixture "],
      ["rose", "alpha"],
      ["blue", " JHN 15:1"],
    ]);
    expect(verseText("JHN.15.1").textContent).toBe(V1);
  });
});
