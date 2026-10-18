import { useTranslation } from "react-i18next";
import type { AudienceSlide, ItemKind, LiveMarks, PresentationTheme, ScriptureOverlay } from "@/types/presentation";
import type { Page } from "@/types/presentationTemplate";
import { palette, refLabel, textWeight } from "./labels";
import { TemplateSlide } from "./TemplateSlide";

interface SlideViewProps {
  slide: AudienceSlide;
  kind: ItemKind;
  theme: PresentationTheme;
  /** The slide's image as a data: address, when it is on this computer. */
  image?: string | null;
  /** A passage shown over the slide. */
  overlay?: ScriptureOverlay | null;
  /** Blank the screen (a pause the speaker chose). */
  blank?: boolean;
  /** The speaker's pointer and pen, for this moment only. */
  marks?: LiveMarks | null;
  /** Its accessible name, e.g. "Slide 3 of 9". */
  label: string;
  className?: string;
  /**
   * The page in the church template, laid out by the core (with the
   * passage already on it when one is shown); drawn instead of the
   * built-in arrangement.
   */
  page?: Page | null;
  /** The template's pictures and the slide's image, by asset id. */
  images?: Map<string, string>;
  /** Mark text boxes too small for their text (the editor only, never the audience). */
  showOverflow?: boolean;
}

const NO_IMAGES = new Map<string, string>();

/**
 * One audience slide, drawn as the exports draw it: a 16:9 page whose text
 * sizes follow the page width (the same proportions as the PowerPoint and
 * PDF layout, which works in points on a 960-point-wide page). Only
 * audience content can be given to it.
 */
export function SlideView({ slide, kind, theme, image = null, overlay = null, blank = false, marks = null, label, className = "", page = null, images = NO_IMAGES, showOverflow = false }: SlideViewProps) {
  if (page) {
    return (
      <div role="group" aria-label={label} className={`relative w-full overflow-hidden ${className}`} style={{ aspectRatio: `${page.width} / ${page.height}`, backgroundColor: page.background }}>
        {/* A pause slide keeps the template's background (the core left out its content); only the speaker's blank screen is plain. */}
        {blank ? null : <TemplateSlide page={page} images={images} showOverflow={showOverflow} />}
        {!blank && marks && <MarksLayer marks={marks} />}
      </div>
    );
  }
  const colours = palette(theme);
  // Points on a 960-point page, as a share of the slide's width.
  const pt = (points: number) => `${(points / 9.6).toFixed(3)}cqw`;
  const pad = pt(64);
  const style = { backgroundColor: colours.background, color: colours.text, containerType: "inline-size" as const };
  return (
    <div role="group" aria-label={label} className={`relative aspect-video w-full overflow-hidden ${className}`} style={style}>
      {blank || slide.blank ? null : overlay ? (
        <Scripture heading={null} reference={overlay.label} bible={overlay.bible} verses={overlay.verses} colours={colours} pt={pt} pad={pad} />
      ) : (
        <Content slide={slide} kind={kind} image={image} colours={colours} pt={pt} pad={pad} />
      )}
      {!blank && marks && <MarksLayer marks={marks} />}
    </div>
  );
}

/** The slide in these units: 160 across, 90 down, so marks keep their size on any screen. */
const W = 160;
const H = 90;

