export type Severity = "low" | "medium" | "high" | "critical";

export interface Alert {
  alert_id: string;
  timestamp: string;
  rule_id: string;
  rule_title: string;
  technique: string;
  tactic: string;
  severity: Severity;
  host: string;
  user: string;
  event_id: string;
  pid: number;
  ppid: number;
  image: string;
  command_line: string | null;
  false_positive: boolean | null;
}

export interface ChainNode {
  event_id: string;
  pid: number;
  ppid: number;
  image: string;
  command_line: string | null;
  timestamp: string;
  technique: string | null;
  rule_id: string | null;
  event_type?: string | null;
  host?: string | null;
  detail?: string | null;
}

export type EdgeRelation = "parent" | "network" | "file" | "registry";

export interface ChainEdge {
  from: string;
  to: string;
  relation: EdgeRelation;
}

export interface Targets {
  pids: number[];
  remote_ips: string[];
  file_paths: string[];
}

export interface Incident {
  incident_id: string;
  incident_raised_time: string;
  host: string;
  user: string;
  severity: Severity;
  risk_score: number;
  matched_scenario: string | null;
  techniques: string[];
  tactics: string[];
  alert_ids: string[];
  chain: { nodes: ChainNode[]; edges: ChainEdge[] };
  targets: Targets;
}

export interface ResponseAction {
  action_id: string;
  incident_id: string;
  host: string;
  action: string;
  target: Record<string, unknown>;
  decided_by: Record<string, unknown>;
  mode: "dry_run" | "live";
  status: string;
  command_issued_time: string | null;
  agent_received_time: string | null;
  response_executed_time: string | null;
  result: string | null;
}

export interface Explain {
  summary: string;
  objective: string;
  notable_details: string[];
  next_steps: string[];
  caveats: string[];
  generated_time: string;
  // Optional: absent on explain docs cached before this field existed.
  ungrounded_mentions?: string[];
  // Computed by the backend on every read (engine/ai_explain/explain.py's
  // annotate_staleness), never persisted -- true when this explain was
  // generated under an older prompt version than the one currently
  // running (or predates version tracking entirely).
  is_stale?: boolean;
}

export interface IncidentTriage {
  incident_id: string;
  triage_time: string;
  verdict: string | null;
  confidence: string | null;
  reason: string | null;
  model: string;
  status: "ok" | "failed";
  explain: Explain | null;
}

export interface IncidentListItem extends Incident {
  triage_verdict: string | null;
  triage_status: "ok" | "failed" | null;
  last_response_action: ResponseAction | null;
}

export interface IncidentDetail extends Incident {
  triage: IncidentTriage | null;
  response_history: ResponseAction[];
}

export interface GraphNode {
  event_id: string;
  pid: number;
  ppid: number;
  image: string;
  technique: string | null;
  rule_id: string | null;
  rule_title: string | null;
  is_trigger: boolean;
  event_type?: string | null;
  host?: string | null;
  detail?: string | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: ChainEdge[];
}

// --- Metrics page ---

export type MetricStatus = "ok" | "no_data" | "pending_upstream";

export interface MetricValue<T> {
  value: T;
  status: MetricStatus;
}

export type MetricsRange = "24h" | "7d" | "30d" | "all";

export interface DurationStats {
  mean: number;
  median: number;
  p90: number;
  count: number;
}

export interface MetricsSummary {
  range: string;
  since: string | null;
  as_of: string;
  total_alerts: MetricValue<number>;
  total_incidents: MetricValue<number>;
  critical_incidents: MetricValue<number>;
  mttd: MetricValue<DurationStats | null>;
  mttd_by_scenario: MetricValue<Record<string, DurationStats>>;
  mttr: MetricValue<DurationStats | null>;
  mttr_by_scenario: MetricValue<Record<string, DurationStats>>;
  alert_to_incident_ratio: MetricValue<number | null>;
  response_actions_by_mode: MetricValue<Record<string, number>>;
}

export interface TimeseriesBucket {
  bucket: string;
  severity_counts: Record<string, number>;
}

