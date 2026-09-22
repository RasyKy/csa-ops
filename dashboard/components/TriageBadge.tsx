const VERDICT_COLORS: Record<string, string> = {
  true_positive: "bg-red-300 text-red-950 dark:bg-red-800 dark:text-red-50",
  likely_true_positive: "bg-orange-300 text-orange-950 dark:bg-orange-800 dark:text-orange-50",
  needs_review: "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  likely_false_positive: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  false_positive: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

export function TriageBadge({
  verdict,
  status,
}: {
  verdict: string | null;
  status?: "ok" | "failed" | null;
}) {
  if (status === "failed") {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
        failed
      </span>
    );
  }

  if (!verdict) {
    return <span className="text-xs text-slate-500">pending</span>;
  }

  const colors = VERDICT_COLORS[verdict] ?? "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${colors}`}>
      {verdict.replace(/_/g, " ")}
    </span>
  );
}
