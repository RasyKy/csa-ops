import { agreementDetailText, agreementText } from "@/lib/caseMetricsDisplay";
import type { MetricsCases, MetricsTriage } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// Compact by design -- headline numbers plus the top verdict, not the full
// distribution table (that stays reasonable to add back on /incidents if
// ever needed, but doesn't belong in a 3-across bottom row).
export function TriagePanel({ data, caseMetrics = null }: { data: MetricsTriage | null; caseMetrics?: MetricsCases | null }) {
  const agreement = caseMetrics?.ai_agreement?.value ?? null;
  const agreementDetail = agreement ? agreementDetailText(agreement) : null;

  const stats = data?.stats.status === "ok" ? data.stats.value : null;
  const topVerdict = stats
    ? Object.entries(stats.verdict_counts).sort(([, a], [, b]) => b - a)[0]
    : undefined;

  return (
    <div data-testid="overview-card" className="rounded-lg border border-line bg-surface p-3">
      <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-500">
        AI triage
        <InfoTooltip text="AI triage verdict and confidence distribution for incidents in this range." />
      </h3>
      {!data ? (
        <MetricState status="loading" />
      ) : !stats ? (
        <MetricState status={data.stats.status} noDataMessage="No triage yet" />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Confidence</span>
            <span>
              {(["low", "medium", "high"] as const).map((level) => `${level} ${stats.confidence_counts[level] ?? 0}`).join(" · ")}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Avg latency</span>
            <span>{stats.avg_latency_seconds !== null ? formatSeconds(stats.avg_latency_seconds) : "-"}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Failed runs</span>
            <span data-testid="triage-failed-runs">
              {stats.failed_count} of {stats.total_count}
            </span>
          </div>
          {topVerdict && (
            <div className="flex justify-between gap-2 truncate">
              <span className="text-zinc-500">Top verdict</span>
              <span className="truncate">
                {topVerdict[0].replace(/_/g, " ")} ({topVerdict[1]})
              </span>
            </div>
          )}
        </div>
      )}
      {agreement && (
        <div className="mt-1.5 text-sm" data-testid="analyst-agreement">
          <div className="flex flex-wrap justify-between gap-x-2">
            <span className="flex items-center gap-1 text-ink-muted">
              Analyst agreement
              <InfoTooltip text="How often the AI and the analyst chose the same side on resolved incidents. AI: true positive and likely true positive are malicious; false positive and likely false positive are benign; needs review is uncertain. Analyst: true positive is malicious; false positive and benign activity are benign. Undetermined verdicts are not scored." />
            </span>
            <span data-testid="analyst-agreement-text">{agreementText(agreement)}</span>
          </div>
          {agreementDetail && (
            <p className="mt-0.5 text-right text-xs text-ink-subtle" data-testid="analyst-agreement-detail">
              {agreementDetail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
