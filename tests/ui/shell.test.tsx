import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { App } from "@/app/App";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

describe("application shell", () => {
  it("shows the brand and the three workspace panes", async () => {
    await renderApp();

    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("img", { name: "Abiding Word" })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Settings" })).toBeInTheDocument();

    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    const study = screen.getByRole("main", { name: "Study" });
    const sources = screen.getByRole("complementary", { name: "Sources" });

    expect(within(scripture).getByText("No Bible has been added yet.")).toBeInTheDocument();
    expect(within(study).getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(await within(sources).findByText(/No sources yet/)).toBeInTheDocument();
    expect(within(sources).getByRole("button", { name: "Add to library…" })).toBeEnabled();
  });

  it("offers keyboard-operable pane dividers", async () => {
    const { user } = await renderApp();
    const divider = screen.getByRole("separator", { name: "Resize Scripture pane" });
    const before = Number(divider.getAttribute("aria-valuenow"));

    divider.focus();
    await user.keyboard("{ArrowRight}");

    expect(Number(divider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  });

  it("can hide a side pane", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Show Sources pane" }));
    expect(screen.queryByRole("complementary", { name: "Sources" })).not.toBeInTheDocument();
  });

  it("starts with the Sources pane hidden on a narrow window, and it can be shown", async () => {
    const { user } = await renderApp(undefined, { width: 864 });
    expect(screen.getByRole("complementary", { name: "Scripture" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Sources" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show Sources pane" }));
    expect(screen.getByRole("complementary", { name: "Sources" })).toBeInTheDocument();
  });

  it("explains a failed startup instead of showing the workspace", async () => {
    const api = createMemoryApi({
      ready: false,
      error: { kind: "migration", message: "Abiding Word could not update its database to this version." },
    });
    render(<App api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("could not update its database");
    expect(screen.queryByRole("main", { name: "Study" })).not.toBeInTheDocument();
  });
});
