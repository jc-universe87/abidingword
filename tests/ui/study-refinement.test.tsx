import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Study workspace refinement (v0.10). All text is invented.

beforeEach(() => window.localStorage.clear());

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function withStudy(study: { title: string; primaryPassage?: string; studyType?: "passage" | "word" | "teaching" | "topical" | "custom"; templateId?: string; status?: "active" | "archived" }) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Sermon Series" });
  const detail = await api.studyCreate({ projectId: project.id, ...study });
  if (study.status) await api.studyUpdate({ id: detail.study.id, status: study.status });
  return { api, project, studyId: detail.study.id };
}

async function open(user: User, title: RegExp) {
  await user.click(await screen.findByRole("button", { name: title }));
  return screen.findByRole("textbox", { name: "Study title" });
}

const header = () => document.getElementById("study-overview") as HTMLElement;

describe("the study header", () => {
  it("shows the passage once when the title is the passage", async () => {
    const { api } = await withStudy({ title: "John 15:1–11", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /John 15:1–11/);
    const passages = within(header()).getByRole("region", { name: "Passages" });
    expect(within(passages).queryByRole("button", { name: "John 15:1–11" })).not.toBeInTheDocument();
    expect(within(passages).getByRole("button", { name: "Open in Scripture" })).toBeInTheDocument();
    expect(within(passages).getByRole("button", { name: "Related passage" })).toBeInTheDocument();
  });

  it("treats a dash, spacing or case difference as the same", async () => {
    const { api } = await withStudy({ title: "john 15:1-11", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /john 15:1-11/i);
    expect(within(header()).queryByRole("button", { name: "John 15:1–11" })).not.toBeInTheDocument();
  });

  it("shows the passage beneath a title that differs from it", async () => {
    const { api } = await withStudy({ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    expect(within(header()).getByRole("button", { name: "John 15:1–11" })).toBeInTheDocument();
    expect(within(header()).queryByRole("button", { name: "Open in Scripture" })).not.toBeInTheDocument();
  });

  it("does not depend on what Scripture happens to show", async () => {
    for (const shown of ["JHN.15", "PSA.23"]) {
      const { api } = await withStudy({ title: "John 15:1–11", primaryPassage: "JHN.15.1-JHN.15.11" });
      api.state.settings.scripturePassage = shown;
      const { user } = await renderApp(api);
      await open(user, /John 15:1–11/);
      expect(within(header()).queryByRole("button", { name: "John 15:1–11" })).not.toBeInTheDocument();
      expect(within(header()).getByRole("button", { name: "Open in Scripture" })).toBeInTheDocument();
      document.body.innerHTML = "";
    }
  });

  it("follows the title when it is edited", async () => {
    const { api } = await withStudy({ title: "John 15:1–11", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    const title = await open(user, /John 15:1–11/);
    await user.clear(title);
    await user.type(title, "The True Vine");
    await user.tab();
    expect(await within(header()).findByRole("button", { name: "John 15:1–11" })).toBeInTheDocument();
  });

  it("does not show the kind of study in the header, only in Study details", async () => {
    const { api } = await withStudy({ title: "Righteousness", studyType: "word" });
    const { user } = await renderApp(api);
    await open(user, /Righteousness/);
    expect(within(header()).queryByText("Word Study")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Study details" }));
    expect(within(screen.getByRole("region", { name: "Study details" })).getByText(/Type: Word Study/)).toBeInTheDocument();
  });
});

describe("Study details", () => {
  it("is grouped: about, passages, related studies and copy", async () => {
    const { api } = await withStudy({ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    const details = screen.getByRole("region", { name: "Study details" });
    const groups = within(details).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(groups).toEqual(["About this study", "Passages", "Related studies", "Copy"]);
    const about = within(details).getByRole("group", { name: "About this study" });
    expect(within(about).getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(within(about).getByRole("textbox", { name: /Purpose/ })).toBeInTheDocument();
    expect(within(details).getByRole("group", { name: "Copy" })).toContainElement(within(details).getByRole("button", { name: /Duplicate/ }));
  });

  it("never names a built-in template", async () => {
    const { api } = await withStudy({ title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    const details = screen.getByRole("region", { name: "Study details" });
    expect(details).not.toHaveTextContent(/Template/i);
    expect(details).not.toHaveTextContent("Passage Study Template");
  });

  it("says where a study came from only for the user's own template", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Series" });
    const builtin = api.state.templates.find((t) => t.isBuiltin && t.studyType === "passage")!;
    const copy = await api.templateDuplicate(builtin.id);
    const own = await api.templateUpdate({ id: copy.id, name: "Wednesday Bible Study", studyType: copy.studyType, sections: copy.sections });
    await api.studyCreate({ projectId: project.id, title: "Mine", templateId: own.id });
    const { user } = await renderApp(api);
    await open(user, /Mine/);
    await user.click(screen.getByRole("button", { name: "Study details" }));
    expect(screen.getByRole("region", { name: "Study details" })).toHaveTextContent("From your template: Wednesday Bible Study");
  });

  it("closes with Escape and returns focus to its toggle", async () => {
    const { api } = await withStudy({ title: "The True Vine" });
    const { user } = await renderApp(api);
    await open(user, /The True Vine/);
    const toggle = screen.getByRole("button", { name: "Study details" });
    await user.click(toggle);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(toggle).toHaveFocus());
  });
});
