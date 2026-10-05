import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { pickProject } from "@/features/studies/projects";
import { writeLocal } from "@/lib/storage";
import type { Project } from "@/types/domain";
import type { StudySummary } from "@/types/studies";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

beforeEach(() => window.localStorage.clear());

type User = Awaited<ReturnType<typeof renderApp>>["user"];

const ask = () => screen.getByLabelText("What would you like to study?");

async function createStudy(user: User, text: string) {
  await user.type(await screen.findByLabelText("What would you like to study?"), text);
  await user.click(screen.getByRole("button", { name: "Create study" }));
  return screen.findByRole("textbox", { name: "Study title" });
}

async function openOrganiser(user: User) {
  await user.click(await screen.findByRole("button", { name: "Organise in projects" }));
}

describe("the first study", () => {
  it("makes the default project by itself: nobody has to understand projects first", async () => {
    const { api, user } = await renderApp();
    expect(await screen.findByRole("heading", { level: 1, name: "Studies" })).toBeInTheDocument();
    // one question, no project to choose or create
    expect(ask()).toBeInTheDocument();
    expect(screen.queryByLabelText("New project")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /project/i })).not.toBeInTheDocument();

    expect(await createStudy(user, "John 15:1-11")).toHaveValue("John 15:1–11");
    expect(api.state.projects.map((p) => p.title)).toEqual(["My studies"]);
    expect(api.state.studies[0]!.projectId).toBe(api.state.projects[0]!.id);
  });

  it("names the default project in the interface language", async () => {
    const { setLanguage } = await import("@/i18n");
    await setLanguage("de");
    try {
      const { api, user } = await renderApp();
      await user.type(await screen.findByLabelText("Was möchten Sie studieren?"), "John 15:1-11");
      await user.click(screen.getByRole("button", { name: "Bibelstudium erstellen" }));
      await waitFor(() => expect(api.state.projects).toHaveLength(1));
      expect(api.state.projects[0]!.title).toBe("Meine Bibelstudien");
    } finally {
      await setLanguage("en");
    }
  });

  it("does not make a second default project when a study is created again", async () => {
    const { api, user } = await renderApp();
    await createStudy(user, "Romans 8");
    await user.click(screen.getByRole("button", { name: "Back to Studies" }));
    await user.click(await screen.findByRole("button", { name: "New study" }));
    await user.type(await screen.findByLabelText("What would you like to study?"), "Romans 12");
    await user.click(screen.getByRole("button", { name: "Create study" }));
    await screen.findByRole("textbox", { name: "Study title" });
    expect(api.state.projects).toHaveLength(1);
    expect(api.state.studies).toHaveLength(2);
  });
});

describe("a single project", () => {
  it("is used without being shown: Studies, and no project in the way", async () => {
    const api = createMemoryApi();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Romans Sermon Series" });
    await api.studyCreate({ projectId: project.id, title: "Romans 8" });
    const { user } = await renderApp(api);

    expect(await screen.findByRole("heading", { level: 1, name: "Studies" })).toBeInTheDocument();
    expect(screen.queryByText("Romans Sermon Series")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Romans 8/ }));
    // the way back is "Studies", not "Projects › …"
    expect(await screen.findByRole("button", { name: "Back to Studies" })).toBeInTheDocument();
    expect(screen.queryByText("Romans Sermon Series")).not.toBeInTheDocument();
  });

  it("creates new studies in it, and never makes another project", async () => {
    const api = createMemoryApi();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Romans Sermon Series" });
    await api.studyCreate({ projectId: project.id, title: "Romans 8" });
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: "New study" }));
    await createStudy(user, "Romans 12:1-2");
    expect(api.state.projects).toHaveLength(1);
    expect(api.state.studies.find((s) => s.title === "Romans 12:1–2")?.projectId).toBe(project.id);
  });
});

