import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The workspace's visual hierarchy (v0.18.4): the Study or Teaching is the
// current work, Scripture and Sources support it; the open teaching starts with
// two quiet lines, and what it becomes is gathered under Materials, of which
// the presentation is one kind.

async function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  const prep = await api.teachingCreate({ studyId: study.id, title: "Remain in the vine", kind: "sermon", points: [{ title: "Stay connected" }] });
  await api.teachingUpdate({ id: prep.id, audience: "The whole church", centralMessage: "Fruit comes from remaining." });
  return api;
}

// Names in the language in use, so the same steps work in every language.
const studyPane = () => screen.getByRole("main", { name: i18n.t("app.panes.name.study") });

async function openTeaching(api: ReturnType<typeof createMemoryApi>, teaching = "Bible Teaching") {
  const { user } = await renderApp(api);
  await user.click(within(await screen.findByRole("list", { name: i18n.t("studies.list.listLabel") })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: i18n.t("studies.editor.titleLabel") });
  await user.click(within(studyPane()).getByRole("button", { name: teaching }));
  const article = await within(studyPane()).findByRole("article", { name: "Remain in the vine" });
  return { user, article };
}

describe("the three panes", () => {
  it("give the work the leading surface, Scripture one step back, Sources two", async () => {
    const api = await setup();
    await renderApp(api);
    expect(studyPane().className).toContain("bg-pane-work");
    expect(screen.getByRole("complementary", { name: "Scripture" }).className).toContain("bg-pane-scripture");
    expect(screen.getByRole("complementary", { name: "Sources" }).className).toContain("bg-pane-sources");
  });

  it("switch views with quiet tabs whose choice is pressed, not only coloured", async () => {
    const api = await setup();
    const { user } = await openTeaching(api);
    const views = within(studyPane()).getByRole("group", { name: i18n.t("studies.view.label") });
    const [study, teaching] = within(views).getAllByRole("button");
    expect(teaching).toHaveAttribute("aria-pressed", "true");
    expect(study).toHaveAttribute("aria-pressed", "false");
    for (const tab of [study!, teaching!]) expect(tab.className).toBe("aw-tab");
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    const bible = within(scripture).getByRole("button", { name: "Bible", pressed: true });
    expect(bible.className).toBe("aw-tab");
    await user.click(within(scripture).getByRole("button", { name: "Marks" }));
    expect(within(scripture).getByRole("button", { name: "Marks" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the open Bible Teaching", () => {
  it("starts with two lines: its title with Materials, then its details and the way to another", async () => {
    const api = await setup();
    const { article } = await openTeaching(api);
    const header = article.querySelector("header")!;
    const head = within(header);
    expect(head.getByRole("textbox", { name: "Title" })).toHaveValue("Remain in the vine");
    expect(head.getByRole("button", { name: "Materials" })).toHaveAttribute("aria-haspopup", "menu");
    expect(head.getByRole("button", { name: /^About this teaching/ })).toHaveAttribute("aria-expanded", "false");
    expect(head.getByRole("button", { name: "Prepare another Bible Teaching" })).toBeInTheDocument();
    // Nothing else stands between the header and the work: the folded details, then the central message.
    const details = header.nextElementSibling as HTMLElement;
    expect(details).not.toBeVisible();
    expect(within(details.nextElementSibling as HTMLElement).getByRole("textbox", { name: "Central message" })).toHaveValue("Fruit comes from remaining.");
    // The title wraps in a narrow pane but stays one line of text.
    const title = head.getByRole("textbox", { name: "Title" });
    expect(title.tagName).toBe("TEXTAREA");
  });

  it("keeps the title one line of text: Enter does not break it", async () => {
    const api = await setup();
    const { user, article } = await openTeaching(api);
    const title = within(article).getByRole("textbox", { name: "Title" });
    await user.click(title);
    await user.keyboard("{End}{Enter} today");
    expect(title).toHaveValue("Remain in the vine today");
  });

  it("gathers what it becomes under Materials; the presentation is one kind of material", async () => {
    const api = await setup();
    const { user, article } = await openTeaching(api);
    // "Presentation" is no longer the umbrella.
    expect(within(studyPane()).queryByRole("button", { name: "Presentation" })).toBeNull();
    const materials = within(article).getByRole("button", { name: "Materials" });
    await user.click(materials);
    const menu = screen.getByRole("menu", { name: "Materials" });
    const items = within(menu).getAllByRole("menuitem");
    // Only what exists is offered: no manuscript or worksheet pretends to be there.
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Presentation");
    expect(items[0]).toHaveTextContent("Slides for the screen, made from this teaching");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(materials).toHaveFocus();
    await user.click(materials);
    await user.click(screen.getByRole("menuitem", { name: /^Presentation/ }));
    const region = await within(studyPane()).findByRole("region", { name: "Presentation of “Remain in the vine”" });
    await user.click(within(region).getByRole("button", { name: "Back to the teaching" }));
    await waitFor(() => expect(within(studyPane()).getByRole("button", { name: "Materials" })).toHaveFocus());
  });

  it.each([
    ["de", "Bibellehre", "Unterlagen", "Präsentation"],
    ["ko", "성경 가르침", "가르침 자료", "프레젠테이션"],
    ["fr", "Enseignement biblique", "Supports", "Présentation"],
    ["es", "Enseñanza bíblica", "Materiales", "Presentación"],
    ["pt", "Ensino bíblico", "Materiais", "Apresentação"],
  ])("names Materials naturally in %s", async (lang, teaching, materials, presentation) => {
    await i18n.changeLanguage(lang);
    try {
      const api = await setup();
      const { user, article } = await openTeaching(api, teaching);
      await user.click(within(article).getByRole("button", { name: materials }));
      expect(within(screen.getByRole("menu", { name: materials })).getByRole("menuitem", { name: new RegExp(`^${presentation}`) })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