/** The pointer (a soft red spot) and the highlighter strokes, drawn over the slide. */
export function MarksLayer({ marks }: { marks: LiveMarks }) {
  if (!marks.pointer && marks.strokes.length === 0) return null;
  return (
    <svg aria-hidden="true" data-live-marks="" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
      {marks.strokes.map((stroke, i) =>
        stroke.length === 1 ? (
          <circle key={i} cx={stroke[0]![0] * W} cy={stroke[0]![1] * H} r={1.6} fill="#facc15" fillOpacity={0.55} />
        ) : (
          <polyline
            key={i}
            points={stroke.map(([x, y]) => `${(x * W).toFixed(2)},${(y * H).toFixed(2)}`).join(" ")}
            fill="none"
            stroke="#facc15"
            strokeOpacity={0.55}
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
      {marks.pointer && (
        <g>
          <circle cx={marks.pointer[0] * W} cy={marks.pointer[1] * H} r={6} fill="#ef4444" fillOpacity={0.18} />
          <circle cx={marks.pointer[0] * W} cy={marks.pointer[1] * H} r={1.6} fill="#ef4444" stroke="#ffffff" strokeWidth={0.4} />
        </g>
      )}
    </svg>
  );
}

type Pt = (points: number) => string;

/** A size that keeps long text on the slide, never below 22 points. */
function fitting(text: string, max: number, roomy: number): number {
  const length = textWeight(text);
  if (length <= roomy) return max;
  return Math.max(22, Math.round(max * Math.sqrt(roomy / length)));
}

function Scripture({
  heading,
  reference,
  bible,
  verses,
  colours,
  pt,
  pad,
}: {
  heading: string | null;
  reference: string | null;
  bible: string | null;
  verses: { verse: number; text: string }[];
  colours: { accent: string; muted: string };
  pt: Pt;
  pad: string;
}) {
  const { t } = useTranslation();
  const text = verses.map((v) => `${v.verse} ${v.text}`).join(" ");
  return (
    <div className="flex h-full flex-col" style={{ padding: pad, gap: pt(12) }}>
      {heading && <p className="m-0 font-semibold leading-tight" style={{ fontSize: pt(32) }}>{heading}</p>}
      {reference && (
        <p className="m-0 font-semibold" style={{ fontSize: pt(28), color: colours.accent }}>
          {bible ? t("presentation.slide.referenceWithBible", { reference, bible }) : reference}
        </p>
      )}
      {verses.length > 0 ? (
        <p className="m-0 leading-snug" style={{ fontSize: pt(fitting(text, 34, 260)) }}>
          {verses.map((v) => (
            <span key={`${v.verse}`}>
              <sup className="font-semibold" style={{ color: colours.muted }}>{v.verse}</sup> {v.text}{" "}
            </span>
          ))}
        </p>
      ) : (
        reference && <p className="m-0" style={{ fontSize: pt(24), color: colours.muted }}>{t("presentation.export.labels.scriptureUnavailable")}</p>
      )}
    </div>
  );
}

function Content({
  slide,
  kind,
  image,
  colours,
  pt,
  pad,
}: {
  slide: AudienceSlide;
  kind: ItemKind;
  image: string | null;
  colours: { accent: string; muted: string };
  pt: Pt;
  pad: string;
}) {
  const { t } = useTranslation();
  const { heading, body } = slide;
  const reference = slide.reference ? refLabel(slide.reference) : null;
  const lines = (text: string) => text.split("\n").map((line, i) => <span key={i} className="block">{line || " "}</span>);

  if (kind === "title" || kind === "section") {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center" style={{ padding: pad, gap: pt(16) }}>
        {heading && <p className="m-0 font-semibold leading-tight" style={{ fontSize: pt(fitting(heading, kind === "title" ? 54 : 46, 40)) }}>{heading}</p>}
        {reference && <p className="m-0" style={{ fontSize: pt(28), color: colours.accent }}>{reference}</p>}
        {body && <p className="m-0" style={{ fontSize: pt(26), color: colours.muted }}>{lines(body)}</p>}
      </div>
    );
  }
  if (kind === "scripture") {
    return <Scripture heading={heading} reference={reference} bible={slide.bible} verses={slide.verses} colours={colours} pt={pt} pad={pad} />;
  }
  if (kind === "image") {
    const img = slide.image;
    const caption = img ? [img.caption, img.generated ? t("presentation.export.labels.generatedImage") : null].filter(Boolean).join(" · ") : "";
    return (
      <div className="flex h-full flex-col items-center" style={{ padding: `${pt(40)} ${pad} ${pt(32)}`, gap: pt(8) }}>
        {heading && <p className="m-0 text-center font-semibold" style={{ fontSize: pt(32) }}>{heading}</p>}
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {image ? (
            <img src={image} alt={img?.caption ?? ""} className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center border-2 border-dashed text-center" style={{ borderColor: colours.muted, color: colours.muted, fontSize: pt(22) }}>
              {t("presentation.export.labels.imageUnavailable")}
            </div>
          )}
        </div>
        {caption && <p className="m-0 text-center" style={{ fontSize: pt(26) }}>{caption}</p>}
        {img?.credit && <p className="m-0 text-center" style={{ fontSize: pt(16), color: colours.muted }}>{img.credit}</p>}
      </div>
    );
  }
  if (kind === "question" || (kind === "text" && !heading)) {
    const strong = kind === "question";
    return (
      <div className="flex h-full flex-col" style={{ padding: pad, gap: pt(12) }}>
        {heading && <p className="m-0 text-center font-semibold" style={{ fontSize: pt(28), color: colours.muted }}>{heading}</p>}
        <div className="flex flex-1 items-center justify-center text-center">
          {body && (
            <p className={`m-0 leading-snug ${strong ? "font-semibold" : ""}`} style={{ fontSize: pt(fitting(body, strong ? 44 : 40, 90)) }}>
              {lines(body)}
            </p>
          )}
        </div>
      </div>
    );
  }
  if (kind === "quote") {
    return (
      <div className="flex h-full flex-col justify-center" style={{ padding: `${pad} ${pt(88)}`, gap: pt(16) }}>
        {body && <p className="m-0 leading-snug" style={{ fontSize: pt(fitting(body, 38, 120)) }}>{t("presentation.slide.quoted", { text: body.trim() })}</p>}
        {heading && <p className="m-0" style={{ fontSize: pt(26), color: colours.muted }}>{t("presentation.slide.quoteBy", { name: heading })}</p>}
      </div>
    );
  }
  // heading, text, activity
  return (
    <div className="flex h-full flex-col" style={{ padding: pad, gap: pt(20) }}>
      {heading && <p className="m-0 font-semibold leading-tight" style={{ fontSize: pt(fitting(heading, kind === "text" ? 36 : 44, 40)) }}>{heading}</p>}
      {body && <p className="m-0 leading-snug" style={{ fontSize: pt(fitting(body, kind === "text" ? 34 : 30, 160)) }}>{lines(body)}</p>}
    </div>
  );
}
