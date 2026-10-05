import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { AttackChainCard } from "@/components/chain/AttackChainCard";
import { EventTimeline } from "@/components/EventTimeline";
import { ExplainPanel } from "@/components/ExplainPanel";
import { ExportReportDropdown } from "@/components/ExportReportDropdown";
import { ResponseHistoryPanel } from "@/components/ResponseHistoryPanel";
import { SeverityBadge } from "@/components/SeverityBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { TriagePanel } from "@/components/TriagePanel";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { PropertyBar } from "@/components/ui/PropertyBar";
import { Time } from "@/components/ui/Time";
import { Tooltip } from "@/components/ui/Tooltip";
import { backendFetch } from "@/lib/api";
import {
  incidentTitle,
  humanizeScenario,
  humanizeTactic,
} from "@/lib/incidentDisplay";
import { deriveIncidentStatus } from "@/lib/incidents";
import { tzLabel } from "@/lib/time";
import type { Graph, IncidentDetail } from "@/lib/types";

export const maxDuration = 60;

// Server component: fetches FastAPI directly on the server. The dashboard
// API key never reaches the browser this way -- see lib/api.ts.
async function getIncident(id: string): Promise<IncidentDetail | null> {
  const res = await backendFetch(`/incidents/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

async function getGraph(id: string): Promise<Graph> {
  const res = await backendFetch(`/incidents/${id}/graph`);
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

export default async function IncidentPage({ params }: { params: { id: string } }) {
  const [incident, graph] = await Promise.all([getIncident(params.id), getGraph(params.id)]);
  if (!incident) notFound();

  const status = deriveIncidentStatus(incident.response_history ?? []);

  // Graph nodes carry rule_title and is_trigger but no timestamp; the chain
  // nodes carry the timestamp. Join them so the title can use the earliest hit.
  const chainTimes = new Map(incident.chain.nodes.map((n) => [n.event_id, n.timestamp ?? null]));
  const titleNodes = graph.nodes.map((n) => ({
    rule_title: n.rule_title,
    is_trigger: n.is_trigger,
    timestamp: chainTimes.get(n.event_id) ?? null,
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      {/* Top back link & export report */}
      <div className="flex items-center justify-between gap-4">
        <a
          href="/incidents"
          className="inline-flex items-center gap-1 text-sm text-ink-subtle hover:text-ink transition-colors"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span>Incidents</span>
        </a>
        <ExportReportDropdown incidentId={incident.incident_id} />
      </div>

      {/* Title row */}
      <div className="mt-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold text-ink">
          {incidentTitle(incident, titleNodes)}
        </h1>
        <span className="text-sm font-mono text-ink-subtle">
          {incident.incident_id}
        </span>
      </div>

      {/* Property bar: Severity, Status, Host, User, Raised only */}
      <div className="mt-4 pb-4 border-b border-line">
        <PropertyBar
          items={[
            {
              label: "Severity",
              value: <SeverityBadge severity={incident.severity} />,
            },
            {
              label: "Status",
              value: (
                <Tooltip content="Derived from the latest response action. Case status isn't tracked yet.">
                  <span tabIndex={0} className="inline-flex cursor-help">
                    <StatusBadge status={status} />
                  </span>
                </Tooltip>
              ),
            },
            {
              label: "Host",
              value: incident.host,
            },
            {
              label: "User",
              value: incident.user,
            },
            {
              label: "Raised",
              value: (
                <span>
                  <Time iso={incident.incident_raised_time} />
                  <span className="ml-1 text-xs text-ink-subtle">{tzLabel()}</span>
                </span>
              ),
            },
          ]}
        />
      </div>

      {/* Two-column grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        {/* Left column */}
        <div className="space-y-6 min-w-0">
          <TriagePanel triage={incident.triage} />

          <AttackChainCard graph={graph} chainNodes={incident.chain.nodes} />

          <Card>
            <CardHeader title="Event timeline" />
            <CardBody flush>
              <EventTimeline nodes={incident.chain.nodes} />
            </CardBody>
          </Card>

          <ExplainPanel incidentId={incident.incident_id} triage={incident.triage} model={incident.triage?.model} />
        </div>

        {/* Right rail: sticky with max-height and overflow scroll */}
        <div className="space-y-6 min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          {/* 1. Details: Scenario, Alerts, Risk score, Tactics, Techniques only */}
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <KeyValueList
                items={[
                  {
                    label: "Scenario",
                    value: humanizeScenario(incident.matched_scenario),
                  },
                  {
                    label: "Alerts",
                    value: incident.alert_ids?.length ?? 0,
                  },
                  {
                    label: "Risk score",
                    value: incident.risk_score ?? "—",
                  },
                  {
                    label: "Tactics",
                    value:
                      incident.tactics && incident.tactics.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {incident.tactics.map((tactic) => (
                            <Badge key={tactic} tone="neutral">
                              {humanizeTactic(tactic)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-ink-subtle">None</span>
                      ),
                  },
                  {
                    label: "Techniques",
                    value:
                      incident.techniques && incident.techniques.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {incident.techniques.map((tech) => (
                            <Badge key={tech} tone="neutral" className="font-mono">
                              {tech}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-ink-subtle">None</span>
                      ),
                  },
                ]}
              />
            </CardBody>
          </Card>

          {/* 2. Indicators */}
          <Card>
            <CardHeader title="Indicators" />
            <CardBody>
              <KeyValueList
                items={[
                  {
                    label: "Process IDs",
                    value:
                      incident.targets?.pids && incident.targets.pids.length > 0 ? (
                        <div className="space-y-0.5 font-mono text-xs break-all text-ink">
                          {incident.targets.pids.map((pid, idx) => (
                            <div key={idx}>{pid}</div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-subtle">None</span>
                      ),
                  },
                  {
                    label: "Remote IPs",
                    value:
                      incident.targets?.remote_ips && incident.targets.remote_ips.length > 0 ? (
                        <div className="space-y-0.5 font-mono text-xs break-all text-ink">
                          {incident.targets.remote_ips.map((ip, idx) => (
                            <div key={idx}>{ip}</div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-subtle">None</span>
                      ),
                  },
                  {
                    label: "File paths",
                    value:
                      incident.targets?.file_paths && incident.targets.file_paths.length > 0 ? (
                        <div className="space-y-0.5 font-mono text-xs break-all text-ink">
                          {incident.targets.file_paths.map((path, idx) => (
                            <div key={idx}>{path}</div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-subtle">None</span>
                      ),
                  },
                ]}
              />
            </CardBody>
          </Card>

          {/* 3. Response history */}
          <ResponseHistoryPanel history={incident.response_history ?? []} />
        </div>
      </div>
    </main>
  );
}

