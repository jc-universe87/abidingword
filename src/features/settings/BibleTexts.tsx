import { useEffect, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { useScripture } from "@/features/scripture/ScriptureContext";
import type { BibleTranslation } from "@/types/scripture";
import { formatDate, formatNumber } from "@/i18n/format";
import { LanguageChoice, type LanguageValue } from "@/features/scripture/LanguageChoice";

/** Settings → Bible Texts: what is installed, details, add, remove. */
export function BibleTexts({ onAddBible }: { onAddBible: () => void }) {
  const { t } = useTranslation();
  const { translations } = useScripture();
  return (
    <div className="flex flex-col gap-4">
      {translations.length === 0 ? (
        <p className="m-0 text-text-muted">{t("scripture.bibles.empty")}</p>
      ) : (
        <ul aria-label={t("scripture.bibles.installed")} className="m-0 flex list-none flex-col border-t border-border-subtle p-0">
          {translations.map((bible) => (
            <BibleRow key={bible.id} bible={bible} />
          ))}
        </ul>
      )}
      <div>
        <Button onClick={onAddBible}>{t("scripture.bibles.addBible")}</Button>
      </div>
    </div>
  );
}

function BibleRow({ bible }: { bible: BibleTranslation }) {
  const { t } = useTranslation();
  const source = bible.sourceOrigin === "bundled" ? t("scripture.bibles.source.bundled") : t("scripture.bibles.source.imported");
  const status = bible.importStatus === "ready" ? t("scripture.bibles.status.ready") : t("scripture.bibles.status.notStructured");
  const api = useApi();
  const { reloadTranslations } = useScripture();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setError(null);
    try {
      await api.bibleRemove(bible.id);
      await reloadTranslations();
    } catch (e) {
      setError(toApiError(e).message);
      setConfirming(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 border-b border-border-subtle py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="m-0 font-semibold text-text-strong">
            {bible.name} <span className="font-normal text-text-muted">({bible.shortName})</span>
          </p>
          <p className="m-0 text-[0.9375rem] text-text-muted">
            {[bible.language, source, status].join(t("common.listSeparator"))}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t("scripture.bibles.hideDetails") : t("scripture.bibles.details")}
          </Button>
          <Button variant="quiet" onClick={() => setConfirming(true)} aria-label={t("scripture.bibles.removeNamed", { name: bible.name })}>
            {t("scripture.bibles.removeEllipsis")}
          </Button>
        </div>
      </div>

      {open && (
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 text-[0.9375rem] sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-text-strong">{t("scripture.bibles.field.language")}</dt>
          <dd className="m-0">
            <BibleLanguage bible={bible} />
          </dd>
          <dt className="font-medium text-text-strong">{t("scripture.bibles.field.contents")}</dt>
          <dd className="m-0">{t("scripture.bibles.contents", { count: bible.bookCount, verses: formatNumber(bible.verseCount) })}</dd>
          {bible.publisher && (<><dt className="font-medium text-text-strong">{t("scripture.bibles.field.publisher")}</dt><dd className="m-0">{bible.publisher}</dd></>)}
          {bible.licenseType && (<><dt className="font-medium text-text-strong">{t("scripture.bibles.field.licence")}</dt><dd className="m-0">{bible.licenseType}</dd></>)}
          {bible.copyrightNotice && (<><dt className="font-medium text-text-strong">{t("scripture.bibles.field.notice")}</dt><dd className="m-0">{bible.copyrightNotice}</dd></>)}
          {bible.originalFileName && (<><dt className="font-medium text-text-strong">{t("scripture.bibles.field.from")}</dt><dd className="m-0 break-all">{bible.originalFileName}</dd></>)}
          <dt className="font-medium text-text-strong">{t("scripture.bibles.field.added")}</dt>
          <dd className="m-0">{formatDate(bible.createdAt)}</dd>
        </dl>
      )}

      {confirming && (
        <div role="alertdialog" aria-labelledby={`remove-${bible.id}`} className="flex flex-col gap-3 border-l-[3px] border-danger bg-bg-secondary px-4 py-3">
          <p id={`remove-${bible.id}`} className="m-0">
            <Trans
              i18nKey={bible.sourceOrigin === "managed_copy" ? "scripture.bibles.confirmRemoveManaged" : "scripture.bibles.confirmRemove"}
              values={{ name: bible.name }}
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={remove}>{t("scripture.bibles.removeNamed", { name: bible.shortName })}</Button>
            <Button autoFocus onClick={() => setConfirming(false)}>{t("scripture.bibles.keep")}</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </li>
  );
}

/**
 * A Bible's language, correctable here (v0.18.3): the name shown and the tag
 * typed references use first. Saving changes nothing else about the Bible.
 */
function BibleLanguage({ bible }: { bible: BibleTranslation }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const { reloadTranslations } = useScripture();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<LanguageValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Back on "Change language" after Save or Cancel, as from any small editor.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      changeButton.current?.focus();
    }
  }, [editing]);
  const finish = () => {
    returnFocus.current = true;
    setEditing(false);
  };

  const start = () => {
    setValue(bible.languageCode ? { code: bible.languageCode, name: bible.language } : bible.language ? { code: null, name: bible.language } : null);
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    if (!value || !value.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.bibleSetLanguage({ id: bible.id, language: value.name.trim(), languageCode: value.code });
      await reloadTranslations();
      finish();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-3">
        <span>{bible.language || t("scripture.bibles.languageNotSet")}</span>
        <Button ref={changeButton} variant="quiet" onClick={start}>
          {t("scripture.bibles.changeLanguage")}
        </Button>
      </span>
    );
  }
  return (
    <div className="flex max-w-md flex-col gap-2">
      <LanguageChoice id={`${id}-language`} label={t("scripture.bibles.field.language")} value={value} onChange={setValue} />
      <div className="flex gap-2">
        <Button variant="primary" onClick={save} disabled={busy || !value || !value.name.trim()}>
          {t("scripture.bibles.saveLanguage")}
        </Button>
        <Button onClick={finish}>{t("common.cancel")}</Button>
      </div>
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </div>
  );
}
