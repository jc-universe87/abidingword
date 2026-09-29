import { describe, expect, it } from "vitest";
import { contains, parseCanonical, refFromCanonical } from "@/lib/scripture";
import { BOOKS } from "../support/scriptureFixture";

const books = new Map(BOOKS.map((b) => [b.code, b]));
const display = (canonical: string) => refFromCanonical(canonical, books)?.display;

describe("canonical references in the frontend", () => {
  it("uses the same display forms as the native core", () => {
    expect(display("JHN.15.7")).toBe("John 15:7");
    expect(display("JHN.15.1-JHN.15.11")).toBe("John 15:1–11");
    expect(display("JHN.15.1-JHN.16.4")).toBe("John 15:1–16:4");
    expect(display("ROM.8")).toBe("Romans 8");
    expect(display("JHN.14-JHN.16")).toBe("John 14–16");
    expect(display("1CO.13.4-1CO.13.7")).toBe("1 Corinthians 13:4–7");
    expect(display("JUD.1.3")).toBe("Jude 3");
    expect(display("JUD.1")).toBe("Jude");
  });

  it("rejects malformed canonical strings", () => {
    for (const bad of ["", "JHN", "JHN.x", "JHN.3.16.1", "JHN.3-ROM.4", "JHN.1-JHN.2-JHN.3", "XYZ.1"]) {
      expect(refFromCanonical(bad, books), bad).toBeNull();
    }
    expect(parseCanonical("ROM.8")).toEqual({ book: "ROM", startChapter: 8, startVerse: null, endChapter: 8, endVerse: null });
  });

  it("knows which verses a reference covers", () => {
    const ref = refFromCanonical("JHN.15.1-JHN.16.4", books)!;
    expect(contains(ref, "JHN", 15, 27)).toBe(true);
    expect(contains(ref, "JHN", 16, 4)).toBe(true);
    expect(contains(ref, "JHN", 16, 5)).toBe(false);
    expect(contains(ref, "ROM", 15, 2)).toBe(false);
    const chapter = refFromCanonical("ROM.8", books)!;
    expect(contains(chapter, "ROM", 8, 39)).toBe(true);
  });
});
