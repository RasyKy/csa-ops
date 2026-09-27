import type { MetricsSummary } from "@/lib/types";
import { MetricState } from "./MetricState";

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      {children}
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// 4 cards, not 7: critical-incident count and response-action counts moved
// into NeedsAttention/ResponsePanel where they read more like status than
// a headline stat, and MTTD/MTTR no longer duplicate a full panel below --
// this row is the only place they appear now.
export function KpiCards({ summary }: { summary: MetricsSummary | null }) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} label="—">
            <MetricState status="loading" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card label="Alerts">
        {summary.total_alerts.status === "ok" ? (
          <>
            <p className="text-2xl font-semibold">{summary.total_alerts.value}</p>
            {summary.alert_to_incident_ratio.status === "ok" && summary.alert_to_incident_ratio.value !== null && (
              <p className="text-xs text-zinc-500">{summary.alert_to_incident_ratio.value.toFixed(1)}:1 to incidents</p>
            )}
          </>
        ) : (
          <MetricState status={summary.total_alerts.status} />
        )}
      </Card>
      <Card label="Incidents">
        {summary.total_incidents.status === "ok" ? (
          <p className="text-2xl font-semibold">{summary.total_incidents.value}</p>
        ) : (
          <MetricState status={summary.total_incidents.status} />
        )}
      </Card>
      <Card label="MTTD">
        {summary.mttd.status === "ok" && summary.mttd.value ? (
          <p className="text-2xl font-semibold">{formatSeconds(summary.mttd.value.mean)}</p>
        ) : (
          <MetricState status={summary.mttd.status} pendingMessage="Waiting on detection-timing data from ingestion" />
        )}
      </Card>
      <Card label="MTTR">
        {summary.mttr.status === "ok" && summary.mttr.value ? (
          <p className="text-2xl font-semibold">{formatSeconds(summary.mttr.value.mean)}</p>
        ) : (
          <MetricState status={summary.mttr.status} noDataMessage="No responses yet" />
        )}
      </Card>
    </div>
  );
}
