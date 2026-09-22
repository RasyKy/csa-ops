"use client";

import { useState } from "react";

import type { IncidentTriage } from "@/lib/types";

export function ExplainPanel({
  incidentId,
  triage: initialTriage,
}: {
  incidentId: string;
  triage: IncidentTriage | null;
}) {
  const [triage, setTriage] = useState(initialTriage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canExplain = triage !== null && triage.status === "ok";
  const explain = triage?.explain ?? null;

  const handleExplain = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/explain/${incidentId}`, { method: "POST" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setTriage(await res.json());
    } catch {
      setError("Could not generate explanation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Explain</h3>
        {canExplain && (
          <button
            onClick={handleExplain}
            disabled={loading}
            className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {loading ? "Explaining…" : "Explain"}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {!canExplain && (
        <p className="text-sm text-slate-500">
          {triage ? "Triage failed -- nothing to explain yet." : "No triage yet."}
        </p>
      )}

      {canExplain && !explain && !loading && <p className="text-sm text-slate-500">Not requested yet.</p>}

      {explain && (
        <div className="space-y-2 text-sm">
          <p>{explain.summary}</p>
          <p className="text-slate-500">{explain.objective}</p>
          {explain.notable_details.length > 0 && <List title="Notable details" items={explain.notable_details} />}
          {explain.next_steps.length > 0 && <List title="Next steps" items={explain.next_steps} />}
          {explain.caveats.length > 0 && <List title="Caveats" items={explain.caveats} />}
        </div>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-medium text-slate-700 dark:text-slate-300">{title}</p>
      <ul className="ml-4 list-disc space-y-0.5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
