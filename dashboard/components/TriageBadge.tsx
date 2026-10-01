const VERDICT_COLORS: Record<string, string> = {
  true_positive: "bg-red-300 text-red-950 dark:bg-red-800 dark:text-red-50",
  likely_true_positive: "bg-orange-300 text-orange-950 dark:bg-orange-800 dark:text-orange-50",
  needs_review: "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  likely_false_positive: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  false_positive: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

// `prefix` (e.g. "AI:") disambiguates this from case status wherever both
// might appear in the same row -- opt-in so /incidents' table (which has
// no case-status column to confuse it with) is unaffected.
export function TriageBadge({
  verdict,
  status,
  prefix,
}: {
  verdict: string | null;
  status?: "ok" | "failed" | null;
  prefix?: string;
}) {
  const label = prefix && <span className="mr-1 text-xs text-zinc-500">{prefix}</span>;

  if (status === "failed") {
    return (
      <span className="inline-flex items-center">
        {label}
        <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
          failed
        </span>
      </span>
    );
  }

  if (!verdict) {
    return (
      <span className="inline-flex items-center">
        {label}
        <span className="text-xs text-zinc-500">pending</span>
      </span>
    );
  }

  const colors = VERDICT_COLORS[verdict] ?? "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
  return (
    <span className="inline-flex items-center">
      {label}
      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${colors}`}>
        {verdict.replace(/_/g, " ")}
      </span>
    </span>
  );
}
