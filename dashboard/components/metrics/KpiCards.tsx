import type { MetricsSummary } from "@/lib/types";
import { MetricState } from "./MetricState";

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {children}
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function KpiCards({ summary }: { summary: MetricsSummary | null }) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i} label="—">
            <MetricState status="loading" />
          </Card>
        ))}
      </div>
    );
  }

  const modeCounts = summary.response_actions_by_mode.value;
  const dryRun = modeCounts.dry_run ?? 0;
  const live = modeCounts.live ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
      <Card label="Total alerts">
        {summary.total_alerts.status === "ok" ? (
          <p className="text-2xl font-semibold">{summary.total_alerts.value}</p>
        ) : (
          <MetricState status={summary.total_alerts.status} />
        )}
      </Card>
      <Card label="Total incidents">
        {summary.total_incidents.status === "ok" ? (
          <p className="text-2xl font-semibold">{summary.total_incidents.value}</p>
        ) : (
          <MetricState status={summary.total_incidents.status} />
        )}
      </Card>
      <Card label="Critical incidents">
        {summary.critical_incidents.status === "ok" ? (
          <p className="text-2xl font-semibold">{summary.critical_incidents.value}</p>
        ) : (
          <MetricState status={summary.critical_incidents.status} />
        )}
      </Card>
      <Card label="MTTD">
        <MetricState status={summary.mttd.status} pendingMessage="No attack_action_time source yet" />
      </Card>
      <Card label="MTTR (mean)">
        {summary.mttr.status === "ok" && summary.mttr.value ? (
          <p className="text-2xl font-semibold">{formatSeconds(summary.mttr.value.mean)}</p>
        ) : (
          <MetricState status={summary.mttr.status} />
        )}
      </Card>
      <Card label="Alerts : incidents">
        {summary.alert_to_incident_ratio.status === "ok" && summary.alert_to_incident_ratio.value !== null ? (
          <p className="text-2xl font-semibold">{summary.alert_to_incident_ratio.value.toFixed(1)}</p>
        ) : (
          <MetricState status={summary.alert_to_incident_ratio.status} />
        )}
      </Card>
      <Card label="Response actions">
        {summary.response_actions_by_mode.status === "ok" ? (
          <p className="text-sm">
            <span className="text-2xl font-semibold">{dryRun + live}</span>
            <span className="ml-1 text-slate-500">
              ({dryRun} dry-run, {live} live)
            </span>
          </p>
        ) : (
          <MetricState status={summary.response_actions_by_mode.status} />
        )}
      </Card>
    </div>
  );
}
