import type { MetricStatus } from "@/lib/types";

// The three states every metrics widget must render, per CLAUDE.md's
// metrics page spec: loading, no_data ("source exists, nothing in range"),
// and pending_upstream ("depends on Person A/C data that doesn't exist
// yet"). An empty widget must always say why it's empty, never just render
// nothing or a fake zero.
export function MetricState({
  status,
  noDataMessage = "No data in this range.",
  pendingMessage = "Awaiting upstream data (Person A/C).",
}: {
  status: MetricStatus | "loading";
  noDataMessage?: string;
  pendingMessage?: string;
}) {
  if (status === "loading") {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }
  if (status === "no_data") {
    return <p className="text-sm text-slate-500">{noDataMessage}</p>;
  }
  if (status === "pending_upstream") {
    return <p className="text-sm text-amber-600 dark:text-amber-400">{pendingMessage}</p>;
  }
  return null;
}
