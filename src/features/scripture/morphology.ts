import type { TFunction } from "i18next";
import type { MorphDescribed } from "@/types/scripture";

/**
 * A described morphology code in words (v0.21), from the core's own
 * description: one part per segment ("preposition + noun, common, feminine,
 * singular, absolute"). Only OSHB codes are ever described; verb stems are
 * names (qal, piel…) and shown as written.
 */
export function describeMorph(t: TFunction, described: MorphDescribed): string {
  return described.segments
    .map((segment) => {
      const pos = t(`scripture.morph.pos.${segment.partOfSpeech}`, {
        defaultValue: segment.partOfSpeech,
      });
      const features = segment.features
        .filter(
          (f) =>
            !(f.field.endsWith("Type") && f.value === segment.partOfSpeech),
        )
        .map((f) =>
          f.field === "stem"
            ? f.value
            : t(`scripture.morph.${f.field}.${f.value}`, {
                defaultValue: f.value,
              }),
        );
      return [pos, ...features].join(t("common.listSeparator"));
    })
    .join(" + ");
}

/** The language a described code is in. */
export function morphLanguage(t: TFunction, described: MorphDescribed): string {
  return t(`scripture.morph.language.${described.language}`);
}
