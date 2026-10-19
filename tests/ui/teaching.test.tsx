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
  await user.click(within(scope).getByRole("button", { name: `AI Help with ${part}` }));
  const menu = await within(scope).findByRole("menu", { name: `AI Help with ${part}` });
  const direct = within(menu).queryByRole("menuitem", { name: action });
  if (direct) {
    await user.click(direct);
    return screen.findByTestId("assist-panel");
  }
  const categories = within(menu)
    .getAllByRole("menuitem")
    .filter((item) => item.dataset.category)
    .map((item) => item.textContent ?? "");
  for (const category of categories) {
    await user.click(within(within(scope).getByRole("menu")).getByRole("menuitem", { name: category }));
    const sub = within(scope).getByRole("menu", { name: category });
    const found = within(sub).queryByRole("menuitem", { name: action });
    if (found) {
      await user.click(found);
      return screen.findByTestId("assist-panel");
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

    // Just created: the details are open once, to be filled in.
    expect(within(article).getByRole("button", { name: /^About this teaching/ })).toHaveAttribute("aria-expanded", "true");
    await openAbout(user, article);
    await user.type(field(article, "Who it is for"), "Families");
    await user.type(field(article, "Central message"), "Fruit comes from abiding.");
    await user.type(field(article, "Introduction"), "Have you ever pruned a rose?");
    await settle();
    expect(prep(api)).toMatchObject({ audience: "Families", centralMessage: "Fruit comes from abiding.", introduction: "Have you ever pruned a rose?" });
    // With the assistant off there is no assistant anywhere.
    expect(within(article).queryByRole("button", { name: /^AI Help with/ })).toBeNull();
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

    await openAbout(user, within(studyPane()).getByRole("article", { name: "Sermon · Abiding" }));
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
    const studyId = api.state.studies[0]!.id;
    const studyBefore = JSON.stringify({ study: api.state.studies, findings: api.state.findings, passages: await api.studyPassageList(studyId) });
    const { user } = await renderApp(api);
    const sermon = await startSermon(user);
    await user.type(field(sermon, "Introduction"), "Have you pruned a rose?");
    await settle();
    // "About this teaching" folded away: the way to another teaching is still in sight, with no picker yet.
    const about = within(sermon).getByRole("button", { name: /^About this teaching/ });
    if (about.getAttribute("aria-expanded") === "true") await user.click(about);
    expect(within(studyPane()).queryByRole("combobox", { name: "Teaching:" })).toBeNull();
    const another = within(studyPane()).getByRole("button", { name: "Prepare another Bible Teaching" });
    expect(another).toBeVisible();

    // By keyboard: the form opens with the focus on it, the kind is chosen as for the first teaching.
    another.focus();
    await user.keyboard("{Enter}");
    const form = await within(studyPane()).findByRole("form", { name: "Prepare another Bible Teaching" });
    expect(within(form).getByRole("heading", { name: "Prepare another Bible Teaching" })).toHaveFocus();
    await user.click(within(form).getByRole("radio", { name: "Group Bible study" }));
    await user.click(within(form).getByRole("button", { name: "Start" }));
    await within(studyPane()).findByRole("article", { name: "Group Bible study · Abiding" });

    // Two independent teachings of the same study, both in the picker.
    const preps = api.state.teaching.preparations;
    expect(preps.map((p) => [p.kind, p.studyId])).toEqual([["sermon", studyId], ["bible_study", studyId]]);
    expect(preps[0]!.introduction).toBe("Have you pruned a rose?");
    expect(preps[1]!.introduction).toBe("");
    const which = within(studyPane()).getByRole("combobox", { name: "Teaching:" });
    expect(within(which).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sermon · Abiding · Sermon", "Group Bible study · Abiding · Group Bible study"]);
    expect(within(studyPane()).getByRole("button", { name: "Prepare another Bible Teaching" })).toBeVisible();

    // Switch both ways. The picker sits in the open teaching's details line (v0.18.4), so it is drawn
    // anew with each teaching; the keyboard stays on it.
    const picker = () => within(studyPane()).getByRole("combobox", { name: "Teaching:" });
    await user.selectOptions(which, preps[0]!.id);
    expect(field(await within(studyPane()).findByRole("article", { name: "Sermon · Abiding" }), "Introduction")).toHaveValue("Have you pruned a rose?");
    await waitFor(() => expect(picker()).toHaveFocus());
    await user.selectOptions(picker(), preps[1]!.id);
    await within(studyPane()).findByRole("article", { name: "Group Bible study · Abiding" });

    // Cancelling another new teaching changes nothing and returns to the button.
    await user.click(within(studyPane()).getByRole("button", { name: "Prepare another Bible Teaching" }));
    await user.click(within(studyPane()).getByRole("button", { name: "Cancel" }));
    expect(api.state.teaching.preparations).toHaveLength(2);
    await waitFor(() => expect(within(studyPane()).getByRole("button", { name: "Prepare another Bible Teaching" })).toHaveFocus());

    // Deleting one leaves the other, and the study as it was.
    const group = await within(studyPane()).findByRole("article", { name: "Group Bible study · Abiding" });
    const groupAbout = await openAbout(user, group);
    await user.click(within(groupAbout).getByRole("button", { name: "Delete this teaching" }));
    await user.click(within(groupAbout).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.state.teaching.preparations.map((p) => p.kind)).toEqual(["sermon"]));
    expect(await within(studyPane()).findByRole("article", { name: "Sermon · Abiding" })).toBeInTheDocument();
    expect(within(studyPane()).queryByRole("combobox", { name: "Teaching:" })).toBeNull();
    await waitFor(() => expect(within(studyPane()).getByRole("button", { name: "Prepare another Bible Teaching" })).toHaveFocus());
    expect(JSON.stringify({ study: api.state.studies, findings: api.state.findings, passages: await api.studyPassageList(studyId) })).toBe(studyBefore);
  });

  it("after the only teaching is deleted, offers the first-teaching form again without moving focus later", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const sermon = await startSermon(user);
    const about = await openAbout(user, sermon);
    await user.click(within(about).getByRole("button", { name: "Delete this teaching" }));
    await user.click(within(about).getByRole("button", { name: "Delete" }));
    const form = await within(studyPane()).findByRole("form", { name: "Prepare a teaching from this study" });
    await user.click(within(form).getByRole("button", { name: "Start" }));
    await within(studyPane()).findByRole("article", { name: "Sermon · Abiding" });
    expect(within(studyPane()).getByRole("button", { name: "Prepare another Bible Teaching" })).not.toHaveFocus();
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

  it("closes on Escape or Cancel with nothing changed, and gives focus back to its AI Help button", async () => {
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
    await waitFor(() => expect(screen.queryByTestId("assist-panel")).toBeNull());
    // Focus goes back to the AI Help button that opened it.
    await waitFor(() => expect(within(article).getByRole("button", { name: "AI Help with Central message" })).toHaveFocus());
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
    expect(await within(panel).findByText(/^Sources found: two independent sites in the search results report it\. Source quality varies/)).toBeInTheDocument();
    expect(within(panel).getByText("Needs checking: only one source was found. Read it before you use it.")).toBeInTheDocument();
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
    expect(within(article).queryByRole("button", { name: /^AI Help with/ })).toBeNull();
    // The core refuses too.
    await expect(api.assistantAsk({ preparationId: prep(api).id, action: "grammar", part: "introduction", text: "x" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("assistant settings", () => {
  it("is off until turned on, keeps the key out of sight, and checks the connection", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    const enabled = await within(region).findByRole("checkbox", { name: "Use the AI Assistant" });
    expect(enabled).not.toBeChecked();
    // Off: only the switch, no disabled form and no paragraph to read.
    expect(within(region).queryByRole("combobox", { name: "Service" })).toBeNull();
    expect(within(region).queryByRole("button", { name: "Check the connection" })).toBeNull();

    await user.click(enabled);
    expect(await within(region).findByText("The AI Assistant is on.")).toBeInTheDocument();
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

  it("review fixes: a first start fills the model, Enter keeps the key, Escape in a field stays, and a kept key follows its service", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    // The default service gets its suggested model without choosing it again.
    expect(within(region).getByRole("textbox", { name: "Model" })).toHaveValue("gpt-6.1-sol");

    // Enter in the key field keeps the key (it does not just save the form).
    await user.type(within(region).getByLabelText("Key"), "sk-openai{Enter}");
    expect(await within(region).findByText("The key is kept on this computer.")).toBeInTheDocument();
    expect(api.state.teaching.assistant.keys.get("openai")).toBe("sk-openai");
    expect(within(region).getByRole("button", { name: "Check the connection" })).toBeEnabled();

    // Escape while typing does not leave Settings.
    await user.type(within(region).getByRole("textbox", { name: "Model" }), "x");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    // A service chosen is saved at once, so a key already kept for it shows.
    api.state.teaching.assistant.keys.set("anthropic", "sk-ant");
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "anthropic");
    await waitFor(() => expect(api.state.teaching.assistant.config.provider).toBe("anthropic"));
    expect(await within(region).findByPlaceholderText("A key is kept (type to replace it)")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Check the connection" })).toBeEnabled();
  });

  it("offers each service by name, with a suggested model and plain help for its key", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    const service = within(region).getByRole("combobox", { name: "Service" });
    const offered = within(service).getAllByRole("option").map((o) => o.textContent);
    expect(offered).toEqual(
      expect.arrayContaining(["OpenAI (ChatGPT)", "Anthropic (Claude)", "Google Gemini", "xAI (Grok)", "Perplexity", "DeepSeek", "Qwen (Alibaba Cloud)", "Ollama", "LM Studio", "Other compatible service"]),
    );
    // Grouped by where it runs, not ranked by vendor.
    expect(within(service).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(["On the internet", "On this computer", "Other"]);

    for (const [kind, model] of [["xai", "grok-4.7"], ["perplexity", "sonar-pro"], ["deepseek", "deepseek-flash"], ["qwen", "qwen-plus"], ["google", "gemini-3.8-flash"], ["mistral", "mistral-large-latest"], ["cohere", "command-a-plus-05-2026"], ["moonshot", "kimi-k3"], ["zai", "glm-5.3"], ["minimax", "MiniMax-M2.7"]] as const) {
      await user.selectOptions(service, kind);
      expect(within(region).getByRole("textbox", { name: "Model" })).toHaveValue(model);
      expect(within(region).getByLabelText("Key")).toBeInTheDocument();
    }
    // On this computer: a suggested model to download, and no key.
    await user.selectOptions(service, "ollama");
    expect(within(region).getByRole("textbox", { name: "Model" })).toHaveValue("gemma4");
    expect(within(region).queryByLabelText("Key")).toBeNull();

    // "How do I get a key?": short answers and the service's own page.
    await user.selectOptions(service, "deepseek");
    await user.click(within(region).getByText("How do I get a key?"));
    // Step by step, assuming no technical knowledge.
    for (const step of [/Open the DeepSeek page/, /Sign in, or create an account/, /Create a new key/, /Copy it straight away/, /Come back to Abiding Word/, /Paste it into the Key field/, /Press Keep key/, /Press Check the connection/]) {
      expect(within(region).getByText(step)).toBeVisible();
    }
    expect(within(region).getByText(/may ask for payment details or prepaid credit/)).toBeVisible();
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
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
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
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "ollama");
    expect(within(region).getByText("Runs on this computer: your text does not leave it.")).toBeInTheDocument();
    await user.click(within(region).getByText("Advanced"));
    await user.type(within(region).getByRole("textbox", { name: "Address of the service" }), "http://127.0.0.1.nip.io/v1");
    expect(within(region).getByText("When you ask for help, the text you chose is sent over the internet to this service.")).toBeInTheDocument();
  });

  it("explains real-story research without promising truth, and keeps theology optional", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    // The explanation waits behind the help button.
    const searchHelp = within(region).getByRole("button", { name: "More about: Look up real stories" });
    const explanation = within(region).getByText(/A search service only finds pages: it does not decide what is true/);
    expect(explanation).not.toBeVisible();
    await user.click(searchHelp);
    expect(explanation).toBeVisible();
    expect(explanation).toHaveTextContent(/Read the sources before you use a story/);
    const words = region.textContent ?? "";
    expect(words).not.toMatch(/proves?|guarantee|verified as true/i);

    const theology = within(region).getByRole("textbox", { name: /How should the AI approach theological questions\?/ });
    expect(within(region).getByText("(optional)")).toBeInTheDocument();
    expect(theology).toHaveValue("");
    const help = within(region).getByRole("button", { name: "More about: How should the AI approach theological questions?" });
    await user.click(help);
    const note = within(region).getByText(/This does not ask about your life/);
    expect(note).toBeVisible();
    expect(note).toHaveTextContent(/still mentions other serious interpretations/);
    expect(note).toHaveTextContent(/no tradition is assumed/);
    // Examples to start from; nothing about the person's life is asked.
    const examples = within(region).getByRole("group", { name: "Examples:" });
    expect(within(examples).getAllByRole("button").map((b) => b.textContent)).toEqual(["Reformed evangelical", "Lutheran", "Roman Catholic", "Pentecostal", "No particular tradition"]);
    await user.click(within(examples).getByRole("button", { name: "Lutheran" }));
    expect(theology).toHaveValue("Lutheran");
    expect(words).not.toMatch(/biograph|testimony/i);
    await user.click(within(region).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.state.teaching.assistant.config.perspective).toBe("Lutheran"));
  });

  it("links each cloud service's own current model list and price list, and invents none for another service", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    const service = within(region).getByRole("combobox", { name: "Service" });
    // Every service on the internet, alphabetically, with its official models and prices pages.
    const internet = within(service).getByRole("group", { name: "On the internet" });
    expect(within(internet).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["anthropic", "cohere", "deepseek", "google", "minimax", "mistral", "moonshot", "openai", "perplexity", "qwen", "xai", "zai"]);
    const expected: [string, string, string, string | null][] = [
      ["openai", "OpenAI", "https://developers.openai.com/api/docs/models", "https://developers.openai.com/api/docs/pricing"],
      ["anthropic", "Anthropic", "https://platform.claude.com/docs/en/models/overview", "https://platform.claude.com/docs/en/about-claude/pricing"],
      ["google", "Google", "https://ai.google.dev/gemini-api/docs/models", "https://ai.google.dev/gemini-api/docs/pricing"],
      ["xai", "xAI", "https://docs.x.ai/developers/models", "https://docs.x.ai/developers/pricing"],
      ["perplexity", "Perplexity", "https://docs.perplexity.ai", "https://docs.perplexity.ai/docs/getting-started/pricing"],
      ["mistral", "Mistral AI", "https://docs.mistral.ai/models/model-selection-guide", "https://docs.mistral.ai/inference/pricing"],
      ["cohere", "Cohere", "https://docs.cohere.com/docs/models", "https://cohere.com/pricing"],
      // One page with both models and prices: one link.
      ["deepseek", "DeepSeek", "https://api-docs.deepseek.com/quick_start/pricing", null],
      ["qwen", "Alibaba Cloud", "https://www.alibabacloud.com/help/en/model-studio/models", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"],
      ["moonshot", "Moonshot AI", "https://platform.moonshot.ai", null],
      ["zai", "Z.ai", "https://z.ai/model-api", "https://docs.z.ai/guides/overview/pricing"],
      ["minimax", "MiniMax", "https://platform.minimax.io/docs/guides/models-intro", "https://platform.minimax.io/docs/guides/pricing-paygo"],
    ];
    for (const [kind, name, models, prices] of expected) {
      await user.selectOptions(service, kind);
      expect(within(region).getByRole("textbox", { name: "Model" })).not.toHaveValue("");
      await user.click(within(region).getByRole("button", { name: `See ${name}’s current models` }));
      expect(api.state.library.openedLinks.at(-1)).toBe(models);
      if (prices) {
        await user.click(within(region).getByRole("button", { name: `See ${name}’s prices` }));
        expect(api.state.library.openedLinks.at(-1)).toBe(prices);
      } else {
        expect(within(region).queryByRole("button", { name: `See ${name}’s prices` })).toBeNull();
      }
    }
    // Programs on this computer: their own lists of models to download.
    await user.selectOptions(service, "ollama");
    await user.click(within(region).getByRole("button", { name: "See models you can download for Ollama" }));
    expect(api.state.library.openedLinks.at(-1)).toBe("https://ollama.com/library");
    // Another compatible service: no list is made up.
    await user.selectOptions(service, "openai_compatible");
    expect(within(region).queryByRole("button", { name: /current models|models you can download|prices/ })).toBeNull();
    // The model stays editable.
    const model = within(region).getByRole("textbox", { name: "Model" });
    await user.type(model, "my-own-model");
    expect(model).toHaveValue("my-own-model");
  });

  it("offers Brave, Tavily and Exa plainly, keeps SearXNG and SerpApi apart, and never promises truth", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    const search = within(region).getByRole("combobox", { name: "Look up real stories" });
    const recommended = within(search).getByRole("group", { name: "Recommended" });
    expect(within(recommended).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Brave Search – simple general web search",
      "Tavily – search designed for AI assistants",
      "Exa – finds relevant sources and passages",
    ]);
    const advanced = within(search).getByRole("group", { name: "Other (advanced)" });
    expect(within(advanced).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "SearXNG – self-hosted, needs a server address",
      "SerpApi – Google results through SerpApi",
    ]);

    const pages: [string, string, string][] = [
      ["brave", "Brave Search", "https://brave.com/search/api/"],
      ["tavily", "Tavily", "https://app.tavily.com"],
      ["exa", "Exa", "https://dashboard.exa.ai/api-keys"],
      ["serpapi", "SerpApi", "https://serpapi.com/manage-api-key"],
    ];
    for (const [kind, name, url] of pages) {
      await user.selectOptions(search, kind);
      // Saved at once: the key status belongs to the chosen service.
      await waitFor(() => expect(api.state.teaching.assistant.config.search).toBe(kind));
      expect(within(region).getByRole("button", { name: "Check search" })).toBeDisabled();
      expect(within(region).getByText("To check the search, first paste its key and choose Keep key.")).toBeInTheDocument();
      // The set-up help is one closed line until asked.
      const setup = within(region).getByText(`How do I set up ${name}?`);
      await user.click(setup);
      await user.click(within(region).getByRole("button", { name: `Open the ${name} page` }));
      expect(api.state.library.openedLinks.at(-1)).toBe(url);
      await user.click(setup);
    }

    // A key kept for Exa belongs to Exa only.
    await user.selectOptions(search, "exa");
    await user.type(within(region).getByLabelText("Search key"), "exa-key{Enter}");
    await waitFor(() => expect(api.state.teaching.assistant.keys.get("search:exa")).toBe("exa-key"));
    await user.click(within(region).getByRole("button", { name: "Check search" }));
    expect(await within(region).findByText("The search service answered and found web pages.")).toBeInTheDocument();
    expect(api.state.teaching.assistant.searchTested).toBe(1);
    await user.selectOptions(search, "tavily");
    await waitFor(() => expect(within(region).getByRole("button", { name: "Check search" })).toBeDisabled());
    expect(within(region).getByPlaceholderText("Search key")).toBeInTheDocument();

    // SearXNG: an address, no key, its explanation behind the set-up line.
    await user.selectOptions(search, "searxng");
    expect(within(region).queryByLabelText("Search key")).toBeNull();
    expect(within(region).getByText(/If this means nothing to you, choose one of the recommended services/)).not.toBeVisible();
    expect(within(region).getByText("To check the search, first enter the SearXNG address.")).toBeInTheDocument();
    await user.type(within(region).getByRole("textbox", { name: "SearXNG address" }), "https://search.example.org");
    expect(within(region).getByRole("button", { name: "Check search" })).toBeEnabled();

    const words = region.textContent ?? "";
    expect(words).not.toMatch(/verif|proves?|guarantee|(?<!what )is true/i);
  });

  it("saves only the search part when the search service changes, keeping unsaved AI-service changes in the form", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    const model = within(region).getByRole("textbox", { name: "Model" });
    await user.clear(model);
    await user.type(model, "my-unsaved-model");
    await user.selectOptions(within(region).getByRole("combobox", { name: "Look up real stories" }), "exa");
    await waitFor(() => expect(api.state.teaching.assistant.config.search).toBe("exa"));
    // The model typed but not saved is neither saved nor lost.
    expect(api.state.teaching.assistant.config.model).not.toBe("my-unsaved-model");
    expect(model).toHaveValue("my-unsaved-model");
    expect(within(region).getByRole("combobox", { name: "Look up real stories" })).toBeEnabled();
  });

  it("says plainly whether images can be made, and lets OpenAI make them while another service writes", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    await user.click(within(region).getByRole("checkbox", { name: /Allow making images/ }));
    const capability = () => within(region).getByTestId("image-capability");
    // Nothing to say while it works: the line appears only when something needs attention.
    expect(within(region).queryByTestId("image-capability")).toBeNull();

    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "anthropic");
    await waitFor(() => expect(capability()).toHaveTextContent("Anthropic (Claude) cannot make images. Choose OpenAI for images, or leave this off."));
    // Google's image models need their own request, not built yet: not offered.
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "google");
    await waitFor(() => expect(capability()).toHaveTextContent("Google Gemini cannot make images."));
    // Another compatible service: Abiding Word cannot tell.
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "openai_compatible");
    await waitFor(() => expect(capability()).toHaveTextContent(/cannot tell whether Other compatible service can make images/));

    // Write with Claude, make images with OpenAI.
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "anthropic");
    await user.selectOptions(within(region).getByRole("combobox", { name: "Make images with" }), "openai");
    expect(within(region).queryByTestId("image-capability")).toBeNull();
    // Until an OpenAI key for images is kept, that is said plainly.
    expect(within(region).getByText(/No OpenAI key for images is kept yet/)).toBeInTheDocument();
    await user.type(within(region).getByLabelText("OpenAI key for images"), "sk-img{Enter}");
    await waitFor(() => expect(within(region).queryByText(/No OpenAI key for images is kept yet/)).toBeNull());
    await waitFor(() => expect(api.state.teaching.assistant.keys.get("openai")).toBe("sk-img"));
    expect(api.state.teaching.assistant.config).toMatchObject({ provider: "anthropic", imageService: "openai", generateImages: true });
    expect(api.state.teaching.assistant.keys.has("anthropic")).toBe(false);
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
    await user.click(within(article).getByRole("button", { name: "AI Help with Introduction" }));
    const menu = await within(article).findByRole("menu", { name: "AI Help with Introduction" });
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
    const help = within(article).getByRole("button", { name: "AI Help with Introduction" });
    help.focus();
    await user.keyboard("{Enter}");
    await within(article).findByRole("menu", { name: "AI Help with Introduction" });
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
    expect(within(article).getByRole("menu", { name: "AI Help with Introduction" })).toBeInTheDocument();
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
    await waitFor(() => expect(within(panel).getByRole("status")).toHaveTextContent("Asking the assistant…"));
    // Focus moves to Stop waiting (what had it is disabled while asking).
    expect(within(panel).getByRole("button", { name: "Stop waiting" })).toHaveFocus();
    const askButton = within(panel).getByRole("button", { name: "Ask" });
    expect(askButton).toBeDisabled();
    await user.click(askButton);
    fireEvent.keyDown(panel, { key: "Enter", ctrlKey: true });
    expect(api.state.teaching.assistant.asked).toHaveLength(1);

    await user.click(within(panel).getByRole("button", { name: "Stop waiting" }));
    expect(within(panel).queryByTestId("pending")).toBeNull();
    expect(within(panel).getByText(/^Stopped waiting. Nothing was changed./)).toHaveTextContent(/may count toward your use/);
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
    await waitFor(() => expect(within(panel).getByRole("status")).toHaveTextContent("Looking for sources… This can take a little while."));
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
    expect(find).toHaveAttribute("aria-disabled", "true");
    await user.click(find);
    expect(api.state.teaching.assistant.findCalls).toHaveLength(1);
    await act(async () => release());
    await waitFor(() => expect(within(panel).queryByText("Finding suitable images…")).toBeNull());

    release = holdOn(api);
    const make = within(panel).getByRole("button", { name: "Make an image" });
    await user.click(make);
    expect(within(panel).getByText("Creating an image… This can take a little while.")).toBeInTheDocument();
    expect(make).toHaveAttribute("aria-disabled", "true");
    await user.click(make);
    await act(async () => release());
    expect(await within(panel).findByText("Made by the assistant: an illustration, not a photograph")).toBeInTheDocument();
    expect(api.state.teaching.assistant.generated).toHaveLength(1);
  });
});

