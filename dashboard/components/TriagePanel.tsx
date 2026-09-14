import type { IncidentTriage } from "@/lib/types";

export function TriagePanel({ triage }: { triage: IncidentTriage | null }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">AI Triage</h3>
      {triage ? (
        <dl className="space-y-1 text-sm">
          <Row label="Verdict" value={triage.verdict} />
          <Row label="Confidence" value={triage.confidence} />
          <Row label="Reason" value={triage.reason} />
        </dl>
      ) : (
        <p className="text-sm text-slate-500">No triage yet.</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
