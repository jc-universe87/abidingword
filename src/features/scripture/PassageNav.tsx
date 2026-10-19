import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { bookName } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useScripture } from "./ScriptureContext";

const field =
  "h-10 min-w-0 rounded-aw border border-border bg-bg px-2 text-[0.9375rem] text-text";
// Quiet around the text: the arrows need no box of their own.
const iconButton =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-aw text-text-strong " +
  "hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-40";

/** Book and chapter pickers, previous/next, and a typed-reference box. */
export function PassageNav() {
  const { t } = useTranslation();
  const { books, bookByCode, location, goToChapter, navigateText } = useScripture();
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const book = bookByCode.get(location.book);
  const chapterCount = book?.chapterCount ?? 1;

  const step = (delta: -1 | 1) => {
    if (!book) return;
    const next = location.chapter + delta;
    if (next >= 1 && next <= chapterCount) return goToChapter(book.code, next);
    const neighbour = books[book.ordinal - 1 + delta];
    if (neighbour) goToChapter(neighbour.code, delta === 1 ? 1 : neighbour.chapterCount);
  };
  const atStart = book?.ordinal === 1 && location.chapter === 1;
  const atEnd = book?.ordinal === books.length && location.chapter === chapterCount;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await navigateText(text);
      setText("");
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-1" noValidate>
        <label htmlFor="scripture-go-to" className="type-meta font-medium">
          {t("scripture.nav.goToLabel")}
        </label>
        <div className="flex gap-2">
          <input
            id="scripture-go-to"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("scripture.nav.goToPlaceholder")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`${field} flex-1 px-3 placeholder:text-text-muted`}
          />
          <button type="submit" className="h-10 rounded-aw border border-border px-3 text-[0.9375rem] font-medium text-text-strong hover:bg-bg-secondary">
            {t("scripture.nav.go")}
          </button>
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="m-0 text-[0.9375rem] text-danger">
            {error}
          </p>
        )}
      </form>

      <label className="flex flex-col gap-1">
        <span className="sr-only">{t("scripture.nav.book")}</span>
        <select value={location.book} onChange={(e) => goToChapter(e.target.value, 1)} className={field}>
          <optgroup label={t("scripture.nav.oldTestament")}>
            {books.filter((b) => b.testament === "OT").map((b) => (
              <option key={b.code} value={b.code}>{bookName(b.code, b.name)}</option>
            ))}
          </optgroup>
          <optgroup label={t("scripture.nav.newTestament")}>
            {books.filter((b) => b.testament === "NT").map((b) => (
              <option key={b.code} value={b.code}>{bookName(b.code, b.name)}</option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button type="button" className={iconButton} onClick={() => step(-1)} disabled={atStart} aria-label={t("scripture.nav.previousChapter")} title={t("scripture.nav.previousChapter")}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="type-meta">{t("scripture.nav.chapter")}</span>
          <select
            value={location.chapter}
            onChange={(e) => goToChapter(location.book, Number(e.target.value))}
            className={`${field} flex-1`}
          >
            {Array.from({ length: chapterCount }, (_, i) => (
              <option key={i + 1} value={i + 1}>{i + 1}</option>
            ))}
          </select>
        </label>
        <button type="button" className={iconButton} onClick={() => step(1)} disabled={atEnd} aria-label={t("scripture.nav.nextChapter")} title={t("scripture.nav.nextChapter")}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
