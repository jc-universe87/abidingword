import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { describeMorph } from "@/features/scripture/morphology";
import type { MorphDescribed, WordReport } from "@/types/scripture";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Original-language research (v0.21): lemma search, word details and the Word
// Study, from a Bible's own word annotations. CONSTRUCTED TEST TEXT, not Bible
// text: invented verses of real Hebrew words, with annotations written for the
// test (codes follow the OSHB documentation's examples).

const QAL_PERFECT: MorphDescribed = {
  scheme: "oshb",
  language: "hebrew",
  segments: [{ partOfSpeech: "verb", features: [{ field: "stem", value: "qal" }, { field: "conjugation", value: "perfect" }, { field: "person", value: "third" }, { field: "gender", value: "masculine" }, { field: "number", value: "singular" }] }],
};
const NOUN_PLURAL: MorphDescribed = {
  scheme: "oshb",
  language: "hebrew",
  segments: [{ partOfSpeech: "noun", features: [{ field: "nounType", value: "common" }, { field: "gender", value: "masculine" }, { field: "number", value: "plural" }, { field: "state", value: "absolute" }] }],
};

const V1 = "בָּרָא אֱלֹהִים אוֹר";
const V2 = "וַיִּבְרָא אֱלֹהִים";
const V3 = "בָּרָא מַיִם";

function withBibles() {
  const api = createMemoryApi();
  const plain = api.installFixtureBible("PLN", "plain");
  const tagged = api.installFixtureBible("TAG", "tagged");
  api.state.settings.scriptureTranslationId = tagged.id;
  api.state.settings.scripturePassage = "GEN.1";
  api.setVerseText(tagged.id, "GEN.1.1", V1);
  api.setVerseText(tagged.id, "GEN.1.2", V2);
  api.setVerseText(tagged.id, "GEN.1.3", V3);
  api.setVerseText(plain.id, "GEN.1.1", "Plain words only.");
  api.installFixtureWords(tagged.id, "GEN.1.1", [
    { surface: "בָּרָא", lemma: "בָּרָא", strong: "H1254a", morph: "HVqp3ms", described: QAL_PERFECT },
    { surface: "אֱלֹהִים", lemma: "אֱלֹהִים", strong: "H430", morph: "HNcmpa", described: NOUN_PLURAL },
  ], "oshb");
  api.installFixtureWords(tagged.id, "GEN.1.2", [
    { surface: "וַיִּבְרָא", lemma: "בָּרָא", strong: "H1254a", morph: "HC/Vqw3ms" },
    { surface: "אֱלֹהִים", lemma: "אֱלֹהִים", strong: "H430", morph: "HNcmpa", described: NOUN_PLURAL },
  ], "oshb");
  // A homograph: the same lemma with another lexical number.
  api.installFixtureWords(tagged.id, "GEN.1.3", [{ surface: "בָּרָא", lemma: "בָּרָא", strong: "H1254b", morph: "HVqp3ms", described: QAL_PERFECT }], "oshb");
  return { api, plain, tagged };
}

const pane = () => screen.getByRole("complementary", { name: "Scripture" });
type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function concordance(user: User) {
  await within(pane()).findByRole("heading", { level: 2 });
  await user.click(within(pane()).getByRole("button", { name: "Concordance" }));
  return within(pane());
}

const verseText = (verse: string) => pane().querySelector<HTMLElement>(`[data-verse-text="${verse}"]`)!;
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
async function select(verse: string, from: number, to: number) {
  const range = document.createRange();
  range.setStart(...point(verse, from));
  range.setEnd(...point(verse, to));
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}
const toolbar = () => screen.findByRole("group", { name: "Actions for the selected words" });

