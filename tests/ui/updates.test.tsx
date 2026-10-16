import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { createMemoryApi } from "../support/memoryApi";
import { createMemoryUpdater } from "../support/memoryUpdater";
import { openSettingsSection, renderApp } from "../support/render";

// The real delay is covered in updates-startup.test.tsx.
vi.mock("@/features/updates/timing", () => ({ STARTUP_CHECK_DELAY_MS: 0 }));

const NEXT = { version: "0.5.0-dev.12", notes: null };

function apiWith(updatesEnabled: boolean) {
  const api = createMemoryApi();
  api.state.info.version = "0.5.0-dev.11";
  api.state.info.updatesEnabled = updatesEnabled;
  return api;
}

const notice = () => screen.queryByRole("status", { name: "Update" });

describe("update notice", () => {
  it("offers an available update without blocking the app", async () => {
    const updater = createMemoryUpdater({ available: NEXT });
    await renderApp(apiWith(true), { updater });
    const bar = await screen.findByRole("status", { name: "Update" });
    expect(bar).toHaveTextContent("An update is available: version 0.5.0-dev.12.");
    expect(within(bar).getByRole("button", { name: "Update now" })).toBeInTheDocument();
    // The workspace is there and usable.
    expect(screen.getByRole("main", { name: /study/i })).toBeInTheDocument();
  });

  it("says nothing when this build is current", async () => {
    const updater = createMemoryUpdater({ available: null });
    await renderApp(apiWith(true), { updater });
    await waitFor(() => expect(updater.checks).toBe(1));
    expect(notice()).toBeNull();
  });

  it("stays quiet and usable when the automatic check fails", async () => {
    const api = apiWith(true);
    const updater = createMemoryUpdater({ checkError: new Error("offline") });
    await renderApp(api, { updater });
    await waitFor(() => expect(updater.checks).toBe(1));
    expect(notice()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("main", { name: /study/i })).toBeInTheDocument();
  });

  it("never checks in a build without an updater", async () => {
    const updater = createMemoryUpdater({ available: NEXT });
    await renderApp(apiWith(false), { updater });
    await new Promise((r) => setTimeout(r, 50));
    expect(updater.checks).toBe(0);
    expect(notice()).toBeNull();
  });

  it("Later hides the notice for that version", async () => {
    const updater = createMemoryUpdater({ available: NEXT });
    const { user } = await renderApp(apiWith(true), { updater });
    await user.click(within(await screen.findByRole("status", { name: "Update" })).getByRole("button", { name: "Later" }));
    expect(notice()).toBeNull();
    expect(updater.installs).toBe(0);
  });

  it("downloads and installs, showing a percentage only when the size is known", async () => {
    const updater = createMemoryUpdater({ available: NEXT, progress: [{ downloaded: 50, total: 200 }] });
    const { user } = await renderApp(apiWith(true), { updater });
    await user.click(within(await screen.findByRole("status", { name: "Update" })).getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(updater.installs).toBe(1));
    expect(screen.getByRole("status", { name: "Update" })).toHaveTextContent("Downloading the update… 25%");
  });

  it("shows no invented percentage when the size is unknown", async () => {
    const updater = createMemoryUpdater({ available: NEXT, progress: [{ downloaded: 5000, total: null }] });
    const { user } = await renderApp(apiWith(true), { updater });
    await user.click(within(await screen.findByRole("status", { name: "Update" })).getByRole("button", { name: "Update now" }));
    const bar = await screen.findByRole("status", { name: "Update" });
    expect(bar).toHaveTextContent("Downloading the update…");
    expect(bar).not.toHaveTextContent("%");
  });

  it("reports a failed installation in the interface language and allows another try", async () => {
    const updater = createMemoryUpdater({ available: NEXT, installError: new Error("signature mismatch, raw detail") });
    const { user } = await renderApp(apiWith(true), { updater });
    await i18n.changeLanguage("de");
    await user.click(within(await screen.findByRole("status", { name: "Update" })).getByRole("button", { name: "Jetzt aktualisieren" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Das Update konnte nicht installiert werden.");
    expect(alert).not.toHaveTextContent("signature mismatch");
    updater.installError = null;
    await user.click(within(alert).getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(updater.installs).toBe(2));
    await i18n.changeLanguage("en");
  });
});

describe("Settings → Updates", () => {
  async function openSettings(updater: ReturnType<typeof createMemoryUpdater>, enabled = true) {
    const result = await renderApp(apiWith(enabled), { updater });
    return { ...result, section: await openSettingsSection(result.user, "Updates") };
  }

  it("shows the running version and the channel", async () => {
    const { section } = await openSettings(createMemoryUpdater());
    expect(within(section).getByTestId("update-version")).toHaveTextContent("0.5.0-dev.11");
    expect(within(section).getByText("Development / test")).toBeInTheDocument();
  });

  it("checks on request and says when it is up to date", async () => {
    const updater = createMemoryUpdater({ available: null });
    const { user, section } = await openSettings(updater);
    await waitFor(() => expect(updater.checks).toBe(1)); // the automatic one
    await user.click(within(section).getByRole("button", { name: "Check for updates" }));
    expect(await within(section).findByText("Abiding Word is up to date.")).toBeInTheDocument();
    expect(updater.checks).toBe(2);
  });

  it("offers Update now when a check finds one", async () => {
    const updater = createMemoryUpdater({ available: null });
    const { user, section } = await openSettings(updater);
    await waitFor(() => expect(updater.checks).toBe(1));
    updater.available = NEXT;
    await user.click(within(section).getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(within(section).getByRole("button", { name: "Update now" })).toBeInTheDocument());
    await user.click(within(section).getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(updater.installs).toBe(1));
  });

  it("reports a failed manual check in a translated message, not the raw error", async () => {
    const updater = createMemoryUpdater({ checkError: new Error("dns error: raw detail") });
    const { user, section } = await openSettings(updater);
    await waitFor(() => expect(updater.checks).toBe(1));
    await user.click(within(section).getByRole("button", { name: "Check for updates" }));
    expect(await within(section).findByText(/Could not check for updates/)).toBeInTheDocument();
    expect(within(section).queryByText(/raw detail/)).toBeNull();
  });

  it("says plainly that a build without an updater has none", async () => {
    const updater = createMemoryUpdater();
    const { section } = await openSettings(updater, false);
    expect(within(section).getByText("This build does not include automatic updates.")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Check for updates" })).toBeNull();
    expect(updater.checks).toBe(0);
  });
});
