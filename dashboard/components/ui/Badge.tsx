import React from "react";

export type BadgeTone = "neutral" | "info" | "danger";

export const BADGE_STYLES = {
  container:
    "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-line-strong bg-surface text-xs font-medium text-ink select-none",
  tones: {
    neutral: {
      dot: "bg-zinc-500 dark:bg-zinc-400",
      icon: "text-zinc-500 dark:text-zinc-400",
    },
    info: {
      dot: "bg-blue-500 dark:bg-blue-400",
      icon: "text-blue-500 dark:text-blue-400",
    },
    danger: {
      dot: "bg-red-500 dark:bg-red-400",
      icon: "text-red-500 dark:text-red-400",
    },
  },
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  "data-testid"?: string;
}

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  icon: Icon,
  className = "",
  "data-testid": testId,
  ...props
}: BadgeProps) {
  const marker = BADGE_STYLES.tones[tone];

  return (
    <span
      data-testid={testId}
      className={`${BADGE_STYLES.container} ${className}`.trim()}
      {...props}
    >
      {Icon ? (
        <Icon className={`h-3.5 w-3.5 shrink-0 ${marker.icon}`} aria-hidden="true" />
      ) : dot ? (
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${marker.dot}`} aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}