describe("Lemma search", () => {
  it("is offered only for a Bible with word annotations", async () => {
    const { api, plain } = withBibles();
    const { user } = await renderApp(api);
    const view = await concordance(user);
    expect(view.getByRole("radio", { name: "Lemma" })).toBeInTheDocument();
    await user.selectOptions(view.getByRole("combobox", { name: "Bible" }), plain.shortName);
    expect(view.queryByRole("radio", { name: "Lemma" })).toBeNull();
    expect(view.getByRole("radio", { name: "Word" })).toBeChecked();
  });

  it("keeps homographs apart, counts one entry and highlights exactly its words", async () => {
    const { api } = withBibles();
    const { user } = await renderApp(api);
    const view = await concordance(user);
    await user.click(view.getByRole("radio", { name: "Lemma" }));
    await user.type(view.getByLabelText("Lemma or lexical number"), "ברא");
    await user.click(view.getByRole("button", { name: "Find" }));
    const entries = await view.findByRole("region", { name: "Entries for “ברא”" });
    const choices = within(entries).getAllByRole("button");
    expect(choices.map((c) => c.textContent)).toEqual([
      "בָּרָא · H1254a2 times · בָּרָא, וַיִּבְרָא",
      "בָּרָא · H1254b1 time · בָּרָא",
    ]);
    await user.click(choices[0]!);
    await waitFor(() => expect(view.getAllByRole("status").at(-1)).toHaveTextContent("2 occurrences · in 2 verses"));
    const verse = view.getByRole("button", { name: "Open Genesis 1:2 in the Bible" });
    expect([...verse.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["וַיִּבְרָא"]);
    expect(verse.querySelector("[dir=rtl]")).not.toBeNull();
    // Each written form isolated for direction, with its count after it.
    const forms = view.getByText("Written forms:", { exact: false }).closest("p")!;
    expect(forms.textContent).toBe("Written forms: בָּרָא (1), וַיִּבְרָא (1)");
    expect(forms.querySelectorAll("bdi")).toHaveLength(2);
  });

  it("describes OSHB codes in words, keeps the code, and narrows by it", async () => {
    const { api } = withBibles();
    const { user } = await renderApp(api);
    const view = await concordance(user);
    await user.click(view.getByRole("radio", { name: "Lemma" }));
    await user.type(view.getByLabelText("Lemma or lexical number"), "H1254a");
    await user.click(view.getByRole("button", { name: "Find" }));
    await waitFor(() => expect(view.getAllByRole("status").at(-1)).toHaveTextContent("2 occurrences"));
    await user.click(view.getByRole("button", { name: "Grammar" }));
    const described = view.getByRole("checkbox", { name: /verb · qal · perfect · 3rd person · masculine · singular/ });
    expect(described.closest("label")).toHaveTextContent("HVqp3ms");
    // A code with no description given is shown as written.
    expect(view.getByRole("checkbox", { name: /HC\/Vqw3ms/ })).toBeInTheDocument();
    await user.click(described);
    await waitFor(() => expect(view.getAllByRole("status").at(-1)).toHaveTextContent("1 occurrence · in 1 verse"));
    expect(view.queryByRole("button", { name: "Open Genesis 1:2 in the Bible" })).toBeNull();
    await user.click(view.getByRole("button", { name: "Show all forms" }));
    await waitFor(() => expect(view.getAllByRole("status").at(-1)).toHaveTextContent("2 occurrences"));
  });

  it("shows codes of an undescribed scheme as written and says so", async () => {
    const api = createMemoryApi();
    const greek = api.installFixtureBible("GRK", "greek");
    api.state.settings.scripturePassage = "JHN.1";
    api.setVerseText(greek.id, "JHN.1.1", "ὁ λόγος ἦν");
    api.installFixtureWords(greek.id, "JHN.1.1", [{ surface: "λόγος", lemma: "λόγος", strong: "G3056", morph: "Gr,N,,,,,NMS," }], "raw");
    const { user } = await renderApp(api);
    const view = await concordance(user);
    await user.click(view.getByRole("radio", { name: "Lemma" }));
    await user.type(view.getByLabelText("Lemma or lexical number"), "λογος");
    await user.click(view.getByRole("button", { name: "Find" }));
    await waitFor(() => expect(view.getAllByRole("status").at(-1)).toHaveTextContent("1 occurrence"));
    await user.click(view.getByRole("button", { name: "Grammar" }));
    expect(view.getByText(/Abiding Word does not describe this scheme in words/)).toBeInTheDocument();
    expect(view.getByRole("checkbox", { name: "Gr,N,,,,,NMS, (1)" })).toBeInTheDocument();
  });

  it("says when nothing in the annotations matches", async () => {
    const { api } = withBibles();
    const { user } = await renderApp(api);
    const view = await concordance(user);
    await user.click(view.getByRole("radio", { name: "Lemma" }));
    await user.type(view.getByLabelText("Lemma or lexical number"), "G9999");
    await user.click(view.getByRole("button", { name: "Find" }));
    expect(await view.findByText("“G9999” is not a lemma or lexical number in this Bible’s annotations.")).toBeInTheDocument();
  });
});

describe("Word details in the reader", () => {
  it("are offered only for annotated words, and show the Bible's own lemma and grammar", async () => {
    const { api } = withBibles();
    const { user } = await renderApp(api);
    await waitFor(() => expect(verseText("GEN.1.1")).not.toBeNull());
    // אוֹר carries no annotation: only the usual actions.
    await select("GEN.1.1", V1.indexOf("אוֹר"), V1.length);
    let bar = await toolbar();
    expect(within(bar).queryByRole("button", { name: "Word details" })).toBeNull();

    await select("GEN.1.1", 0, 3);
    bar = await toolbar();
    await user.click(await within(bar).findByRole("button", { name: "Word details" }));
    expect(within(bar).getByText("From this Bible’s own word annotations. Nothing is looked up elsewhere.")).toBeInTheDocument();
    expect(within(bar).getByText(/verb · qal · perfect/)).toBeInTheDocument();
    expect(within(bar).getByText("HVqp3ms")).toBeInTheDocument();
    expect(within(bar).getByText("This entry occurs 2 times in this Bible.")).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Find this lemma" }));
    const view = within(pane());
    await waitFor(() => expect(view.getAllByRole("status").at(-1)).toHaveTextContent("2 occurrences · in 2 verses"));
    expect(view.getByRole("radio", { name: "Lemma" })).toBeChecked();
  });

  it("puts the word into the open Word Study, asking before replacing its word", async () => {
    const { api, tagged } = withBibles();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Words" });
    const study = await api.studyCreate({ projectId: project.id, title: "Creating", studyType: "word" });
    await api.studyUpdate({ id: study.study.id, details: { lemma: "עשה" } });
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /Creating/ }));
    await waitFor(() => expect(verseText("GEN.1.1")).not.toBeNull());
    await select("GEN.1.1", 0, 3);
    const bar = await toolbar();
    await user.click(await within(bar).findByRole("button", { name: "Word details" }));
    await user.click(within(bar).getByRole("button", { name: "Study this word" }));
    expect(await within(bar).findByText("“Creating” studies “עשה”. Study “בָּרָא · H1254a” instead?")).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Replace" }));
    expect(await within(bar).findByText("Added to “Creating”.")).toBeInTheDocument();
    const saved = api.state.studies.find((s) => s.id === study.study.id)!;
    expect(saved.details).toMatchObject({ lemma: "בָּרָא", lexicalId: "H1254a", translationId: tagged.id });
  });

  it("without an open Word Study, says how to use the word", async () => {
    const { api } = withBibles();
    const { user } = await renderApp(api);
    await waitFor(() => expect(verseText("GEN.1.1")).not.toBeNull());
    await select("GEN.1.1", 0, 3);
    const bar = await toolbar();
    await user.click(await within(bar).findByRole("button", { name: "Word details" }));
    await user.click(within(bar).getByRole("button", { name: "Study this word" }));
    expect(await within(bar).findByText("Open a Word Study to use this word in it.")).toBeInTheDocument();
  });
});

