import { useTranslation } from "react-i18next";
import lockupDark from "./assets/abiding-word-horizontal-compact-color-on-dark.svg";
import lockupLight from "./assets/abiding-word-horizontal-compact-color.svg";

// The brand package's "horizontal compact" lockup (mark + wordmark, for
// application chrome). Outlined SVGs with clearspace built in; the colour
// version follows the theme (see index.css). Minimum width: 140 px.
export function BrandLockup({ height = 40 }: { height?: number }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex" role="img" aria-label={t("common.appName")}>
      <img src={lockupLight} alt="" height={height} className="aw-on-light" style={{ height }} />
      <img src={lockupDark} alt="" height={height} className="aw-on-dark" style={{ height }} />
    </span>
  );
}
