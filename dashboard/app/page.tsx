"use client";

import { useCallback, useEffect, useState } from "react";

import { AlertsTimeseriesChart } from "@/components/metrics/AlertsTimeseriesChart";
import { DataSourcesIndicator } from "@/components/metrics/DataSourcesIndicator";
import { DetectionQualityPanel } from "@/components/metrics/DetectionQualityPanel";
import { EmptyRangeState } from "@/components/metrics/EmptyRangeState";
import { KpiCards } from "@/components/metrics/KpiCards";
import { MitreHeatmap } from "@/components/metrics/MitreHeatmap";
import { MttdMttrPanel } from "@/components/metrics/MttdMttrPanel";
import { NeedsAttention } from "@/components/metrics/NeedsAttention";
import { PipelineHealthStrip } from "@/components/metrics/PipelineHealthStrip";
import { RangeSelector } from "@/components/metrics/RangeSelector";
import { ResponsePanel } from "@/components/metrics/ResponsePanel";
import { SeverityBreakdown } from "@/components/metrics/SeverityBreakdown";
import { TriagePanel } from "@/components/metrics/TriagePanel";
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

const POLL_INTERVAL_MS = 3000;
const NEWEST_INCIDENTS_LIMIT = 5;

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

  const load = useCallback(async () => {
    const qs = `?range=${range}`;
    try {
      const [summary, timeseries, top, mitre, response, triage, pipeline, incidents] = await Promise.all([
        fetch(`/api/metrics/summary${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/timeseries${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/top${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/mitre${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/response${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/triage${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/pipeline`).then((r) => r.json()),
        fetch(`/api/incidents?limit=${NEWEST_INCIDENTS_LIMIT}`).then((r) => r.json()),
      ]);
      setData({ summary, timeseries, top, mitre, response, triage, pipeline, incidents });
      setLastUpdated(new Date());
      setError(null);
    } catch {
      setError("Could not reach the backend.");
    }
  }, [range]);

  useEffect(() => {
    setData(EMPTY_STATE); // show loading state immediately on range change, not stale data
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
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

      {rangeIsEmpty ? (
        <>
          <EmptyRangeState range={range} onSwitchToAll={() => setRange("all")} />
          <div className="mt-6">
            <PipelineHealthStrip data={data.pipeline} />
          </div>
        </>
      ) : (
        <>
          <NeedsAttention summary={data.summary} response={data.response} incidents={data.incidents} />

          <div className="mb-6 grid gap-3 lg:grid-cols-[1fr_auto]">
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
        </>
      )}
    </main>
  );
}
