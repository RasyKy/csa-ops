import { UserCheck } from "lucide-react";

import { TRIAGE_BADGE_STYLES } from "@/components/TriageBadge";
import { Tooltip } from "@/components/ui/Tooltip";
import { sideOfAnalyst, verdictRelation } from "@/lib/caseJoin";
import { verdictLabel } from "@/lib/caseDisplay";

// The AI's verdict as the triage pill words it ("Likely false positive").
export function aiVerdictLabel(verdict: string): string {
  const known = (TRIAGE_BADGE_STYLES.verdicts as Record<string, { label: string }>)[verdict];
  if (known) return known.label;
  const formatted = verdict.replace(/_/g, " ");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// The analyst's verdict, in the same pill shape as the AI's but tagged "Analyst".
// Red only for malicious (a true positive); every other verdict is quiet grey.
//
// Pass `aiVerdict` (null when there is none) to word the pill's tooltip, title and
// aria-label by how it relates to the AI's call. Left out, the pill is exactly the
// plain one (the Case card uses it that way).
export function AnalystVerdict({
  verdict,
  variant,
  labelTestId,
  className = "",
  aiVerdict,
}: {
  verdict: string | null | undefined;
  variant: "pill" | "line";
  labelTestId?: string;
  className?: string;
  aiVerdict?: string | null;
}) {
  if (!verdict) return null;
  const label = verdictLabel(verdict);
  const iconColor = sideOfAnalyst(verdict) === "malicious" ? "text-red-500 dark:text-red-400" : "text-ink-subtle";

  if (variant === "line") {
    return (
      <span
        title="Analyst verdict"
        data-testid="analyst-verdict-line"
        data-analyst-verdict={verdict}
        className={`inline-flex min-w-0 items-center gap-1 text-xs text-ink-muted ${className}`.trim()}
      >
        <UserCheck className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} aria-hidden="true" />
        <span className="sr-only">Analyst verdict: </span>
        <span className="truncate" data-testid={labelTestId}>
          {label}
        </span>
      </span>
    );
  }

  const pillBody = (
    <>
      <span className="text-[11px] font-medium text-ink-subtle" aria-hidden="true">
        Analyst
      </span>
      <span className="h-3 border-l border-line-strong" aria-hidden="true" />
      <UserCheck className={`${TRIAGE_BADGE_STYLES.iconSize} ${iconColor}`} aria-hidden="true" />
      <span className="sr-only">Analyst verdict: </span>
      <span data-testid={labelTestId}>{label}</span>
    </>
  );

  if (aiVerdict === undefined) {
    return (
      <span
        title="Analyst verdict"
        data-testid="analyst-verdict-pill"
        data-analyst-verdict={verdict}
        className={`${TRIAGE_BADGE_STYLES.container} ${className}`.trim()}
      >
        {pillBody}
      </span>
    );
  }

  const relation = verdictRelation(aiVerdict, verdict);
  let tooltipText = "Analyst verdict.";
  if (relation === "agree") {
    tooltipText = "Analyst verdict. The AI reached the same conclusion.";
  } else if (relation !== "no_ai" && aiVerdict) {
    tooltipText = `Analyst verdict. The AI said ${aiVerdictLabel(aiVerdict).toLowerCase()}.`;
  }
  // "Analyst verdict. ..." becomes "Analyst verdict: <label>. ..." for the accessible name
  const accessibleName = `Analyst verdict: ${label}${tooltipText.slice("Analyst verdict".length)}`;

  return (
    <span className={`${TRIAGE_BADGE_STYLES.wrapper} ${className}`.trim()}>
      <Tooltip side="bottom" content={<span className="block max-w-[240px] whitespace-normal">{tooltipText}</span>}>
        <span
          title={accessibleName}
          aria-label={accessibleName}
          data-testid="analyst-verdict-pill"
          data-analyst-verdict={verdict}
          data-ai-relation={relation}
          className={TRIAGE_BADGE_STYLES.container}
        >
          {pillBody}
        </span>
      </Tooltip>
    </span>
  );
}
