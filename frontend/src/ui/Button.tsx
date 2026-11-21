import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet" | "danger";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap select-none " +
  "transition-[background-color,color,border-color,box-shadow] duration-150 ease-out " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/85 active:bg-ink/75",
  secondary: "border border-line-control bg-surface text-ink hover:bg-sunken active:bg-sunken/70",
  quiet: "text-ink underline-offset-4 decoration-cobalt hover:underline px-0",
  danger: "border border-danger text-danger hover:bg-danger-tint",
};

const sizes: Record<Size, string> = { md: "h-11 px-5 text-[0.9375rem]", sm: "h-10 px-4 text-sm" };

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return [base, variants[variant], variant === "quiet" ? "h-11 text-[0.9375rem]" : sizes[size], extra].join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
