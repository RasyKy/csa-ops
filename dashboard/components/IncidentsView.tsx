"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnalystVerdict, aiVerdictLabel } from "@/components/case/AnalystVerdict";
import { DisagreementMarker } from "@/components/case/DisagreementMarker";
import { Filters } from "@/components/Filters";
import { RefreshIndicator } from "@/components/RefreshIndicator";
import { SeverityBadge } from "@/components/SeverityBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { TriageBadge } from "@/components/TriageBadge";
import { humanizeScenario } from "@/lib/incidentDisplay";
import { incidentListTitle, incidentMeta } from "@/lib/incidentListTitle";
import {
  assigneeFilterMatches,
  effectiveCase,
  isUnresolved,
  matchesStatusFilter,
  normalizeStatus,
  parseStatusFilter,
  verdictRelation,
  type NormalizedStatus,
  type StatusFilter,
} from "@/lib/caseJoin";
import { handleUnauthorized } from "@/lib/clientCache";
import { nextDelay } from "@/lib/pollBackoff";
import { shareStructure } from "@/lib/swrCache";
import { formatDateTime, formatShortDateTime, formatUtc, tzLabel } from "@/lib/time";
import type { CaseSummary, IncidentListItem, Severity } from "@/lib/types";
import { useAlertTitles } from "@/lib/useAlertTitles";
import { useSwrState } from "@/lib/useSwrState";

const POLL_BASE_MS = 3000;
const POLL_MAX_MS = 30000;

type SortColumn = "severity" | "incident" | "raised" | "status" | "assignee";
// "queue" is the default order: unresolved first, resolved last, newest first in each group.
type SortState = SortColumn | "queue";
type SortDirection = "asc" | "desc";

const SORT_COLUMNS: readonly SortColumn[] = ["severity", "incident", "raised", "status", "assignee"];

