"use client";

import { useCallback, useEffect, useState } from "react";
import { handleUnauthorized } from "@/lib/clientCache";
import { nextDelay } from "@/lib/pollBackoff";
import { useSwrState } from "@/lib/useSwrState";

import { RefreshIndicator } from "@/components/RefreshIndicator";
import { AlertsTimeseriesChart } from "@/components/metrics/AlertsTimeseriesChart";
import { DataSourcesIndicator } from "@/components/metrics/DataSourcesIndicator";
import { DetectionQualityPanel } from "@/components/metrics/DetectionQualityPanel";
import { EmptyRangeBanner } from "@/components/metrics/EmptyRangeState";
import { KpiCards } from "@/components/metrics/KpiCards";
import { MitreHeatmap } from "@/components/metrics/MitreHeatmap";
import { MttdMttrPanel } from "@/components/metrics/MttdMttrPanel";
import { NeedsAttention } from "@/components/metrics/NeedsAttention";
import { PipelineHealthStrip } from "@/components/metrics/PipelineHealthStrip";
import { RangeSelector } from "@/components/metrics/RangeSelector";
import { ResponsePanel } from "@/components/metrics/ResponsePanel";
import { SeverityBreakdown } from "@/components/metrics/SeverityBreakdown";
import { TriagePanel } from "@/components/metrics/TriagePanel";
import { sinceForRange } from "@/lib/range";
import type {
  CaseSummary,
  IncidentListItem,
  MetricsMitre,
  MetricsPipeline,
  MetricsRange,
  MetricsResponse,
  MetricsSummary,
  MetricsTimeseries,
  MetricsTop,
  MetricsTriage,
  MetricsCases,
} from "@/lib/types";

const POLL_BASE_MS = 3000;
const POLL_MAX_MS = 30000;
// GET /incidents caps limit at 500 (backend/app/routers/incidents.py) --
// far more than enough to cover every incident in range at this project's
// scale. This same fetch backs both the open-incident count and the
// newest-incidents list, so it needs every incident in range, not just the
// newest few.
const INCIDENTS_FETCH_LIMIT = 500;

interface PageState {
  summary: MetricsSummary | null;
  timeseries: MetricsTimeseries | null;
  top: MetricsTop | null;
  mitre: MetricsMitre | null;
  response: MetricsResponse | null;
  triage: MetricsTriage | null;
  pipeline: MetricsPipeline | null;
  incidents: IncidentListItem[] | null;
  // null when the case service did not answer: every incident then counts as open.
  cases: CaseSummary[] | null;
  // null when /api/metrics/cases did not answer: the case rows are then left out.
  caseMetrics: MetricsCases | null;
}

const EMPTY_STATE: PageState = {
  summary: null,
  timeseries: null,
  top: null,
  mitre: null,
  response: null,
  triage: null,
  pipeline: null,
  incidents: null,
  cases: null,
  caseMetrics: null,
};

