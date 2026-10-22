import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { createMemoryApi } from "../support/memoryApi";
import { openInfo, renderApp, saveInfo } from "../support/render";

// Information panels (v0.19): Project, Bible Study and Bible Teaching
// information open on request over the work, edit a draft, and write it only
// with Save. Cancel, Escape, the close button and a click outside discard it.
// All text is invented for the tests.

async function setup() {
  const api = createMemoryApi();
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Romans" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding", primaryPassage: "JHN.15.1-JHN.15.8" });
  const firstBlock = (await api.studyGet(study.id)).sections[0]!.blocks[0]!;
  await api.studyBlockUpdate({ id: firstBlock.id, content: "The vine and the branches." });
  return { api, projectId: project.id, studyId: study.id, blockId: firstBlock.id };
}

const studyPane = () => screen.getByRole("main", { name: "Study" });

async function openStudy(api: ReturnType<typeof createMemoryApi>) {
  const { user } = await renderApp(api);
  await user.click(await screen.findByRole("button", { name: /John/ }));
  await user.click(await screen.findByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
  return user;
}

describe("Bible Study information", () => {
  it("is closed when a study opens: the study's parts come first", async () => {
    const { api } = await setup();
    await openStudy(api);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(studyPane()).queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(within(studyPane()).getByRole("region", { name: "Text" })).toBeInTheDocument();
  });

  it("saves the whole draft with Save, in one change, and closes", async () => {
    const { api, studyId, blockId } = await setup();
    const user = await openStudy(api);
    const update = vi.spyOn(api, "studyUpdate");
    const panel = await openInfo(user, "Bible Study information");
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Status" }), "archived");
    await user.type(within(panel).getByRole("textbox", { name: /Purpose/ }), "To abide.");
    // Nothing is written while the fields change.
    expect(update).not.toHaveBeenCalled();
    expect(within(panel).getByText("Not saved yet")).toBeInTheDocument();
    await saveInfo(user, panel);
    expect(update).toHaveBeenCalledTimes(1);
    const study = api.state.studies.find((s) => s.id === studyId)!;
    expect(study).toMatchObject({ status: "archived", description: "To abide." });
    // The study's own writing is untouched.
    expect((await api.studyGet(studyId)).sections[0]!.blocks.find((b) => b.id === blockId)!.content).toBe("The vine and the branches.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Bible Study information" })).toHaveFocus());
  });

  it("discards the draft on Escape, Cancel, the close button and a click outside", async () => {
    const { api, studyId } = await setup();
    const user = await openStudy(api);
    const update = vi.spyOn(api, "studyUpdate");
    const toggle = screen.getByRole("button", { name: "Bible Study information" });

    const close = {
      escape: async () => user.keyboard("{Escape}"),
      cancel: async (panel: HTMLElement) => user.click(within(panel).getByRole("button", { name: "Cancel" })),
      button: async (panel: HTMLElement) => user.click(within(panel).getByRole("button", { name: "Close" })),
      outside: async () => {
        fireEvent.mouseDown(within(studyPane()).getByRole("region", { name: "Text" }));
      },
    };
    for (const [how, run] of Object.entries(close)) {
      const panel = await openInfo(user, "Bible Study information");
      const purpose = within(panel).getByRole("textbox", { name: /Purpose/ });
      expect(purpose).toHaveValue("");
      await user.type(purpose, `Typed then ${how}`);
      await run(panel);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByText("Unsaved changes were discarded.")).toBeInTheDocument();
      await waitFor(() => expect(toggle).toHaveFocus());
    }
    expect(update).not.toHaveBeenCalled();
    expect(api.state.studies.find((s) => s.id === studyId)!.description ?? "").toBe("");
  });

  it("closes without a note when nothing was changed", async () => {
    const { api } = await setup();
    const user = await openStudy(api);
    await openInfo(user, "Bible Study information");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Unsaved changes were discarded.")).toBeNull();
  });

  it("keeps the panel and the draft when saving fails, with the reason", async () => {
    const { api } = await setup();
    const user = await openStudy(api);
    vi.spyOn(api, "studyUpdate").mockRejectedValueOnce(new ApiError("filesystem", "The data folder could not be written."));
    const panel = await openInfo(user, "Bible Study information");
    await user.type(within(panel).getByRole("textbox", { name: /Purpose/ }), "Kept on screen.");
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("The data folder could not be written.");
    expect(screen.getByRole("dialog", { name: "Bible Study information" })).toBeInTheDocument();
    expect(within(panel).getByRole("textbox", { name: /Purpose/ })).toHaveValue("Kept on screen.");
    // Trying again works.
    await saveInfo(user, panel);
    expect(api.state.studies[0]!.description).toBe("Kept on screen.");
  });

  it("does not overwrite information changed elsewhere while the panel was open", async () => {
    const { api, studyId } = await setup();
    const user = await openStudy(api);
    const panel = await openInfo(user, "Bible Study information");
    await user.type(within(panel).getByRole("textbox", { name: /Purpose/ }), "Mine.");
    await api.studyUpdate({ id: studyId, description: "Theirs." });
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/changed somewhere else/);
    expect(api.state.studies.find((s) => s.id === studyId)!.description).toBe("Theirs.");
  });

  it("is a labelled dialog that keeps Tab inside while open", async () => {
    const { api } = await setup();
    const user = await openStudy(api);
    const panel = await openInfo(user, "Bible Study information");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(within(panel).getByRole("heading", { name: "Bible Study information" })).toBeInTheDocument();
    for (let i = 0; i < 40; i++) {
      await user.tab();
      expect(panel.contains(document.activeElement)).toBe(true);
    }
  });
});

describe("Project information", () => {
  it("edits the description as a draft saved with Save", async () => {
    const { api, projectId } = await setup();
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /John/ }));
    const panel = await openInfo(user, "Project information");
    await user.type(within(panel).getByRole("textbox", { name: "Description" }), "The Upper Room sermons.");
    expect(api.state.projects.find((p) => p.id === projectId)!.description ?? "").toBe("");
    await saveInfo(user, panel);
    expect(api.state.projects.find((p) => p.id === projectId)!.description).toBe("The Upper Room sermons.");
  });
});
