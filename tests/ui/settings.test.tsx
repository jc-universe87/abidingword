import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../support/render";

describe("settings", () => {
  it("shows the version and where data is stored", async () => {
    const { user } = await renderApp();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toHaveFocus();
    expect(screen.getByText("Abiding Word 0.1.0 (Foundation)")).toBeInTheDocument();
    expect(screen.getByText("/home/test/.local/share/Abiding Word")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Bible Texts" })).toBeInTheDocument();
    for (const planned of ["AI assistance", "Sync", "Integrations"]) {
      expect(screen.getByText(planned)).toBeInTheDocument();
    }
  });

  it("applies and saves the theme choice", async () => {
    const { api, user } = await renderApp();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("radio", { name: /Dark/ }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(api.state.settings.theme).toBe("dark");
  });

  it("returns to the workspace", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Back to workspace" }));
    expect(await screen.findByRole("main", { name: "Study" })).toBeInTheDocument();
  });
});
