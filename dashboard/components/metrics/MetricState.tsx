import type { MetricStatus } from "@/lib/types";

function PendingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 8v5" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// The three states every metrics widget can render: loading, no_data
// ("source exists, nothing in range"), and pending_upstream ("depends on
// data that doesn't exist in the contract yet"). An empty widget always
// says why, in one short line -- never a wrapping sentence, and never a
// raw field/index name (that detail lives in the header's data-sources
// indicator; callers here pass a plain-language tooltip instead).
export function MetricState({
  status,
  noDataMessage = "No data",
  pendingMessage = "Awaiting upstream data",
}: {
  status: MetricStatus | "loading";
  noDataMessage?: string;
  pendingMessage?: string;
}) {
  if (status === "loading") {
    return <p className="truncate text-sm text-zinc-400">Loading…</p>;
  }
  if (status === "no_data") {
    return <p className="truncate text-sm text-zinc-500">{noDataMessage}</p>;
  }
  if (status === "pending_upstream") {
    return (
      <span className="inline-flex items-center gap-1 truncate text-sm text-zinc-500" title={pendingMessage}>
        <PendingIcon />
        Pending
      </span>
    );
  }
  return null;
}
