import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { textDirection } from "@/features/scripture/ConcordanceView";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The concordance (v0.12): surface-form occurrences in one Bible. All text is invented.

function withBible() {
  const api = createMemoryApi();
  const bible = api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  api.setVerseText(bible.id, "ROM.8.1", "Saved by grace, not by disgrace.");
  api.setVerseText(bible.id, "ROM.8.2", "Grace upon grace.");
  api.setVerseText(bible.id, "JHN.15.1", "By grace through faith.");
  api.setVerseText(bible.id, "PSA.23.2", "בְּרֵאשִׁית בָּרָא");
  return { api, bible };
}

const pane = () => screen.getByRole("complementary", { name: "Scripture" });
type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function concordance(user: User) {
  await within(pane()).findByRole("heading", { level: 2 });
  await user.click(within(pane()).getByRole("button", { name: "Concordance" }));
  return within(pane());
}

async function find(user: User, query: string, mode: "Word" | "Phrase" = "Word") {
  const view = within(pane());
  const box = view.getByLabelText("Word or phrase");
  await user.clear(box);
  await user.type(box, query);
  await user.click(view.getByRole("radio", { name: mode }));
  await user.click(view.getByRole("button", { name: "Find" }));
}

describe("Concordance", () => {
  it("finds whole words, counts occurrences, groups by book in Bible order and marks each one", async () => {
    const { user } = await renderApp(withBible().api);
    const view = await concordance(user);
    await find(user, "Grace");
    await waitFor(() => expect(view.getByRole("status")).toHaveTextContent("4 occurrences")); // not "disgrace"
    expect(view.getByRole("status")).toHaveTextContent("4 occurrences · in 3 verses");
    const groups = view.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(groups).toEqual(["John (1)", "Romans (3)"]);
    const romans = view.getByRole("region", { name: "Romans (3)" });
    const verse2 = within(romans).getByRole("button", { name: "Open Romans 8:2 in the Bible" });
    expect([...verse2.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Grace", "grace"]);
    expect(verse2.textContent).toContain("Grace upon grace.");
  });

  it("looks for a phrase only as words together, and says when a word is really a phrase", async () => {
    const { user } = await renderApp(withBible().api);
    const view = await concordance(user);
    await find(user, "by grace", "Phrase");
    await waitFor(() => expect(view.getByRole("status")).toHaveTextContent("2 occurrences"));
    await find(user, "by grace", "Word");
    expect(await view.findByRole("alert")).toHaveTextContent("That is more than one word. Choose Phrase to look for words together.");
  });

  it("says plainly when a word does not occur", async () => {
    const { user } = await renderApp(withBible().api);
    const view = await concordance(user);
    await find(user, "zebra");
    expect(await view.findByText("“zebra” does not occur in this Bible.")).toBeInTheDocument();
    expect(view.queryByRole("heading", { level: 3, name: "Books" })).toBeNull();
  });

  it("opens an occurrence in the Bible, with Back, and the Study's passage untouched", async () => {
    const { api } = withBible();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Series" });
    const vine = await api.studyCreate({ projectId: project.id, title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const before = JSON.stringify(api.state.passages);
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /The True Vine/ }));
    await within(pane()).findByText(/showing John 15:1–11/);
    const view = await concordance(user);
    await find(user, "grace");
    await user.click(await view.findByRole("button", { name: "Open Romans 8:2 in the Bible" }));
    expect(await within(pane()).findByText(/showing Romans 8:2/)).toBeInTheDocument();
    expect(within(pane()).getByRole("button", { name: "Back to John 15:1–11" })).toBeInTheDocument();
    await user.click(within(pane()).getByRole("button", { name: "Back" }));
    expect(await within(pane()).findByText(/showing John 15:1–11/)).toBeInTheDocument();
    // the occurrences are still there on coming back
    await user.click(within(pane()).getByRole("button", { name: "Concordance" }));
    expect(within(pane()).getByRole("status")).toHaveTextContent("4 occurrences");
    expect(JSON.stringify(api.state.passages)).toBe(before);
    expect((await api.studyPassageList(vine.study.id)).map((p) => p.reference.canonical)).toEqual(["JHN.15.1-JHN.15.11"]);
  });

  it("shows Hebrew right to left and keeps the rest of the pane as it is", async () => {
    const { user } = await renderApp(withBible().api);
    const view = await concordance(user);
    expect(view.getByLabelText("Word or phrase")).toHaveAttribute("dir", "auto");
    await find(user, "בראשית");
    const hit = await view.findByRole("button", { name: /Psalm 23:2/ });
    expect(hit.querySelector("[dir='rtl']")).not.toBeNull();
    expect(hit.querySelector("[dir='rtl'] mark")?.textContent).toBe("בְּרֵאשִׁית");
    expect(pane().getAttribute("dir")).toBeNull();
    expect(textDirection("Grace")).toBeUndefined();
    expect(textDirection("אֶת־הָאָרֶץ")).toBe("rtl");
  });

  it("looks in the Bible chosen", async () => {
    const { api } = withBible();
    const other = api.installFixtureBible("FXB", "beta");
    api.setVerseText(other.id, "PSA.23.1", "Only grace here.");
    const { user } = await renderApp(api);
    const view = await concordance(user);
    await user.selectOptions(view.getByRole("combobox", { name: "Bible" }), "FXB");
    await find(user, "grace");
    await waitFor(() => expect(view.getByRole("status")).toHaveTextContent("1 occurrence"));
    expect(api.concordanceCalls.at(-1)?.translationId).toBe(other.id);
  });

  it("with many verses, lists books and loads a book's verses when it is opened", async () => {
    const { api, bible } = withBible();
    for (let v = 1; v <= 210; v++) api.setVerseText(bible.id, `PSA.119.${v}`, `Grace number ${v}.`);
    const { user } = await renderApp(api);
    const view = await concordance(user);
    await find(user, "grace");
    const psalms = await view.findByRole("button", { name: "Psalms (210)" });
    expect(psalms).toHaveAttribute("aria-expanded", "false");
    expect(view.queryByRole("button", { name: /Open Psalm 119:1 / })).toBeNull();
    await user.click(psalms);
    expect(psalms).toHaveAttribute("aria-expanded", "true");
    expect(await view.findByRole("button", { name: "Open Psalm 119:1 in the Bible" })).toBeInTheDocument();
    expect(api.concordanceCalls.at(-1)?.book).toBe("PSA");
  });
});

describe("A word study's occurrences", () => {
  it("are looked up from the study, in its Bible, without copying anything into it", async () => {
    const { api, bible } = withBible();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Words" });
    const study = await api.studyCreate({ projectId: project.id, title: "Grace", studyType: "word" });
    await api.studyUpdate({ id: study.study.id, details: { lemma: "grace" } });
    const findingsBefore = api.state.findings.length;
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /Grace/ }));
    await user.click(await screen.findByRole("button", { name: "Bible Study information" }));
    expect(screen.getByRole("textbox", { name: "Word" })).toHaveAttribute("dir", "auto");
    await user.click(screen.getByRole("button", { name: "Find occurrences" }));
    await waitFor(() => expect(within(pane()).getByRole("status")).toHaveTextContent("4 occurrences"));
    expect(within(pane()).getByLabelText("Word or phrase")).toHaveValue("grace");
    expect(api.concordanceCalls.at(-1)).toMatchObject({ translationId: bible.id, query: "grace", mode: "word" });
    expect(api.state.findings.length).toBe(findingsBefore);
    await waitFor(() => expect(api.state.studies.find((s) => s.id === study.study.id)?.details?.lemma).toBe("grace"));
  });
});

describe("Concordance words in each language", () => {
  it("uses the established term for each language, and Korean says 용례", async () => {
    const { readFileSync } = await import("node:fs");
    const label = (lang: string) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/scripture.json`, "utf8")).marks.concordance as string;
    expect([label("en"), label("de"), label("ko"), label("fr"), label("es"), label("pt")]).toEqual([
      "Concordance", "Konkordanz", "용례 찾기", "Concordance", "Concordancia", "Concordância",
    ]);
    const ko = JSON.parse(readFileSync("src/i18n/locales/ko/scripture.json", "utf8")).concordance;
    expect(JSON.stringify(ko)).not.toMatch(/콘코던스|프로젝트|템플릿|섹션|블록/);
  });
});
