import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ApiError } from "@/lib/api";
import type { AssistReply } from "@/types/teaching";
import { createMemoryApi, type MemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

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
  await user.click(within(studyPane()).getByRole("button", { name: "Bible Teaching" }));
}

async function startSermon(user: User) {
  await openTeaching(user);
  await user.click(await within(studyPane()).findByRole("button", { name: "Start" }));
  return within(studyPane()).findByRole("article", { name: "Sermon · Abiding" });
}

const field = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole("textbox", { name });

/** Opens "About this teaching" (kind, audience, purpose, what the whole teaching uses). */
async function openAbout(user: User, article: HTMLElement) {
  const toggle = within(article).getByRole("button", { name: /^About this teaching/ });
  if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
  return within(article).getByRole("region", { name: "About this teaching" });
}

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

/** Help → (the category holding it) → the action, as a person would click it. */
async function helpWith(user: User, scope: HTMLElement, part: string, action: string) {
  await user.click(within(scope).getByRole("button", { name: `Help with ${part}` }));
  const menu = await within(scope).findByRole("menu", { name: `Help with ${part}` });
  const direct = within(menu).queryByRole("menuitem", { name: action });
  if (direct) {
    await user.click(direct);
    return within(scope).findByTestId("assist-panel");
  }
  const categories = within(menu)
    .getAllByRole("menuitem")
    .filter((item) => item.getAttribute("aria-haspopup") === "menu")
    .map((item) => item.textContent ?? "");
  for (const category of categories) {
    await user.click(within(within(scope).getByRole("menu")).getByRole("menuitem", { name: category }));
    const sub = within(scope).getByRole("menu", { name: category });
    const found = within(sub).queryByRole("menuitem", { name: action });
    if (found) {
      await user.click(found);
      return within(scope).findByTestId("assist-panel");
    }
    await user.click(within(sub).getByRole("menuitem", { name: "All help" }));
  }
  throw new Error(`No “${action}” under Help with ${part}`);
}

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

    // The details wait under "About this teaching"; the writing comes first.
    expect(within(article).getByRole("button", { name: /^About this teaching/ })).toHaveAttribute("aria-expanded", "false");
    await openAbout(user, article);
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
    const about = await openAbout(user, article);
    await user.click(within(about).getByRole("button", { name: "Use something from your study" }));
    await user.selectOptions(within(about).getByRole("combobox", { name: "From your study" }), findingId);
    await user.click(within(about).getByRole("button", { name: "Add" }));
    const used = await within(about).findByRole("list", { name: "From your study, in the whole teaching" });
    expect(within(used).getByText("Branches do not strain; they stay.")).toBeInTheDocument();
    expect(api.state.findings).toHaveLength(1);

    // Changed in the study: the teaching shows it as it is now.
    await api.findingUpdate({ id: findingId, content: "Branches stay." });
    await user.click(within(studyPane()).getByRole("button", { name: "Bible Study" }));
    await user.click(within(studyPane()).getByRole("button", { name: "Bible Teaching" }));
    expect(await within(studyPane()).findByText("Branches stay.")).toBeInTheDocument();

    await user.click(within(studyPane()).getByRole("button", { name: "Stop using this here" }));
    await waitFor(() => expect(within(studyPane()).queryByText("Branches stay.")).toBeNull());
    expect(api.state.findings.map((f) => f.content)).toEqual(["Branches stay."]);
  });

  it("names Scripture in the teaching without adding it to the study", async () => {
    const { api, studyId } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    const about = await openAbout(user, article);
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
    await user.click(await screen.findByRole("button", { name: "성경 가르침" }));
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
    expect(within(panel).getByText("The assistant says this draws on Scripture")).toBeInTheDocument();
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
    expect(await within(panel).findByText("Search words based on your request (they may include your words) will also go to your search service.")).toBeInTheDocument();
    await ask(user, panel);
    expect(await within(panel).findByText("Two independent sites in the search results report it (read them before using it)")).toBeInTheDocument();
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
    const region = await openSettingsSection(user, "Assistant");
    const enabled = await within(region).findByRole("checkbox", { name: "Use the assistant" });
    expect(enabled).not.toBeChecked();
    // Off: one plain sentence instead of a disabled form.
    expect(within(region).getByText("Turn on the assistant to choose a service and check the connection.")).toBeInTheDocument();
    expect(within(region).queryByRole("combobox", { name: "Service" })).toBeNull();
    expect(within(region).queryByRole("button", { name: "Check the connection" })).toBeNull();

    await user.click(enabled);
    expect(await within(region).findByText("The assistant is on.")).toBeInTheDocument();
    expect(api.state.teaching.assistant.config.enabled).toBe(true);
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "anthropic");
    expect(within(region).getByRole("textbox", { name: "Model" })).toHaveValue("claude-sonnet-5-5");
    expect(within(region).getByText("When you ask for help, the text you chose is sent over the internet to this service.")).toBeInTheDocument();

    // The check sits with the key and says why it cannot run yet.
    const test = within(region).getByRole("button", { name: "Check the connection" });
    expect(test).toBeDisabled();
    expect(test).toHaveAccessibleDescription("To check the connection, first paste your key and choose Keep key.");

    const key = within(region).getByLabelText("Key");
    await user.type(key, "sk-ant-secret");
    await user.click(within(region).getByRole("button", { name: "Keep key" }));
    expect(await within(region).findByText("The key is kept on this computer.")).toBeInTheDocument();
    expect(key).toHaveValue("");
    expect(document.body.textContent).not.toContain("sk-ant-secret");
    expect(api.state.teaching.assistant.keys.get("anthropic")).toBe("sk-ant-secret");
    expect(api.state.teaching.assistant.config).toMatchObject({ enabled: true, provider: "anthropic", model: "claude-sonnet-5-5" });

    expect(test).toBeEnabled();
    await user.click(test);
    expect(await within(region).findByText("Connected. The assistant answered and is ready.")).toBeInTheDocument();
    expect(api.state.teaching.assistant.tested).toBe(1);

    // Without a model there is nothing to check, and it says so.
    await user.clear(within(region).getByRole("textbox", { name: "Model" }));
    expect(test).toBeDisabled();
    expect(test).toHaveAccessibleDescription("To check the connection, first enter the model’s name.");

    // A local service: nothing leaves the computer, and no key is asked for.
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "ollama");
    expect(within(region).getByText("Runs on this computer: your text does not leave it.")).toBeInTheDocument();
    expect(within(region).queryByLabelText("Key")).toBeNull();
    expect(test).toBeEnabled();
  });

  it("offers each service by name, with a suggested model and plain help for its key", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the assistant" }));
    const service = within(region).getByRole("combobox", { name: "Service" });
    const offered = within(service).getAllByRole("option").map((o) => o.textContent);
    expect(offered).toEqual(
      expect.arrayContaining(["OpenAI (ChatGPT)", "Anthropic (Claude)", "Google Gemini", "xAI (Grok)", "Perplexity", "DeepSeek", "Qwen (Alibaba Cloud)", "Ollama", "LM Studio", "Other compatible service"]),
    );
    // Grouped by where it runs, not ranked by vendor.
    expect(within(service).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(["On the internet", "On this computer", "Other"]);

    for (const [kind, model] of [["xai", "grok-4"], ["perplexity", "sonar-pro"], ["deepseek", "deepseek-chat"], ["qwen", "qwen-plus"]] as const) {
      await user.selectOptions(service, kind);
      expect(within(region).getByRole("textbox", { name: "Model" })).toHaveValue(model);
      expect(within(region).getByLabelText("Key")).toBeInTheDocument();
    }

    // "How do I get a key?": short answers and the service's own page.
    await user.selectOptions(service, "deepseek");
    await user.click(within(region).getByText("How do I get a key?"));
    for (const question of ["What is a key?", "Why do I need one?", "Where do I get it?", "Does it cost money?", "Where do I paste it?"]) {
      expect(within(region).getByText(question)).toBeVisible();
    }
    await user.click(within(region).getByRole("button", { name: "Open the DeepSeek key page" }));
    expect(api.state.library.openedLinks).toContain("https://platform.deepseek.com/api_keys");

    // The technical address waits under Advanced.
    expect(within(region).getByLabelText("Address of the service")).not.toBeVisible();
    const words = region.textContent ?? "";
    for (const jargon of [/endpoint/i, /base url/i, /token/i, /OpenAI-compatible/i]) expect(words).not.toMatch(jargon);

    // A local program: what it is, that it needs no key, and where to get it.
    await user.selectOptions(service, "lmstudio");
    await user.click(within(region).getByText("How do I set up LM Studio?"));
    expect(within(region).getByText(/needs no key and no account/)).toBeVisible();
    expect(within(region).getByRole("textbox", { name: "Model" })).toHaveValue("");
    expect(within(region).getByRole("button", { name: "Check the connection" })).toHaveAccessibleDescription("To check the connection, first enter the model’s name.");
  });

  it("asks the generic service for its address and explains a bad one", async () => {
    const { user } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the assistant" }));
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "openai_compatible");
    const test = within(region).getByRole("button", { name: "Check the connection" });
    expect(test).toHaveAccessibleDescription("To check the connection, first enter the address of the service.");
    expect(within(region).getByLabelText("Key (if the service needs one)")).toBeInTheDocument();
    const address = within(region).getByRole("textbox", { name: "Address of the service" });
    await user.type(address, "ftp://example.org");
    expect(test).toHaveAccessibleDescription("The address of the service must begin with http:// or https://.");
    await user.clear(address);
    await user.type(address, "https://example.org/v1");
    await user.type(within(region).getByRole("textbox", { name: "Model" }), "my-model");
    expect(test).toBeEnabled();
  });

  it("says text leaves the computer for a look-alike local address", async () => {
    const { user } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the assistant" }));
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "ollama");
    expect(within(region).getByText("Runs on this computer: your text does not leave it.")).toBeInTheDocument();
    await user.click(within(region).getByText("Advanced"));
    await user.type(within(region).getByRole("textbox", { name: "Address of the service" }), "http://127.0.0.1.nip.io/v1");
    expect(within(region).getByText("When you ask for help, the text you chose is sent over the internet to this service.")).toBeInTheDocument();
  });

  it("explains real-story research without promising truth, and keeps theology optional", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the assistant" }));
    const search = within(region).getByRole("combobox", { name: "Look up real stories" });
    expect(search).toHaveAccessibleDescription(/cannot be trusted to remember facts/);
    expect(search).toHaveAccessibleDescription(/Read the sources yourself/);
    const words = region.textContent ?? "";
    expect(words).not.toMatch(/proves?|guarantee|verified as true/i);

    const theology = within(region).getByRole("textbox", { name: /How should the assistant place theological questions\?/ });
    expect(within(region).getByText("(optional)")).toBeInTheDocument();
    expect(theology).toHaveValue("");
    expect(theology).toHaveAccessibleDescription(/assumes no particular tradition/);
    // Examples to start from; nothing about the person's life is asked.
    const examples = within(region).getByRole("group", { name: "Examples:" });
    await user.click(within(examples).getByRole("button", { name: "Lutheran" }));
    await user.click(within(examples).getByRole("button", { name: "On disputed questions, show the different views first." }));
    expect(theology).toHaveValue("Lutheran On disputed questions, show the different views first.");
    expect(words).not.toMatch(/biograph|your life|testimony/i);
    await user.click(within(region).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.state.teaching.assistant.config.perspective).toBe("Lutheran On disputed questions, show the different views first."));
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

