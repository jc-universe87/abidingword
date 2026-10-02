import { describe, expect, it } from "vitest";
import { STARTUP_CHECK_DELAY_MS } from "@/features/updates/timing";
import { createMemoryApi } from "../support/memoryApi";
import { createMemoryUpdater } from "../support/memoryUpdater";
import { renderApp } from "../support/render";

describe("update check timing", () => {
  it("does not look for updates while the app is starting", async () => {
    const api = createMemoryApi();
    api.state.info.updatesEnabled = true;
    const updater = createMemoryUpdater({ available: { version: "9.9.9", notes: null } });
    await renderApp(api, { updater });
    expect(STARTUP_CHECK_DELAY_MS).toBeGreaterThanOrEqual(5_000);
    expect(updater.checks).toBe(0);
  });
});
