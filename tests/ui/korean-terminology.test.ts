import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Korean terminology regression (v0.10). Checks specific semantic keys and
// the user-facing locale areas; there is deliberately no global ban on 연구.

function load(area: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`src/i18n/locales/ko/${area}.json`, "utf8"));
}

function flatten(value: unknown, prefix = "", out: Record<string, string> = {}) {
  if (typeof value === "string") out[prefix] = value;
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const studies = flatten(load("studies"));
const everything = Object.assign(
  {},
  ...["app", "studies", "library", "scripture", "settings", "common", "errors"].map((a) =>
    flatten(load(a), a),
  ),
) as Record<string, string>;

describe("Korean terminology", () => {
  it("uses 성경공부 for generic Study and no 연구 in study types or labels", () => {
    expect(studies["home.title"]).toBe("성경공부");
    expect(studies["studyType.passage"]).toBe("본문 공부");
    expect(studies["studyType.word"]).toBe("단어 공부");
    expect(studies["studyType.topical"]).toBe("주제별 성경공부");
    expect(studies["studyType.biblical_theology"]).toBe("성경신학");
    expect(studies["studyType.systematic_theology"]).toBe("조직신학");
    for (const [key, value] of Object.entries(studies)) {
      if (/^(studyType|newStudy|list|header|projects|templates|templateEditor|sections|blocks)\./.test(key))
        expect(value, key).not.toContain("연구");
    }
  });

  it("calls a Project 성경공부 모음 and a Template 공부 틀", () => {
    expect(studies["projects.title"]).toContain("성경공부 모음");
    expect(studies["newStudy.template"]).toBe("공부 틀");
    expect(studies["newStudy.approach.custom"]).toBe("빈 성경공부");
    expect(studies["header.fromTemplate"]).toBe("내 공부 틀에서 시작함: {{name}}");
  });

  it("calls a Section 부분 and never shows 블록", () => {
    expect(studies["findings.section"]).toBe("부분");
    expect(studies["add.section"]).toBe("부분");
    for (const [key, value] of Object.entries(everything)) expect(value, key).not.toContain("블록");
  });

  it("does not use transliterated app words in user-facing copy", () => {
    for (const [key, value] of Object.entries(everything)) {
      expect(value, key).not.toMatch(/프로젝트|템플릿|섹션/);
    }
  });

  it("keeps Finding as 기록 and the Remark block as 참고", () => {
    expect(studies["blockType.note"]).toBe("참고");
    expect(JSON.stringify(load("studies"))).not.toContain("발견");
  });
});
