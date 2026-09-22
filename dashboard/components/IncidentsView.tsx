"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Filters } from "@/components/Filters";
import { SeverityBadge } from "@/components/SeverityBadge";
import { TriageBadge } from "@/components/TriageBadge";
import type { IncidentListItem, Severity } from "@/lib/types";

const POLL_INTERVAL_MS = 3000;

export function IncidentsView() {
  const [severity, setSeverity] = useState<Severity | "">("");
  const [host, setHost] = useState("");
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (host) params.set("host", host);

    try {
      const res = await fetch(`/api/incidents?${params.toString()}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setIncidents(await res.json());
      setError(null);
    } catch {
      setError("Could not reach the backend.");
    }
  }, [severity, host]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <>
      <Filters severity={severity} host={host} onSeverityChange={setSeverity} onHostChange={setHost} />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
            <th className="py-2 pr-4">Severity</th>
            <th className="py-2 pr-4">Host</th>
            <th className="py-2 pr-4">User</th>
            <th className="py-2 pr-4">Scenario</th>
            <th className="py-2 pr-4">Raised</th>
            <th className="py-2 pr-4">Triage</th>
            <th className="py-2 pr-4">Last action</th>
            <th className="py-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.incident_id} className="border-b border-slate-100 dark:border-slate-900">
              <td className="py-2 pr-4">
                <SeverityBadge severity={incident.severity} />
              </td>
              <td className="py-2 pr-4">{incident.host}</td>
              <td className="py-2 pr-4">{incident.user}</td>
              <td className="py-2 pr-4">{incident.matched_scenario ?? "—"}</td>
              <td className="py-2 pr-4">{incident.incident_raised_time}</td>
              <td className="py-2 pr-4">
                <TriageBadge verdict={incident.triage_verdict} status={incident.triage_status} />
              </td>
              <td className="py-2 pr-4">{incident.last_response_action?.action ?? "none"}</td>
              <td className="py-2 pr-4">
                <Link className="text-blue-600 hover:underline" href={`/incidents/${incident.incident_id}`}>
                  View
                </Link>
              </td>
            </tr>
          ))}
          {incidents.length === 0 && !error && (
            <tr>
              <td colSpan={8} className="py-4 text-center text-slate-500">
                No incidents.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
