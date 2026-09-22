import type { MetricsPipeline } from "@/lib/types";
import { MetricState } from "./MetricState";

const LABELS: Record<string, string> = {
  "logs-normalized": "Ingestion (logs-normalized)",
  alerts: "Alerts",
  incidents: "Incidents",
  incident_triage: "AI triage",
  response_actions: "Response actions",
};

function formatAge(latestTimestamp: string): string {
  const ageMs = Date.now() - new Date(latestTimestamp).getTime();
  const ageSeconds = ageMs / 1000;
  if (ageSeconds < 60) return "just now";
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

export function PipelineHealthStrip({ data }: { data: MetricsPipeline | null }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Pipeline health</h3>
      {!data ? (
        <MetricState status="loading" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {Object.entries(data.sources).map(([source, health]) => (
            <div key={source}>
              <p className="mb-1 truncate text-xs text-slate-500" title={LABELS[source] ?? source}>
                {LABELS[source] ?? source}
              </p>
              {health.status === "ok" && health.value ? (
                <>
                  <p className="text-lg font-semibold">{health.value.count}</p>
                  <p className="text-xs text-slate-500">
                    {health.value.latest_timestamp ? formatAge(health.value.latest_timestamp) : "—"}
                  </p>
                </>
              ) : (
                <MetricState
                  status={health.status}
                  noDataMessage="No documents yet"
                  pendingMessage="Not owned/reachable"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
