import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "quiet";

const base =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-aw px-4 text-[0.9375rem] font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-border text-text-strong hover:bg-bg-secondary",
  quiet: "px-2 text-text-strong hover:bg-bg-secondary",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "secondary", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
