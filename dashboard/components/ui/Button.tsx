import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "sm" | "icon";

export interface ButtonClassesOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function buttonClasses({
  variant = "secondary",
  size = "md",
  className = "",
}: ButtonClassesOptions = {}): string {
  const base =
    "inline-flex items-center justify-center font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none select-none";

  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      "bg-ink text-surface hover:opacity-90 aria-pressed:ring-1 aria-pressed:ring-ink aria-pressed:ring-offset-1 aria-[pressed=true]:ring-1 aria-[pressed=true]:ring-ink aria-[pressed=true]:ring-offset-1",
    secondary:
      "bg-surface text-ink border border-line-strong hover:bg-surface-subtle aria-pressed:bg-surface-subtle aria-pressed:border-ink aria-[pressed=true]:bg-surface-subtle aria-[pressed=true]:border-ink",
    ghost:
      "bg-transparent text-ink hover:bg-surface-subtle aria-pressed:bg-surface-subtle aria-[pressed=true]:bg-surface-subtle",
  };

  const sizeStyles: Record<ButtonSize, string> = {
    md: "h-8 px-3 text-sm gap-1.5",
    sm: "h-7 px-2 text-xs gap-1",
    icon: "h-8 w-8 p-0",
  };

  return `${base} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`.trim();
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  "aria-pressed"?: boolean | "true" | "false" | "mixed";
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  "aria-pressed": ariaPressed,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={ariaPressed}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {children}
    </button>
  );
}