describe("the teaching canvas", () => {
  it("puts the writing first and keeps the details folded away until wanted", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    await startSermon(user);
    // Visited again later: the details start folded, and the writing comes first.
    await user.click(within(studyPane()).getByRole("button", { name: "Bible Study" }));
    await user.click(within(studyPane()).getByRole("button", { name: "Bible Teaching" }));
    const article = await within(studyPane()).findByRole("article", { name: "Sermon · Abiding" });
    const about = within(article).getByRole("button", { name: /^About this teaching/ });
    expect(about).toHaveAttribute("aria-expanded", "false");
    expect(within(article).queryByRole("textbox", { name: "Who it is for" })).toBeNull();
    expect(within(article).queryByRole("button", { name: "Delete this teaching" })).toBeNull();
    // The main parts are there at once, in order.
    const boxes = within(article).getAllByRole("textbox").map((b) => (b as HTMLInputElement).labels?.[0]?.textContent ?? "");
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
    expect(await within(article).findByRole("textbox", { name: "Where it may lead" })).toBeInTheDocument();
    expect(within(article).getByRole("textbox", { name: "Follow-up questions" })).toBeInTheDocument();
    await user.selectOptions(within(article).getByRole("combobox", { name: "Kind of teaching" }), "lesson");
    expect(await within(article).findByRole("heading", { name: "Lesson plan" })).toBeInTheDocument();
    expect(within(article).getByRole("textbox", { name: "What you will say or do" })).toBeInTheDocument();
    // The same point, only named differently: nothing was lost.
    expect(prep(api).points).toHaveLength(1);
  });

  it("starts a children's lesson with its steps, each of a kind, and shows the fields each kind needs", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    await openTeaching(user);
    const form = await within(studyPane()).findByRole("form", { name: "Prepare a teaching from this study" });
    await user.click(within(form).getByRole("radio", { name: "Children" }));
    // The kind says what it gives to work in, and what it starts with.
    expect(within(form).getByText(/A lesson in steps: teaching, Bible reading, questions, activities and pictures/)).toBeInTheDocument();
    expect(within(form).getByText("Starts with: Welcome · Bible story · Question · Activity · Prayer.")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Start" }));
    const article = await within(studyPane()).findByRole("article", { name: "Children · Abiding" });
    expect(prep(api).points.map((p) => [p.title, p.kind])).toEqual([
      ["Welcome", "text"],
      ["Bible story", "scripture"],
      ["Question", "question"],
      ["Activity", "activity"],
      ["Prayer", "text"],
    ]);
    expect(within(article).getByRole("heading", { name: "Lesson plan" })).toBeInTheDocument();
    // The welcome and the ending are steps: no separate introduction or conclusion.
    expect(within(article).queryByRole("textbox", { name: "Opening" })).toBeNull();
    expect(within(article).queryByRole("textbox", { name: "Ending" })).toBeNull();
    expect(field(article, "The one thing to remember")).toBeInTheDocument();
    const steps = within(article).getAllByRole("listitem", { name: /^Step \d/ });
    expect(within(steps[0]!).getByRole("textbox", { name: "What you will say" })).toBeInTheDocument();
    expect(within(steps[1]!).getByRole("textbox", { name: "How you will read or tell it" })).toBeInTheDocument();
    expect(within(steps[2]!).getByRole("textbox", { name: "Answers to listen for" })).toBeInTheDocument();
    expect(within(steps[3]!).getByRole("textbox", { name: "How it works" })).toBeInTheDocument();
    expect(within(steps[3]!).getByRole("textbox", { name: "What you need" })).toBeInTheDocument();
    // Fields a step does not use are not shown: no application or illustration under a welcome.
    expect(within(steps[0]!).queryByRole("textbox", { name: "What they should take away" })).toBeNull();

    // A step becomes a picture; what was written stays.
    await user.type(within(steps[0]!).getByRole("textbox", { name: "What you will say" }), "Hello everyone.");
    await settle();
    await user.selectOptions(within(steps[0]!).getByRole("combobox", { name: "Kind of step: Welcome" }), "image");
    await waitFor(() => expect(prep(api).points[0]!.kind).toBe("image"));
    const first = within(article).getAllByRole("listitem", { name: /^Step \d/ })[0]!;
    expect(within(first).getByRole("textbox", { name: "What it shows, and when you show it" })).toHaveValue("Hello everyone.");
    // A new step starts as teaching.
    await user.click(within(article).getByRole("button", { name: "Add a step" }));
    await waitFor(() => expect(prep(api).points).toHaveLength(6));
    expect(prep(api).points[5]!.kind).toBe("text");
  });

  it("keeps writing visible in a field the kind does not use, and an introduction written before", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Have you pruned a rose?");
    await settle();
    await openAbout(user, article);
    await user.selectOptions(within(article).getByRole("combobox", { name: "Kind of teaching" }), "children");
    // A lesson has no separate introduction, but what was written there is never hidden.
    expect(await within(article).findByRole("textbox", { name: "Opening" })).toHaveValue("Have you pruned a rose?");
    expect(within(article).queryByRole("textbox", { name: "Ending" })).toBeNull();
  });

  it("gives a group Bible study an opening, questions with follow-ups, and a closing", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    await openTeaching(user);
    const form = await within(studyPane()).findByRole("form", { name: "Prepare a teaching from this study" });
    await user.click(within(form).getByRole("radio", { name: "Group Bible study" }));
    expect(within(form).getByText(/Questions for the group, each with where it may lead/)).toBeInTheDocument();
    expect(within(form).queryByText(/^Starts with/)).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Start" }));
    const article = await within(studyPane()).findByRole("article", { name: "Group Bible study · Abiding" });
    expect(field(article, "Opening")).toBeInTheDocument();
    expect(field(article, "Closing")).toBeInTheDocument();
    expect(field(article, "What the group should discover")).toHaveAttribute("placeholder", "The one thing the conversation should lead to");
    expect(prep(api).points).toHaveLength(0);
    // No kinds of step outside a lesson.
    await user.click(within(article).getByRole("button", { name: "Add a question" }));
    await waitFor(() => expect(prep(api).points).toHaveLength(1));
    expect(prep(api).points[0]!.kind).toBeNull();
    expect(within(article).queryByRole("combobox", { name: /^Kind of step/ })).toBeNull();
  });

  it("works fully without the assistant", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Abide.");
    await settle();
    expect(prep(api).introduction).toBe("Abide.");
    expect(within(article).queryByRole("button", { name: /^AI Help with/ })).toBeNull();
    expect(within(article).queryByText(/assistant/i)).toBeNull();
  });
});

