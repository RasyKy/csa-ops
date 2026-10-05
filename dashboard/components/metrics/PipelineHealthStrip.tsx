import type { MetricsPipeline } from "@/lib/types";
import { formatDateTime, formatRelative, tzLabel } from "@/lib/time";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

const LABELS: Record<string, string> = {
  "logs-normalized": "Ingestion (logs-normalized)",
  alerts: "Alerts",
  incidents: "Incidents",
  incident_triage: "AI triage",
  response_actions: "Response actions",
};

function getIngestionDotClass(latestTimestamp: string | null): string {
  if (!latestTimestamp) return "bg-red-500";
  const diffMs = Date.now() - new Date(latestTimestamp).getTime();
  const diffMinutes = diffMs / (60 * 1000);
  if (diffMinutes < 5) return "bg-emerald-500";
  if (diffMinutes < 60) return "bg-amber-500";
  return "bg-red-500";
}

export function PipelineHealthStrip({ data }: { data: MetricsPipeline | null }) {
  return (
    <div data-testid="overview-card" className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-zinc-500">
          Pipeline health
          <InfoTooltip text="Time since the most recent document landed in each data source." />
        </h3>
        <span className="text-xs text-zinc-400">All-time totals</span>
      </div>
      {!data ? (
        <MetricState status="loading" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {Object.entries(data.sources).map(([source, health]) => {
            const isIngestion = source === "logs-normalized";
            const exactTime = health.value?.latest_timestamp
              ? `${formatDateTime(health.value.latest_timestamp)} ${tzLabel()}`
              : undefined;

            return (
              <div key={source} title={exactTime} data-testid={`pipeline-source-${source}`}>
                <p className="mb-1 truncate text-xs text-zinc-500">
                  {LABELS[source] ?? source}
                </p>
                {isIngestion && health.status === "pending_upstream" ? (
                  <div
                    className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500"
                    title="The ingestion log store isn't connected in this environment."
                  >
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-zinc-400 dark:border-zinc-500" data-testid="ingestion-hollow-dot" />
                    <span>Not connected</span>
                    <InfoTooltip text="The ingestion log store isn't connected in this environment." />
                  </div>
                ) : health.status === "ok" && health.value ? (
                  <>
                    <p className="text-lg font-semibold">{health.value.count}</p>
                    {isIngestion ? (
                      <p className="flex items-center gap-1.5 text-xs text-zinc-500" title={exactTime}>
                        <span
                          data-testid="ingestion-dot"
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${getIngestionDotClass(health.value.latest_timestamp)}`}
                        />
                        <span>
                          {health.value.latest_timestamp
                            ? `Last event ${formatRelative(health.value.latest_timestamp)}`
                            : "No events"}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-500" title={exactTime}>
                        {health.value.latest_timestamp ? formatRelative(health.value.latest_timestamp) : "-"}
                      </p>
                    )}
                  </>
                ) : (
                  <MetricState
                    status={health.status}
                    noDataMessage="No documents yet"
                    pendingMessage="Not connected in this environment"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

