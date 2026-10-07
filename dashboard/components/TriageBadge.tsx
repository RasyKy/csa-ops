import React from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ShieldAlert,
  ShieldCheck,
  CircleHelp,
  Clock,
  TriangleAlert,
} from "lucide-react";

export const TRIAGE_BADGE_STYLES = {
  container:
    "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-line-strong bg-surface text-xs font-medium text-ink select-none",
  wrapper: "inline-flex items-center",
  prefix: "mr-1 text-xs text-ink-subtle",
  iconSize: "h-3.5 w-3.5 shrink-0",
  verdicts: {
    true_positive: {
      label: "True positive",
      icon: ShieldAlert,
      iconColor: "text-red-500 dark:text-red-400",
    },
    likely_true_positive: {
      label: "Likely true positive",
      icon: ShieldAlert,
      iconColor: "text-orange-600 dark:text-orange-500",
    },
    needs_review: {
      label: "Needs review",
      icon: CircleHelp,
      iconColor: "text-amber-600 dark:text-amber-500",
    },
    likely_false_positive: {
      label: "Likely false positive",
      icon: ShieldCheck,
      iconColor: "text-zinc-500 dark:text-zinc-400",
    },
    false_positive: {
      label: "False positive",
      icon: ShieldCheck,
      iconColor: "text-zinc-500 dark:text-zinc-400",
    },
    pending: {
      label: "Pending",
      icon: Clock,
      iconColor: "text-zinc-500 dark:text-zinc-400",
    },
    failed: {
      label: "Failed",
      icon: TriangleAlert,
      iconColor: "text-red-500 dark:text-red-400",
    },
  },
};

export interface TriageBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  verdict: string | null;
  status?: "ok" | "failed" | null;
  prefix?: string;
  className?: string;
  "data-testid"?: string;
  // Opt-in: an "AI" tag inside the pill, "AI verdict: <label>" as its title and
  // aria-label, and a tooltip. Off, the output is exactly what it always was.
  showSourceTag?: boolean;
  confidence?: string | null;
  tooltipAlign?: "center" | "end";
}

// `prefix` (e.g. "AI:") disambiguates this from case status wherever both
// might appear in the same row -- opt-in so /incidents' table (which has
// no case-status column to confuse it with) is unaffected.
export function TriageBadge({
  verdict,
  status,
  prefix,
  className = "",
  "data-testid": testId,
  showSourceTag = false,
  confidence = null,
  tooltipAlign = "center",
  ...props
}: TriageBadgeProps) {
  let entry = TRIAGE_BADGE_STYLES.verdicts.pending;

  if (status === "failed") {
    entry = TRIAGE_BADGE_STYLES.verdicts.failed;
  } else if (verdict && verdict in TRIAGE_BADGE_STYLES.verdicts) {
    entry = TRIAGE_BADGE_STYLES.verdicts[verdict as keyof typeof TRIAGE_BADGE_STYLES.verdicts];
  } else if (verdict) {
    const formatted = verdict.replace(/_/g, " ");
    const sentenceCase = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    entry = {
      label: sentenceCase,
      icon: CircleHelp,
      iconColor: "text-zinc-500 dark:text-zinc-400",
    };
  }

  const Icon = entry.icon;

  if (showSourceTag) {
    const tooltipText = `AI verdict${confidence ? `, ${confidence} confidence` : ""}. Advisory only: it never changes detections or response actions.`;
    return (
      <span className={`${TRIAGE_BADGE_STYLES.wrapper} ${className}`.trim()}>
        {prefix && <span className={TRIAGE_BADGE_STYLES.prefix}>{prefix}</span>}
        <Tooltip
          side="bottom"
          align={tooltipAlign}
          content={<span className="block max-w-[240px] whitespace-normal">{tooltipText}</span>}
        >
          <span
            data-testid={testId}
            data-source-tag="ai"
            title={`AI verdict: ${entry.label}`}
            aria-label={`AI verdict: ${entry.label}`}
            className={TRIAGE_BADGE_STYLES.container}
            {...props}
          >
            <span className="text-[11px] font-medium text-ink-subtle" aria-hidden="true">
              AI
            </span>
            <span className="h-3 border-l border-line-strong" aria-hidden="true" />
            <Icon className={`${TRIAGE_BADGE_STYLES.iconSize} ${entry.iconColor}`} aria-hidden="true" />
            <span>{entry.label}</span>
          </span>
        </Tooltip>
      </span>
    );
  }

  return (
    <span className={`${TRIAGE_BADGE_STYLES.wrapper} ${className}`.trim()}>
      {prefix && <span className={TRIAGE_BADGE_STYLES.prefix}>{prefix}</span>}
      <span
        data-testid={testId}
        className={TRIAGE_BADGE_STYLES.container}
        {...props}
      >
        <Icon className={`${TRIAGE_BADGE_STYLES.iconSize} ${entry.iconColor}`} aria-hidden="true" />
        <span>{entry.label}</span>
      </span>
    </span>
  );
}
