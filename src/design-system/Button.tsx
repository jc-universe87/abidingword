import type { ComponentPropsWithRef } from "react";

/**
 * The action hierarchy (v0.18.5): one `primary` per place (the thing to do
 * next), `secondary` for the other real choices, `quiet` for small or
 * frequent actions beside content, `danger` for removing or deleting (always
 * with a confirmation or an undo nearby). Icon-only actions use the
 * `aw-icon-button` class with a name and a title.
 */
type Variant = "primary" | "secondary" | "quiet" | "danger";

const base =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-aw px-4 text-[0.9375rem] font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-border text-text-strong hover:bg-hover",
  quiet: "px-2 text-text-strong hover:bg-hover",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
};

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: Variant;
}

export function Button({ variant = "secondary", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