describe("A Word Study's lemma", () => {
  it("is looked up by lexical number in the chosen Bible, and an untagged Bible says it cannot", async () => {
    const { api, plain, tagged } = withBibles();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Words" });
    const study = await api.studyCreate({ projectId: project.id, title: "Create", studyType: "word" });
    await api.studyUpdate({ id: study.study.id, details: { lemma: "בָּרָא", lexicalId: "H1254b", translationId: tagged.id } });
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /Create/ }));
    await user.click(await screen.findByRole("button", { name: "Bible Study information" }));
    expect(screen.getByRole("textbox", { name: "Lexical number" })).toHaveValue("H1254b");
    await user.click(screen.getByRole("button", { name: "Find this lemma" }));
    const view = within(pane());
    await waitFor(() => expect(view.getAllByRole("status").at(-1)).toHaveTextContent("1 occurrence · in 1 verse"));
    expect(view.getByText("Lexical number H1254b")).toBeInTheDocument();

    const studyBible = screen.getAllByRole("combobox", { name: "Bible" }).find((el) => !pane().contains(el))!;
    await user.selectOptions(studyBible, plain.shortName);
    expect(screen.queryByRole("button", { name: "Find this lemma" })).toBeNull();
    expect(screen.getByText("The chosen Bible has no word annotations, so lemma search is not available for it.")).toBeInTheDocument();
  });

  it("stays quiet when no Bible has word annotations", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("PLN", "plain");
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Words" });
    await api.studyCreate({ projectId: project.id, title: "Grace", studyType: "word" });
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /Grace/ }));
    await user.click(await screen.findByRole("button", { name: "Bible Study information" }));
    expect(screen.queryByRole("textbox", { name: "Lexical number" })).toBeNull();
    expect(screen.queryByText(/lemma search is not available/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Find this lemma" })).toBeNull();
  });
});

