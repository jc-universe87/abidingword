import { describe, expect, it } from "vitest";
import { resolveOutline, resolveOutlineCounted, type OutlineSource } from "@/lib/pdfjsEngine";

// A stand-in for a PDF.js document: page objects are {num} references.
function fakeDoc(): OutlineSource {
  const pageOf: Record<number, number> = { 10: 0, 11: 1, 12: 2, 13: 3 };
  return {
    numPages: 4,
    getDestination: async (name) => {
      if (name === "chap2") return [{ num: 12, gen: 0 }, { name: "XYZ" }, 0, 700, null];
      if (name === "throws") throw new Error("lookup failed");
      return null;
    },
    getPageIndex: async (ref) => {
      const n = (ref as { num: number }).num;
      if (!(n in pageOf)) throw new Error("unknown page");
      return pageOf[n]!;
    },
  };
}

type Node = { title: string; target: unknown; children: Node[] };
const depth = (items: Node[]): number => items.reduce((m, i) => Math.max(m, 1 + depth(i.children)), 0);

describe("resolving a PDF outline", () => {
  it("resolves a named destination to its physical page", async () => {
    const items = await resolveOutline(fakeDoc(), [{ title: "Chapter 2", dest: "chap2", items: [] }]);
    expect(items[0]!.target).toEqual({ kind: "page", page: 3 });
  });

  it("resolves an explicit destination array with a page reference", async () => {
    const items = await resolveOutline(fakeDoc(), [{ title: "A", dest: [{ num: 11, gen: 0 }, { name: "Fit" }] }]);
    expect(items[0]!.target).toEqual({ kind: "page", page: 2 });
  });

  it("accepts a plain page index, and refuses one outside the document", async () => {
    const items = await resolveOutline(fakeDoc(), [
      { title: "Index", dest: [3, { name: "Fit" }] },
      { title: "Beyond", dest: [99, { name: "Fit" }] },
      { title: "Negative", dest: [-1] },
    ]);
    expect(items.map((i) => [i.title, i.target])).toEqual([["Index", { kind: "page", page: 4 }]]);
  });

  it("keeps the hierarchy, and an untitled wrapper passes its children up", async () => {
    const items = await resolveOutline(fakeDoc(), [
      { title: "Part", dest: [{ num: 10 }], items: [{ title: "Chapter", dest: "chap2", items: [{ title: "Section", dest: [{ num: 13 }] }] }] },
      { title: "  ", items: [{ title: "Lifted", dest: [{ num: 11 }] }] },
    ]);
    expect(items.map((i) => i.title)).toEqual(["Part", "Lifted"]);
    expect(items[0]!.children[0]!.title).toBe("Chapter");
    expect(items[0]!.children[0]!.children[0]!.target).toEqual({ kind: "page", page: 4 });
  });

  it("drops web links and broken destinations, but keeps a group whose children lead somewhere", async () => {
    const items = await resolveOutline(fakeDoc(), [
      { title: "Website", url: "https://example.org", dest: null },
      { title: "Missing name", dest: "bad" },
      { title: "Throwing name", dest: "throws" },
      { title: "Unknown page", dest: [{ num: 999 }] },
      { title: "Group", dest: null, items: [{ title: "Child", dest: [{ num: 10 }] }, { title: "Dead child", dest: "bad" }] },
    ]);
    expect(items.map((i) => i.title)).toEqual(["Group"]);
    expect(items[0]!.target).toBeNull();
    expect(items[0]!.children.map((c) => c.title)).toEqual(["Child"]);
  });

  it("survives malformed entries", async () => {
    const items = await resolveOutline(fakeDoc(), [
      null,
      7,
      "x",
      { title: 5 },
      { title: "Ok", dest: [{ num: 10 }] },
      { title: "Weird", dest: { not: "an array" } },
      { title: "Bad items", dest: [{ num: 11 }], items: "nope" },
    ]);
    expect(items.map((i) => i.title)).toEqual(["Ok", "Bad items"]);
    expect(await resolveOutline(fakeDoc(), null)).toEqual([]);
    expect(await resolveOutline(fakeDoc(), { title: "not a list" })).toEqual([]);
  });

  it("is bounded in size and depth", async () => {
    const many = Array.from({ length: 6000 }, (_, i) => ({ title: `T${i}`, dest: [{ num: 10 }] }));
    expect((await resolveOutline(fakeDoc(), many)).length).toBe(5000);
    let deep: unknown[] = [{ title: "leaf", dest: [{ num: 10 }] }];
    for (let i = 0; i < 100; i += 1) deep = [{ title: `L${i}`, dest: [{ num: 10 }], items: deep }];
    expect(depth(await resolveOutline(fakeDoc(), deep))).toBeLessThanOrEqual(12);
  });

  it("counts the entries that had somewhere to go, so failing to look them up is not mistaken for having none", async () => {
    const web = await resolveOutlineCounted(fakeDoc(), [{ title: "Website", url: "https://example.org" }, { title: "Also web", url: "https://example.net" }]);
    expect(web).toEqual({ items: [], wanted: 0 }); // a real "nothing to navigate"
    const broken = await resolveOutlineCounted(fakeDoc(), [{ title: "A", dest: "bad" }, { title: "B", dest: [{ num: 999 }] }]);
    expect(broken.items).toEqual([]);
    expect(broken.wanted).toBe(2); // they had destinations, none could be resolved
  });

  it("looks destinations up a few at a time, in the right order, and shares repeated pages", async () => {
    let running = 0;
    let peak = 0;
    let calls = 0;
    const slow: OutlineSource = {
      numPages: 50,
      getDestination: async () => null,
      getPageIndex: async (ref) => {
        calls += 1;
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 15));
        running -= 1;
        return (ref as { num: number }).num % 50;
      },
    };
    const raw = Array.from({ length: 40 }, (_, i) => ({ title: `Entry ${i}`, dest: [{ num: i % 20 }] }));
    const { items } = await resolveOutlineCounted(slow, raw);
    expect(items.map((i) => i.title)).toEqual(raw.map((r) => r.title));
    expect(items[7]!.target).toEqual({ kind: "page", page: 8 });
    expect(peak).toBeGreaterThan(1); // not one at a time
    expect(peak).toBeLessThanOrEqual(6); // and not all at once
    expect(calls).toBe(20); // a page referenced by two entries is looked up once
  });
});
