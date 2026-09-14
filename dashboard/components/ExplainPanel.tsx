import type { IncidentTriage } from "@/lib/types";

export function ExplainPanel({ triage }: { triage: IncidentTriage | null }) {
  const explain = triage?.explain ?? null;

  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Explain</h3>
      {explain ? (
        <div className="space-y-2 text-sm">
          <p>{explain.summary}</p>
          <p className="text-slate-500">{explain.objective}</p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Not requested yet.</p>
      )}
    </div>
  );
}
