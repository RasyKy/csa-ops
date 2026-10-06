import type { MetricsCases, MetricsTop } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

const TOP_N = 3;
const VERDICT_ROWS = 5;

function getReadableRuleName(ruleId: string, top: MetricsTop | null): string {
  if (top?.top_rules.status === "ok") {
    const found = top.top_rules.value.find((r) => r.key === ruleId);
    if (found?.title) return found.title;
  }
  let cleaned = ruleId.replace(/^[tT]\d+(?:\.\d+)?_/, "").replace(/_/g, " ").trim();
  if (cleaned) cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return cleaned || ruleId;
}

export function DetectionQualityPanel({ top, caseMetrics = null }: { top: MetricsTop | null; caseMetrics?: MetricsCases | null }) {
  const entries = top?.fp_rate_by_rule.status === "ok" ? Object.entries(top.fp_rate_by_rule.value) : [];
  const topEntries = entries
    .sort(([, a], [, b]) => {
      if (b.total !== a.total) return b.total - a.total;
      return b.rate - a.rate;
    })
    .slice(0, TOP_N);

  // Analyst verdicts from resolved cases, per rule. Shown only when there is at
  // least one; the fixture-label rows above are not touched by it.
  const verdictEntries = (caseMetrics?.verdicts_by_rule?.status === "ok" ? Object.entries(caseMetrics.verdicts_by_rule.value) : [])
    .sort(([ruleA, a], [ruleB, b]) => b.total - a.total || ruleA.localeCompare(ruleB))
    .slice(0, VERDICT_ROWS);

  return (
    <div data-testid="overview-card" className="rounded-lg border border-line bg-surface p-3">
      <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-500">
        Detection quality (FP rate)
        <InfoTooltip text="Rules with the highest false-positive rate in this range." />
      </h3>
      {!top ? (
        <MetricState status="loading" />
      ) : top.fp_rate_by_rule.status !== "ok" || topEntries.length === 0 ? (
        <div className="flex items-center gap-1 text-sm text-zinc-500">
          <span>No analyst-labeled alerts yet</span>
          <InfoTooltip text="False-positive rates come from alerts an analyst has labeled as true positive or false positive." />
        </div>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {topEntries.map(([rule, stats]) => {
            const readableName = getReadableRuleName(rule, top);
            return (
              <li key={rule} data-testid="detection-quality-row" data-rule={rule} className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200" title={rule}>
                  {readableName}
                </span>
                <div className="flex shrink-0 items-baseline gap-1.5">
                  <span
                    className={
                      stats.rate >= 0.5
                        ? "text-red-600 dark:text-red-400 font-semibold"
                        : stats.rate > 0
                          ? "text-amber-600 dark:text-amber-400 font-semibold"
                          : "text-zinc-500 font-semibold"
                    }
                  >
                    {(stats.rate * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-zinc-400">
                    {stats.fp_count} of {stats.total} alerts
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {verdictEntries.length > 0 && (
        <div className="mt-3" data-testid="analyst-verdicts">
          <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-ink-muted">
            Analyst verdicts
            <InfoTooltip text="From resolved cases. Each alert of a resolved incident counts once under its rule with the analyst's verdict." />
          </p>
          <ul className="space-y-1.5 text-sm">
            {verdictEntries.map(([rule, counts]) => (
              <li key={rule} data-testid="analyst-verdict-row" data-rule={rule} className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-ink" title={rule}>
                  {getReadableRuleName(rule, top)}
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5 text-xs">
                  <span className="text-ink">
                    {counts.false_positive} of {counts.total} false positive
                  </span>
                  {counts.benign_activity > 0 && <span className="text-ink-subtle">{counts.benign_activity} benign</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

