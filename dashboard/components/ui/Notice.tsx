import React from "react";
import type { LucideIcon } from "lucide-react";

export type NoticeTone = "neutral" | "info";

const NOTICE_STYLES: Record<NoticeTone, { container: string; icon: string }> = {
  neutral: {
    container: "bg-surface-subtle border-line text-ink",
    icon: "text-ink-muted",
  },
  info: {
    container: "bg-accent-soft border-accent/20 text-ink",
    icon: "text-accent",
  },
};

export interface NoticeProps {
  children: React.ReactNode;
  tone?: NoticeTone;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function Notice({
  children,
  tone = "neutral",
  icon: Icon,
  iconClassName,
  actions,
  className = "",
}: NoticeProps) {
  const styles = NOTICE_STYLES[tone];

  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-md border px-4 py-3 text-sm ${styles.container} ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className={`h-4 w-4 shrink-0 ${iconClassName ?? styles.icon}`} />}
        <div className="min-w-0">{children}</div>
      </div>
      {actions && <div className="ml-auto shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
