import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ApiError } from "@/lib/api";
import type { AssistReply } from "@/types/teaching";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Teaching Preparation (v0.16): written by the person; the assistant only
// suggests, and nothing changes without an explicit choice. All text is invented.

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function setup({ assistant = false }: { assistant?: boolean } = {}) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  await api.studyPassageAdd({ studyId: study.id, reference: "JHN.15.1-JHN.15.8" });
  const finding = await api.findingCreate({ studyId: study.id, findingType: "observation", content: "Branches do not strain; they stay." });
  if (assistant) {
    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, enabled: true, model: "test-model" });
    await api.assistantKeySet("provider", "sk-test");
  }
  return { api, studyId: study.id, findingId: finding.id };
}

const studyPane = () => screen.getByRole("main", { name: "Study" });

async function openTeaching(user: User) {
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
  await user.click(within(studyPane()).getByRole("button", { name: "Teaching" }));
}

async function startSermon(user: User) {
  await openTeaching(user);
  await user.click(await within(studyPane()).findByRole("button", { name: "Start" }));
  return within(studyPane()).findByRole("article", { name: "Sermon · Abiding" });
}

const field = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole("textbox", { name });

/** Waits for the debounced save of every field. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
}

const prep = (api: MemoryApi) => api.state.teaching.preparations[0]!;

function proposal(suggestion: string, changes = "Fixed the apostrophe."): AssistReply {
  return { result: { type: "proposal", suggestion, changes, placement: "replace" }, assistant: "OpenAI · test-model", remote: true };
}

afterEach(async () => {
  window.localStorage.clear();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("teaching preparation", () => {
  it("starts empty, is written by the person, and saves as they type", async () => {
    const { api, studyId } = await setup();
    const { user } = await renderApp(api);
    await openTeaching(user);
    expect(await within(studyPane()).findByRole("heading", { name: "Prepare a teaching from this study" })).toBeInTheDocument();
    expect(api.state.teaching.preparations).toHaveLength(0);
    await user.click(within(studyPane()).getByRole("button", { name: "Start" }));
    const article = await within(studyPane()).findByRole("article", { name: "Sermon · Abiding" });
    expect(prep(api)).toMatchObject({ studyId, title: "Sermon · Abiding", kind: "sermon", centralMessage: null, introduction: "" });
    // Nothing is filled in.
    expect(field(article, "Central message")).toHaveValue("");
    expect(within(article).getByText(/No points yet/)).toBeInTheDocument();

    await user.type(field(article, "Who it is for"), "Families");
    await user.type(field(article, "Central message"), "Fruit comes from abiding.");
    await user.type(field(article, "Introduction"), "Have you ever pruned a rose?");
    await settle();
    expect(prep(api)).toMatchObject({ audience: "Families", centralMessage: "Fruit comes from abiding.", introduction: "Have you ever pruned a rose?" });
    // With the assistant off there is no assistant anywhere.
    expect(within(article).queryByRole("button", { name: /^Help with/ })).toBeNull();
  });

  it("adds, orders and removes main points from the keyboard", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.click(within(article).getByRole("button", { name: "Add a point" }));
    await waitFor(() => expect(field(article, "Title of point 1")).toHaveFocus());
    await user.keyboard("The vine");
    await user.click(within(article).getByRole("button", { name: "Add a point" }));
    await waitFor(() => expect(field(article, "Title of point 2")).toHaveFocus());
    await user.keyboard("The branches");
    await settle();
    expect(prep(api).points.map((p) => p.title)).toEqual(["The vine", "The branches"]);

    within(article).getByRole("button", { name: "Move “The branches” up" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(prep(api).points.map((p) => p.title)).toEqual(["The branches", "The vine"]));
    expect(within(article).getByText("Point moved to place 1.")).toBeInTheDocument();
    await waitFor(() => expect(within(article).getByRole("button", { name: "Move “The branches” up" })).toHaveFocus());

    // A point with writing asks first; Keep is the safe default.
    await user.click(within(article).getByRole("button", { name: "Delete “The vine”" }));
    await waitFor(() => expect(within(article).getByRole("button", { name: "Keep" })).toHaveFocus());
    await user.click(within(article).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(prep(api).points.map((p) => p.title)).toEqual(["The branches"]));
  });

  it("uses study findings as live links and never takes them from the study", async () => {
    const { api, findingId } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    const about = within(article).getByRole("region", { name: "What it is about" });
    await user.click(within(about).getByRole("button", { name: "Use a finding from the study" }));
    await user.selectOptions(within(about).getByRole("combobox", { name: "Finding" }), findingId);
    await user.click(within(about).getByRole("button", { name: "Add" }));
    const used = await within(about).findByRole("list", { name: "Findings from the study in the whole teaching" });
    expect(within(used).getByText("Branches do not strain; they stay.")).toBeInTheDocument();
    expect(api.state.findings).toHaveLength(1);

    // Changed in the study: the teaching shows it as it is now.
    await api.findingUpdate({ id: findingId, content: "Branches stay." });
    await user.click(within(studyPane()).getByRole("button", { name: "Study" }));
    await user.click(within(studyPane()).getByRole("button", { name: "Teaching" }));
    expect(await within(studyPane()).findByText("Branches stay.")).toBeInTheDocument();

    await user.click(within(studyPane()).getByRole("button", { name: "Stop using this finding here" }));
    await waitFor(() => expect(within(studyPane()).queryByText("Branches stay.")).toBeNull());
    expect(api.state.findings.map((f) => f.content)).toEqual(["Branches stay."]);
  });

  it("names Scripture in the teaching without adding it to the study", async () => {
    const { api, studyId } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    const about = within(article).getByRole("region", { name: "What it is about" });
    await user.click(within(about).getByRole("button", { name: "Add a passage" }));
    await user.type(within(about).getByRole("textbox", { name: "Passage for the whole teaching" }), "Galatians 5:22-23{Enter}");
    expect(await within(about).findByRole("button", { name: "Galatians 5:22–23" })).toBeInTheDocument();
    expect(prep(api).passages.map((p) => p.reference.canonical)).toEqual(["GAL.5.22-GAL.5.23"]);
    expect((await api.studyPassageList(studyId)).map((p) => p.reference.canonical)).toEqual(["JHN.15.1-JHN.15.8"]);
  });

  it("keeps several teachings for one study, each on its own", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    await startSermon(user);
    await user.click(within(studyPane()).getByRole("button", { name: "Prepare another teaching" }));
    await user.click(within(studyPane()).getByText("Youth"));
    await user.click(within(studyPane()).getByRole("button", { name: "Start" }));
    await within(studyPane()).findByRole("article", { name: "Youth · Abiding" });
    const which = within(studyPane()).getByRole("combobox", { name: "Teaching:" });
    expect(within(which).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sermon · Abiding · Sermon", "Youth · Abiding · Youth"]);
    await user.selectOptions(which, prep(api).id);
    expect(await within(studyPane()).findByRole("article", { name: "Sermon · Abiding" })).toBeInTheDocument();
  });

  it("shows the teaching in Korean with natural teaching words", async () => {
    const { api } = await setup();
    await act(async () => {
      await i18n.changeLanguage("ko");
    });
    const { user } = await renderApp(api);
    await user.click(within(await screen.findByRole("list", { name: "성경공부" })).getByRole("button", { name: /Abiding/ }));
    await user.click(await screen.findByRole("button", { name: "가르침 준비" }));
    await user.click(await screen.findByRole("button", { name: "시작하기" }));
    expect(await screen.findByRole("heading", { name: "대지" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "핵심 메시지" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "서론" })).toBeInTheDocument();
  });
});

/** Asks once the panel knows what it would share (Ask is usable then). */
async function ask(user: User, panel: HTMLElement) {
  const button = await within(panel).findByRole("button", { name: "Ask" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe("the assistant", () => {
  async function helpWith(user: User, scope: HTMLElement, part: string, action: string) {
    await user.click(within(scope).getByRole("button", { name: `Help with ${part}` }));
    const menu = await within(scope).findByRole("menu", { name: `Help with ${part}` });
    await user.click(within(menu).getByRole("menuitem", { name: action }));
    return within(scope).findByTestId("assist-panel");
  }

  it("says what will be shared, asks only when told, and changes nothing until the person chooses", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "We dont produce fruit by trying harder.");
    await settle();
    api.state.teaching.assistant.replies.push(proposal("We don't produce fruit by trying harder."));

    const panel = await helpWith(user, article, "Introduction", "Check grammar and spelling");
    expect(await within(panel).findByText("To help, this will be sent to OpenAI · test-model:")).toBeInTheDocument();
    expect(within(panel).getByText("your Introduction")).toBeInTheDocument();
    expect(within(panel).getByText("Scripture: John 15:1–8")).toBeInTheDocument();
    expect(api.state.teaching.assistant.asked).toHaveLength(0);

    await ask(user, panel);
    const heading = await within(panel).findByRole("heading", { name: "Suggested wording" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(api.state.teaching.assistant.asked[0]).toMatchObject({ action: "grammar", part: "introduction", text: "We dont produce fruit by trying harder." });
    expect(within(panel).getByText("Nothing has changed yet. Your text stays as it is unless you choose this.")).toBeInTheDocument();
    const diff = within(panel).getByTestId("assist-diff");
    expect(diff.querySelector("del")).toHaveTextContent("dont");
    expect(diff.querySelector("ins")).toHaveTextContent("don't");
    // Still the person's own text.
    expect(field(article, "Introduction")).toHaveValue("We dont produce fruit by trying harder.");
    expect(prep(api).introduction).toBe("We dont produce fruit by trying harder.");

    await user.click(within(panel).getByRole("button", { name: "Use this wording" }));
    await waitFor(() => expect(field(article, "Introduction")).toHaveValue("We don't produce fruit by trying harder."));
    await waitFor(() => expect(field(article, "Introduction")).toHaveFocus());
    await settle();
    expect(prep(api).introduction).toBe("We don't produce fruit by trying harder.");
    // And it can be undone at once.
    await user.click(within(article).getByRole("button", { name: "Undo" }));
    await settle();
    expect(prep(api).introduction).toBe("We dont produce fruit by trying harder.");
  });

  it("closes on Escape or Cancel with nothing changed, and gives focus back to the text", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Central message"), "Fruit comes from abiding.");
    await settle();
    api.state.teaching.assistant.replies.push(proposal("Fruit grows from abiding in Christ."));
    const panel = await helpWith(user, article, "Central message", "Make it clearer");
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Ask" })).toHaveFocus());
    await ask(user, panel);
    const heading = await within(panel).findByRole("heading", { name: "Suggested wording" });
    await waitFor(() => expect(heading).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(within(article).queryByTestId("assist-panel")).toBeNull());
    await waitFor(() => expect(field(article, "Central message")).toHaveFocus());
    expect(field(article, "Central message")).toHaveValue("Fruit comes from abiding.");
    expect(prep(api).centralMessage).toBe("Fruit comes from abiding.");
  });

  it("works on only the selected words when some are selected", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "First sentence stays. Second sentance changes.");
    await settle();
    const area = field(article, "Introduction") as HTMLTextAreaElement;
    const start = area.value.indexOf("Second");
    area.setSelectionRange(start, area.value.length);
    api.state.teaching.assistant.replies.push(proposal("Second sentence changes."));
    const panel = await helpWith(user, article, "Introduction", "Check grammar and spelling");
    expect(within(panel).getByText("Only the words you selected.")).toBeInTheDocument();
    await ask(user, panel);
    expect(api.state.teaching.assistant.asked[0]).toMatchObject({ text: "Second sentance changes.", selected: true });
    await user.click(await within(panel).findByRole("button", { name: "Use this wording" }));
    await waitFor(() => expect(area).toHaveValue("First sentence stays. Second sentence changes."));
  });

  it("will not write a part that is still empty", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    const panel = await helpWith(user, article, "Conclusion", "Ideas for an illustration");
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Write something here first. The assistant helps with what you have written.");
    expect(within(panel).getByRole("button", { name: "Ask" })).toBeDisabled();
    expect(api.state.teaching.assistant.asked).toHaveLength(0);
  });

  it("shows comments with their basis, and adds a suggested passage only when asked", async () => {
    const { api, studyId } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "We stay, and he bears fruit.");
    await settle();
    const gal = (await api.referenceParse("Galatians 5:22-23"));
    api.state.teaching.assistant.replies.push({
      result: {
        type: "comments",
        summary: "Clear; one question.",
        comments: [
          { excerpt: "he bears fruit", comment: "Who is “he”? Name him.", basis: "reasoning", passages: [] },
          { excerpt: "", comment: "Compare the fruit of the Spirit.", basis: "scripture", passages: [gal] },
        ],
      },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    const panel = await helpWith(user, article, "Introduction", "Check theology and the passage");
    await ask(user, panel);
    expect(await within(panel).findByText("Who is “he”? Name him.")).toBeInTheDocument();
    expect(within(panel).getByText("The assistant’s own thought, to weigh for yourself")).toBeInTheDocument();
    expect(within(panel).getByText("Based on Scripture")).toBeInTheDocument();
    expect(prep(api).passages).toHaveLength(0);
    await user.click(within(panel).getByRole("button", { name: "Add Galatians 5:22–23 to this teaching" }));
    await waitFor(() => expect(prep(api).passages.map((p) => p.reference.canonical)).toEqual(["GAL.5.22-GAL.5.23"]));
    expect((await api.studyPassageList(studyId))).toHaveLength(1);
  });

  it("marks illustration ideas as invented and keeps one only on request", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.click(within(article).getByRole("button", { name: "Add a point" }));
    await user.keyboard("Stay connected");
    await user.type(field(article, "Explanation"), "A branch cut off withers.");
    await settle();
    api.state.teaching.assistant.replies.push({
      result: { type: "options", standing: "hypothetical", options: [{ text: "Imagine a branch lying on the path…", note: "An invented picture." }] },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    const point = within(article).getByRole("listitem", { name: "Point 1: Stay connected" });
    const panel = await helpWith(user, point, "Explanation", "Ideas for an illustration");
    await ask(user, panel);
    expect(await within(panel).findByText("These are invented examples, not real events. Do not tell them as if they happened.")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Add below my text" })).toBeNull();
    expect(prep(api).materials).toHaveLength(0);
    await user.click(within(panel).getByRole("button", { name: "Keep as an idea" }));
    await waitFor(() => expect(prep(api).materials).toHaveLength(1));
    expect(prep(api).materials[0]).toMatchObject({ kind: "illustration", standing: "hypothetical", pointId: prep(api).points[0]!.id });
    expect(prep(api).points[0]!.explanation).toBe("A branch cut off withers.");
    const kept = within(point).getByRole("list", { name: "Kept from the assistant in Stay connected" });
    expect(within(kept).getByText("Invented example, not a real event")).toBeInTheDocument();
  });

  it("finds real stories only with a search service, and shows how far each is checked", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    let panel = await helpWith(user, article, "Introduction", "Find a real story…");
    await user.type(within(panel).getByRole("textbox", { name: "What kind of real story are you looking for?" }), "forgiveness after conflict");
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/Real stories can only be found and checked with a search service/);
    expect(within(panel).getByRole("button", { name: "Ask" })).toBeDisabled();
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));

    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, search: "searxng", searchUrl: "https://search.example.org" });
    api.state.teaching.assistant.replies.push({
      result: {
        type: "stories",
        stories: [
          { title: "Neighbours reconcile", summary: "Two reports say…", standing: "verified", sources: [
            { title: "Report A", url: "https://www.bbc.co.uk/a", site: "bbc.co.uk", excerpt: "" },
            { title: "Report B", url: "https://www.theguardian.com/b", site: "theguardian.com", excerpt: "" },
          ] },
          { title: "A blog story", summary: "One blog says…", standing: "unverified", sources: [{ title: "Blog", url: "https://blog.example.net/c", site: "example.net", excerpt: "" }] },
        ],
      },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    panel = await helpWith(user, article, "Introduction", "Find a real story…");
    await user.type(within(panel).getByRole("textbox", { name: "What kind of real story are you looking for?" }), "forgiveness after conflict");
    expect(await within(panel).findByText("Search words (not your text) will also go to your search service.")).toBeInTheDocument();
    await ask(user, panel);
    expect(await within(panel).findByText("Reported by at least two independent sources the search found")).toBeInTheDocument();
    expect(within(panel).getByText("Not checked: only one source. Please check before you use it.")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: /Report A/ }));
    expect(api.state.library.openedLinks).toEqual(["https://www.bbc.co.uk/a"]);
    await user.click(within(panel).getAllByRole("button", { name: "Keep with this teaching" })[0]!);
    await waitFor(() => expect(prep(api).materials).toHaveLength(1));
    expect(prep(api).materials[0]).toMatchObject({ kind: "story", standing: "verified" });
    expect(prep(api).materials[0]!.sources.map((s) => s.url)).toEqual(["https://www.bbc.co.uk/a", "https://www.theguardian.com/b"]);
  });

  it("finds freely licensed images with their licence, and marks made images as made", async () => {
    const { api } = await setup({ assistant: true });
    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, generateImages: true });
    api.state.teaching.assistant.foundImages = [
      {
        title: "Grapevine", url: "https://upload.wikimedia.org/v.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:V.jpg",
        thumbUrl: "https://upload.wikimedia.org/thumb/v.jpg", licence: "CC BY-SA 4.0", licenceUrl: null, author: "Jane Doe",
        attribution: "Jane Doe, CC BY-SA 4.0, via Wikimedia Commons", thumbData: "data:image/jpeg;base64,/9j/",
      },
    ];
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Jesus is the vine; we are the branches.");
    await settle();
    api.state.teaching.assistant.replies.push({
      result: { type: "visuals", ideas: [{ description: "A vine with branches and grapes", kind: "photo", searchTerms: "grapevine" }] },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    const panel = await helpWith(user, article, "Introduction", "Suggest a visual");
    await ask(user, panel);
    await user.click(await within(panel).findByRole("button", { name: "Find freely licensed images" }));
    expect(await within(panel).findByText("Found image · CC BY-SA 4.0")).toBeInTheDocument();
    expect(within(panel).getByText("by Jane Doe")).toBeInTheDocument();
    expect(api.state.teaching.assistant.findCalls).toEqual(["grapevine"]);
    expect(prep(api).materials).toHaveLength(0);
    await user.click(within(panel).getByRole("button", { name: "Keep the image “Grapevine”" }));
    await waitFor(() => expect(prep(api).materials[0]).toMatchObject({ kind: "image", standing: "found", image: { licence: "CC BY-SA 4.0", author: "Jane Doe" } }));

    await user.click(within(panel).getByRole("button", { name: "Make an image" }));
    expect(await within(panel).findByText("Made by the assistant: an illustration, not a photograph")).toBeInTheDocument();
    expect(prep(api).materials).toHaveLength(1);
  });

  it("is never offered while it is turned off, and says so plainly if asked for anyway", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    expect(within(article).queryByRole("button", { name: /^Help with/ })).toBeNull();
    // The core refuses too.
    await expect(api.assistantAsk({ preparationId: prep(api).id, action: "grammar", part: "introduction", text: "x" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("assistant settings", () => {
  it("is off until turned on, keeps the key out of sight, and checks the connection", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const enabled = await screen.findByRole("checkbox", { name: "Use the assistant" });
    expect(enabled).not.toBeChecked();
    await user.click(enabled);
    await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "anthropic");
    expect(screen.getByRole("textbox", { name: "Model" })).toHaveValue("claude-sonnet-5-5");
    expect(screen.getByText("When you ask for help, the text you chose is sent over the internet to this service.")).toBeInTheDocument();
    const key = screen.getByLabelText("Key");
    await user.type(key, "sk-ant-secret");
    await user.click(screen.getByRole("button", { name: "Keep key" }));
    expect(await screen.findByText("The key is kept on this computer.")).toBeInTheDocument();
    expect(key).toHaveValue("");
    expect(document.body.textContent).not.toContain("sk-ant-secret");
    expect(api.state.teaching.assistant.keys.get("anthropic")).toBe("sk-ant-secret");
    expect(api.state.teaching.assistant.config).toMatchObject({ enabled: true, provider: "anthropic", model: "claude-sonnet-5-5" });

    await user.click(screen.getByRole("button", { name: "Check the connection" }));
    expect(await screen.findByText("The assistant answered. It is ready.")).toBeInTheDocument();

    // A local service: nothing leaves the computer, and no key is asked for.
    await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "ollama");
    expect(screen.getByText("Runs on this computer: your text does not leave it.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Key")).toBeNull();
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);
    await waitFor(() => expect(api.state.teaching.assistant.config.provider).toBe("ollama"));
  });
});

describe("the comparison of a suggestion", () => {
  it("shows removed and added words, and keeps a changed phrase together", async () => {
    const { wordDiff } = await import("@/features/teaching/diff");
    const parts = wordDiff("It looks like they are hurting it.", "It looks as if they are hurting it.");
    expect(parts.filter((p) => p.kind === "removed").map((p) => p.text.trim())).toEqual(["like"]);
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text.trim())).toEqual(["as if"]);
    // Each side reads back exactly.
    expect(parts.filter((p) => p.kind !== "added").map((p) => p.text).join("")).toBe("It looks like they are hurting it.");
    expect(parts.filter((p) => p.kind !== "removed").map((p) => p.text).join("")).toBe("It looks as if they are hurting it.");
    expect(wordDiff("Same text.", "Same text.")).toEqual([{ kind: "same", text: "Same text." }]);
  });
});
