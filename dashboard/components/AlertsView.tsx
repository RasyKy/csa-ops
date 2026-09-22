"use client";

import { useCallback, useEffect, useState } from "react";

import { Filters } from "@/components/Filters";
import { SeverityBadge } from "@/components/SeverityBadge";
import type { Alert, Severity } from "@/lib/types";

export function AlertsView() {
  const [severity, setSeverity] = useState<Severity | "">("");
  const [host, setHost] = useState("");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (host) params.set("host", host);

    try {
      const res = await fetch(`/api/alerts?${params.toString()}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setAlerts(await res.json());
      setError(null);
    } catch {
      setError("Could not reach the backend.");
    }
  }, [severity, host]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <Filters severity={severity} host={host} onSeverityChange={setSeverity} onHostChange={setHost} />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
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
            <tr key={alert.alert_id} className="border-b border-slate-100 dark:border-slate-900">
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
              <td colSpan={6} className="py-4 text-center text-slate-500">
                No alerts.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
