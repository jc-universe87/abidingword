import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import type { InquiryReply } from "@/types/inquiry";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Help with a library source and comparing passages (v0.20): from the words
// the person selected only, named with the source's title, author and place;
// quotations open in the source; a note keeps a real citation; a comparison
// uses only the two or three passages put aside. All text is invented.

const WRITER: SourceFixture = {
  title: "Grace and the Vine",
  author: "A. Writer",
  format: "markdown",
  language: "English",
  segments: [
    { text: "The vine gives life to the branches.", sectionPath: "Chapter 4" },
    { text: "Remaining means receiving, not striving.", sectionPath: "Chapter 4" },
    { text: "A paragraph never selected: SECRET-OTHER-PARAGRAPH.", sectionPath: "Chapter 5" },
  ],
};
const AUTHOR: SourceFixture = {
  title: "Fruit",
  author: "B. Author",
  format: "markdown",
  language: "English",
  segments: [{ text: "Fruit is the evidence of effort and discipline.", sectionPath: "Fruit" }],
};

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function setup({ assistant = true }: { assistant?: boolean } = {}) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.installFixtureSource(WRITER);
  api.installFixtureSource(AUTHOR);
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  await api.studyPassageAdd({ studyId: study.id, reference: "JHN.15.1-JHN.15.8" });
  if (assistant) {
    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, enabled: true, model: "test-model" });
    await api.assistantKeySet("provider", "sk-test");
  }
  return { api, studyId: study.id };
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const studyPane = () => screen.getByRole("main", { name: "Study" });

async function openStudy(user: User) {
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
}

async function openSource(user: User, title: string, first: RegExp) {
  const back = within(sourcesPane()).queryByRole("button", { name: "Back to Sources" });
  if (back) await user.click(back);
  await user.click(await within(sourcesPane()).findByRole("button", { name: new RegExp(title) }));
  const reader = await within(sourcesPane()).findByRole("region", { name: title });
  await within(reader).findByText(first);
  return reader;
}

const paragraph = (reader: HTMLElement, start: string) => [...reader.querySelectorAll<HTMLElement>("[data-segment-id]")].find((p) => p.textContent?.startsWith(start))!;

