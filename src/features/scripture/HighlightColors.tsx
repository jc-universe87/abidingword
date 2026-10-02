import { useTranslation } from "react-i18next";
import { SWATCH_CLASS } from "@/lib/annotationRender";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/types/scripture";

/**
 * The five highlight colours as small swatches. Colour is only a visual
 * choice: each swatch is named (never colour alone) and carries no meaning.
 */
export function HighlightColors({ current, onPick }: { current?: HighlightColor | null; onPick: (color: HighlightColor) => void }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("scripture.colors.label")} className="flex items-center gap-3">
      {HIGHLIGHT_COLORS.map((color) => {
        const name = t(`scripture.colors.${color}`);
        return (
          <button
            key={color}
            type="button"
            aria-label={name}
            title={name}
            aria-pressed={current === undefined ? undefined : current === color}
            data-color={color}
            onClick={() => onPick(color)}
            className={`size-10 rounded-full border-2 border-text-muted ${SWATCH_CLASS[color]} hover:ring-2 hover:ring-accent aria-pressed:ring-2 aria-pressed:ring-text-strong`}
          />
        );
      })}
    </div>
  );
}
