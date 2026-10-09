import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Scripture links inside Library sources, Reading view (v0.11). All text is invented.

const MANY: SourceFixture = {
  title: "Notes on Abiding",
  format: "text",
  language: "English",
  segments: [
    { text: "Introduction without references." },
    { text: "Compare John 15:5, Romans 6:1-4, and Galatians 2:20." },
    { text: "Close together: John 3:16;Romans 8:1 (both)." },
  ],
  mentions: [
    { segment: 1, reference: "JHN.15.5", matchedText: "John 15:5" },
    { segment: 1, reference: "ROM.6.1-ROM.6.4", matchedText: "Romans 6:1-4" },
    { segment: 1, reference: "GAL.2.20", matchedText: "Galatians 2:20" },
    { segment: 2, reference: "JHN.3.16", matchedText: "John 3:16" },
    { segment: 2, reference: "ROM.8.1", matchedText: "Romans 8:1" },
  ],
};

function withLibrary(...fixtures: SourceFixture[]) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  for (const fixture of fixtures) api.installFixtureSource(fixture);
  return api;
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
const scripture = () => screen.getByRole("complementary", { name: "Scripture" });
type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function openSource(user: User, title: string) {
  // the source may be listed twice (sources for the passage, recently added); either opens it
  await user.click((await within(sourcesPane()).findAllByRole("button", { name: new RegExp(`^${title}`) }))[0]!);
  return within(sourcesPane()).findByRole("region", { name: title });
}
const reference = (root: HTMLElement, passage: string) => within(root).findByRole("button", { name: `${passage} (Scripture reference)` });

