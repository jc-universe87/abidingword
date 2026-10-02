// All interface text, bundled with the app (no network). One JSON file per
// area and language: src/i18n/locales/<language>/<area>.json. English is
// imported explicitly because its shape types every translation key; the
// other languages are collected by file name.
import app from "./locales/en/app.json";
import books from "./locales/en/books.json";
import common from "./locales/en/common.json";
import errors from "./locales/en/errors.json";
import library from "./locales/en/library.json";
import scripture from "./locales/en/scripture.json";
import settings from "./locales/en/settings.json";
import studies from "./locales/en/studies.json";
import type { Language } from "./languages";

export const english = { app, books, common, errors, library, scripture, settings, studies };

export type Messages = typeof english;
export const AREAS = Object.keys(english) as (keyof Messages)[];

const files = import.meta.glob<{ default: Record<string, unknown> }>("./locales/*/*.json", { eager: true });

function messagesFor(language: Language): Record<string, unknown> {
  if (language === "en") return english;
  const messages: Record<string, unknown> = {};
  for (const area of AREAS) {
    messages[area] = files[`./locales/${language}/${area}.json`]?.default ?? {};
  }
  return messages;
}

export const resources = {
  en: { translation: english },
  de: { translation: messagesFor("de") },
  ko: { translation: messagesFor("ko") },
  fr: { translation: messagesFor("fr") },
  es: { translation: messagesFor("es") },
  pt: { translation: messagesFor("pt") },
};