export default function OverviewPage() {
  const [range, setRange] = useState<MetricsRange>("7d");
  // Keyed by range: a revisit renders the last data for that range at once and the
  // poll below revalidates it in the background.
  const { data, setData, fetchedAt, refreshing, setRefreshing } = useSwrState<PageState>(`overview:${range}`, EMPTY_STATE);
  const [error, setError] = useState<string | null>(null);

  // Returns true on success, false on any network or non-2xx error.
  const load = useCallback(async (isCancelled: () => boolean, signal: AbortSignal): Promise<boolean> => {
    const qs = `?range=${range}`;
    setRefreshing(true);
    const since = sinceForRange(range);
    const incidentsQs = new URLSearchParams({ limit: String(INCIDENTS_FETCH_LIMIT), ...(since ? { since } : {}) });
    try {
      // The case summaries ride along in the same cycle. A failure there is not
      // a poll failure: the Overview just counts every incident as open.
      const casesRequest = fetch("/api/cases", { signal, cache: "no-store" }).catch(() => null);
      const caseMetricsRequest = fetch(`/api/metrics/cases${qs}`, { signal, cache: "no-store" }).catch(() => null);
      const responses = await Promise.all([
        fetch(`/api/metrics/summary${qs}`, { signal }),
        fetch(`/api/metrics/timeseries${qs}`, { signal }),
        fetch(`/api/metrics/top${qs}`, { signal }),
        fetch(`/api/metrics/mitre${qs}`, { signal }),
        fetch(`/api/metrics/response${qs}`, { signal }),
        fetch(`/api/metrics/triage${qs}`, { signal }),
        fetch(`/api/metrics/pipeline`, { signal }),
        fetch(`/api/incidents?${incidentsQs.toString()}`, { signal }),
      ]);
      // A 401 means the session is gone: forget the cache and go to sign-in.
      if (responses.some((r) => r.status === 401)) {
        if (!isCancelled()) handleUnauthorized();
        return false;
      }
      // Count any non-2xx response as a failure so back-off activates.
      if (responses.some((r) => !r.ok)) {
        if (isCancelled()) return false;
        setError("Could not reach the backend.");
        return false;
      }
      const [summary, timeseries, top, mitre, response, triage, pipeline, incidents] =
        await Promise.all(responses.map((r) => r.json() as Promise<unknown>));
      const casesRes = await casesRequest;
      let cases: CaseSummary[] | null = null;
      if (casesRes && casesRes.ok) {
        try {
          const parsed: unknown = await casesRes.json();
          if (Array.isArray(parsed)) cases = parsed as CaseSummary[];
        } catch {
          cases = null;
        }
      }
      const caseMetricsRes = await caseMetricsRequest;
      let caseMetrics: MetricsCases | null = null;
      if (caseMetricsRes && caseMetricsRes.ok) {
        try {
          const parsed = (await caseMetricsRes.json()) as MetricsCases | null;
          if (parsed && typeof parsed === "object" && parsed.ai_agreement && parsed.status_counts) caseMetrics = parsed;
        } catch {
          caseMetrics = null;
        }
      }
      if (isCancelled()) return false;
      setData({ summary, timeseries, top, mitre, response, triage, pipeline, incidents, cases, caseMetrics } as PageState);
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
  }, [range, setData, setRefreshing]);

  useEffect(() => {
    // Effect-scoped locals -- no useRef needed (same pattern as BackendWakeBanner).
    let cancelled = false;
    let inFlight = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    // Aborted on range change or unmount, so a superseded run's requests are
    // cancelled instead of overlapping the new run's.
    const controller = new AbortController();

    const isCancelled = () => cancelled;

    const runPoll = async () => {
      if (inFlight) return;
      if (cancelled) return;
      inFlight = true;
      const success = await load(isCancelled, controller.signal);
      inFlight = false;
      if (cancelled) return;
      if (success) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures += 1;
      }
      schedulNext();
    };

    const schedulNext = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const delay = nextDelay(consecutiveFailures, POLL_BASE_MS, POLL_MAX_MS);
      timerId = setTimeout(() => { void runPoll(); }, delay);
    };

    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
      } else {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        void runPoll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // On a range change the page already shows that range's cached data, or the
    // loading state when there is none (useSwrState); the poll starts at once.
    void runPoll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [load]);

  const rangeIsEmpty =
    data.summary !== null &&
    data.summary.total_alerts.status !== "ok" &&
    data.summary.total_incidents.status !== "ok";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Overview</h1>
        <RefreshIndicator
          className="flex-1"
          refreshing={refreshing}
          fetchedAt={fetchedAt}
          failed={error !== null}
          pollMs={POLL_BASE_MS}
        />
        <DataSourcesIndicator summary={data.summary} mitre={data.mitre} pipeline={data.pipeline} />
      </div>
      <RangeSelector range={range} onRangeChange={setRange} lastUpdated={fetchedAt === null ? null : new Date(fetchedAt)} />
      {/* With data on screen a failed refresh is only the quiet note above. */}
      {error && fetchedAt === null && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {rangeIsEmpty && <EmptyRangeBanner range={range} onSwitchToAll={() => setRange("all")} />}

      {/* Layout is identical across every range: sections always render in
          the same positions, counts show 0 when empty (a real value),
          averages show a placeholder instead. */}
      <NeedsAttention incidents={data.incidents} response={data.response} cases={data.cases} caseMetrics={data.caseMetrics} />

      <div
        className={`mb-6 ${
          data.summary?.mttr_by_scenario?.status === "ok"
            ? "grid gap-3 lg:grid-cols-[1fr_auto]"
            : ""
        }`}
      >
        <KpiCards summary={data.summary} />
        <MttdMttrPanel summary={data.summary} />
      </div>

      <section className="mb-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <AlertsTimeseriesChart data={data.timeseries} />
        <SeverityBreakdown timeseries={data.timeseries} top={data.top} />
      </section>

      <section className="mb-6">
        <MitreHeatmap data={data.mitre} />
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <ResponsePanel data={data.response} />
        <TriagePanel data={data.triage} caseMetrics={data.caseMetrics} />
        <DetectionQualityPanel top={data.top} caseMetrics={data.caseMetrics} />
      </section>

      <PipelineHealthStrip data={data.pipeline} />
    </main>
  );
}
