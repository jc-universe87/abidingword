import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Image as ImageIcon, Plus, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { FindingSources } from "@/features/library/FindingSources";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { findingLabel } from "@/features/studies/labels";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { Finding } from "@/types/studies";
import type { TeachingMaterial, TeachingPreparation } from "@/types/teaching";
import { Sources } from "./AssistPanel";
import { standingLabel } from "./labels";

interface LinksProps {
  preparation: TeachingPreparation;
  /** null: the teaching as a whole. */
  pointId: string | null;
  /** Where this is, for labels: "this point" / the point's name. */
  scope: string;
  studyFindings: Finding[];
  onChanged: (prep: TeachingPreparation) => void;
  onRevealScripture: () => void;
}

/**
 * What is used in a point (or the whole teaching): study findings (live links:
 * they stay the study's and show as they are now), Scripture passages, and
 * what the person kept from the assistant, each with its standing.
 */
export function TeachingLinks({ preparation, pointId, scope, studyFindings, onChanged, onRevealScripture }: LinksProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { goTo, translation } = useScripture();
  const id = useId();
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState("");
  const [adding, setAdding] = useState(false);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const links = preparation.findings.filter((l) => l.pointId === pointId);
  const passages = preparation.passages.filter((p) => p.pointId === pointId);
  const materials = preparation.materials.filter((m) => m.pointId === pointId);
  const available = studyFindings.filter((f) => !links.some((l) => l.finding.id === f.id));

  const act = async (run: () => Promise<TeachingPreparation>) => {
    setError(null);
    try {
      onChanged(await run());
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    }
  };

  const quiet = "inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong";

  return (
    <div className="flex flex-col gap-2">
      {(passages.length > 0 || links.length > 0 || materials.length > 0) && (
        <h5 className="type-meta m-0 font-medium">{t("studies.teaching.links.used", { scope })}</h5>
      )}
      {passages.length > 0 && (
        <ul aria-label={t("studies.teaching.links.passages", { scope })} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {passages.map((p) => {
            const name = referenceLabel(p.reference);
            return (
              <li key={p.id} className="inline-flex items-center rounded-aw border border-border-subtle">
                <button
                  type="button"
                  onClick={() => {
                    goTo(p.reference);
                    onRevealScripture();
                  }}
                  className="inline-flex min-h-11 items-center gap-1 px-3 text-[0.9375rem] font-medium text-link hover:bg-bg-secondary"
                >
                  <BookOpen className="size-4" aria-hidden="true" />
                  {name}
                </button>
                <button
                  type="button"
                  onClick={() => void act(() => api.teachingPassageRemove(p.id))}
                  aria-label={t("studies.teaching.links.removePassage", { passage: name })}
                  className="inline-flex size-11 items-center justify-center text-text-muted hover:bg-bg-secondary"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {links.length > 0 && (
        <ul aria-label={t("studies.teaching.links.findings", { scope })} className="m-0 flex list-none flex-col gap-2 p-0">
          {links.map((link) => (
            <li key={link.id} className="flex flex-col gap-1 border-l-[3px] border-border pl-3">
              <div className="flex items-start justify-between gap-2">
                <p className="reading m-0 whitespace-pre-wrap text-text">
                  <span className="type-meta mr-1 font-medium">{findingLabel(t, link.finding.findingType)}</span>
                  {link.finding.content}
                </p>
                <button
                  type="button"
                  onClick={() => void act(() => api.teachingFindingUnlink(link.id))}
                  aria-label={t("studies.teaching.links.removeFinding")}
                  title={t("studies.teaching.links.removeFindingHint")}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              {link.finding.passages.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {link.finding.passages.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        goTo(p.reference);
                        onRevealScripture();
                      }}
                      className="min-h-11 rounded-aw px-2 text-[0.875rem] text-link underline underline-offset-2 hover:bg-bg-secondary"
                    >
                      {referenceLabel(p.reference)}
                    </button>
                  ))}
                </div>
              )}
              <FindingSources finding={link.finding} canAdd={false} onChanged={() => void act(() => api.teachingGet(preparation.id))} />
            </li>
          ))}
        </ul>
      )}
      {materials.length > 0 && (
        <ul aria-label={t("studies.teaching.links.materials", { scope })} className="m-0 flex list-none flex-col gap-2 p-0">
          {materials.map((m) => (
            <Material key={m.id} material={m} onRemove={() => void act(() => api.teachingMaterialRemove(m.id))} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {!picking && available.length > 0 && (
          <button type="button" onClick={() => setPicking(true)} className={quiet}>
            <Plus className="size-4" aria-hidden="true" />
            {t("studies.teaching.links.useFinding")}
          </button>
        )}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={quiet}>
            <Plus className="size-4" aria-hidden="true" />
            {t("studies.teaching.links.addPassage")}
          </button>
        )}
      </div>
      {picking && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!choice) return;
            void act(() => api.teachingFindingLink({ preparationId: preparation.id, pointId, findingId: choice })).then((ok) => {
              if (ok) {
                setChoice("");
                setPicking(false);
              }
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setPicking(false);
            }
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <label htmlFor={`${id}-finding`} className="text-[0.9375rem] text-text-strong">
            {t("studies.teaching.links.chooseFinding")}
          </label>
          <select
            id={`${id}-finding`}
            autoFocus
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="h-11 min-w-0 max-w-full flex-1 basis-60 rounded-aw border border-border bg-bg px-2 text-[0.9375rem]"
          >
            <option value="">{t("studies.teaching.links.pick")}</option>
            {available.map((f) => (
              <option key={f.id} value={f.id}>
                {findingLabel(t, f.findingType)}: {f.content.length > 90 ? `${f.content.slice(0, 90)}…` : f.content || t("studies.teaching.links.empty")}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" className="min-h-11" disabled={!choice}>
            {t("common.add")}
          </Button>
          <Button className="min-h-11" onClick={() => setPicking(false)}>
            {t("common.cancel")}
          </Button>
          <p className="m-0 basis-full text-[0.875rem] text-text-muted">{t("studies.teaching.links.findingNote")}</p>
        </form>
      )}
      {adding && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void act(async () => api.teachingPassageAdd({ preparationId: preparation.id, pointId, reference: (await api.referenceParse(reference, translation?.id)).canonical })).then((ok) => {
              if (ok) {
                setReference("");
                setAdding(false);
              }
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setAdding(false);
            }
          }}
          className="flex flex-wrap items-center gap-2"
          noValidate
        >
          <label htmlFor={`${id}-passage`} className="sr-only">
            {t("studies.teaching.links.passageLabel", { scope })}
          </label>
          <input
            id={`${id}-passage`}
            autoFocus
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("studies.passages.placeholder")}
            className="h-11 min-w-0 flex-1 basis-48 rounded-aw border border-border bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted"
          />
          <Button type="submit" variant="primary" className="min-h-11">
            {t("common.add")}
          </Button>
          <Button className="min-h-11" onClick={() => setAdding(false)}>
            {t("common.cancel")}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="m-0 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Something kept from the assistant: always with its standing, never as the person's own words. */
function Material({ material, onRemove }: { material: TeachingMaterial; onRemove: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [preview, setPreview] = useState<string | null>(null);
  const image = material.image;
  const file = image?.file ?? null;
  const thumb = image?.thumbUrl ?? null;
  // Loaded once per image (not again on every save of the teaching).
  useEffect(() => {
    let active = true;
    const load = file ? api.teachingImage(file) : thumb ? api.assistantImagePreview(thumb) : null;
    load?.then(
      (data) => active && setPreview(data),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, file, thumb]);
  const tone = material.standing === "unverified" ? "text-danger" : "text-text-strong";
  return (
    <li className="flex flex-col gap-1 rounded-aw border border-dashed border-border bg-bg-secondary px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="type-meta font-medium">{t(`studies.teaching.material.${material.kind}`)}</span>
          <span className={`text-[0.875rem] font-medium ${tone}`}>{standingLabel(t, material.standing, image?.licence)}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("studies.teaching.material.remove")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-aw text-text-muted hover:bg-bg"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {material.title && <p className="type-subhead m-0">{material.title}</p>}
      {image &&
        (preview ? (
          <img src={preview} alt={material.title || material.content} className="w-full max-w-xs rounded-aw border border-border-subtle" />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-aw border border-border-subtle text-text-muted">
            <ImageIcon className="size-5" aria-hidden="true" />
          </span>
        ))}
      {material.content && <p className="m-0 whitespace-pre-wrap text-text">{material.content}</p>}
      {image?.attribution && <p className="type-meta m-0">{image.attribution}</p>}
      {image?.pageUrl && <Sources sources={[{ title: t("studies.teaching.assist.images.source"), url: image.pageUrl, site: "commons.wikimedia.org" }]} />}
      <Sources sources={material.sources} />
      {material.assistant && <p className="type-meta m-0">{t("studies.teaching.assist.from", { assistant: material.assistant })}</p>}
    </li>
  );
}
