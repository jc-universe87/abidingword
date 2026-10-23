import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ApiError } from "@/lib/api";
import type { InquiryReply } from "@/types/inquiry";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Help in a Bible Study (v0.20): a small Help action in each part, only when
// the assistant is on; a temporary panel that shows exactly what would be
// sent; help kept apart from the person's writing, with what each point rests
// on; wording changed and notes added only by an explicit choice. All text is
// invented.

type User = Awaited<ReturnType<typeof renderApp>>["user"];

const WRITING = "Remaining is about effort. We must try harder.";

async function setup({ assistant = true }: { assistant?: boolean } = {}) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study, sections } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  await api.studyPassageAdd({ studyId: study.id, reference: "JHN.15.1-JHN.15.8" });
  const part = sections[0]!;
  api.state.blocks.find((b) => b.sectionId === part.id)!.content = WRITING;
  const note = await api.findingCreate({ studyId: study.id, sectionId: part.id, findingType: "question", content: "Does remaining depend on me?" });
  if (assistant) {
    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, enabled: true, model: "test-model" });
    await api.assistantKeySet("provider", "sk-test");
  }
  return { api, studyId: study.id, partId: part.id, noteId: note.id };
}

const studyPane = () => screen.getByRole("main", { name: "Study" });

async function openStudy(user: User) {
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
  return (await screen.findByDisplayValue(WRITING)).closest("section") as HTMLElement;
}

async function openHelp(user: User, part: HTMLElement) {
  await user.click(within(part).getByRole("button", { name: /^Help with/ }));
  return within(part).findByTestId("inquiry-panel");
}