describe("the floating AI panel", () => {
  it("opens over the workspace without moving the teaching, as a non-modal dialog tied to its part", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "We dont stay.");
    await settle();
    const panel = await helpWith(user, article, "Introduction", "Check grammar and spelling");
    // Not inside the teaching: the text does not move.
    expect(article).not.toContainElement(panel);
    const floating = screen.getByRole("dialog", { name: "AI Assistant: Check grammar and spelling · Introduction" });
    expect(floating).toHaveAttribute("aria-modal", "false");
    expect(floating).toContainElement(panel);
    // The teaching stays usable while it is open.
    await user.type(field(article, "Conclusion"), "Abide.");
    expect(field(article, "Conclusion")).toHaveValue("Abide.");
    expect(screen.getByTestId("assist-panel")).toBeInTheDocument();
    // The panel keeps the part it was opened for.
    expect(within(panel).getByRole("heading", { level: 4 })).toHaveTextContent("Check grammar and spelling · Introduction");
  });

  it("minimises to a small chip and opens again with its request kept, by keyboard too", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    const panel = await helpWith(user, article, "Introduction", "Ask for something else…");
    await user.type(within(panel).getByRole("textbox", { name: "What would you like help with?" }), "Is this too long?");
    await user.click(screen.getByRole("button", { name: "Minimise" }));
    expect(screen.getByTestId("assist-panel")).not.toBeVisible();
    expect(screen.queryByRole("dialog", { name: /^AI Assistant/ })).toBeNull();
    // Named by what it shows.
    const chip = screen.getByRole("button", { name: "AI Help · Ask for something else… · Introduction" });
    await waitFor(() => expect(chip).toHaveFocus());
    await user.keyboard("{Enter}");
    const again = screen.getByTestId("assist-panel");
    expect(again).toBeVisible();
    expect(within(again).getByRole("textbox", { name: "What would you like help with?" })).toHaveValue("Is this too long?");
  });

  it("shows one panel at a time: asking about another part moves it there", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "One.");
    await user.type(field(article, "Conclusion"), "Two.");
    await settle();
    await helpWith(user, article, "Introduction", "Check grammar and spelling");
    await helpWith(user, article, "Conclusion", "Make it clearer");
    const panels = screen.getAllByTestId("assist-panel");
    expect(panels).toHaveLength(1);
    expect(within(panels[0]!).getByRole("heading", { level: 4 })).toHaveTextContent("Make it clearer · Conclusion");
  });

  it("offers Make an image only where the service can make images, with the reason, while Find stays", async () => {
    const { api } = await setup({ assistant: true });
    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, provider: "anthropic", generateImages: true });
    await api.assistantKeySet("provider", "sk-ant");
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Jesus is the vine.");
    await settle();
    // The menu says so beside the picture ideas.
    await user.click(within(article).getByRole("button", { name: "AI Help with Introduction" }));
    await user.click(within(article).getByRole("menuitem", { name: "Ideas and illustrations" }));
    expect(within(article).getByText(/This AI service cannot make images/)).toBeInTheDocument();
    await user.keyboard("{Escape}{Escape}");

    api.state.teaching.assistant.replies.push({
      result: { type: "visuals", ideas: [{ description: "A vine", kind: "photo", searchTerms: "grapevine" }] },
      assistant: "Anthropic · test-model",
      remote: true,
    });
    const panel = await helpWith(user, article, "Introduction", "Suggest a visual");
    await ask(user, panel);
    const make = await within(panel).findByRole("button", { name: "Make an image" });
    expect(make).toBeDisabled();
    expect(make).toHaveAccessibleDescription(/This AI service cannot make images/);
    expect(within(panel).getByRole("button", { name: "Find freely licensed images" })).toBeEnabled();
  });
});

