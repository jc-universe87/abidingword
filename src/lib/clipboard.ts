/**
 * Puts text on the system clipboard. The web view's own clipboard is used (a
 * secure context, and always from a click or key press); where it is missing
 * the older copy command is tried. Resolves false when neither worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older way
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const done = document.execCommand?.("copy") ?? false;
    area.remove();
    return done;
  } catch {
    return false;
  }
}