function parseSort(raw: string | null): SortState {
  return raw !== null && (SORT_COLUMNS as readonly string[]).includes(raw) ? (raw as SortColumn) : "queue";
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const TH_BASE =
  "group/col cursor-pointer select-none py-1.5 pr-3 font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors";

const raisedMs = (incident: IncidentListItem) => Date.parse(incident.incident_raised_time) || 0;

const EMPTY_INCIDENTS: IncidentListItem[] = [];

// Everything one row or card needs, as values that compare cheaply, so a refresh that
// changes one incident re-renders only that row and one that changes nothing renders none.
interface RowProps {
  incident: IncidentListItem;
  title: string;
  meta: string;
  status: NormalizedStatus;
  assignee: string | null;
  analystVerdict: string | null;
  onOpen: (e: React.MouseEvent, incidentId: string) => void;
  onAux: (e: React.MouseEvent, incidentId: string) => void;
  onKey: (e: React.KeyboardEvent, incidentId: string) => void;
}

// The Triage cell. A resolved incident leads with the analyst's verdict; the AI's
// verdict shows on a second line only when it adds something (it differs, or it was
// uncertain, or the analyst could not decide). Unresolved incidents show the AI pill.
function TriageCell({ incident, analystVerdict }: { incident: IncidentListItem; analystVerdict: string | null }) {
  if (!analystVerdict) {
    return <TriageBadge verdict={incident.triage_verdict} status={incident.triage_status} showSourceTag />;
  }
  // a failed triage has no verdict to compare with
  const aiVerdict = incident.triage_status === "failed" ? null : incident.triage_verdict ?? null;
  const relation = verdictRelation(aiVerdict, analystVerdict);
  const aiSaid =
    aiVerdict && (relation === "disagree" || relation === "ai_uncertain" || relation === "analyst_undetermined")
      ? `AI said ${aiVerdictLabel(aiVerdict).toLowerCase()}`
      : null;
  return (
    <>
      <AnalystVerdict verdict={analystVerdict} variant="pill" aiVerdict={aiVerdict} />
      {aiSaid && (
        <span className="flex max-w-full items-center gap-1.5 text-xs text-ink-muted" data-testid="triage-ai-said">
          {relation === "disagree" && <DisagreementMarker aiVerdict={aiVerdict} analystVerdict={analystVerdict} />}
          <span className="truncate" title={aiSaid}>
            {aiSaid}
          </span>
        </span>
      )}
    </>
  );
}

const IncidentRow = memo(function IncidentRow({
  incident,
  title,
  meta,
  status,
  assignee,
  analystVerdict,
  onOpen,
  onAux,
  onKey,
}: RowProps) {
  return (
    <tr
      data-incident-id={incident.incident_id}
      onClick={(e) => onOpen(e, incident.incident_id)}
      onAuxClick={(e) => onAux(e, incident.incident_id)}
      tabIndex={0}
      onKeyDown={(e) => onKey(e, incident.incident_id)}
      className="group h-[52px] cursor-pointer border-b border-zinc-100 transition-all duration-150 ease-out hover:bg-zinc-100/70 hover:shadow-sm dark:border-zinc-900 dark:hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
    >
      <td className="whitespace-nowrap py-1 pr-3 pl-2 align-middle border-l-2 border-transparent transition-colors group-hover:border-l-zinc-500 dark:group-hover:border-l-zinc-400">
        <SeverityBadge severity={incident.severity} />
      </td>
      <td className="w-full max-w-0 py-1 pr-3 align-middle" data-testid="cell-incident">
        <div className="truncate text-sm font-medium text-ink" title={title} data-testid="cell-incident-title">
          {title}
        </div>
        <div className="truncate text-xs text-ink-muted" title={meta} data-testid="cell-incident-meta">
          {meta}
        </div>
      </td>
      <td
        className="whitespace-nowrap py-1 pr-3 text-right align-middle text-xs text-ink-muted"
        title={`${formatDateTime(incident.incident_raised_time)} ${tzLabel()} (${formatUtc(incident.incident_raised_time)})`}
        data-testid="cell-raised"
      >
        {formatShortDateTime(incident.incident_raised_time)}
      </td>
      <td className="whitespace-nowrap py-1 pr-3 align-middle" data-testid="cell-triage">
        <div className="flex flex-col items-start justify-center gap-0.5">
          <TriageCell incident={incident} analystVerdict={analystVerdict} />
        </div>
      </td>
      <td className="whitespace-nowrap py-1 pr-3 align-middle" data-testid="cell-status">
        <StatusBadge status={status} />
      </td>
      <td className="whitespace-nowrap py-1 pr-3 align-middle" data-testid="cell-assignee">
        {assignee ? (
          <span className="text-zinc-600 dark:text-zinc-400">{assignee}</span>
        ) : (
          <span className="text-ink-subtle">Unassigned</span>
        )}
      </td>
      <td className="py-1 pr-2 text-right align-middle">
        <span
          aria-hidden="true"
          className="inline-block text-zinc-400 transition-all duration-150 ease-out group-hover:translate-x-1 group-hover:text-zinc-700 dark:text-zinc-500 dark:group-hover:text-zinc-300"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </td>
    </tr>
  );
});

const IncidentCard = memo(function IncidentCard({
  incident,
  title,
  meta,
  status,
  assignee,
  analystVerdict,
  onOpen,
  onAux,
  onKey,
}: RowProps) {
  return (
    <div
      data-incident-id={incident.incident_id}
      onClick={(e) => onOpen(e, incident.incident_id)}
      onAuxClick={(e) => onAux(e, incident.incident_id)}
      tabIndex={0}
      onKeyDown={(e) => onKey(e, incident.incident_id)}
      className="group min-w-0 cursor-pointer rounded-lg border border-zinc-200 border-l-4 border-l-transparent bg-white p-3.5 shadow-sm transition-all duration-150 ease-out hover:border-zinc-300 hover:border-l-zinc-500 hover:bg-zinc-50 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:border-l-zinc-400 dark:hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={status} />
        </div>
        <span
          aria-hidden="true"
          className="text-zinc-400 transition-all duration-150 ease-out group-hover:translate-x-1 group-hover:text-zinc-700 dark:text-zinc-500 dark:group-hover:text-zinc-300"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>

      <div className="truncate text-sm font-semibold text-ink" title={title} data-testid="card-incident-title">
        {title}
      </div>
      <div className="mb-2 truncate text-xs text-ink-muted" title={meta} data-testid="card-incident-meta">
        {meta}
      </div>

      <div className="mb-2 flex flex-col items-start gap-1">
        <TriageCell incident={incident} analystVerdict={analystVerdict} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-xs text-ink-muted dark:border-zinc-800/80">
        <span className="whitespace-nowrap" title={formatUtc(incident.incident_raised_time)} data-testid="card-raised">
          {formatShortDateTime(incident.incident_raised_time)}
        </span>
        <span className="text-ink-subtle" data-testid="card-assignee">
          {assignee ?? "Unassigned"}
        </span>
      </div>
    </div>
  );
});

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
  // Case status filter. A legacy ?status=open link now means Open exactly.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(parseStatusFilter(searchParams.get("status")));
  const [assigneeFilter, setAssigneeFilter] = useState(searchParams.get("assignee") || "all");
  const [sortColumn, setSortColumn] = useState<SortState>(parseSort(searchParams.get("sort")));
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    searchParams.get("order") === "asc" ? "asc" : "desc"
  );

  // The list, the case summaries and the alert titles are cached: a revisit renders
  // the last data at once and refreshes it in the background. A filter with no cached
  // answer yet keeps showing the list that was on screen until its own answer arrives.
  const incidentsKey = severity ? `incidents:list:severity=${severity}` : "incidents:list";
  const shownIncidents = useRef<IncidentListItem[]>(EMPTY_INCIDENTS);
  const {
    data: freshIncidents,
    setData: setIncidents,
    fetchedAt,
    refreshing,
    setRefreshing,
  } = useSwrState<IncidentListItem[]>(incidentsKey, shownIncidents.current);
  shownIncidents.current = freshIncidents;
  const [error, setError] = useState<string | null>(null);
  // Case summaries joined onto the list. A failed case request keeps the last
  // known data (or none, which reads as every incident Open) without an error banner.
  const { data: cases, setData: setCases } = useSwrState<CaseSummary[] | null>("cases:list", null);
  const [casesUnavailable, setCasesUnavailable] = useState(false);

  // Each incident keeps the very same object for as long as it is unchanged, even when
  // a new incident shifts the others' positions, so its row has nothing to re-render.
  const stableById = useRef(new Map<string, IncidentListItem>());
  const incidents = useMemo(() => {
    const previous = stableById.current;
    const current = new Map<string, IncidentListItem>();
    const list = freshIncidents.map((incident) => {
      const before = previous.get(incident.incident_id);
      const kept = before ? shareStructure(before, incident) : incident;
      current.set(incident.incident_id, kept);
      return kept;
    });
    stableById.current = current;
    return list;
  }, [freshIncidents]);
  const [assigneeNames, setAssigneeNames] = useState<string[]>([]);
  // Rule titles of the alerts, to name incidents that have no matched scenario.
  const alertTitles = useAlertTitles();

  // Guard against double-fire navigation when pressing Enter/Space or clicking
  const isNavigatingRef = useRef(false);

  // Keeps the URL in sync with the filter and sorting state
  useEffect(() => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (search) params.set("search", search);
    if (technique) params.set("technique", technique);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (assigneeFilter !== "all") params.set("assignee", assigneeFilter);
    if (sortColumn !== "queue") {
      params.set("sort", sortColumn);
      if (sortDirection === "asc") params.set("order", "asc");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [severity, search, technique, statusFilter, assigneeFilter, sortColumn, sortDirection, pathname, router]);

  // Returns true on success, false on a network error or any non-2xx answer
  // (including 503 backend_unavailable), so the poll below can back off.
  const load = useCallback(
    async (isCancelled: () => boolean, signal: AbortSignal): Promise<boolean> => {
      const params = new URLSearchParams();
      if (severity) params.set("severity", severity);
      setRefreshing(true);

      try {
        const [res, casesRes] = await Promise.all([
          fetch(`/api/incidents?${params.toString()}`, { signal }),
          fetch("/api/cases", { signal, cache: "no-store" }).catch(() => null),
        ]);
        // A 401 means the session is gone: forget the cache and go to sign-in.
        if (res.status === 401 || casesRes?.status === 401) {
          if (!isCancelled()) handleUnauthorized();
          return false;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = await res.json();
        let caseList: CaseSummary[] | null = null;
        if (casesRes && casesRes.ok) {
          try {
            const parsed: unknown = await casesRes.json();
            if (Array.isArray(parsed)) caseList = parsed as CaseSummary[];
          } catch {
            caseList = null;
          }
        }
        if (isCancelled()) return false;
        setIncidents(body);
        if (caseList) {
          setCases(caseList);
          setCasesUnavailable(false);
        } else {
          setCasesUnavailable(true);
        }
        setError(null);
        return true;
      } catch {
        if (isCancelled()) return false;
        setError("Could not reach the backend.");
        return false;
      } finally {
        // a superseded run must not clear the flag of the run that replaced it
        if (!isCancelled()) setRefreshing(false);
      }
    },
    [severity, setIncidents, setCases, setRefreshing]
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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cases/assignees", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("status"))))
      .then((list: unknown) => {
        if (cancelled || !Array.isArray(list)) return;
        setAssigneeNames(list.filter((n): n is string => typeof n === "string" && n !== "Unassigned"));
      })
      .catch(() => {
        // the filter falls back to the names seen in the case data
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const assigneeOptions = useMemo(() => {
    const names = new Set(assigneeNames);
    for (const c of cases ?? []) if (c.assignee) names.add(c.assignee);
    if (assigneeFilter !== "all" && assigneeFilter !== "unassigned") names.add(assigneeFilter);
    return Array.from(names);
  }, [assigneeNames, cases, assigneeFilter]);

  const caseById = useMemo(() => new Map((cases ?? []).map((c) => [c.incident_id, c])), [cases]);
  const caseOf = useCallback(
    (incidentId: string) => caseById.get(incidentId) ?? effectiveCase(incidentId, null),
    [caseById]
  );

  // The title shown for each incident (its scenario, else the earliest alert's rule
  // title, else its technique), looked up once per data change.
  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const inc of incidents) map.set(inc.incident_id, incidentListTitle(inc, alertTitles));
    return map;
  }, [incidents, alertTitles]);
  const titleOf = useCallback((incidentId: string) => titleById.get(incidentId) ?? "Incident", [titleById]);

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
  // 1. Status and assignee filters use the real case data (lib/caseJoin.ts); an
  //    incident with no stored case is Open and unassigned.
  // 2. Search matches host, user, the raw scenario, or the title shown in the list.
  // 3. Technique / tactic matches techniques or tactics arrays.
  const filteredIncidents = useMemo(() => {
    let list = incidents;

    if (statusFilter !== "all" || assigneeFilter !== "all") {
      list = list.filter((inc) => {
        const c = caseOf(inc.incident_id);
        return matchesStatusFilter(c.status, statusFilter) && assigneeFilterMatches(c.assignee, assigneeFilter);
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (inc) =>
          (inc.host && inc.host.toLowerCase().includes(q)) ||
          (inc.user && inc.user.toLowerCase().includes(q)) ||
          titleOf(inc.incident_id).toLowerCase().includes(q) ||
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
  }, [incidents, statusFilter, assigneeFilter, caseOf, search, technique, titleOf]);

  // Sorting. The default "queue" order puts unresolved incidents first and resolved
  // ones last, newest first within each group.
  const sortedIncidents = useMemo(() => {
    const list = [...filteredIncidents];
    if (sortColumn === "queue") {
      return list.sort((a, b) => {
        const unresolvedA = isUnresolved(caseOf(a.incident_id).status) ? 0 : 1;
        const unresolvedB = isUnresolved(caseOf(b.incident_id).status) ? 0 : 1;
        return unresolvedA - unresolvedB || raisedMs(b) - raisedMs(a);
      });
    }
    return list.sort((a, b) => {
      let diff = 0;
      switch (sortColumn) {
        case "severity":
          diff = (SEVERITY_WEIGHT[a.severity] ?? 0) - (SEVERITY_WEIGHT[b.severity] ?? 0);
          break;
        case "incident":
          diff = titleOf(a.incident_id).localeCompare(titleOf(b.incident_id));
          break;
        case "raised":
          // the real timestamp, not the text
          diff = raisedMs(a) - raisedMs(b);
          break;
        case "status": {
          const weight = { open: 0, investigating: 1, resolved: 2 };
          diff =
            weight[normalizeStatus(caseOf(a.incident_id).status)] -
            weight[normalizeStatus(caseOf(b.incident_id).status)];
          break;
        }
        case "assignee":
          diff = (caseOf(a.incident_id).assignee || "").localeCompare(caseOf(b.incident_id).assignee || "");
          break;
      }
      return sortDirection === "asc" ? diff : -diff;
    });
  }, [filteredIncidents, sortColumn, sortDirection, caseOf, titleOf]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const restoreQueueOrder = () => {
    setSortColumn("queue");
    setSortDirection("desc");
  };

  // These handlers keep their identity between renders, so a memoized row only
  // re-renders when its own data changes.
  const navigateToIncident = useCallback(
    (incidentId: string, openInNewTab = false) => {
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
    },
    [router]
  );

  const handleRowClick = useCallback(
    (e: React.MouseEvent, incidentId: string) => {
      const target = e.target as HTMLElement;
      if (target.closest("a") || target.closest("button")) return;

      if (e.metaKey || e.ctrlKey) {
        navigateToIncident(incidentId, true);
      } else {
        navigateToIncident(incidentId);
      }
    },
    [navigateToIncident]
  );

  const handleRowAuxClick = useCallback(
    (e: React.MouseEvent, incidentId: string) => {
      const target = e.target as HTMLElement;
      if (target.closest("a") || target.closest("button")) return;

      if (e.button === 1) {
        navigateToIncident(incidentId, true);
      }
    },
    [navigateToIncident]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, incidentId: string) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        navigateToIncident(incidentId);
      }
    },
    [navigateToIncident]
  );

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

  // The analyst's verdict for an incident, only once its case is resolved.
  const analystVerdictOf = (incidentId: string): string | null => {
    const c = caseOf(incidentId);
    return normalizeStatus(c.status) === "resolved" && c.verdict ? c.verdict : null;
  };

  // What each memoized row or card is given: plain values, so an unchanged incident
  // compares equal and skips its render.
  const rowPropsOf = (incident: IncidentListItem): RowProps => {
    const caseInfo = caseOf(incident.incident_id);
    return {
      incident,
      title: titleOf(incident.incident_id),
      meta: incidentMeta(incident.host, incident.user, incident.alert_ids?.length ?? 0),
      status: normalizeStatus(caseInfo.status),
      assignee: caseInfo.assignee ?? null,
      analystVerdict: analystVerdictOf(incident.incident_id),
      onOpen: handleRowClick,
      onAux: handleRowAuxClick,
      onKey: handleKeyDown,
    };
  };

  return (
    <>
      <Filters
        severity={severity}
        search={search}
        techniqueOrTactic={technique}
        techniquesAndTactics={allTechniquesAndTactics}
        statusFilter={statusFilter}
        assigneeFilter={assigneeFilter}
        assigneeNames={assigneeOptions}
        onSeverityChange={setSeverity}
        onSearchChange={setSearch}
        onTechniqueOrTacticChange={setTechnique}
        onStatusFilterChange={(value) => setStatusFilter(parseStatusFilter(value))}
        onAssigneeFilterChange={setAssigneeFilter}
      />

      {/* Showing N of M incidents count header */}
      <div className="mb-3 flex items-center justify-between gap-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <div className="flex min-w-0 items-center gap-3">
          <span>
            Showing {sortedIncidents.length} of {incidents.length} incidents
          </span>
          {sortColumn === "queue" ? (
            <span className="font-normal text-ink-subtle" data-testid="queue-note">
              Unresolved first, then newest
            </span>
          ) : (
            <button
              type="button"
              onClick={restoreQueueOrder}
              data-testid="queue-order-button"
              className="rounded font-normal text-ink-muted underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Queue order
            </button>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <RefreshIndicator
            className="flex-1 text-right font-normal"
            refreshing={refreshing}
            fetchedAt={fetchedAt}
            failed={error !== null}
            pollMs={POLL_BASE_MS}
          />
          {casesUnavailable && (
            <span className="shrink-0 font-normal text-ink-subtle" data-testid="cases-unavailable">
              Case data unavailable
            </span>
          )}
        </div>
      </div>

      {/* With data on screen a failed refresh is only the quiet note beside the count. */}
      {error && fetchedAt === null && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {/* DESKTOP TABLE VIEW (>= 768px). The bottom padding leaves room for a tooltip
          under the last row. */}
      <div className="hidden md:block overflow-x-auto pb-14" data-testid="incidents-table-container">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
              <th onClick={() => handleSort("severity")} className={TH_BASE}>
                <div className="flex items-center">
                  <span>Severity</span>
                  {renderSortIndicator("severity")}
                </div>
              </th>
              <th onClick={() => handleSort("incident")} className={`${TH_BASE} w-full`}>
                <div className="flex items-center">
                  <span>Incident</span>
                  {renderSortIndicator("incident")}
                </div>
              </th>
              <th
                title={`Times are shown in ${tzLabel()}`}
                onClick={() => handleSort("raised")}
                className={`${TH_BASE} text-right`}
              >
                <div className="flex items-center justify-end">
                  <span>Raised</span>
                  {renderSortIndicator("raised")}
                </div>
              </th>
              <th className="py-1.5 pr-3 font-semibold text-zinc-600 dark:text-zinc-400">
                <div className="flex items-center">
                  <span>Triage</span>
                </div>
              </th>
              <th onClick={() => handleSort("status")} className={TH_BASE}>
                <div className="flex items-center">
                  <span>Status</span>
                  {renderSortIndicator("status")}
                </div>
              </th>
              <th onClick={() => handleSort("assignee")} className={TH_BASE}>
                <div className="flex items-center">
                  <span>Assignee</span>
                  {renderSortIndicator("assignee")}
                </div>
              </th>
              <th className="py-1.5 pr-2 text-right" aria-label="Open incident" />
            </tr>
          </thead>
          <tbody>
            {sortedIncidents.map((incident) => (
              <IncidentRow key={incident.incident_id} {...rowPropsOf(incident)} />
            ))}
            {sortedIncidents.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-zinc-500">
                  No incidents match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MOBILE STACKED CARDS (< 768px) */}
      <div className="flex flex-col gap-3 md:hidden">
        {sortedIncidents.map((incident) => (
          <IncidentCard key={incident.incident_id} {...rowPropsOf(incident)} />
        ))}
        {sortedIncidents.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No incidents match the selected filters.
          </div>
        )}
      </div>
    </>
  );
}