export interface MetricsTimeseries {
  range: string;
  since: string | null;
  as_of: string;
  buckets: MetricValue<TimeseriesBucket[]>;
}

export interface TopTerm {
  key: string;
  count: number;
}

export interface RuleTerm extends TopTerm {
  title: string | null;
}

export interface FpRateEntry {
  fp_count: number;
  total: number;
  rate: number;
}

export interface MetricsTop {
  range: string;
  since: string | null;
  as_of: string;
  top_hosts: MetricValue<TopTerm[]>;
  top_rules: MetricValue<RuleTerm[]>;
  top_users: MetricValue<TopTerm[]>;
  fp_rate_by_rule: MetricValue<Record<string, FpRateEntry>>;
}

export interface MitreCell {
  technique: string;
  tactic: string | null;
  count: number;
  status: "fired" | "covered_not_fired";
}

export interface MetricsMitre {
  range: string;
  since: string | null;
  as_of: string;
  coverage_status: "ok" | "pending_upstream";
  techniques: MetricValue<MitreCell[]>;
}

export interface ActionStats {
  total: number;
  succeeded: number;
  rate: number | null;
}

export interface DryRunStats {
  total: number;
  by_status: Record<string, number>;
}

export interface MetricsResponse {
  range: string;
  since: string | null;
  as_of: string;
  by_action: MetricValue<Record<string, ActionStats>>;
  live: MetricValue<ActionStats>;
  dry_run: MetricValue<DryRunStats>;
  kill_switch: boolean;
  response_mode: string;
}

export interface TriageStats {
  verdict_counts: Record<string, number>;
  confidence_counts: Record<string, number>;
  failed_count: number;
  total_count: number;
  avg_confidence: number | null;
  avg_latency_seconds: number | null;
}

export interface MetricsTriage {
  range: string;
  since: string | null;
  as_of: string;
  stats: MetricValue<TriageStats | null>;
}

export interface IndexHealth {
  count: number;
  latest_timestamp: string | null;
}

export interface MetricsPipeline {
  range: string;
  since: string | null;
  as_of: string;
  sources: Record<string, MetricValue<IndexHealth | null>>;
}

// --- Analyst cases (mirrors backend/app/models/case.py) ---

export type CaseStatus = "open" | "investigating" | "resolved";

export type Verdict = "true_positive" | "false_positive" | "benign_activity" | "undetermined";

export type CaseEventType =
  | "created"
  | "status_changed"
  | "assignee_changed"
  | "note_added"
  | "resolved"
  | "reopened";

export interface CaseEvent {
  id: string;
  time: string;
  actor: string;
  type: CaseEventType;
  data: Record<string, unknown>;
}

export interface Case {
  incident_id: string;
  status: CaseStatus;
  assignee: string | null;
  verdict: Verdict | null;
  resolution_note: string | null;
  resolved_time: string | null;
  updated_time: string | null;
  events: CaseEvent[];
  version: number;
}

export interface CaseSummary {
  incident_id: string;
  status: CaseStatus;
  assignee: string | null;
  verdict: Verdict | null;
  updated_time: string | null;
  resolved_time: string | null;
  version: number;
}

// --- Case metrics (GET /metrics/cases; backend/metrics/case_metrics.py) ---

export interface CaseStatusCounts {
  open: number;
  investigating: number;
  resolved: number;
}

export interface AiAgreement {
  resolved_total: number;
  scored: number;
  agree: number;
  disagree: number;
  ai_uncertain: number;
  unscored: number;
  confusion: Record<string, number>;
}

export interface ResolveTimeStats {
  count: number;
  median_seconds: number | null;
  p90_seconds: number | null;
  values_seconds: number[] | null;
}

export interface VerdictCounts {
  true_positive: number;
  false_positive: number;
  benign_activity: number;
  undetermined: number;
  total: number;
}

export interface MetricsCases {
  range: string;
  since: string | null;
  as_of: string;
  status_counts: MetricValue<CaseStatusCounts>;
  ai_agreement: MetricValue<AiAgreement>;
  resolve_time: MetricValue<ResolveTimeStats>;
  verdicts_by_rule: MetricValue<Record<string, VerdictCounts>>;
}