async function select(element: HTMLElement, words: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[data-aw-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const node = walker.nextNode()!;
  const at = node.textContent!.indexOf(words);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + words.length);
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

function reply(api: ReturnType<typeof createMemoryApi>, verdict: "disagree" | "insufficient" | null = null): InquiryReply {
  const segment = api.state.library.segments.find((s) => s.text.startsWith("Remaining means"))!;
  const quote = "receiving, not striving";
  const at = segment.text.indexOf(quote);
  const link = {
    sourceId: segment.sourceId,
    title: "Grace and the Vine",
    author: "A. Writer",
    location: "Chapter 4 · paragraph 2",
    start: { segmentId: segment.id, offset: at },
    end: { segmentId: segment.id, offset: at + quote.length },
    quote,
  };
  return {
    result: {
      type: "insight",
      summary: verdict ? "They differ on effort." : "The author says remaining is receiving.",
      points: [
        {
          kind: verdict ? "position" : "source",
          text: "Remaining is receiving.",
          about: verdict ? "S1" : null,
          aboutLabel: verdict ? "“Grace and the Vine” by A. Writer — Chapter 4 · paragraph 2" : null,
          evidence: [{ block: "S1", kind: "source", label: "“Grace and the Vine” by A. Writer — Chapter 4 · paragraph 2", quote, source: link }],
          references: [],
          downgraded: false,
        },
        { kind: verdict ? "unsupported" : "inference", text: "The author implies effort is useless.", about: null, aboutLabel: null, evidence: [], references: [], downgraded: true },
      ],
      verdict,
      unverified: 0,
      downgraded: 1,
    },
    assistant: "OpenAI · test-model",
    remote: true,
  };
}

afterEach(async () => {
  window.localStorage.clear();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("Help with a library source", () => {
  it("is not offered while the assistant is off", async () => {
    const { api } = await setup({ assistant: false });
    const { user } = await renderApp(api);
    const reader = await openSource(user, "Grace and the Vine", /The vine gives life/);
    await select(paragraph(reader, "Remaining means"), "receiving, not striving");
    const strip = await within(reader).findByRole("group", { name: "Mark the selected text" });
    expect(within(strip).queryByRole("button", { name: "Help" })).toBeNull();
  });

  it("sends only the selected words, named from the source, and shows the author's words with a way back to them", async () => {
    const { api } = await setup();
    api.state.inquiry.replies.push(reply(api));
    const { user } = await renderApp(api);
    const reader = await openSource(user, "Grace and the Vine", /The vine gives life/);
    await select(paragraph(reader, "Remaining means"), "Remaining means receiving");
    const strip = await within(reader).findByRole("group", { name: "Mark the selected text" });
    await user.click(within(strip).getByRole("button", { name: "Help" }));
    const panel = await within(reader).findByTestId("inquiry-panel");
    const preview = await within(panel).findByTestId("inquiry-preview");
    expect(within(preview).getByText("Words from your library are included.", { exact: false })).toBeInTheDocument();
    const source = within(preview).getByRole("button", { name: /Library source/ });
    expect(source).toHaveTextContent("“Grace and the Vine” by A. Writer — Chapter 4 · paragraph 2");
    expect(within(panel).getByText("No Bible Study is open, so only the selected words are used.")).toBeInTheDocument();
    const asked = api.state.inquiry.previews.at(-1)!;
    expect(asked.scope).toMatchObject({ kind: "source", excerpt: { quote: "Remaining means receiving" }, studyId: null });
    expect(JSON.stringify(asked)).not.toContain("SECRET-OTHER-PARAGRAPH");

    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    const card = (await within(panel).findAllByRole("article"))[0]!;
    expect(within(card).getByText("The author says")).toBeInTheDocument();
    expect(within(card).getByText("“receiving, not striving”")).toBeInTheDocument();
    expect(within(card).getByText(/Source: “Grace and the Vine” by A. Writer/)).toBeInTheDocument();
    // Without an open study there is nowhere to keep it, and the panel says so.
    expect(within(panel).getByText("Open a Bible Study to add notes to it.")).toBeInTheDocument();
    // The quoted words open in their source.
    await user.click(within(card).getByRole("button", { name: "Open in the source" }));
    expect(await within(sourcesPane()).findByRole("region", { name: "Grace and the Vine" })).toBeInTheDocument();
  });

  it("includes the open Bible Study only when chosen, and keeps a note citing the author's exact words", async () => {
    const { api, studyId } = await setup();
    api.state.inquiry.replies.push(reply(api));
    const { user } = await renderApp(api);
    await openStudy(user);
    const reader = await openSource(user, "Grace and the Vine", /The vine gives life/);
    await select(paragraph(reader, "Remaining means"), "Remaining means receiving");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "Help" }));
    const panel = await within(reader).findByTestId("inquiry-panel");
    await within(panel).findByTestId("inquiry-preview");
    expect(api.state.inquiry.previews.at(-1)!.scope).toMatchObject({ studyId: null });
    await user.click(within(panel).getByRole("checkbox", { name: /Also include my Bible Study “Abiding”/ }));
    await waitFor(() => expect(api.state.inquiry.previews.at(-1)!.scope).toMatchObject({ studyId }));
    await waitFor(() => expect(within(panel).getByTestId("inquiry-preview")).toHaveTextContent("Bible text"));

    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    const card = (await within(panel).findAllByRole("article"))[0]!;
    await user.click(within(card).getByRole("button", { name: "Add to Bible Study…" }));
    const form = within(card).getByRole("form", { name: "Add this point as a note" });
    expect(within(form).getByRole("combobox", { name: "Kind of note" })).toHaveDisplayValue("Quotation");
    expect(within(form).getByRole("checkbox", { name: /“receiving, not striving” — Grace and the Vine, Chapter 4 · paragraph 2/ })).toBeChecked();
    await user.click(within(form).getByRole("button", { name: "Add as note" }));
    await waitFor(() => expect(api.state.findings.some((f) => f.assistedBy === "OpenAI · test-model")).toBe(true));
    const kept = api.state.findings.find((f) => f.assistedBy)!;
    expect(kept.studyId).toBe(studyId);
    expect(kept.sources).toHaveLength(1);
    expect(kept.sources[0]).toMatchObject({ title: "Grace and the Vine", quote: "receiving, not striving" });
  });
});

