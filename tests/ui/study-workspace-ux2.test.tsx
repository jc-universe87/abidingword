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

  it("offers one compact Contents control for a long study; choosing a section goes there", async () => {
    const api = await withStudy();
    const user = await open(api);
    // Nine sections of the built-in template are not nine links on the page.
    expect(study().queryByRole("navigation", { name: "Study contents" })).not.toBeInTheDocument();
    const toggle = study().getByRole("button", { name: "Contents" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const nav = study().getByRole("navigation", { name: "Study contents" });
    expect(within(nav).getAllByRole("button")).toHaveLength(9);
    await user.click(within(nav).getByRole("button", { name: "Application" }));
    expect(study().queryByRole("navigation", { name: "Study contents" })).not.toBeInTheDocument();
    expect(study().getByRole("heading", { level: 2, name: "Application" })).toHaveFocus();
  });

  it("lists the findings entry only when there are findings, and Escape closes and restores focus", async () => {
    const api = await withStudy();
    const user = await open(api);
    await user.click(study().getByRole("button", { name: "Contents" }));
    expect(within(study().getByRole("navigation", { name: "Study contents" })).queryByRole("button", { name: "Study notes" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    const toggle = study().getByRole("button", { name: "Contents" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
});

describe("a new study", () => {
  it("is calm: no findings area, no filters, no quick-add row, one way to begin", async () => {
    const api = await withStudy();
    await open(api);
    expect(study().getByText("Start your study")).toBeInTheDocument();
    // one Add action, with its choices showing for a new study
    expect(study().getByRole("button", { name: "Add" })).toHaveAttribute("aria-expanded", "true");
    expect(study().getByRole("button", { name: "Note" })).toBeInTheDocument();
    expect(study().getByRole("button", { name: "Section" })).toBeInTheDocument();
    expect(study().getByRole("button", { name: "Text block" })).toBeInTheDocument();
    expect(study().queryByRole("heading", { name: "Study notes" })).not.toBeInTheDocument();
    expect(study().queryByRole("button", { name: "Question" })).not.toBeInTheDocument();
    expect(study().queryByRole("combobox", { name: /More/ })).not.toBeInTheDocument();
    // Template sections are still there, with their writing areas.
    expect(study().getAllByRole("heading", { level: 2 })).toHaveLength(9);
    // Per-section controls are tucked away.
    expect(study().queryByRole("button", { name: "Move section Text down" })).not.toBeInTheDocument();
    expect(study().queryByRole("group", { name: "Add to Text" })).not.toBeInTheDocument();
  });

  it("turns into a single Add menu once there is writing, and Add opens the same choices", async () => {
    const api = await withStudy();
    const user = await open(api);
    await user.click(study().getByRole("button", { name: "Note" }));
    await user.type(study().getByLabelText("New observation"), "Branches depend on the vine.");
    await user.click(study().getByRole("button", { name: "Save finding" }));
    await waitFor(() => expect(api.state.findings).toHaveLength(1));
    expect(api.state.findings[0]!.findingType).toBe("observation");

    expect(study().queryByText("Start your study")).not.toBeInTheDocument();
    const add = study().getByRole("button", { name: "Add" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    await user.click(add);
    expect(study().getByRole("button", { name: "Note" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(add).toHaveFocus();
    await user.click(add);
    await user.click(study().getByRole("button", { name: "Section" }));
    await waitFor(() => expect(api.state.sections.some((s) => s.title === "New section")).toBe(true));
  });

  it("keeps the kind changeable while writing, and links a passage only when asked", async () => {
    const api = await withStudy();
    const user = await open(api);
    await user.click(study().getByRole("button", { name: "Note" }));
    await user.click(study().getByRole("radio", { name: "Application" }));
    await user.type(study().getByLabelText("New application"), "Stay close.");
    await user.click(study().getByRole("button", { name: "Save finding" }));
    await waitFor(() => expect(api.state.findings[0]?.findingType).toBe("application"));
    expect(api.state.findings[0]?.passages).toHaveLength(0);
  });
});

describe("findings and sections in the page", () => {
  it("shows a note as its text, with kind as a quiet label and the rest under Details", async () => {
    const api = await withStudy();
    await api.findingCreate({ studyId: api.state.studies[0]!.id, findingType: "question", content: "What is the fruit?" });
    const user = await open(api);
    const list = await screen.findByRole("list", { name: "Study notes" });
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
    expect(study().getByText("Start your study")).toBeInTheDocument();
    await user0.click(screen.getByRole("button", { name: "Settings" }));
    await api.studyBlockUpdate({ id: first.blocks[0]!.id, content: "Abide in me." });
    await user0.click(screen.getByRole("button", { name: "Back to workspace" }));
    const section = await study().findByRole("region", { name: "Text" });
    expect(within(section).queryByText(/The passage being studied/)).not.toBeInTheDocument();
    expect(study().queryByText("Start your study")).not.toBeInTheDocument();
    const user = user0;

    const options = within(section).getByRole("button", { name: "Options for section Text" });
    await user.click(options);
    expect(within(section).getByRole("button", { name: "Rename section Text" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Move section Text down" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(options).toHaveFocus();

    // text blocks are added from the study's one Add, into the section last worked in
    await user.click(within(section).getByRole("textbox", { name: /^Text: paragraph/ }));
    await user.click(study().getByRole("button", { name: "Add" }));
    await user.click(study().getByRole("button", { name: "Text block" }));
    await user.click(within(study().getByRole("group", { name: "Text block in Text" })).getByRole("button", { name: "Remark" }));
    await waitFor(() => expect(api.state.blocks.filter((b) => b.blockType === "note")).toHaveLength(1));
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
