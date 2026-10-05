"use client";

import { useCallback, useEffect, useState } from "react";
import { nextDelay } from "@/lib/pollBackoff";

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
  IncidentListItem,
  MetricsMitre,
  MetricsPipeline,
  MetricsRange,
  MetricsResponse,
  MetricsSummary,
  MetricsTimeseries,
  MetricsTop,
  MetricsTriage,
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
};

export default function OverviewPage() {
  const [range, setRange] = useState<MetricsRange>("7d");
  const [data, setData] = useState<PageState>(EMPTY_STATE);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Returns true on success, false on any network or non-2xx error.
  const load = useCallback(async (isCancelled: () => boolean, signal: AbortSignal): Promise<boolean> => {
    const qs = `?range=${range}`;
    const since = sinceForRange(range);
    const incidentsQs = new URLSearchParams({ limit: String(INCIDENTS_FETCH_LIMIT), ...(since ? { since } : {}) });
    try {
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
      // Count any non-2xx response as a failure so back-off activates.
      if (responses.some((r) => !r.ok)) {
        if (isCancelled()) return false;
        setError("Could not reach the backend.");
        return false;
      }
      const [summary, timeseries, top, mitre, response, triage, pipeline, incidents] =
        await Promise.all(responses.map((r) => r.json() as Promise<unknown>));
      if (isCancelled()) return false;
      setData({ summary, timeseries, top, mitre, response, triage, pipeline, incidents } as PageState);
      setLastUpdated(new Date());
      setError(null);
      return true;
    } catch {
      if (isCancelled()) return false;
      setError("Could not reach the backend.");
      return false;
    }
  }, [range]);

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

    // Show loading state immediately on range change, not stale data.
    setData(EMPTY_STATE);
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
        <DataSourcesIndicator summary={data.summary} mitre={data.mitre} pipeline={data.pipeline} />
      </div>
      <RangeSelector range={range} onRangeChange={setRange} lastUpdated={lastUpdated} />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {rangeIsEmpty && <EmptyRangeBanner range={range} onSwitchToAll={() => setRange("all")} />}

      {/* Layout is identical across every range: sections always render in
          the same positions, counts show 0 when empty (a real value),
          averages show a placeholder instead. */}
      <NeedsAttention incidents={data.incidents} response={data.response} />

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
        <TriagePanel data={data.triage} />
        <DetectionQualityPanel top={data.top} />
      </section>

      <PipelineHealthStrip data={data.pipeline} />
    </main>
  );
}
