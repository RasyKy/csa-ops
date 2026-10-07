"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useState } from "react";

import { Filters } from "@/components/Filters";
import { RefreshIndicator } from "@/components/RefreshIndicator";
import { SeverityBadge } from "@/components/SeverityBadge";
import { handleUnauthorized } from "@/lib/clientCache";
import type { Alert, Severity } from "@/lib/types";
import { useSwrState } from "@/lib/useSwrState";

const EMPTY_ALERTS: Alert[] = [];

// One row. Memoized: a refresh that returns the same alert hands it the same
// object, so the row does not render again.
const AlertRow = memo(function AlertRow({ alert }: { alert: Alert }) {
  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-900">
      <td className="py-2 pr-4">
        <SeverityBadge severity={alert.severity} />
      </td>
      <td className="py-2 pr-4">{alert.rule_title}</td>
      <td className="py-2 pr-4">{alert.technique}</td>
      <td className="py-2 pr-4">{alert.host}</td>
      <td className="py-2 pr-4">{alert.user}</td>
      <td className="py-2 pr-4">{alert.timestamp}</td>
    </tr>
  );
});

export function AlertsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [severity, setSeverity] = useState<Severity | "">((searchParams.get("severity") as Severity | null) ?? "");
  const [host, setHost] = useState(searchParams.get("host") ?? "");
  const [ruleId, setRuleId] = useState(searchParams.get("rule_id") ?? "");
  const [error, setError] = useState<string | null>(null);

  // The query string is part of the cache key, so each filter combination has its
  // own cached list and a revisit shows it at once.
  const query = new URLSearchParams();
  if (severity) query.set("severity", severity);
  if (host) query.set("host", host);
  if (ruleId) query.set("rule_id", ruleId);
  const queryString = query.toString();
  const {
    data: alerts,
    setData: setAlerts,
    fetchedAt,
    refreshing,
    setRefreshing,
  } = useSwrState<Alert[]>(`alerts:list:${queryString}`, EMPTY_ALERTS);

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
    setRefreshing(true);
    try {
      const res = await fetch(`/api/alerts?${queryString}`);
      // A 401 means the session is gone: forget the cache and go to sign-in.
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      setAlerts(await res.json());
      setError(null);
    } catch {
      setError("Could not reach the backend.");
    } finally {
      setRefreshing(false);
    }
  }, [queryString, setAlerts, setRefreshing]);

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
      <div className="mb-2 flex justify-end">
        <RefreshIndicator
          className="text-right"
          refreshing={refreshing}
          fetchedAt={fetchedAt}
          failed={error !== null}
        />
      </div>
      {/* With data on screen a failed refresh is only the quiet note above the table. */}
      {error && fetchedAt === null && <p className="mb-2 text-sm text-red-600">{error}</p>}
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
            <AlertRow key={alert.alert_id} alert={alert} />
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
