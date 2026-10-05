import type { MetricsResponse } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

// Compact by design -- this sits in the bottom row next to two other
// panels. Automated response status (kill switch / mode) already shows in
// Needs Attention, so it isn't repeated here. Full per-action breakdowns
// are one click away on /incidents; here it's headline numbers only.
export function ResponsePanel({ data }: { data: MetricsResponse | null }) {
  const liveTotal = data?.live.value.total ?? 0;
  const liveSucceeded = data?.live.value.succeeded ?? 0;
  const dryRunTotal = data?.dry_run.value.total ?? 0;

  return (
    <div data-testid="overview-card" className="rounded-lg border border-line bg-surface p-3">
      <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-500">
        Response
        <InfoTooltip text="Automated and manual response actions taken on incidents in this range." />
      </h3>

      {!data ? (
        <MetricState status="loading" />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Live actions</span>
            <span data-testid="response-live-status">
              {liveTotal === 0 ? "None yet" : `${liveSucceeded} of ${liveTotal} succeeded`}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Practice mode</span>
            <span data-testid="response-practice-status">{dryRunTotal} logged, not executed</span>
          </div>
        </div>
      )}
    </div>
  );
}

