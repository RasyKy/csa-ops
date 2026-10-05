"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Filters } from "@/components/Filters";
import { SeverityBadge } from "@/components/SeverityBadge";
import { TriageBadge } from "@/components/TriageBadge";
import { humanizeScenario } from "@/lib/incidentDisplay";
import { deriveIncidentStatus, isOpenIncident } from "@/lib/incidents";
import { nextDelay } from "@/lib/pollBackoff";
import { describeResponseAction } from "@/lib/responseWording";
import type { IncidentListItem, Severity } from "@/lib/types";

const POLL_BASE_MS = 3000;
const POLL_MAX_MS = 30000;

type SortColumn =
  | "severity"
  | "host"
  | "user"
  | "scenario"
  | "alerts"
  | "raised"
  | "triage"
  | "last_action";
type SortDirection = "asc" | "desc";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function IncidentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [severity, setSeverity] = useState<Severity | "">(
    (searchParams.get("severity") as Severity | null) ?? ""
  );
  // Support both 'search' and legacy 'host' query parameter for search box
  const [search, setSearch] = useState(
    searchParams.get("search") ?? searchParams.get("host") ?? ""
  );
  const [technique, setTechnique] = useState(searchParams.get("technique") ?? "");
  const [status, setStatus] = useState<"" | "open">(
    searchParams.get("status") === "open" ? "open" : ""
  );
  const [sortColumn, setSortColumn] = useState<SortColumn>(
    (searchParams.get("sort") as SortColumn) ?? "raised"
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    (searchParams.get("order") as SortDirection) ?? "desc"
  );

  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Guard against double-fire navigation when pressing Enter/Space or clicking
  const isNavigatingRef = useRef(false);

  // Keeps the URL in sync with the filter and sorting state
  useEffect(() => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (search) params.set("search", search);
    if (technique) params.set("technique", technique);
    if (status) params.set("status", status);
    if (sortColumn !== "raised") params.set("sort", sortColumn);
    if (sortDirection !== "desc") params.set("order", sortDirection);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [severity, search, technique, status, sortColumn, sortDirection, pathname, router]);

  // Returns true on success, false on a network error or any non-2xx answer
  // (including 503 backend_unavailable), so the poll below can back off.
  const load = useCallback(
    async (isCancelled: () => boolean, signal: AbortSignal): Promise<boolean> => {
      const params = new URLSearchParams();
      if (severity) params.set("severity", severity);

      try {
        const res = await fetch(`/api/incidents?${params.toString()}`, { signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = await res.json();
        if (isCancelled()) return false;
        setIncidents(body);
        setError(null);
        return true;
      } catch {
        if (isCancelled()) return false;
        setError("Could not reach the backend.");
        return false;
      }
    },
    [severity]
  );

  useEffect(() => {
    // One run at a time, back off while the backend is failing, pause while the
    // tab is hidden and resume with an immediate run when it is visible again.
    let cancelled = false;
    let inFlight = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    const controller = new AbortController();
    const isCancelled = () => cancelled;

    const clearTimer = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const scheduleNext = () => {
      if (cancelled || document.hidden) return;
      timerId = setTimeout(() => {
        void runPoll();
      }, nextDelay(consecutiveFailures, POLL_BASE_MS, POLL_MAX_MS));
    };

    const runPoll = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      const success = await load(isCancelled, controller.signal);
      inFlight = false;
      if (cancelled) return;
      consecutiveFailures = success ? 0 : consecutiveFailures + 1;
      scheduleNext();
    };

    const onVisibilityChange = () => {
      clearTimer();
      if (!document.hidden) void runPoll();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void runPoll();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  // Dynamically extract distinct techniques and tactics from current incidents
  const allTechniquesAndTactics = useMemo(() => {
    const set = new Set<string>();
    for (const inc of incidents) {
      if (Array.isArray(inc.techniques)) {
        inc.techniques.forEach((t) => t && set.add(t));
      }
      if (Array.isArray(inc.tactics)) {
        inc.tactics.forEach((t) => t && set.add(t));
      }
    }
    return Array.from(set).sort();
  }, [incidents]);

  // Filtering:
  // 1. "Status: open" explicitly uses deriveIncidentStatus heuristic from @/lib/incidents:
  //    In this system, there is no real case-status field in the incident data contract (see docs/person_b.md).
  //    An incident is considered "open" if its response hasn't completed (deriveIncidentStatus !== "resolved", or isOpenIncident).
  // 2. Search matches host, user, OR scenario.
  // 3. Technique / tactic matches techniques or tactics arrays.
  const filteredIncidents = useMemo(() => {
    let list = incidents;

    if (status === "open") {
      list = list.filter((inc) => {
        const history = inc.last_response_action ? [inc.last_response_action] : [];
        return deriveIncidentStatus(history) !== "resolved" || isOpenIncident(inc);
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (inc) =>
          (inc.host && inc.host.toLowerCase().includes(q)) ||
          (inc.user && inc.user.toLowerCase().includes(q)) ||
          (inc.matched_scenario &&
            (inc.matched_scenario.toLowerCase().includes(q) ||
              humanizeScenario(inc.matched_scenario).toLowerCase().includes(q)))
      );
    }

    if (technique) {
      list = list.filter(
        (inc) =>
          (Array.isArray(inc.techniques) && inc.techniques.includes(technique)) ||
          (Array.isArray(inc.tactics) && inc.tactics.includes(technique))
      );
    }

    return list;
  }, [incidents, status, search, technique]);

  // Sorting
  const sortedIncidents = useMemo(() => {
    return [...filteredIncidents].sort((a, b) => {
      let diff = 0;
      switch (sortColumn) {
        case "severity":
          diff = (SEVERITY_WEIGHT[a.severity] ?? 0) - (SEVERITY_WEIGHT[b.severity] ?? 0);
          break;
        case "host":
          diff = (a.host || "").localeCompare(b.host || "");
          break;
        case "user":
          diff = (a.user || "").localeCompare(b.user || "");
          break;
        case "scenario":
          diff = (a.matched_scenario || "").localeCompare(b.matched_scenario || "");
          break;
        case "alerts":
          diff = (a.alert_ids?.length ?? 0) - (b.alert_ids?.length ?? 0);
          break;
        case "raised":
          diff = (a.incident_raised_time || "").localeCompare(b.incident_raised_time || "");
          break;
        case "triage":
          diff = (a.triage_verdict || "").localeCompare(b.triage_verdict || "");
          break;
        case "last_action": {
          const actA = a.last_response_action
            ? describeResponseAction(a.last_response_action)
            : "";
          const actB = b.last_response_action
            ? describeResponseAction(b.last_response_action)
            : "";
          diff = actA.localeCompare(actB);
          break;
        }
      }
      return sortDirection === "asc" ? diff : -diff;
    });
  }, [filteredIncidents, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const navigateToIncident = (incidentId: string, openInNewTab = false) => {
    if (openInNewTab) {
      window.open(`/incidents/${incidentId}`, "_blank");
      return;
    }
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    router.push(`/incidents/${incidentId}`);
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 400);
  };

  const handleRowClick = (e: React.MouseEvent, incidentId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest("a") || target.closest("button")) return;

    if (e.metaKey || e.ctrlKey) {
      navigateToIncident(incidentId, true);
    } else {
      navigateToIncident(incidentId);
    }
  };

  const handleRowAuxClick = (e: React.MouseEvent, incidentId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest("a") || target.closest("button")) return;

    if (e.button === 1) {
      navigateToIncident(incidentId, true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, incidentId: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      navigateToIncident(incidentId);
    }
  };

  const renderSortIndicator = (column: SortColumn) => {
    if (sortColumn === column) {
      return (
        <span
          className="ml-1 text-xs font-bold text-zinc-900 dark:text-zinc-100"
          aria-label={sortDirection === "asc" ? "sorted ascending" : "sorted descending"}
        >
          {sortDirection === "asc" ? "▲" : "▼"}
        </span>
      );
    }
    return (
      <span className="ml-1 text-xs text-zinc-400 opacity-0 transition-opacity group-hover/col:opacity-100 dark:text-zinc-500">
        ⇅
      </span>
    );
  };

  return (
    <>
      <Filters
        severity={severity}
        search={search}
        techniqueOrTactic={technique}
        techniquesAndTactics={allTechniquesAndTactics}
        onSeverityChange={setSeverity}
        onSearchChange={setSearch}
        onTechniqueOrTacticChange={setTechnique}
      />

      {status === "open" && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          {/* Explicitly uses deriveIncidentStatus heuristic from @/lib/incidents:
              In this system, there is no real case-status field in the incident data contract (see docs/person_b.md).
              An incident is considered "open" if its response hasn't completed (deriveIncidentStatus !== "resolved", or isOpenIncident). */}
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
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

      {/* Showing N of M incidents count header */}
      <div className="mb-3 flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>
          Showing {sortedIncidents.length} of {incidents.length} incidents
        </span>
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {/* DESKTOP TABLE VIEW (>= 768px) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
              <th
                onClick={() => handleSort("severity")}
                className="group/col cursor-pointer select-none py-1.5 pr-4 font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center">
                  <span>Severity</span>
                  {renderSortIndicator("severity")}
                </div>
              </th>
              <th
                onClick={() => handleSort("host")}
                className="group/col cursor-pointer select-none py-1.5 pr-4 font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center">
                  <span>Host</span>
                  {renderSortIndicator("host")}
                </div>
              </th>
              <th
                onClick={() => handleSort("user")}
                className="group/col cursor-pointer select-none py-1.5 pr-4 font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center">
                  <span>User</span>
                  {renderSortIndicator("user")}
                </div>
              </th>
              <th
                onClick={() => handleSort("scenario")}
                className="group/col cursor-pointer select-none py-1.5 pr-4 font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center">
                  <span>Scenario</span>
                  {renderSortIndicator("scenario")}
                </div>
              </th>
              <th
                onClick={() => handleSort("alerts")}
                className="group/col cursor-pointer select-none py-1.5 pr-4 text-right font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center justify-end">
                  <span>Alerts</span>
                  {renderSortIndicator("alerts")}
                </div>
              </th>
              <th
                onClick={() => handleSort("raised")}
                className="group/col cursor-pointer select-none py-1.5 pr-4 text-right font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center justify-end">
                  <span>Raised</span>
                  {renderSortIndicator("raised")}
                </div>
              </th>
              <th
                onClick={() => handleSort("triage")}
                className="group/col cursor-pointer select-none py-1.5 pr-4 font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center">
                  <span>Triage</span>
                  {renderSortIndicator("triage")}
                </div>
              </th>
              <th
                onClick={() => handleSort("last_action")}
                className="group/col cursor-pointer select-none py-1.5 pr-4 font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                <div className="flex items-center">
                  <span>Last action</span>
                  {renderSortIndicator("last_action")}
                </div>
              </th>
              <th className="py-1.5 pr-2 text-right" aria-label="Open incident" />
            </tr>
          </thead>
          <tbody>
            {sortedIncidents.map((incident) => {
              const fullAction = incident.last_response_action
                ? describeResponseAction(incident.last_response_action)
                : "None yet";
              return (
                <tr
                  key={incident.incident_id}
                  onClick={(e) => handleRowClick(e, incident.incident_id)}
                  onAuxClick={(e) => handleRowAuxClick(e, incident.incident_id)}
                  tabIndex={0}
                  onKeyDown={(e) => handleKeyDown(e, incident.incident_id)}
                  className="group cursor-pointer border-b border-zinc-100 transition-all duration-150 ease-out hover:bg-zinc-100/70 hover:shadow-sm dark:border-zinc-900 dark:hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
                >
                  <td className="py-2 pr-4 pl-2 border-l-2 border-transparent transition-colors group-hover:border-l-zinc-500 dark:group-hover:border-l-zinc-400">
                    <SeverityBadge severity={incident.severity} />
                  </td>
                  <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-zinc-100">
                    {incident.host}
                  </td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                    {incident.user}
                  </td>
                  <td
                    className="py-2 pr-4 text-xs text-zinc-600 dark:text-zinc-400"
                    title={incident.matched_scenario ?? undefined}
                  >
                    {incident.matched_scenario ? humanizeScenario(incident.matched_scenario) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {incident.alert_ids?.length ?? 0}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    {incident.incident_raised_time}
                  </td>
                  <td className="py-2 pr-4">
                    <TriageBadge verdict={incident.triage_verdict} status={incident.triage_status} className="-my-0.5" />
                  </td>
                  <td className="py-2 pr-4 max-w-[200px]">
                    <span
                      className="block truncate text-zinc-600 dark:text-zinc-400"
                      title={fullAction}
                    >
                      {fullAction}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <span
                      aria-hidden="true"
                      className="inline-block text-zinc-400 transition-all duration-150 ease-out group-hover:translate-x-1 group-hover:text-zinc-700 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </td>
                </tr>
              );
            })}
            {sortedIncidents.length === 0 && !error && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-zinc-500">
                  No incidents match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MOBILE STACKED CARDS (< 768px) */}
      <div className="flex flex-col gap-3 md:hidden">
        {sortedIncidents.map((incident) => {
          const fullAction = incident.last_response_action
            ? describeResponseAction(incident.last_response_action)
            : "None yet";
          return (
            <div
              key={incident.incident_id}
              onClick={(e) => handleRowClick(e, incident.incident_id)}
              onAuxClick={(e) => handleRowAuxClick(e, incident.incident_id)}
              tabIndex={0}
              onKeyDown={(e) => handleKeyDown(e, incident.incident_id)}
              className="group cursor-pointer rounded-lg border border-zinc-200 border-l-4 border-l-transparent bg-white p-3.5 shadow-sm transition-all duration-150 ease-out hover:border-zinc-300 hover:border-l-zinc-500 hover:bg-zinc-50 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:border-l-zinc-400 dark:hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={incident.severity} />
                  <TriageBadge verdict={incident.triage_verdict} status={incident.triage_status} />
                </div>
                <span
                  aria-hidden="true"
                  className="text-zinc-400 transition-all duration-150 ease-out group-hover:translate-x-1 group-hover:text-zinc-700 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </div>

              <div className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {incident.host} <span className="font-normal text-zinc-400 dark:text-zinc-500">•</span>{" "}
                {incident.user}
              </div>

              <div
                className="mb-2 text-xs text-zinc-600 dark:text-zinc-400"
                title={incident.matched_scenario ?? undefined}
              >
                {incident.matched_scenario ? humanizeScenario(incident.matched_scenario) : "—"}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800/80 dark:text-zinc-400">
                <span className="whitespace-nowrap">{incident.incident_raised_time}</span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {incident.alert_ids?.length ?? 0} alert
                  {(incident.alert_ids?.length ?? 0) === 1 ? "" : "s"}
                </span>
              </div>

              <div
                className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 truncate"
                title={fullAction}
              >
                <span className="font-medium text-zinc-600 dark:text-zinc-400">Action:</span>{" "}
                {fullAction}
              </div>
            </div>
          );
        })}
        {sortedIncidents.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No incidents match the selected filters.
          </div>
        )}
      </div>
    </>
  );
}
