"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Filters } from "@/components/Filters";
import { SeverityBadge } from "@/components/SeverityBadge";
import type { Alert, Severity } from "@/lib/types";

export function AlertsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [severity, setSeverity] = useState<Severity | "">((searchParams.get("severity") as Severity | null) ?? "");
  const [host, setHost] = useState(searchParams.get("host") ?? "");
  const [ruleId, setRuleId] = useState(searchParams.get("rule_id") ?? "");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keeps the URL in sync with the filter state -- same reasoning as
  // IncidentsView: shareable links, working back button, and it's what
  // makes the Overview's top-hosts/top-rules drill-down links land
  // pre-filtered.
  useEffect(() => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (host) params.set("host", host);
    if (ruleId) params.set("rule_id", ruleId);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [severity, host, ruleId, pathname, router]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (host) params.set("host", host);
    if (ruleId) params.set("rule_id", ruleId);

    try {
      const res = await fetch(`/api/alerts?${params.toString()}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setAlerts(await res.json());
      setError(null);
    } catch {
      setError("Could not reach the backend.");
    }
  }, [severity, host, ruleId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <Filters severity={severity} host={host} onSeverityChange={setSeverity} onHostChange={setHost} />
      {ruleId && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            Rule: {ruleId}
            <button
              onClick={() => setRuleId("")}
              aria-label="Clear rule filter"
              className="ml-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ×
            </button>
          </span>
        </div>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <th className="py-2 pr-4">Severity</th>
            <th className="py-2 pr-4">Rule</th>
            <th className="py-2 pr-4">Technique</th>
            <th className="py-2 pr-4">Host</th>
            <th className="py-2 pr-4">User</th>
            <th className="py-2 pr-4">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.alert_id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2 pr-4">
                <SeverityBadge severity={alert.severity} />
              </td>
              <td className="py-2 pr-4">{alert.rule_title}</td>
              <td className="py-2 pr-4">{alert.technique}</td>
              <td className="py-2 pr-4">{alert.host}</td>
              <td className="py-2 pr-4">{alert.user}</td>
              <td className="py-2 pr-4">{alert.timestamp}</td>
            </tr>
          ))}
          {alerts.length === 0 && !error && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-zinc-500">
                No alerts.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
