import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

async function withStudy(title = "The True Vine", extra: { studyType?: "custom" | "passage" } = {}) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Sermon Series" });
  await api.studyCreate({ projectId: project.id, title, ...extra });
  return api;
}

async function open(api: ReturnType<typeof createMemoryApi>, width = 1440, title: RegExp = /The True Vine|Loose/) {
  const { user } = await renderApp(api, { width });
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: title }));
  await screen.findByRole("textbox", { name: "Study title" });
  return user;
}

const study = () => within(screen.getByRole("main", { name: "Study" }));

describe("contents", () => {
  it("has no Contents control for a short study", async () => {
    const api = await withStudy("Loose notes", { studyType: "custom" });
    await open(api);
    expect(study().queryByRole("button", { name: "Contents" })).not.toBeInTheDocument();
    expect(study().queryByRole("navigation", { name: "Study contents" })).not.toBeInTheDocument();
  });

  it("has no Contents control for a long study either: its parts are headings in the study", async () => {
    const api = await withStudy();
    await open(api);
    expect(study().queryByRole("button", { name: "Contents" })).not.toBeInTheDocument();
    expect(study().getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(4);
  });
});

describe("a new study", () => {
  it("is calm: its few parts, ready to write in, and nothing else to choose", async () => {
    const api = await withStudy();
    await open(api);
    // Six parts, each with a writing area and its guidance; no notes area, no filter, no start prompt.
    expect(study().getAllByRole("heading", { level: 2 })).toHaveLength(6);
    expect(study().getAllByRole("textbox", { name: /: paragraph$/ })).toHaveLength(6);
    expect(study().queryByText("Start your study")).not.toBeInTheDocument();
    expect(study().queryByRole("heading", { name: "Other notes" })).not.toBeInTheDocument();
    expect(study().queryByRole("combobox", { name: "Show notes" })).not.toBeInTheDocument();
    // Per-part controls are tucked away until asked for.
    expect(study().queryByRole("button", { name: "Move part Text down" })).not.toBeInTheDocument();
    expect(study().queryByRole("group", { name: "Add to Text" })).not.toBeInTheDocument();
    expect(study().queryByRole("button", { name: "Question" })).not.toBeInTheDocument();
  });

  it("puts a note that belongs to no part under Other notes, at the end of the study", async () => {
    const api = await withStudy();
    const user = await open(api);
    await user.click(study().getByRole("button", { name: "Note" }));
    await user.type(study().getByLabelText("New observation"), "Branches depend on the vine.");
    await user.click(study().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.state.findings).toHaveLength(1));
    expect(api.state.findings[0]).toMatchObject({ findingType: "observation", sectionId: null });
    const other = await study().findByRole("region", { name: "Other notes" });
    // after the last part
    const lastPart = study().getByRole("region", { name: "Application" });
    expect(lastPart.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the kind changeable while writing, and links a passage only when asked", async () => {
    const api = await withStudy();
    const user = await open(api);
    await user.click(study().getByRole("button", { name: "Note" }));
    await user.click(study().getByRole("radio", { name: "Application" }));
    await user.type(study().getByLabelText("New application"), "Stay close.");
    await user.click(study().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.state.findings[0]?.findingType).toBe("application"));
    expect(api.state.findings[0]?.passages).toHaveLength(0);
  });
});

describe("findings and sections in the page", () => {
  it("shows a note as its text, with kind as a quiet label and the rest under Details", async () => {
    const api = await withStudy();
    await api.findingCreate({ studyId: api.state.studies[0]!.id, findingType: "question", content: "What is the fruit?" });
    const user = await open(api);
    const list = await screen.findByRole("list", { name: "Other notes" });
    const note = within(list).getByRole("article");
    expect(within(note).getByRole("textbox", { name: "Question text" })).toHaveValue("What is the fruit?");
    expect(within(note).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(note).queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
    await user.click(within(note).getByRole("button", { name: /^Details for question/ }));
    expect(within(note).getAllByRole("combobox")).toHaveLength(2);
    expect(within(note).getByRole("button", { name: "Delete question" })).toBeInTheDocument();
    expect(within(note).getByRole("button", { name: "+ Add source" })).toBeInTheDocument();
  });

  it("keeps section management reachable and hides guidance once there is writing", async () => {
    const api = await withStudy();
    const first = (await api.studyGet(api.state.studies[0]!.id)).sections[0]!;
    // Empty, a section says what it is for; once it has writing the guidance steps aside.
    const user0 = await open(api);
    expect(within(study().getByRole("region", { name: first.title })).getByText(/The passage being studied/)).toBeInTheDocument();
    await user0.click(screen.getByRole("button", { name: "Settings" }));
    await api.studyBlockUpdate({ id: first.blocks[0]!.id, content: "Abide in me." });
    await user0.click(screen.getByRole("button", { name: "Back to workspace" }));
    const section = await study().findByRole("region", { name: "Text" });
    expect(within(section).queryByText(/The passage being studied/)).not.toBeInTheDocument();
    expect(study().queryByText("Start your study")).not.toBeInTheDocument();
    const user = user0;

    const options = within(section).getByRole("button", { name: "Options for part Text" });
    await user.click(options);
    expect(within(section).getByRole("button", { name: "Rename part Text" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Move part Text down" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(options).toHaveFocus();

    // more writing is added from the part's own Add
    await user.click(within(section).getByRole("button", { name: "Add to Text" }));
    await user.click(within(section).getByRole("button", { name: "Writing" }));
    await waitFor(() => expect(within(section).getAllByRole("textbox", { name: /^Text: paragraph/ })).toHaveLength(2));
  });
});

describe("long titles", () => {
  it("keeps a very long title whole in a wrapping field, even in a narrow window", async () => {
    const long = "A very long study title about abiding in the true vine and bearing much fruit for the Father's glory";
    const api = await withStudy(long);
    await open(api, 700, /A very long/);
    const title = screen.getByRole("textbox", { name: "Study title" });
    expect(title.tagName).toBe("TEXTAREA");
    expect(title).toHaveValue(long);
    expect(title.className).toContain("break-words");
    expect(title.className).not.toContain("truncate");
  });
});
