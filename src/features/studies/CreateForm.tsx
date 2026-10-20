import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";

interface CreateFormProps {
  label: string;
  placeholder: string;
  submitLabel: string;
  onCreate: (title: string) => Promise<unknown>;
}

/** A one-field form for creating a titled record (project, study). */
export function CreateForm({ label, placeholder, submitLabel, onCreate }: CreateFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError(t("studies.titleRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(title);
      setTitle("");
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor={id} className="text-[0.9375rem] font-medium text-text-strong">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-10 min-w-0 flex-1 basis-64 aw-input px-3 text-base placeholder:text-text-muted"
        />
        <Button type="submit" variant="primary" disabled={busy}>
          <Plus className="size-4" aria-hidden="true" />
          {submitLabel}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="m-0 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