/** Waits for the debounced preview (and saves). */
async function settle(ms = 300) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function insight(over: Partial<Extract<InquiryReply["result"], { type: "insight" }>> = {}): InquiryReply {
  return {
    result: {
      type: "insight",
      summary: "The text speaks of remaining, not effort.",
      points: [
        {
          kind: "text",
          text: "The passage ties fruit to remaining.",
          about: null,
          aboutLabel: null,
          evidence: [{ block: "P1", kind: "scripture", label: "John 15:1–8 (FXA)", quote: "fifteen four about remaining", source: null }],
          references: [],
          downgraded: false,
        },
        { kind: "inference", text: "Your writing may rest on effort.", about: null, aboutLabel: null, evidence: [], references: [], downgraded: true },
        { kind: "knowledge", text: "Vines were pruned in winter.", about: null, aboutLabel: null, evidence: [], references: [{ canonical: "ISA.5.1-ISA.5.7", book: "ISA", startChapter: 5, startVerse: 1, endChapter: 5, endVerse: 7, display: "Isaiah 5:1–7" }], downgraded: false },
      ],
      verdict: null,
      unverified: 1,
      downgraded: 1,
      ...over,
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

describe("Help in a Bible Study", () => {
  it("is not there while the assistant is off: the study stays content first", async () => {
    const { api } = await setup({ assistant: false });
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    expect(within(part).queryByRole("button", { name: /^Help with/ })).toBeNull();
    expect(screen.queryByTestId("inquiry-panel")).toBeNull();
    expect(api.state.inquiry.previews).toEqual([]);
  });

  it("shows exactly what would be sent, and sends nothing until asked", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const panel = await openHelp(user, part);
    expect(within(panel).getByRole("heading", { name: /Help with/ })).toHaveFocus();
    expect(within(panel).getByText(/Nothing in your Bible Study changes unless you accept it/)).toBeInTheDocument();
    const preview = await within(panel).findByTestId("inquiry-preview");
    expect(within(preview).getByText(/outside this computer/)).toBeInTheDocument();
    expect(within(preview).getByText(/OpenAI · test-model/)).toBeInTheDocument();
    expect(within(preview).getByText("Nothing is searched on the web.", { exact: false })).toBeInTheDocument();
    // Each piece can be opened and read word for word.
    const writing = within(preview).getByRole("button", { name: /Your writing/ });
    expect(writing).toHaveAttribute("aria-expanded", "false");
    await user.click(writing);
    expect(writing).toHaveAttribute("aria-expanded", "true");
    expect(within(preview).getAllByText(WRITING)[0]).toBeVisible();
    expect(within(preview).getByRole("button", { name: /Bible text/ })).toBeInTheDocument();
    expect(api.state.inquiry.asked).toEqual([]);
  });

  it("shows each point with its standing and what it rests on, apart from the writing", async () => {
    const { api } = await setup();
    api.state.inquiry.replies.push(insight());
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const panel = await openHelp(user, part);
    await within(panel).findByTestId("inquiry-preview");
    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    const heading = await within(panel).findByRole("heading", { name: "Help" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(within(panel).getByText("The text speaks of remaining, not effort.")).toBeInTheDocument();
    const cards = within(panel).getAllByRole("article");
    expect(within(cards[0]!).getByText("In the Bible text")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("“fifteen four about remaining”")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Bible text: John 15:1–8 (FXA)")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("The assistant’s reasoning")).toBeInTheDocument();
    expect(within(cards[1]!).getByText(/words it relied on were not in what was sent/)).toBeInTheDocument();
    expect(within(cards[2]!).getByText("Background knowledge — please check")).toBeInTheDocument();
    expect(within(cards[2]!).getByRole("button", { name: "Isaiah 5:1–7" })).toBeInTheDocument();
    expect(within(panel).getByTestId("inquiry-checked")).toHaveTextContent("1 quotation in the answer was not found in what was sent");
    expect(within(panel).getByText("From OpenAI · test-model · not saved")).toBeInTheDocument();
    // The writing is untouched.
    expect(screen.getByDisplayValue(WRITING)).toBeInTheDocument();
    expect(api.state.blocks.find((b) => b.content === WRITING)).toBeDefined();
    // Escape closes the panel and returns to Help.
    fireEvent.keyDown(heading, { key: "Escape" });
    await waitFor(() => expect(within(part).queryByTestId("inquiry-panel")).toBeNull());
    await waitFor(() => expect(within(part).getByRole("button", { name: /^Help with/ })).toHaveFocus());
  });

  it("changes wording only when the person uses it, and never over words changed since", async () => {
    const { api } = await setup();
    const suggestion = "Remaining is not about effort; it is about staying.";
    api.state.inquiry.replies.push({ result: { type: "proposal", original: WRITING, suggestion, changes: "Clearer contrast." }, assistant: "OpenAI · test-model", remote: true });
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    // Work in the writing first: Help then looks at it.
    await user.click(screen.getByDisplayValue(WRITING));
    const panel = await openHelp(user, part);
    expect(within(panel).getByRole("combobox", { name: "Look at" })).toHaveDisplayValue(/Your writing: “Remaining is about effort/);
    await user.selectOptions(within(panel).getByRole("combobox", { name: "What kind of help?" }), "clarify");
    await within(panel).findByTestId("inquiry-preview");
    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    const diff = await within(panel).findByTestId("inquiry-diff");
    expect(diff.querySelector("ins")).not.toBeNull();
    expect(within(panel).getByText("Your text has not been changed.")).toBeInTheDocument();
    expect(screen.getByDisplayValue(WRITING)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Use this wording" }));
    expect(await screen.findByDisplayValue(suggestion)).toBeInTheDocument();
    await settle(900);
    expect(api.state.blocks.some((b) => b.content === suggestion)).toBe(true);
  });

  it("does not replace words the person changed after asking", async () => {
    const { api } = await setup();
    api.state.inquiry.replies.push({ result: { type: "proposal", original: WRITING, suggestion: "Something else.", changes: "" }, assistant: "OpenAI · test-model", remote: true });
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const area = screen.getByDisplayValue(WRITING);
    await user.click(area);
    const panel = await openHelp(user, part);
    await user.selectOptions(within(panel).getByRole("combobox", { name: "What kind of help?" }), "grammar");
    await within(panel).findByTestId("inquiry-preview");
    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    await within(panel).findByTestId("inquiry-diff");
    fireEvent.change(area, { target: { value: "I rewrote this myself." } });
    await user.click(within(panel).getByRole("button", { name: "Use this wording" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Your text has changed since you asked");
    expect(screen.getByDisplayValue("I rewrote this myself.")).toBeInTheDocument();
  });

  it("looks at the selected words when some are selected", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const area = screen.getByDisplayValue(WRITING) as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(WRITING.indexOf("try harder"), WRITING.indexOf("try harder") + "try harder".length);
    const panel = await openHelp(user, part);
    expect(within(panel).getByRole("combobox", { name: "Look at" })).toHaveDisplayValue("The words you selected: “try harder”");
    expect(within(panel).getByRole("combobox", { name: "What kind of help?" })).toHaveDisplayValue("What do the selected words mean here?");
    await within(panel).findByTestId("inquiry-preview");
    const asked = api.state.inquiry.previews.at(-1)!;
    expect(asked.scope).toMatchObject({ kind: "study", selected: "try harder", text: WRITING });
  });

  it("thinks through a recorded question with that note in focus", async () => {
    const { api, noteId } = await setup();
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const panel = await openHelp(user, part);
    const focus = within(panel).getByRole("combobox", { name: "Look at" });
    await user.selectOptions(focus, `note:${noteId}`);
    const kind = await within(screen.getByTestId("inquiry-panel")).findByRole("combobox", { name: "What kind of help?" });
    expect(kind).toHaveDisplayValue("Think through my open question");
    await waitFor(() => expect(api.state.inquiry.previews.at(-1)!.scope).toMatchObject({ findingId: noteId }));
  });

  it("keeps a point as a note only in the words the person accepts, marked with who helped", async () => {
    const { api, studyId, partId } = await setup();
    api.state.inquiry.replies.push(insight());
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const panel = await openHelp(user, part);
    await within(panel).findByTestId("inquiry-preview");
    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    const card = (await within(panel).findAllByRole("article"))[0]!;
    const before = api.state.findings.length;
    await user.click(within(card).getByRole("button", { name: "Add to Bible Study…" }));
    const form = within(card).getByRole("form", { name: "Add this point as a note" });
    const wording = within(form).getByRole("textbox", { name: "The note" });
    expect(wording).toHaveValue("The passage ties fruit to remaining.");
    expect(api.state.findings.length).toBe(before);
    await user.clear(wording);
    await user.type(wording, "Fruit comes from remaining (my words).");
    expect(within(form).getByRole("combobox", { name: "Kind of note" })).toHaveDisplayValue("Observation");
    await user.click(within(form).getByRole("button", { name: "Add as note" }));
    await waitFor(() => expect(api.state.findings.length).toBe(before + 1));
    const kept = api.state.findings.at(-1)!;
    expect(kept).toMatchObject({ studyId, sectionId: partId, content: "Fruit comes from remaining (my words).", findingType: "observation", assistedBy: "OpenAI · test-model" });
    expect(await screen.findByTestId("assisted-by")).toHaveTextContent("Written with help from OpenAI · test-model");
  });

  it("asks again after looking when what would be sent changed meanwhile", async () => {
    const { api, noteId } = await setup();
    api.state.inquiry.replies.push(insight());
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const panel = await openHelp(user, part);
    await within(panel).findByTestId("inquiry-preview");
    // Another window changes a note of this part after the preview.
    api.state.findings.find((f) => f.id === noteId)!.content = "Changed elsewhere.";
    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("What would be sent has changed since you looked");
    expect(api.state.inquiry.asked).toEqual([]);
    await waitFor(() => expect(within(panel).getByTestId("inquiry-preview")).toHaveTextContent("Your note"));
  });

  it("stops waiting without changing anything, and ignores a late answer", async () => {
    const { api } = await setup();
    let release: () => void = () => undefined;
    api.state.inquiry.hold = new Promise<void>((r) => (release = r));
    api.state.inquiry.replies.push(insight());
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const panel = await openHelp(user, part);
    await within(panel).findByTestId("inquiry-preview");
    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    expect(await within(panel).findByTestId("pending")).toHaveTextContent("Waiting for the answer");
    await user.click(within(panel).getByRole("button", { name: "Stop waiting" }));
    await act(async () => release());
    await settle();
    expect(within(panel).queryByRole("article")).toBeNull();
    expect(within(panel).getByText("Stopped waiting. Nothing was changed.")).toBeInTheDocument();
  });

  it("says plainly when the help cannot be given", async () => {
    const { api } = await setup();
    api.state.inquiry.replies.push(new ApiError("assistant", "The assistant's answer could not be used. Nothing was changed. Please try again.", "assistant.badReply"));
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    const panel = await openHelp(user, part);
    await within(panel).findByTestId("inquiry-preview");
    await user.click(within(panel).getByRole("button", { name: "Ask" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("could not be used. Nothing was changed.");
  });
});

describe("Help in other languages", () => {
  it("speaks German (du) and Korean in the panel", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const part = await openStudy(user);
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    await user.click(within(part).getByRole("button", { name: /^Hilfe zu/ }));
    const panel = await within(part).findByTestId("inquiry-panel");
    expect(within(panel).getByText(/In deinem Bibelstudium ändert sich nichts, solange du es nicht übernimmst/)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Fragen" })).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage("ko");
    });
    expect(await within(panel).findByText(/성경공부에서 아무것도 바뀌지 않습니다/)).toBeInTheDocument();
  });
});

export type { MemoryApi };
