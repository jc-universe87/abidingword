import { useState } from "react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { useScripture } from "@/features/scripture/ScriptureContext";
import type { BibleTranslation } from "@/types/scripture";
import { formatDate } from "@/features/studies/format";

/** Settings → Bible Texts: what is installed, details, add, remove. */
export function BibleTexts({ onAddBible }: { onAddBible: () => void }) {
  const { translations } = useScripture();
  return (
    <div className="flex flex-col gap-4">
      {translations.length === 0 ? (
        <p className="m-0 text-text-muted">No Bible has been added yet.</p>
      ) : (
        <ul aria-label="Installed Bibles" className="m-0 flex list-none flex-col border-t border-border-subtle p-0">
          {translations.map((bible) => (
            <BibleRow key={bible.id} bible={bible} />
          ))}
        </ul>
      )}
      <div>
        <Button onClick={onAddBible}>Add a Bible…</Button>
      </div>
    </div>
  );
}

function source(bible: BibleTranslation): string {
  return bible.sourceOrigin === "bundled" ? "Included with Abiding Word" : "Imported from your file";
}

function BibleRow({ bible }: { bible: BibleTranslation }) {
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
            {bible.language} · {source(bible)} · {bible.importStatus === "ready" ? "Ready" : "Not yet structured"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide details" : "Details"}
          </Button>
          <Button variant="quiet" onClick={() => setConfirming(true)} aria-label={`Remove ${bible.name}`}>
            Remove…
          </Button>
        </div>
      </div>

      {open && (
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 text-[0.9375rem] sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-text-strong">Contents</dt>
          <dd className="m-0">{bible.bookCount} books, {bible.verseCount.toLocaleString()} verses</dd>
          {bible.publisher && (<><dt className="font-medium text-text-strong">Publisher</dt><dd className="m-0">{bible.publisher}</dd></>)}
          {bible.licenseType && (<><dt className="font-medium text-text-strong">Licence</dt><dd className="m-0">{bible.licenseType}</dd></>)}
          {bible.copyrightNotice && (<><dt className="font-medium text-text-strong">Notice</dt><dd className="m-0">{bible.copyrightNotice}</dd></>)}
          {bible.originalFileName && (<><dt className="font-medium text-text-strong">From</dt><dd className="m-0 break-all">{bible.originalFileName}</dd></>)}
          <dt className="font-medium text-text-strong">Added</dt>
          <dd className="m-0">{formatDate(bible.createdAt)}</dd>
        </dl>
      )}

      {confirming && (
        <div role="alertdialog" aria-labelledby={`remove-${bible.id}`} className="flex flex-col gap-3 border-l-[3px] border-danger bg-bg-secondary px-4 py-3">
          <p id={`remove-${bible.id}`} className="m-0">
            Remove <strong>{bible.name}</strong>? Its text will be deleted from Abiding Word
            {bible.sourceOrigin === "managed_copy" ? ", together with Abiding Word's copy of the file (your original file is not touched)" : ""}.
            Your studies, passage links and notes are kept.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={remove}>Remove {bible.shortName}</Button>
            <Button autoFocus onClick={() => setConfirming(false)}>Keep it</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </li>
  );
}
