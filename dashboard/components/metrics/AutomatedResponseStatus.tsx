import type { MetricsResponse } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

type ResponseState = "stopped" | "practice" | "live";

const STATE_COPY: Record<ResponseState, { label: string; subtext: string; dot: string; text: string }> = {
  stopped: {
    label: "Stopped",
    subtext: "No automatic actions are taken",
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
  },
  practice: {
    label: "Practice mode",
    subtext: "Actions are logged, not executed",
    dot: "bg-zinc-400",
    text: "text-zinc-600 dark:text-zinc-300",
  },
  live: {
    label: "Live",
    subtext: "Actions are executed on endpoints",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
};

// Kill switch always wins over response mode -- it's the authoritative
// stop (CLAUDE.md rule 3), so "stopped" is checked first regardless of
// what response_mode says.
function resolveState(response: MetricsResponse): ResponseState {
  if (response.kill_switch) return "stopped";
  return response.response_mode === "live" ? "live" : "practice";
}

// The single most important safety fact on the page, replacing the old
// separate kill-switch/response-mode lines with one status: whether
// automated response can take any action right now. Read-only -- toggling
// the kill switch is a separate, deliberate action elsewhere, not
// something this card exposes.
export function AutomatedResponseStatus({ response }: { response: MetricsResponse | null }) {
  if (!response) {
    return (
      <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <MetricState status="loading" />
      </div>
    );
  }

  const copy = STATE_COPY[resolveState(response)];

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Automated response
        <InfoTooltip text="Kill switch: an emergency stop -- when on, no automatic action is issued and the agent refuses any command that arrives. Practice mode (dry-run): the default safe mode, where a decided action is logged but never executed on an endpoint." />
      </div>
      <p className={`flex items-center gap-1.5 text-2xl font-semibold ${copy.text}`}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${copy.dot}`} />
        {copy.label}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{copy.subtext}</p>
    </div>
  );
}
