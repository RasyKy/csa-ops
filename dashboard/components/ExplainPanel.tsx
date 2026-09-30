"use client";

import { useState } from "react";

import type { IncidentTriage } from "@/lib/types";

function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="rounded border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {title}
        {count !== undefined && <span className="ml-1 text-zinc-500">({count})</span>}
      </summary>
      <div className="border-t border-zinc-200 p-3 text-sm dark:border-zinc-800">{children}</div>
    </details>
  );
}

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

  const requestExplain = async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/explain/${incidentId}${force ? "?force=true" : ""}`, { method: "POST" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setTriage(await res.json());
    } catch {
      setError("Could not generate explanation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">AI analysis</h3>
        {canExplain && !explain && (
          <button
            onClick={() => requestExplain(false)}
            disabled={loading}
            className="rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "Explaining…" : "Explain"}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {!canExplain && (
        <p className="text-sm text-zinc-500">
          {triage ? "Triage failed -- nothing to explain yet." : "No triage yet."}
        </p>
      )}

      {canExplain && !explain && !loading && <p className="text-sm text-zinc-500">Not requested yet.</p>}

      {explain && (
        <div className="space-y-2">
          {explain.ungrounded_mentions && explain.ungrounded_mentions.length > 0 && (
            <p
              className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
              title={`Not found in the incident data this was generated from: ${explain.ungrounded_mentions.join(", ")}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 8v5" />
                <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none" />
              </svg>
              Mentions items not found in incident data
            </p>
          )}
          {explain.is_stale && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <span>Generated with an older version of this explanation. Regenerate for up-to-date advice.</span>
              <button
                onClick={() => requestExplain(true)}
                disabled={loading}
                className="shrink-0 rounded bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-600"
              >
                {loading ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          )}

          <Section title="Summary" defaultOpen>
            <p>{explain.summary}</p>
          </Section>
          <Section title="Likely objective" defaultOpen>
            <p>{explain.objective}</p>
          </Section>
          {explain.notable_details.length > 0 && (
            <Section title="Notable details" count={explain.notable_details.length} defaultOpen={false}>
              <List items={explain.notable_details} />
            </Section>
          )}
          {explain.next_steps.length > 0 && (
            <Section title="Next steps" count={explain.next_steps.length} defaultOpen={false}>
              <List items={explain.next_steps} />
            </Section>
          )}
          {explain.caveats.length > 0 && (
            <Section title="Caveats" count={explain.caveats.length} defaultOpen={false}>
              <List items={explain.caveats} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="ml-4 list-disc space-y-0.5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
