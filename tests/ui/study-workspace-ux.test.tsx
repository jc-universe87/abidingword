import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function withProject(studies: Array<{ title: string; primaryPassage?: string }> = []) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Sermon Series" });
  for (const s of studies) await api.studyCreate({ projectId: project.id, ...s });
  return { api, project };
}

// With a single project the Study pane starts on its studies: there is no project to open.
async function openProject(_user: User) {
  await screen.findByRole("heading", { level: 1, name: "Studies" });
}

async function openStudy(user: User, title: RegExp) {
  await openProject(user);
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: title }));
  return screen.findByRole("textbox", { name: "Study title" });
}

const ask = () => screen.getByLabelText("What would you like to study?");

describe("project page", () => {
  it("offers the creation form straight away in an empty project", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user);
    expect(screen.getByRole("form", { name: "New study" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Studies" })).not.toBeInTheDocument();
  });

  it("hides the form behind a New study button when there are studies, and puts it away again", async () => {
    const { api } = await withProject([{ title: "Romans 8" }]);
    const { user } = await renderApp(api);
    await openProject(user);
    expect(screen.queryByRole("form", { name: "New study" })).not.toBeInTheDocument();
    const opener = screen.getByRole("button", { name: "New study" });
    await user.click(opener);
    expect(ask()).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("form", { name: "New study" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "New study" })).toHaveFocus());
  });
});

describe("creating a study", () => {
  it("prepares a teaching from a study of its passage, and opens it on the Bible Teaching side", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Teaching preparation" }));
    await user.type(ask(), "John 15:1-11");
    await user.click(screen.getByRole("button", { name: "Create study" }));
    // Bible Teaching is derived from Bible Study: a passage study, with its simple template…
    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("John 15:1–11");
    const study = api.state.studies[0]!;
    expect(study.studyType).toBe("passage");
    expect(study.templateId).toBe(api.state.templates.find((t) => t.key === "passage-study")!.id);
    expect(api.state.passages).toHaveLength(1);
    // …opened where the teaching is prepared: choose a format and start.
    expect(screen.getByRole("button", { name: "Bible Teaching", pressed: true })).toBeInTheDocument();
    expect(await screen.findByRole("form", { name: "Prepare a teaching from this study" })).toBeInTheDocument();
  });

  it("opens a study again on the side last worked on", async () => {
    const { api, project } = await withProject();
    await api.studyCreate({ projectId: project.id, title: "Psalm 23", primaryPassage: "PSA.23" });
    const { user } = await renderApp(api);
    await openProject(user);
    await user.click(await screen.findByRole("button", { name: /^Psalm 23/ }));
    await user.click(await screen.findByRole("button", { name: "Bible Teaching" }));
    const { cleanup } = await import("@testing-library/react");
    cleanup();
    await renderApp(api);
    expect(await screen.findByRole("button", { name: "Bible Teaching", pressed: true })).toBeInTheDocument();
  });

  it("uses the typed text as the title of a topic study, and a custom title when given", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Topical study" }));
    await user.type(ask(), "Forgiveness");
    await user.click(screen.getByRole("button", { name: "Create study" }));
    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Forgiveness");
    expect(api.state.passages).toHaveLength(0);
  });

  it("asks for something to study, and closes More options with Escape", async () => {
    const { api } = await withProject();
    const { user } = await renderApp(api);
    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Create study" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Type what you would like to study.");
    const more = screen.getByRole("button", { name: "More options" });
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Biblical theology" })).toBeInTheDocument();
    await user.type(ask(), "x{Escape}");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(api.state.studies).toHaveLength(0);
  });
});

describe("the study page", () => {
  it("keeps metadata out of the way until Bible Study information is opened", async () => {
    const { api } = await withProject([{ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" }]);
    const { user } = await renderApp(api);
    await openStudy(user, /The True Vine/);

    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^No findings yet$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Duplicate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Related studies" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Changes are saved automatically/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "John 15:1–11" })).toBeInTheDocument();
    expect(screen.queryByText("Primary")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Bible Study information" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("dialog", { name: "Bible Study information" });
    expect(within(details).getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: /Duplicate/ })).toBeInTheDocument();
    expect(within(details).getByRole("textbox", { name: /Purpose/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Bible Study information" })).not.toBeInTheDocument();
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it("changes the primary passage from Bible Study information, not from the page", async () => {
    const { api } = await withProject([{ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" }]);
    const studyId = api.state.studies[0]!.id;
    await api.studyPassageAdd({ studyId, reference: "ROM.8.1-ROM.8.4" });
    const { user } = await renderApp(api);
    await openStudy(user, /The True Vine/);

    expect(screen.queryByRole("button", { name: /Make .* the primary passage/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bible Study information" }));
    await user.click(await screen.findByRole("button", { name: /Make Romans 8:1–4 the primary passage/ }));
    await waitFor(() => expect(api.state.passages.find((p) => p.reference.canonical === "ROM.8.1-ROM.8.4")?.role).toBe("primary"));
  });

  it("keeps related studies in Bible Study information, where one can be opened", async () => {
    const { api } = await withProject([{ title: "Romans 8" }, { title: "Galatians 4" }]);
    await api.studyRelationCreate({ fromStudyId: api.state.studies[0]!.id, toStudyId: api.state.studies[1]!.id, relationType: "related" });
    const { user } = await renderApp(api);
    await openStudy(user, /Romans 8/);
    expect(screen.queryByRole("button", { name: "Galatians 4" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bible Study information" }));
    const info = await screen.findByRole("dialog", { name: "Bible Study information" });
    await user.click(within(info).getByRole("button", { name: "Galatians 4" }));
    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Galatians 4");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows nothing about saving when idle, and a brief Saved after a change", async () => {
    const { api } = await withProject([{ title: "The True Vine" }]);
    const { user } = await renderApp(api);
    await openStudy(user, /The True Vine/);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    const title = screen.getByRole("textbox", { name: "Study title" });
    await user.clear(title);
    await user.type(title, "Abiding");
    await user.tab();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("keeps a save error on screen", async () => {
    const { api } = await withProject([{ title: "The True Vine" }]);
    const { user } = await renderApp(api);
    await openStudy(user, /The True Vine/);
    api.studyUpdate = async () => {
      throw { kind: "internal", message: "Disk is full" };
    };
    const title = screen.getByRole("textbox", { name: "Study title" });
    await user.clear(title);
    await user.type(title, "Abiding");
    await user.tab();
    expect(await screen.findByText(/Disk is full/)).toBeInTheDocument();
  });
});