const report = (over: Partial<WordReport>): WordReport => ({
  marked: 0, words: 0, verses: 0, withLemma: 0, withLexicalId: 0, withMorphology: 0, distinctLemmas: 0, phrases: 0, parts: 0,
  morphAttribute: null, morphScheme: "none", otherAttributes: [],
  leftOut: { syntax: 0, conflict: 0, tooLong: 0, unbalanced: 0, overlapping: 0, outsideVerse: 0, empty: 0, tooMany: 0 },
  indexed: false, notIndexed: null, ...over,
});

describe("The import preview", () => {
  async function previewWith(words: WordReport | null) {
    const api = createMemoryApi();
    api.state.nextChosenFiles = ["/home/me/tagged.zip"];
    api.state.nextPreviewWords = words;
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    await user.click(await screen.findByRole("button", { name: "Choose Bible files…" }));
    await screen.findByRole("heading", { level: 1, name: "New Bible" });
  }

  it("summarises the word annotations it will add", async () => {
    await previewWith(report({
      marked: 1203, words: 1200, verses: 300, withLemma: 1200, withLexicalId: 1180, withMorphology: 1190, distinctLemmas: 410,
      morphScheme: "oshb", indexed: true, leftOut: { syntax: 2, conflict: 1, tooLong: 0, unbalanced: 0, overlapping: 0, outsideVerse: 5, empty: 0, tooMany: 0 },
    }));
    expect(screen.getByText("Word annotations: 1,200 words in 300 verses.")).toBeInTheDocument();
    expect(screen.getByText("With a lemma: 1,200 · with lexical numbers: 1,180 · with a grammar code: 1,190 · different lemmas: 410")).toBeInTheDocument();
    expect(screen.getByText(/Open Scriptures Hebrew Bible scheme/)).toBeInTheDocument();
    expect(screen.getByText("3 annotated words could not be read and are left out.")).toBeInTheDocument();
  });

  it("says why annotations are not added, and is silent for an untagged Bible", async () => {
    await previewWith(report({ marked: 500, words: 500, withLexicalId: 500, notIndexed: "strongOnly" }));
    expect(screen.getByText(/500 words carry lexical numbers only/)).toBeInTheDocument();
  });

  it("is silent for a Bible without word markup", async () => {
    await previewWith(null);
    expect(screen.queryByText(/Word annotations/)).toBeNull();
    expect(screen.queryByText(/lexical numbers/)).toBeNull();
  });
});

describe("Grammar in each language", () => {
  it("describes a code with each language's grammatical terms", async () => {
    const words = (lang: string) => describeMorph(i18n.getFixedT(lang), QAL_PERFECT);
    expect(words("en")).toBe("verb · qal · perfect · 3rd person · masculine · singular");
    expect(words("de")).toBe("Verb · qal · Perfekt · 3. Person · maskulin · Singular");
    expect(words("ko")).toBe("동사 · qal · 완료 · 3인칭 · 남성 · 단수");
    expect(words("fr")).toBe("verbe · qal · parfait · 3e personne · masculin · singulier");
  });
});
