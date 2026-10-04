import Link from "next/link";

import type { MetricsSummary } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

function Card({
  label,
  tooltip,
  href,
  children,
}: {
  label: string;
  tooltip?: string;
  href?: string;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-zinc-500">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      {children}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        data-testid="overview-card"
        className="block rounded-lg border border-line bg-surface p-4 hover:bg-surface-subtle"
      >
        {body}
      </Link>
    );
  }
  return (
    <div data-testid="overview-card" className="rounded-lg border border-line bg-surface p-4">
      {body}
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
//
// Layout stays identical across every range, per the "like Wazuh/Kibana/
// Grafana" brief: a count of 0 is a real value and is shown as 0, not
// swapped for a "no data" message -- only averages (MTTD/MTTR) have
// nothing meaningful to show when their input set is empty, so those get
// "-" (or, for MTTR, a more specific dry-run-aware message).
export function KpiCards({ summary }: { summary: MetricsSummary | null }) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} label="-">
            <MetricState status="loading" />
          </Card>
        ))}
      </div>
    );
  }

  const dryRunCount = summary.response_actions_by_mode.value.dry_run ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card label="Alerts" tooltip="Number of alerts raised by detection rules in this range." href="/alerts">
        <p className="text-2xl font-semibold">{summary.total_alerts.value}</p>
        {summary.alert_to_incident_ratio.status === "ok" && summary.alert_to_incident_ratio.value !== null && (
          <p className="text-xs text-zinc-500">{summary.alert_to_incident_ratio.value.toFixed(1)}:1 to incidents</p>
        )}
      </Card>
      <Card
        label="Total incidents"
        tooltip="Number of correlated incidents raised in this range."
        href="/incidents"
      >
        <p className="text-2xl font-semibold">{summary.total_incidents.value}</p>
      </Card>
      <Card label="MTTD" tooltip="Average time from attack to detection." href="/incidents">
        {summary.mttd.status === "ok" && summary.mttd.value ? (
          <p className="text-2xl font-semibold">{formatSeconds(summary.mttd.value.mean)}</p>
        ) : summary.mttd.status === "pending_upstream" ? (
          <MetricState status="pending_upstream" pendingMessage="Waiting on detection-timing data from ingestion" />
        ) : (
          <p className="text-2xl font-semibold text-zinc-400">-</p>
        )}
      </Card>
      <Card
        label="MTTR"
        tooltip="Average time from detection to a completed response action."
        href="/incidents"
      >
        {summary.mttr.status === "ok" && summary.mttr.value ? (
          <p className="text-2xl font-semibold">{formatSeconds(summary.mttr.value.mean)}</p>
        ) : (
          <p className="truncate text-sm text-zinc-500">
            No live responses yet{dryRunCount > 0 ? ` (${dryRunCount} in practice mode)` : ""}
          </p>
        )}
      </Card>
    </div>
  );
}