describe("review fixes: applying a suggestion safely", () => {

  it("never overwrites what was typed after asking", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "We dont stay.");
    await settle();
    api.state.teaching.assistant.replies.push(proposal("We don't stay."));
    const panel = await helpWith(user, article, "Introduction", "Check grammar and spelling");
    await ask(user, panel);
    await within(panel).findByRole("heading", { name: "Suggested wording" });
    // The person keeps writing while the suggestion is shown.
    await user.click(field(article, "Introduction"));
    await user.keyboard("{End} And we bear fruit.");
    await user.click(within(panel).getByRole("button", { name: "Use this wording" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Your text changed after you asked, so this suggestion was not used.");
    expect(field(article, "Introduction")).toHaveValue("We dont stay. And we bear fruit.");
  });

  it("keeps the selection's line breaks, and puts a transition before the selected words", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    const area = field(article, "Introduction") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "First paragraph.\n\nSecond paragrph.\n\nThird paragraph." } });
    await settle();
    // A triple-click selection: the paragraph with its line breaks.
    let start = area.value.indexOf("Second");
    area.setSelectionRange(start, area.value.indexOf("Third"));
    api.state.teaching.assistant.replies.push(proposal("Second paragraph."));
    let panel = await helpWith(user, article, "Introduction", "Check grammar and spelling");
    await ask(user, panel);
    await user.click(await within(panel).findByRole("button", { name: "Use this wording" }));
    await waitFor(() => expect(area).toHaveValue("First paragraph.\n\nSecond paragraph.\n\nThird paragraph."));

    start = area.value.indexOf("Third");
    area.setSelectionRange(start, area.value.length);
    api.state.teaching.assistant.replies.push({ result: { type: "proposal", suggestion: "And so, finally:", changes: "", placement: "start" }, assistant: "OpenAI · test-model", remote: true });
    panel = await helpWith(user, article, "Introduction", "Help with a transition");
    await ask(user, panel);
    await user.click(await within(panel).findByRole("button", { name: "Put this at the start" }));
    await waitFor(() => expect(area).toHaveValue("First paragraph.\n\nSecond paragraph.\n\nAnd so, finally: Third paragraph."));
  });

  it("replaces a one-line part instead of adding lines to it", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await openAbout(user, article);
    await user.type(field(article, "Purpose"), "To abide");
    await settle();
    api.state.teaching.assistant.replies.push({
      result: { type: "options", standing: "suggestion", options: [{ text: "That we\nremain in Christ", note: "" }] },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    const panel = await helpWith(user, article, "Purpose", "Other ways to say this");
    await ask(user, panel);
    expect(await within(panel).findByRole("button", { name: "Use this" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Add below my text" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(field(article, "Purpose")).toHaveValue("That we remain in Christ"));
    await settle();
    expect(prep(api).purpose).toBe("That we remain in Christ");
  });

  it("offers nothing to add for the whole teaching's order, only to read", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    for (const title of ["The vine", "The branches"]) {
      await user.click(within(article).getByRole("button", { name: "Add a point" }));
      await user.keyboard(title);
    }
    await settle();
    api.state.teaching.assistant.replies.push({
      result: { type: "options", standing: "suggestion", options: [{ text: "Branches first, then the vine.", note: "" }] },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    const panel = await helpWith(user, article, "the whole teaching", "How could I order what I have?");
    await ask(user, panel);
    expect(await within(panel).findByText("Branches first, then the vine.")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Add below my text" })).toBeNull();
  });

  it("moves focus to the previous point after deleting one", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    for (const title of ["The vine", "The branches"]) {
      await user.click(within(article).getByRole("button", { name: "Add a point" }));
      await user.keyboard(title);
    }
    await settle();
    await user.click(within(article).getByRole("button", { name: "Delete “The branches”" }));
    await user.click(within(article).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(field(article, "Title of point 1")).toHaveFocus());
    expect(within(article).queryByRole("alert")).toBeNull();
  });
});

describe("review fixes: where text goes", () => {
  it("counts only this computer as local, whatever the address looks like", async () => {
    const { isLocalAddress } = await import("@/lib/localAddress");
    expect(isLocalAddress("http://localhost:11434/v1")).toBe(true);
    expect(isLocalAddress("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalAddress("http://[::1]:8080")).toBe(true);
    expect(isLocalAddress("http://localhost.evil.com/v1")).toBe(false);
    expect(isLocalAddress("http://127.0.0.1.nip.io/v1")).toBe(false);
    expect(isLocalAddress("http://localhost:x@evil.com/v1")).toBe(false);
    expect(isLocalAddress("not an address")).toBe(false);
  });
});

describe("the help menu", () => {
  it("offers a few plain categories, each with its own short list, and something else in the person's words", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.click(within(article).getByRole("button", { name: "Help with Introduction" }));
    const menu = await within(article).findByRole("menu", { name: "Help with Introduction" });
    const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual(["Improve my wording", "Review what I wrote", "Help with structure", "Ideas and illustrations", "Look something up", "Ask for something else…"]);
    expect(items.length).toBeLessThanOrEqual(6);
    // Focus starts on the first category.
    expect(within(menu).getByRole("menuitem", { name: "Improve my wording" })).toHaveFocus();
  });

  it("moves through both levels with the keyboard, and Escape goes back a level, then closes", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    const help = within(article).getByRole("button", { name: "Help with Introduction" });
    help.focus();
    await user.keyboard("{Enter}");
    await within(article).findByRole("menu", { name: "Help with Introduction" });
    await user.keyboard("{ArrowDown}");
    expect(within(article).getByRole("menuitem", { name: "Review what I wrote" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const sub = within(article).getByRole("menu", { name: "Review what I wrote" });
    expect(within(sub).getByRole("menuitem", { name: "Review what I wrote" })).toHaveFocus();
    expect(within(sub).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["All help", "Review what I wrote", "Check theology and the passage"]);
    await user.keyboard("{Escape}");
    // Back on the first level, on the category it came from.
    expect(within(article).getByRole("menuitem", { name: "Review what I wrote" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowLeft}");
    expect(within(article).getByRole("menu", { name: "Help with Introduction" })).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(within(article).getByRole("menuitem", { name: "Ask for something else…" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(within(article).queryByRole("menu")).toBeNull();
    expect(help).toHaveFocus();
    expect(api.state.teaching.assistant.previews).toHaveLength(0);
  });

  it("answers a request in the person's own words with comments only, never wording to put in", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    api.state.teaching.assistant.replies.push({
      result: { type: "comments", summary: "I can help you shape your own introduction.", comments: [{ excerpt: "", comment: "Which picture from John 15 would you start with?", basis: "reasoning", passages: [] }] },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    const panel = await helpWith(user, article, "Introduction", "Ask for something else…");
    const request = within(panel).getByRole("textbox", { name: "What would you like help with?" });
    await waitFor(() => expect(request).toHaveFocus());
    expect(request).toHaveAccessibleDescription(/does not write your teaching for you/);
    expect(within(panel).getByRole("button", { name: "Ask" })).toBeDisabled();
    await user.type(request, "Write my whole introduction for me.");
    await ask(user, panel);
    expect(await within(panel).findByText("Which picture from John 15 would you start with?")).toBeInTheDocument();
    expect(api.state.teaching.assistant.asked[0]).toMatchObject({ action: "free", part: "introduction", request: "Write my whole introduction for me." });
    expect(within(panel).queryByRole("button", { name: "Use this wording" })).toBeNull();
    expect(field(article, "Introduction")).toHaveValue("");
    expect(prep(api).introduction).toBe("");
  });
});

describe("long assistant actions", () => {
  function holdOn(api: MemoryApi) {
    let release = () => {};
    api.state.teaching.assistant.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      api.state.teaching.assistant.hold = null;
      release();
    };
  }

  it("says at once that it is asking, asks only once, and can stop waiting", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "We dont stay.");
    await settle();
    api.state.teaching.assistant.replies.push(proposal("We don't stay."));
    const release = holdOn(api);
    const panel = await helpWith(user, article, "Introduction", "Check grammar and spelling");
    await ask(user, panel);
    expect(within(panel).getByRole("status")).toHaveTextContent("Asking the assistant…");
    const askButton = within(panel).getByRole("button", { name: "Ask" });
    expect(askButton).toBeDisabled();
    await user.click(askButton);
    fireEvent.keyDown(panel, { key: "Enter", ctrlKey: true });
    expect(api.state.teaching.assistant.asked).toHaveLength(1);

    await user.click(within(panel).getByRole("button", { name: "Stop waiting" }));
    expect(within(panel).queryByTestId("pending")).toBeNull();
    expect(within(panel).getByText("Stopped waiting. Nothing was changed.")).toBeInTheDocument();
    await act(async () => release());
    // The late answer is ignored.
    expect(within(panel).queryByRole("heading", { name: "Suggested wording" })).toBeNull();
    expect(field(article, "Introduction")).toHaveValue("We dont stay.");
  });

  it("says when a request failed or timed out, and lets the person try again", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "We dont stay.");
    await settle();
    api.state.teaching.assistant.replies.push(new ApiError("assistant", "The assistant service did not answer in time. Please try again."));
    const panel = await helpWith(user, article, "Introduction", "Check grammar and spelling");
    await ask(user, panel);
    expect(await within(panel).findByRole("alert")).toHaveTextContent("did not answer in time");
    expect(within(panel).queryByTestId("pending")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Ask" })).toBeEnabled();
  });

  it("shows plainly while looking for real stories", async () => {
    const { api } = await setup({ assistant: true });
    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, search: "searxng", searchUrl: "https://search.example" });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Forgiveness after a conflict.");
    await settle();
    api.state.teaching.assistant.replies.push({ result: { type: "stories", stories: [] }, assistant: "OpenAI · test-model", remote: true });
    const release = holdOn(api);
    const panel = await helpWith(user, article, "Introduction", "Find a real story…");
    await user.type(within(panel).getByRole("textbox"), "forgiveness");
    await ask(user, panel);
    expect(within(panel).getByRole("status")).toHaveTextContent("Looking for sources… This can take a little while.");
    await act(async () => release());
    await waitFor(() => expect(within(panel).queryByTestId("pending")).toBeNull());
  });

  it("shows plainly while finding or making images, one request at a time", async () => {
    const { api } = await setup({ assistant: true });
    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, generateImages: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Jesus is the vine; we are the branches.");
    await settle();
    api.state.teaching.assistant.replies.push({
      result: { type: "visuals", ideas: [{ description: "A vine with branches", kind: "photo", searchTerms: "grapevine" }] },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    const panel = await helpWith(user, article, "Introduction", "Suggest a visual");
    await ask(user, panel);
    const find = await within(panel).findByRole("button", { name: "Find freely licensed images" });
    let release = holdOn(api);
    await user.click(find);
    expect(within(panel).getByText("Finding suitable images…")).toBeInTheDocument();
    expect(find).toBeDisabled();
    await user.click(find);
    expect(api.state.teaching.assistant.findCalls).toHaveLength(1);
    await act(async () => release());
    await waitFor(() => expect(within(panel).queryByText("Finding suitable images…")).toBeNull());

    release = holdOn(api);
    const make = within(panel).getByRole("button", { name: "Make an image" });
    await user.click(make);
    expect(within(panel).getByText("Creating an image… This can take a little while.")).toBeInTheDocument();
    expect(make).toBeDisabled();
    await act(async () => release());
    expect(await within(panel).findByText("Made by the assistant: an illustration, not a photograph")).toBeInTheDocument();
    expect(api.state.teaching.assistant.generated).toHaveLength(1);
  });
});

describe("the teaching canvas", () => {
  it("puts the writing first and keeps the details folded away until wanted", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    const about = within(article).getByRole("button", { name: /^About this teaching/ });
    expect(about).toHaveAttribute("aria-expanded", "false");
    expect(within(article).queryByRole("textbox", { name: "Who it is for" })).toBeNull();
    expect(within(article).queryByRole("button", { name: "Delete this teaching" })).toBeNull();
    // The main parts are there at once, in order.
    const boxes = within(article).getAllByRole("textbox").map((b) => b.getAttribute("id") && (b.labels?.[0]?.textContent ?? ""));
    expect(boxes).toEqual(["Title", "Central message", "Introduction", "Conclusion", "Notes for yourself"]);
    await user.click(about);
    expect(await within(article).findByRole("textbox", { name: "Who it is for" })).toBeVisible();
    // The summary says what is set.
    await user.type(field(article, "Who it is for"), "families");
    await settle();
    expect(within(article).getByRole("button", { name: /^About this teaching/ })).toHaveTextContent("Sermon · for families");
  });

  it("names the main parts after the kind: questions for a Bible study, steps for a lesson", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    expect(within(article).getByRole("heading", { name: "Main points" })).toBeInTheDocument();
    await openAbout(user, article);
    await user.selectOptions(within(article).getByRole("combobox", { name: "Kind of teaching" }), "bible_study");
    expect(await within(article).findByRole("heading", { name: "Questions and answers" })).toBeInTheDocument();
    await user.click(within(article).getByRole("button", { name: "Add a question" }));
    expect(await within(article).findByRole("textbox", { name: "What the passage shows" })).toBeInTheDocument();
    await user.selectOptions(within(article).getByRole("combobox", { name: "Kind of teaching" }), "lesson");
    expect(await within(article).findByRole("heading", { name: "Lesson plan" })).toBeInTheDocument();
    expect(within(article).getByRole("textbox", { name: "What you will say or do" })).toBeInTheDocument();
    // The same point, only named differently: nothing was lost.
    expect(prep(api).points).toHaveLength(1);
  });

  it("works fully without the assistant", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Abide.");
    await settle();
    expect(prep(api).introduction).toBe("Abide.");
    expect(within(article).queryByRole("button", { name: /^Help with/ })).toBeNull();
    expect(within(article).queryByText(/assistant/i)).toBeNull();
  });
});