describe("Comparing passages", () => {
  it("puts two passages aside, compares only those, and shows when they do not say enough", async () => {
    const { api } = await setup();
    api.state.inquiry.replies.push(reply(api, "insufficient"));
    const { user } = await renderApp(api);
    let reader = await openSource(user, "Grace and the Vine", /The vine gives life/);
    await select(paragraph(reader, "Remaining means"), "Remaining means receiving, not striving.");
    let strip = await within(reader).findByRole("group", { name: "Mark the selected text" });
    await user.click(within(strip).getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Add to comparison" }));
    const tray = await within(reader).findByRole("region", { name: "Passages to compare" });
    expect(within(tray).getByText("1 of 3 passages to compare")).toBeInTheDocument();
    expect(within(tray).getByRole("button", { name: "Compare…" })).toBeDisabled();

    reader = await openSource(user, "Fruit", /Fruit is the evidence/);
    await select(paragraph(reader, "Fruit is"), "Fruit is the evidence of effort");
    strip = await within(reader).findByRole("group", { name: "Mark the selected text" });
    await user.click(within(strip).getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Add to comparison" }));
    const tray2 = await within(reader).findByRole("region", { name: "Passages to compare" });
    expect(within(tray2).getByText("2 of 3 passages to compare")).toBeInTheDocument();
    await user.click(within(tray2).getByRole("button", { name: "Compare…" }));
    const panel = await within(reader).findByTestId("inquiry-panel");
    expect(within(panel).getByRole("heading", { name: /Compare 2 passages/ })).toBeInTheDocument();
    await within(panel).findByTestId("inquiry-preview");
    const asked = api.state.inquiry.previews.at(-1)!;
    expect(asked.scope.kind).toBe("compare");
    const quotes = asked.scope.kind === "compare" ? asked.scope.excerpts.map((e) => e.quote) : [];
    expect(quotes).toEqual(["Remaining means receiving, not striving.", "Fruit is the evidence of effort"]);
    expect(within(panel).getByTestId("inquiry-preview")).toHaveTextContent("Nothing is searched on the web.");

    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    expect(await within(panel).findByTestId("inquiry-verdict")).toHaveTextContent("The selected passages do not say enough to compare.");
    expect(within(panel).getByText("Not supported by the passages")).toBeInTheDocument();
    // Clearing the tray removes the passages; nothing was saved.
    await user.click(within(panel).getByRole("button", { name: "Done" }));
    await user.click(within(within(reader).getByRole("region", { name: "Passages to compare" })).getByRole("button", { name: "Clear" }));
    expect(within(reader).queryByRole("region", { name: "Passages to compare" })).toBeNull();
  });

  it("keeps a reviewed comparison as one note in the open study", async () => {
    const { api } = await setup();
    api.state.inquiry.replies.push(reply(api, "disagree"));
    const { user } = await renderApp(api);
    await openStudy(user);
    let reader = await openSource(user, "Grace and the Vine", /The vine gives life/);
    await select(paragraph(reader, "Remaining means"), "Remaining means receiving, not striving.");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Add to comparison" }));
    reader = await openSource(user, "Fruit", /Fruit is the evidence/);
    await select(paragraph(reader, "Fruit is"), "Fruit is the evidence of effort");
    await user.click(within(await within(reader).findByRole("group", { name: "Mark the selected text" })).getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Add to comparison" }));
    await user.click(within(await within(reader).findByRole("region", { name: "Passages to compare" })).getByRole("button", { name: "Compare…" }));
    const panel = await within(reader).findByTestId("inquiry-panel");
    await within(panel).findByTestId("inquiry-preview");
    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    await within(panel).findByTestId("inquiry-verdict");
    await user.click(within(panel).getByRole("button", { name: "Keep this comparison as a note…" }));
    const form = within(panel).getByRole("form", { name: "Keep this comparison as a note…" });
    expect(within(form).getByRole("textbox", { name: "The note" })).toHaveValue("They differ on effort.\n• Remaining is receiving.\n• The author implies effort is useless.");
    expect(within(form).getByRole("combobox", { name: "Kind of note" })).toHaveDisplayValue("Interpretation");
    await user.click(within(form).getByRole("button", { name: "Add as note" }));
    await waitFor(() => expect(api.state.findings.filter((f) => f.assistedBy)).toHaveLength(1));
  });
});
