// The Abiding Word logomark, drawn from the master geometry in the brand
// package (128 × 102 grid). Colours follow the theme: Forest/Burgundy/Brass
// on light, Ivory/Ivory/Brass on dark. Do not redraw or recolour parts.
export function Logomark({ height = 24, className = "" }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 128 102"
      height={height}
      width={(height * 128) / 102}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="0,26 30,0 30,92 0,102" fill="var(--aw-mark-page)" />
      <circle cx="58" cy="35" r="10" fill="var(--aw-mark-colon)" />
      <circle cx="58" cy="67" r="10" fill="var(--aw-mark-colon)" />
      <polygon points="80,8 104,8 128,51 104,94 80,94 104,51" fill="var(--aw-mark-chevron)" />
    </svg>
  );
}
