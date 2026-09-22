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
}

export interface Graph {
  nodes: GraphNode[];
  edges: ChainEdge[];
}
