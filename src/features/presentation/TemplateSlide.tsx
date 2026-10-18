import { useTranslation } from "react-i18next";
import type { Page, PageBlock } from "@/types/presentationTemplate";

/** The app's own text fonts after a template's family (as in the exports, which fall back the same way). */
const FALLBACK = 'system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", sans-serif';

const hexAlpha = (hex: string, alpha: number) => {
  const v = Number.parseInt(hex.replace("#", ""), 16) || 0;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${Math.max(0, Math.min(1, alpha))})`;
};

/**
 * One audience page in a church template, drawn from the page the core lays
 * out for PowerPoint and PDF (`presentation_layout`): the same boxes, sizes,
 * colours and line breaks, so the screen, the PowerPoint file and the PDF
 * agree. Units are points on the template's page, as shares of its width.
 */
export function TemplateSlide({ page, images, showOverflow = false }: { page: Page; images: Map<string, string>; showOverflow?: boolean }) {
  const pt = (points: number) => `${((points / page.width) * 100).toFixed(4)}cqw`;
  return (
    <div data-template-page="" className="absolute inset-0 overflow-hidden" style={{ backgroundColor: page.background, containerType: "inline-size" }}>
      {page.blocks.map((block, i) => (
        <Block key={i} block={block} images={images} pt={pt} showOverflow={showOverflow} />
      ))}
    </div>
  );
}

function Block({ block, images, pt, showOverflow }: { block: PageBlock; images: Map<string, string>; pt: (p: number) => string; showOverflow: boolean }) {
  const { t } = useTranslation();
  const box = { position: "absolute" as const, left: pt(block.x), top: pt(block.y), width: pt(block.w), height: pt(block.h) };
  switch (block.type) {
    case "picture": {
      const src = images.get(block.assetId);
      if (!src) return null;
      const { left, top, right, bottom } = block.crop;
      const vw = Math.max(0.01, 1 - left - right);
      const vh = Math.max(0.01, 1 - top - bottom);
      return (
        <div aria-hidden="true" className="overflow-hidden" style={{ ...box, opacity: block.opacity }}>
          <img
            src={src}
            alt=""
            draggable={false}
            className="absolute max-w-none"
            style={{ width: `${100 / vw}%`, height: `${100 / vh}%`, left: `${(-left / vw) * 100}%`, top: `${(-top / vh) * 100}%` }}
          />
        </div>
      );
    }
    case "image": {
      const src = images.get(block.assetId);
      return src ? <img src={src} alt="" style={box} className="object-contain" /> : null;
    }
    case "rect":
      return (
        <div
          aria-hidden="true"
          style={{
            ...box,
            backgroundColor: block.fill ? hexAlpha(block.fill, block.fillOpacity) : undefined,
            border: block.line && block.lineWidth > 0 ? `${pt(block.lineWidth)} solid ${block.line}` : undefined,
            boxSizing: "border-box",
          }}
        />
      );
    case "missing":
      return (
        <div className="flex items-center justify-center border-2 border-dashed text-center" style={{ ...box, borderColor: "currentColor", opacity: 0.7, fontSize: pt(20) }}>
          {t("presentation.export.labels.imageUnavailable")}
        </div>
      );
    case "text": {
      const step = block.size * (block.line > 0 ? block.line : 1.25);
      const frame = block.frame;
      return (
        <>
          {block.lines.map((line, i) => (
            <div
              key={i}
              className="whitespace-pre"
              style={{
                position: "absolute",
                left: pt(block.x),
                width: pt(block.w),
                top: pt(block.y + i * step),
                height: pt(step),
                lineHeight: pt(step),
                fontSize: pt(block.size),
                fontWeight: block.bold ? 700 : 400,
                fontStyle: block.italic ? "italic" : "normal",
                fontFamily: block.family ? `"${block.family}", ${FALLBACK}` : FALLBACK,
                color: block.color,
                textAlign: block.align,
              }}
            >
              {line}
            </div>
          ))}
          {showOverflow && block.overflow && frame && (
            <div
              data-overflow=""
              className="pointer-events-none absolute border-2 border-dashed border-danger"
              style={{ left: pt(frame.x), top: pt(frame.y), width: pt(frame.w), height: pt(frame.h) }}
            >
              <span className="absolute right-0 top-0 rounded-bl bg-danger px-1 text-[0.75rem] font-medium text-white">{t("presentation.templates.tooLong")}</span>
            </div>
          )}
        </>
      );
    }
  }
}
