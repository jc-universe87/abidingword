import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/lib/ApiContext";
import type { BibleLanguageOption } from "@/types/scripture";

/**
 * A Bible's language: one of the 100 reference languages (stored as its tag,
 * which typed references use first), or another language by name only (no
 * tag). Starts unchosen unless the Bible's own metadata named it — nothing is
 * guessed from file names, titles or text (docs/correctness-hardening-v0.18.3.md).
 */
export interface LanguageValue {
  /** The tag ("pt", "pt-BR"); null for a language not in the list. */
  code: string | null;
  /** The name shown with the Bible ("Português"). */
  name: string;
}

const OTHER = "__other";

let cached: Promise<BibleLanguageOption[]> | null = null;

/** The name of a language in the interface language, if the platform knows it. */
function localName(code: string, locale: string): string | undefined {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The name stored with a Bible for a tag: the language's own name ("português",
 * "português (Brasil)"), whether it was chosen from the list or read from the
 * files' metadata; else its name in the interface language.
 */
export function storedName(option: BibleLanguageOption | undefined, code: string, locale: string): string {
  return option?.native ?? localName(code, code) ?? localName(code, locale) ?? option?.name ?? code;
}

export function LanguageChoice({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: LanguageValue | null;
  onChange: (value: LanguageValue | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [options, setOptions] = useState<BibleLanguageOption[] | null>(null);
  const [other, setOther] = useState(value !== null && value.code === null);
  const otherInput = useRef<HTMLInputElement>(null);
  const focusOther = useRef(false);

  useEffect(() => {
    let live = true;
    cached ??= api.bibleLanguageOptions().catch(() => {
      cached = null;
      return [];
    });
    void cached.then((list) => {
      if (live) setOptions(list);
    });
    return () => {
      live = false;
    };
  }, [api]);

  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";

  // A tag given without a name (from the Bible's metadata) is named as a
  // choice from the list would be: its own name first, once the list is here.
  useEffect(() => {
    if (options !== null && value?.code && !value.name.trim()) {
      onChange({ code: value.code, name: storedName(options.find((o) => o.code === value.code), value.code, locale) });
    }
  }, [options, value, locale, onChange]);

  useEffect(() => {
    if (other && focusOther.current) {
      focusOther.current = false;
      otherInput.current?.focus();
    }
  }, [other]);

  const labelled = useMemo(() => {
    const list = (options ?? []).map((o) => {
      const local = localName(o.code, locale) ?? o.name;
      const text = o.native && o.native.toLowerCase() !== local.toLowerCase() ? `${local} (${o.native})` : local;
      return { code: o.code, text };
    });
    // A tag from the Bible's metadata that is not one of the list (pt-BR) is offered as it is.
    if (value?.code && !list.some((o) => o.code === value.code)) {
      list.push({ code: value.code, text: localName(value.code, locale) ?? value.name ?? value.code });
    }
    return list.sort((a, b) => a.text.localeCompare(b.text, locale));
  }, [options, locale, value]);

  const selected = other ? OTHER : (value?.code ?? "");
  const choose = (code: string) => {
    if (code === OTHER) {
      focusOther.current = true;
      setOther(true);
      onChange({ code: null, name: value?.code === null ? value.name : "" });
      return;
    }
    setOther(false);
    if (!code) {
      onChange(null);
      return;
    }
    onChange({ code, name: storedName(options?.find((o) => o.code === code), code, locale) });
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[0.9375rem] font-medium text-text-strong">
        {label}
      </label>
      <select
        id={id}
        value={selected}
        onChange={(e) => choose(e.target.value)}
        aria-describedby={`${id}-hint`}
        className="h-10 aw-input px-2 text-base"
      >
        <option value="">{t("scripture.language.choose")}</option>
        {labelled.map((o) => (
          <option key={o.code} value={o.code}>
            {o.text}
          </option>
        ))}
        <option value={OTHER}>{t("scripture.language.other")}</option>
      </select>
      {other && (
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-[0.9375rem] text-text-strong">{t("scripture.language.otherName")}</span>
          <input
            ref={otherInput}
            value={value?.name ?? ""}
            onChange={(e) => onChange({ code: null, name: e.target.value })}
            required
            aria-invalid={!value?.name.trim()}
            aria-describedby={`${id}-hint`}
            className="h-10 aw-input px-3 text-base"
          />
        </label>
      )}
      <p id={`${id}-hint`} className="m-0 type-meta">
        {t("scripture.language.hint")}
      </p>
    </div>
  );
}
