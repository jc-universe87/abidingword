import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { createMemoryApi } from "../support/memoryApi";
import { openInfo, openSettingsSection, renderApp } from "../support/render";

// Settings › Data and backup (v0.19): export one project, import one as a
// new project, back up everything, and restore everything after a clear
// warning. Each is its own action. All text is invented for the tests.

async function setup() {
  const api = createMemoryApi();
  await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const romans = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Romans" });
  await api.studyCreate({ projectId: romans.id, title: "Justified" });
  return { api, romansId: romans.id };
}

const data = async (user: Parameters<typeof openSettingsSection>[0]) => openSettingsSection(user, "Data and backup");

describe("Data and backup", () => {
  it("is one section of Settings with four separate actions", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    expect(within(section).getByRole("button", { name: "Data and backup" })).toHaveAccessibleDescription("Export, import and back up your work");
    for (const name of ["Export project…", "Import project…", "Back up everything…", "Restore from backup…"]) {
      expect(within(section).getByRole("button", { name: new RegExp(name) })).toBeVisible();
    }
    // What a backup never holds, and that it is private.
    expect(within(section).getByText(/API keys are never included/)).toBeVisible();
    expect(within(section).getByText(/a private copy for you, not for sharing/)).toBeVisible();
  });

  it("gives an open section a quiet shaded ground and leaves closed ones plain", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    expect(section).toHaveAttribute("data-open", "true");
    expect(section.className).toContain("bg-bg-secondary");
    const language = screen.getByRole("region", { name: "Language" });
    expect(language).not.toHaveAttribute("data-open");
    expect(language.className).not.toContain("bg-bg-secondary");
  });

  it("exports the chosen project to the file the save dialog named", async () => {
    const { api, romansId } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    await user.selectOptions(within(section).getByRole("combobox", { name: "Project to export" }), romansId);
    api.state.portability.nextSave = "/home/test/Documents/Romans";
    await user.click(within(section).getByRole("button", { name: /Export project…/ }));
    expect(await within(section).findByText("“Romans” was saved to /home/test/Documents/Romans.awproject.")).toBeInTheDocument();
    expect(within(section).getByText("Bible Studies: 1")).toBeInTheDocument();
    expect(api.state.portability.exported).toEqual([{ projectId: romansId, path: "/home/test/Documents/Romans.awproject" }]);
  });

  it("does nothing when the save dialog is cancelled", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    const exportProject = vi.spyOn(api, "projectExport");
    api.state.portability.nextSave = null;
    await user.click(within(section).getByRole("button", { name: /Export project…/ }));
    expect(exportProject).not.toHaveBeenCalled();
    expect(within(section).queryByRole("status")).toBeNull();
  });

  it("shows what a project file holds and lacks before importing it as a new project", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    const importProject = vi.spyOn(api, "projectImport");
    await user.click(within(section).getByRole("button", { name: /Import project…/ }));
    const preview = await within(section).findByRole("region", { name: "Project to import" });
    // "John" exists here, so the import is a new project beside it.
    expect(within(preview).getByText("It will be added as a new project, “John (2)”. Nothing on this computer is replaced.")).toBeInTheDocument();
    expect(within(preview).getByText(/Bible Studies: 2 · Bible Teachings: 1/)).toBeInTheDocument();
    expect(within(preview).getByText("Not on this computer")).toBeInTheDocument();
    expect(within(preview).getByText("Library: Commentary on John")).toBeInTheDocument();
    expect(importProject).not.toHaveBeenCalled();

    await user.click(within(preview).getByRole("button", { name: "Import" }));
    expect(await within(section).findByText("“John (2)” was added. You’ll find it under Projects.")).toBeInTheDocument();
    expect(within(section).getByText("Citations kept whose library book is not on this computer: 1")).toBeInTheDocument();
    expect(within(section).queryByText(/could not be read/)).toBeNull();
    expect(api.state.projects.map((p) => p.title)).toEqual(["John", "Romans", "John (2)"]);
  });

  it("adds nothing when the preview is cancelled", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    await user.click(within(section).getByRole("button", { name: /Import project…/ }));
    const preview = await within(section).findByRole("region", { name: "Project to import" });
    await user.click(within(preview).getByRole("button", { name: "Cancel" }));
    expect(within(section).queryByRole("region", { name: "Project to import" })).toBeNull();
    expect(api.state.projects).toHaveLength(2);
  });

  it("says why a file cannot be imported, and changes nothing", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    api.state.portability.package = new ApiError("importFailed", "Part of this file does not match its list of contents: it is damaged or was changed. Nothing was changed here.");
    await user.click(within(section).getByRole("button", { name: /Import project…/ }));
    expect(await within(section).findByRole("alert")).toHaveTextContent(/damaged or was changed/);
    expect(within(section).queryByRole("region", { name: "Project to import" })).toBeNull();
    expect(api.state.projects).toHaveLength(2);
  });

  it("backs up everything to the file the save dialog named", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    api.state.portability.nextSave = "/home/test/Backups/All.awbackup";
    await user.click(within(section).getByRole("button", { name: /Back up everything…/ }));
    expect(await within(section).findByText("The backup was saved to /home/test/Backups/All.awbackup (1.2 MB).")).toBeInTheDocument();
    expect(api.state.portability.backups).toEqual(["/home/test/Backups/All.awbackup"]);
  });

  it("restores only after the warning is confirmed, and says where the safety copy is", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    api.state.portability.nextOpen = "/home/test/Backups/All.awbackup";

    // First look, then cancel: nothing restored.
    await user.click(within(section).getByRole("button", { name: /Restore from backup…/ }));
    let preview = await within(section).findByRole("region", { name: "Backup to restore" });
    expect(within(preview).getByText(/replaces all the work on this computer/)).toBeInTheDocument();
    expect(within(preview).getByText(/Projects: 3 · Bible Studies: 12/)).toBeInTheDocument();
    // The safe choice has the focus.
    expect(within(preview).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(preview).getByRole("button", { name: "Cancel" }));
    expect(api.state.portability.restored).toEqual([]);

    await user.click(within(section).getByRole("button", { name: /Restore from backup…/ }));
    preview = await within(section).findByRole("region", { name: "Backup to restore" });
    await user.click(within(preview).getByRole("button", { name: "Replace everything with this backup" }));
    expect(await within(section).findByText("The backup was restored.")).toBeInTheDocument();
    expect(within(section).getByText(/A copy of what was here before is kept at .*pre-restore/)).toBeInTheDocument();
    expect(api.state.portability.restored).toEqual(["/home/test/Backups/All.awbackup"]);
    expect(within(section).getByRole("button", { name: "Continue" })).toBeVisible();
  });

  it("shows a backup that cannot be read as an error, with nothing restored", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const section = await data(user);
    api.state.portability.backup = new ApiError("importFailed", "This file was saved by a newer version of Abiding Word (0.30.0). Please update Abiding Word first.");
    await user.click(within(section).getByRole("button", { name: /Restore from backup…/ }));
    expect(await within(section).findByRole("alert")).toHaveTextContent(/newer version of Abiding Word/);
    expect(api.state.portability.restored).toEqual([]);
  });
});