describe("review fixes: the floating panel and images", () => {
  it("never applies an earlier answer to a later selection: a new request starts a new panel", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Alpha one. Beta two.");
    await settle();
    const area = field(article, "Introduction") as HTMLTextAreaElement;
    api.state.teaching.assistant.replies.push(proposal("Alpha ONE."));
    area.setSelectionRange(0, 10);
    let panel = await helpWith(user, article, "Introduction", "Make it clearer");
    await ask(user, panel);
    await within(panel).findByRole("button", { name: "Use this wording" });
    // Ask again about another selection: the old answer is gone.
    area.setSelectionRange(11, 20);
    panel = await helpWith(user, article, "Introduction", "Make it clearer");
    expect(within(panel).queryByRole("button", { name: "Use this wording" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Ask" })).toBeInTheDocument();
    expect(area).toHaveValue("Alpha one. Beta two.");
  });

  it("opens again from minimised when a new request is chosen", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await helpWith(user, article, "Introduction", "Ask for something else…");
    await user.click(screen.getByRole("button", { name: "Minimise" }));
    expect(screen.getByTestId("assist-panel")).not.toBeVisible();
    const panel = await helpWith(user, article, "Introduction", "Ask for something else…");
    expect(panel).toBeVisible();
    expect(screen.queryByRole("button", { name: /^AI Help · / })).toBeNull();
  });

  it("can be moved with the arrow keys and minimised with Escape on its top bar", async () => {
    const { api } = await setup({ assistant: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await helpWith(user, article, "Introduction", "Ask for something else…");
    const floating = screen.getByTestId("assist-floating");
    const move = within(floating).getByRole("button", { name: "Move the panel (arrow keys)" });
    const before = floating.style.top;
    move.focus();
    await user.keyboard("{ArrowDown}");
    expect(floating.style.top).not.toBe(before);
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("assist-panel")).not.toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: /^AI Help · Ask for something else/ })).toHaveFocus());
  });

  it("says where an image description goes before an image is made", async () => {
    const { api } = await setup({ assistant: true });
    await api.assistantSettingsSet({ ...api.state.teaching.assistant.config, generateImages: true });
    const { user } = await renderApp(api);
    const article = await startSermon(user);
    await user.type(field(article, "Introduction"), "Jesus is the vine.");
    await settle();
    api.state.teaching.assistant.replies.push({
      result: { type: "visuals", ideas: [{ description: "A vine", kind: "photo", searchTerms: "grapevine" }] },
      assistant: "OpenAI · test-model",
      remote: true,
    });
    const panel = await helpWith(user, article, "Introduction", "Suggest a visual");
    await ask(user, panel);
    expect(await within(panel).findByText("Making an image sends this idea’s description to OpenAI (ChatGPT) over the internet.")).toBeInTheDocument();
  });

  it("says when making images waits for the OpenAI key, and that images leave a local set-up", async () => {
    const { user, api } = await renderApp(createMemoryApi());
    const region = await openSettingsSection(user, "AI Assistant");
    await user.click(await within(region).findByRole("checkbox", { name: "Use the AI Assistant" }));
    await user.selectOptions(within(region).getByRole("combobox", { name: "Service" }), "ollama");
    await user.click(within(region).getByRole("checkbox", { name: /Allow making images/ }));
    await user.selectOptions(within(region).getByRole("combobox", { name: "Make images with" }), "openai");
    expect(within(region).getByText("Runs on this computer: your text does not leave it.")).toBeInTheDocument();
    expect(within(region).getByText(/Image descriptions are sent to OpenAI over the internet/)).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.state.teaching.assistant.config.imageService).toBe("openai"));
    // Without the key, images cannot be made yet, and Teaching says why.
    const settings = await api.assistantSettingsGet();
    expect(settings.canGenerateImages).toBe(false);
  });
});