describe("Scripture references in the Reading view", () => {
  it("makes each reference in a paragraph its own quiet action and keeps the text exactly", async () => {
    const { user } = await renderApp(withLibrary(MANY));
    const reader = await openSource(user, "Notes on Abiding");
    for (const passage of ["John 15:5", "Romans 6:1–4", "Galatians 2:20", "John 3:16", "Romans 8:1"]) {
      expect(await reference(reader, passage)).toHaveAttribute("aria-haspopup", "menu");
    }
    const paragraph = (await reference(reader, "John 15:5")).closest("p")!;
    expect(paragraph.textContent).toBe("Compare John 15:5, Romans 6:1-4, and Galatians 2:20.");
    const adjacent = (await reference(reader, "John 3:16")).closest("p")!;
    expect(adjacent.textContent).toBe("Close together: John 3:16;Romans 8:1 (both).");
    // a paragraph without references has no actions
    expect(within(within(reader).getByText("Introduction without references.")).queryByRole("button")).toBeNull();
    // no external link behaviour
    expect(reader.querySelector("[data-scripture-ref] a[href]")).toBeNull();
  });

  it("offers Open in Bible, and Escape closes the menu and returns focus", async () => {
    const { user } = await renderApp(withLibrary(MANY));
    const reader = await openSource(user, "Notes on Abiding");
    const ref = await reference(reader, "Romans 6:1–4");
    await user.click(ref);
    expect(ref).toHaveAttribute("aria-expanded", "true");
    const menu = within(reader).getByRole("menu", { name: "Actions for Romans 6:1–4" });
    const item = within(menu).getByRole("menuitem", { name: "Open in Bible" });
    expect(item).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(within(reader).queryByRole("menu")).not.toBeInTheDocument();
    expect(ref).toHaveFocus();
    expect(ref).toHaveAttribute("aria-expanded", "false");
  });

  it("a click alone navigates nothing; Open in Bible moves Scripture", async () => {
    const { user } = await renderApp(withLibrary(MANY));
    const reader = await openSource(user, "Notes on Abiding");
    expect(await within(scripture()).findByRole("heading", { level: 2 })).toHaveTextContent("Psalm 23");
    await user.click(await reference(reader, "Romans 6:1–4"));
    expect(within(scripture()).getByRole("heading", { level: 2 })).toHaveTextContent("Psalm 23");
    await user.click(within(reader).getByRole("menuitem", { name: "Open in Bible" }));
    expect(await within(scripture()).findByText(/showing Romans 6:1–4/)).toBeInTheDocument();
    expect(within(scripture()).getByRole("heading", { level: 2 })).toHaveTextContent("Romans 6");
    // Scripture's own Back returns to where it was
    await user.click(within(scripture()).getByRole("button", { name: "Back" }));
    expect(await within(scripture()).findByRole("heading", { level: 2 })).toHaveTextContent("Psalm 23");
  });

  it("works from the keyboard", async () => {
    const { user } = await renderApp(withLibrary(MANY));
    const reader = await openSource(user, "Notes on Abiding");
    (await reference(reader, "Galatians 2:20")).focus();
    await user.keyboard("{Enter}");
    expect(within(reader).getByRole("menuitem", { name: "Open in Bible" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await within(scripture()).findByRole("heading", { level: 2 })).toHaveTextContent("Galatians 2");
  });

  it("never changes the Study: its primary passage stays and Back to it is offered", async () => {
    const api = withLibrary(MANY);
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Series" });
    const vine = await api.studyCreate({ projectId: project.id, title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const passagesBefore = JSON.stringify(api.state.passages);
    const studiesBefore = JSON.stringify(api.state.studies);
    const findingsBefore = JSON.stringify(api.state.findings);
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /The True Vine/ }));
    await within(scripture()).findByText(/showing John 15:1–11/);
    const reader = await openSource(user, "Notes on Abiding");
    await user.click(await reference(reader, "Romans 6:1–4"));
    await user.click(within(reader).getByRole("menuitem", { name: "Open in Bible" }));
    expect(await within(scripture()).findByText(/showing Romans 6:1–4/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Study title" })).toHaveValue("The True Vine");
    expect(JSON.stringify(api.state.passages)).toBe(passagesBefore);
    expect(JSON.stringify(api.state.studies)).toBe(studiesBefore);
    expect(JSON.stringify(api.state.findings)).toBe(findingsBefore);
    expect((await api.studyPassageList(vine.study.id)).map((p) => p.reference.canonical)).toEqual(["JHN.15.1-JHN.15.11"]);
    await user.click(within(scripture()).getByRole("button", { name: "Back to John 15:1–11" }));
    expect(await within(scripture()).findByText(/showing John 15:1–11/)).toBeInTheDocument();
  });

  it("from the full reader, opens Scripture and keeps the source beside it", async () => {
    const { user } = await renderApp(withLibrary(MANY));
    await openSource(user, "Notes on Abiding");
    await user.click(within(sourcesPane()).getByRole("button", { name: "Open full reader" }));
    await screen.findByRole("heading", { level: 1, name: "Notes on Abiding" });
    const full = document.body;
    expect(screen.queryByRole("complementary", { name: "Scripture" })).not.toBeInTheDocument();
    await user.click(await reference(full, "John 15:5"));
    await user.click(within(full).getByRole("menuitem", { name: "Open in Bible" }));
    expect(await within(scripture()).findByText(/showing John 15:5/)).toBeInTheDocument();
    expect(await within(sourcesPane()).findByRole("region", { name: "Notes on Abiding" })).toBeInTheDocument();
  });
});

const LANGUAGES: { language: string; text: string; written: string }[] = [
  { language: "Deutsch", text: "Vergleiche Röm 6,1–4 im Zusammenhang.", written: "Röm 6,1–4" },
  { language: "한국어", text: "로마서 6장 1-4절을 함께 읽으라.", written: "로마서 6장 1-4절" },
  { language: "Français", text: "Comparez Romains 6,1-4 avec soin.", written: "Romains 6,1-4" },
  { language: "Español", text: "Compara Romanos 6:1-4 con calma.", written: "Romanos 6:1-4" },
  { language: "Português", text: "Compare Romanos 6:1-4 com calma.", written: "Romanos 6:1-4" },
];

describe("References written in other languages", () => {
  for (const { language, text, written } of LANGUAGES) {
    it(`${language}: the reference as written opens Romans 6:1–4`, async () => {
      const fixture: SourceFixture = {
        title: `Source in ${language}`,
        format: "text",
        language,
        segments: [{ text }],
        mentions: [{ segment: 0, reference: "ROM.6.1-ROM.6.4", matchedText: written }],
      };
      const { user } = await renderApp(withLibrary(fixture));
      const reader = await openSource(user, `Source in ${language}`);
      const ref = await reference(reader, "Romans 6:1–4");
      expect(ref).toHaveTextContent(written);
      expect(ref.closest("p")!.textContent).toBe(text);
      await user.click(ref);
      await user.click(within(reader).getByRole("menuitem", { name: "Open in Bible" }));
      await waitFor(() => expect(within(scripture()).getByText(/showing Romans 6:1–4/)).toBeInTheDocument());
    });
  }

  it("Deutsch: “Mal 4,3” opens Malachi 4:3 and the word “mal” stays text", async () => {
    // v0.11 acceptance: the German abbreviation of Maleachi (verse required).
    const text = "Vergleiche Mal 4,3 – lass uns mal sehen.";
    const fixture: SourceFixture = {
      title: "Maleachi auf Deutsch",
      format: "text",
      language: "Deutsch",
      segments: [{ text }],
      mentions: [{ segment: 0, reference: "MAL.4.3", matchedText: "Mal 4,3" }],
    };
    const { user } = await renderApp(withLibrary(fixture));
    const reader = await openSource(user, "Maleachi auf Deutsch");
    const ref = await reference(reader, "Malachi 4:3");
    expect(ref).toHaveTextContent("Mal 4,3");
    expect(ref.closest("p")!.textContent).toBe(text);
    expect(within(reader).getAllByRole("button", { name: /\(Scripture reference\)$/ })).toHaveLength(1);
    await user.click(ref);
    await user.click(within(reader).getByRole("menuitem", { name: "Open in Bible" }));
    await waitFor(() => expect(within(scripture()).getByText(/showing Malachi 4:3/)).toBeInTheDocument());
  });
});
