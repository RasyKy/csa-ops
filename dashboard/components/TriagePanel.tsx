import { TriageBadge } from "@/components/TriageBadge";
import type { IncidentTriage } from "@/lib/types";

export function TriagePanel({ triage }: { triage: IncidentTriage | null }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">AI Triage</h3>
      {!triage && <p className="text-sm text-slate-500">No triage yet.</p>}
      {triage?.status === "failed" && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Triage failed (model unreachable or output invalid). Response actions were not affected.
        </p>
      )}
      {triage?.status === "ok" && (
        <dl className="space-y-1 text-sm">
          <Row label="Verdict" value={<TriageBadge verdict={triage.verdict} />} />
          <Row label="Confidence" value={triage.confidence ?? "—"} />
          <Row label="Reason" value={triage.reason ?? "—"} />
        </dl>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