describe("several projects", () => {
  async function two() {
    const api = createMemoryApi();
    const a = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Advent" });
    const b = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Romans" });
    return { api, a, b };
  }

  it("keeps the project list, and New study goes into the project last worked in", async () => {
    const { api, a, b } = await two();
    await api.studyCreate({ projectId: a.id, title: "Isaiah 9" });
    writeLocal("studyPane.lastProject", b.id);
    const { user } = await renderApp(api);

    const list = await screen.findByRole("list", { name: "Projects" });
    expect(within(list).getByText("Advent")).toBeInTheDocument();
    expect(within(list).getByText("Romans")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New study" }));
    await createStudy(user, "Romans 5:1-11");
    expect(api.state.projects).toHaveLength(2);
    expect(api.state.studies.find((s) => s.title === "Romans 5:1–11")?.projectId).toBe(b.id);
  });

  it("falls back to the project of the most recently changed study", async () => {
    const { api, a } = await two();
    await api.studyCreate({ projectId: a.id, title: "Isaiah 9" });
    const { user } = await renderApp(api);
    await screen.findByRole("list", { name: "Projects" });
    await user.click(screen.getByRole("button", { name: "New study" }));
    await createStudy(user, "Romans 5:1-11");
    expect(api.state.studies.find((s) => s.title === "Romans 5:1–11")?.projectId).toBe(a.id);
  });
});

describe("choosing a project (the rule)", () => {
  const project = (id: string, title: string): Project => ({ id, workspaceId: "w", title, description: null, studyCount: 0, createdAt: "", updatedAt: "", revision: 1 });
  const study = (id: string, projectId: string, updatedAt: string): StudySummary =>
    ({ id, projectId, projectTitle: "", title: id, studyType: "passage", status: "active", primaryPassage: null, findingCount: 0, updatedAt });

  it("has none when there are no projects, and the only one when there is one", () => {
    expect(pickProject([], [], null)).toBeNull();
    expect(pickProject([project("p1", "A")], [], "gone")).toBe("p1");
  });

  it("prefers the last project used, then the latest study's, then the first by title", () => {
    const projects = [project("p1", "A"), project("p2", "B")];
    const studies = [study("s1", "p1", "2026-01-01"), study("s2", "p2", "2026-02-01")];
    expect(pickProject(projects, studies, "p1")).toBe("p1");
    expect(pickProject(projects, studies, "removed")).toBe("p2");
    expect(pickProject(projects, [], null)).toBe("p1");
    // equal times: the smaller study id decides, always
    expect(pickProject(projects, [study("s9", "p2", "x"), study("s1", "p1", "x")], null)).toBe("p1");
  });
});

describe("organising in projects", () => {
  it("is still there: the project list opens from Studies, and a project can be made", async () => {
    const { api, user } = await renderApp();
    await openOrganiser(user);

    await user.type(await screen.findByLabelText("New project"), "Romans Sermon Series");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("textbox", { name: "Project title" })).toHaveValue("Romans Sermon Series");
    expect(api.state.projects.map((p) => p.title)).toEqual(["Romans Sermon Series"]);

    await user.click(screen.getByRole("button", { name: "Projects" }));
    const list = await screen.findByRole("list", { name: "Projects" });
    expect(within(list).getByText("Romans Sermon Series")).toBeInTheDocument();
    expect(within(list).getByText("0 studies")).toBeInTheDocument();
  });

  it("asks for a title instead of creating an empty project", async () => {
    const { api, user } = await renderApp();
    await openOrganiser(user);
    await user.click(await screen.findByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a title first.");
    expect(api.state.projects).toHaveLength(0);
  });

  it("shows the message from the native core when creation fails", async () => {
    const { api, user } = await renderApp();
    await openOrganiser(user);

    await user.type(await screen.findByLabelText("New project"), "  x");
    api.projectCreate = async () => {
      const { ApiError } = await import("@/lib/api");
      throw new ApiError("database", "Abiding Word could not read or save your data.");
    };
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not read or save your data");
  });
});
