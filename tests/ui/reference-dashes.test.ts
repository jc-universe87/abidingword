import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";

// The interface's test double reads ranges as the core does (v0.19.1):
// "John 15:1–11" with any ordinary dash, spaced or not, is verses 1 to 11.
// The core's own rules are tested in src-tauri/tests/reference_dashes.rs.

describe("Scripture ranges in the test double", () => {
  it("reads every ordinary dash, with or without spaces, as the core does", async () => {
    const api = createMemoryApi();
    for (const dash of ["-", "‐", "‑", "‒", "–", "—"]) {
      for (const written of [`John 15:1${dash}11`, `John 15:1 ${dash} 11`]) {
        const found = await api.referenceDetect(`Read ${written} aloud.`);
        expect(found.map((f) => [f.text, f.reference.canonical, f.start, f.end])).toEqual([[written, "JHN.15.1-JHN.15.11", 5, 5 + written.length]]);
      }
    }
  });

  it("reads a range into the next chapter, and keeps a single verse single", async () => {
    const api = createMemoryApi();
    expect((await api.referenceDetect("See John 15:1–16:4."))[0]!.reference.canonical).toBe("JHN.15.1-JHN.16.4");
    expect((await api.referenceDetect("Read John 15:5—the heart of it."))[0]!.reference.canonical).toBe("JHN.15.5");
  });
});
