"use client";

import { useCallback, useEffect, useState } from "react";

import { AlertsTimeseriesChart } from "@/components/metrics/AlertsTimeseriesChart";
import { DetectionQualityPanel } from "@/components/metrics/DetectionQualityPanel";
import { KpiCards } from "@/components/metrics/KpiCards";
import { MitreHeatmap } from "@/components/metrics/MitreHeatmap";
import { MttdMttrPanel } from "@/components/metrics/MttdMttrPanel";
import { PipelineHealthStrip } from "@/components/metrics/PipelineHealthStrip";
import { RangeSelector } from "@/components/metrics/RangeSelector";
import { ResponsePanel } from "@/components/metrics/ResponsePanel";
import { SeverityBreakdown } from "@/components/metrics/SeverityBreakdown";
import { TriagePanel } from "@/components/metrics/TriagePanel";
import type {
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

interface MetricsState {
  summary: MetricsSummary | null;
  timeseries: MetricsTimeseries | null;
  top: MetricsTop | null;
  mitre: MetricsMitre | null;
  response: MetricsResponse | null;
  triage: MetricsTriage | null;
  pipeline: MetricsPipeline | null;
}

const EMPTY_STATE: MetricsState = {
  summary: null,
  timeseries: null,
  top: null,
  mitre: null,
  response: null,
  triage: null,
  pipeline: null,
};

export default function OverviewPage() {
  const [range, setRange] = useState<MetricsRange>("7d");
  const [data, setData] = useState<MetricsState>(EMPTY_STATE);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = `?range=${range}`;
    try {
      const [summary, timeseries, top, mitre, response, triage, pipeline] = await Promise.all([
        fetch(`/api/metrics/summary${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/timeseries${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/top${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/mitre${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/response${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/triage${qs}`).then((r) => r.json()),
        fetch(`/api/metrics/pipeline`).then((r) => r.json()),
      ]);
      setData({ summary, timeseries, top, mitre, response, triage, pipeline });
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

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Overview</h1>
      <RangeSelector range={range} onRangeChange={setRange} lastUpdated={lastUpdated} />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <KpiCards summary={data.summary} />

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <AlertsTimeseriesChart data={data.timeseries} />
        <MitreHeatmap data={data.mitre} />
      </section>

      <section className="mt-6">
        <SeverityBreakdown timeseries={data.timeseries} top={data.top} />
      </section>

      <section className="mt-6">
        <MttdMttrPanel summary={data.summary} />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <ResponsePanel data={data.response} />
        <TriagePanel data={data.triage} />
      </section>

      <section className="mt-6">
        <DetectionQualityPanel top={data.top} />
      </section>

      <section className="mt-6">
        <PipelineHealthStrip data={data.pipeline} />
      </section>
    </main>
  );
}
