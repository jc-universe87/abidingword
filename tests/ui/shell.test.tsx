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

    expect(within(scripture).getByText(/Scripture engine will be added in the next phase/)).toBeInTheDocument();
    expect(within(study).getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(within(sources).getByText(/Personal source import will arrive/)).toBeInTheDocument();
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