describe("Project information", () => {
  it("offers to export that project", async () => {
    const { api, romansId } = await setup();
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /Romans/ }));
    const panel = await openInfo(user, "Project information");
    api.state.portability.nextSave = "/home/test/Documents/Romans.awproject";
    await user.click(within(panel).getByRole("button", { name: /Export project…/ }));
    await waitFor(() => expect(api.state.portability.exported).toEqual([{ projectId: romansId, path: "/home/test/Documents/Romans.awproject" }]));
    expect(within(panel).getByText(/“Romans” was saved to/)).toBeInTheDocument();
  });
});

describe("the example project", () => {
  it("is added only when asked, with its four pieces of work, and never twice", async () => {
    const api = createMemoryApi();
    const { user } = await renderApp(api);
    expect(api.state.projects).toHaveLength(0);
    const section = await data(user);
    await user.click(within(section).getByRole("button", { name: /Add the example project/ }));
    expect(await within(section).findByText("“Example: Abiding in Christ — John 15:1–11” was added. You’ll find it under Projects.")).toBeInTheDocument();
    expect(api.state.projects.map((p) => p.title)).toEqual(["Example: Abiding in Christ — John 15:1–11"]);
    expect(api.state.studies.map((s) => s.title)).toEqual(["Abiding in the True Vine"]);
    expect(api.state.teaching.preparations.map((p) => p.kind)).toEqual(["sermon", "bible_study", "lesson"]);

    await user.click(within(section).getByRole("button", { name: /Add the example project/ }));
    expect(await within(section).findByText("“Example: Abiding in Christ — John 15:1–11” is already here, so nothing was added.")).toBeInTheDocument();
    expect(api.state.projects).toHaveLength(1);
    expect(api.state.studies).toHaveLength(1);
  });
});
