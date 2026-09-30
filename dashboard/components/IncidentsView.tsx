"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Filters } from "@/components/Filters";
import { SeverityBadge } from "@/components/SeverityBadge";
import { TriageBadge } from "@/components/TriageBadge";
import { isOpenIncident } from "@/lib/incidents";
import { describeResponseAction } from "@/lib/responseWording";
import type { IncidentListItem, Severity } from "@/lib/types";

const POLL_INTERVAL_MS = 3000;

export function IncidentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [severity, setSeverity] = useState<Severity | "">((searchParams.get("severity") as Severity | null) ?? "");
  const [host, setHost] = useState(searchParams.get("host") ?? "");
  const [status, setStatus] = useState<"" | "open">(searchParams.get("status") === "open" ? "open" : "");
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keeps the URL in sync with the filter state so drill-down links from
  // the Overview land pre-filtered, links are shareable, and the back
  // button works -- severity/host/status all read from and write to the
  // URL the same way.
  useEffect(() => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (host) params.set("host", host);
    if (status) params.set("status", status);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [severity, host, status, pathname, router]);

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

  // status=open has no dropdown in Filters (it's a drill-down-only filter,
  // same "open" definition the Overview's Open incidents card uses) -- so
  // it needs its own visibility and a way to clear it.
  const visibleIncidents = status === "open" ? incidents.filter(isOpenIncident) : incidents;

  return (
    <>
      <Filters severity={severity} host={host} onSeverityChange={setSeverity} onHostChange={setHost} />
      {status === "open" && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            Status: open
            <button
              onClick={() => setStatus("")}
              aria-label="Clear status filter"
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
          {visibleIncidents.map((incident) => (
            <tr key={incident.incident_id} className="border-b border-zinc-100 dark:border-zinc-900">
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
              <td className="py-2 pr-4 truncate">
                {incident.last_response_action ? describeResponseAction(incident.last_response_action) : "None yet"}
              </td>
              <td className="py-2 pr-4">
                <Link className="text-blue-600 hover:underline" href={`/incidents/${incident.incident_id}`}>
                  View
                </Link>
              </td>
            </tr>
          ))}
          {visibleIncidents.length === 0 && !error && (
            <tr>
              <td colSpan={8} className="py-4 text-center text-zinc-500">
                No incidents.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
