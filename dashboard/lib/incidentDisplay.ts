export function humanizeScenario(scenario: string | null | undefined): string {
  if (!scenario || typeof scenario !== "string" || !scenario.trim()) {
    return "Incident";
  }
  const cleaned = scenario.replace(/_/g, " ").trim();
  if (!cleaned) return "Incident";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export interface TitleNode {
  rule_title?: string | null;
  is_trigger?: boolean;
  timestamp?: string | null;
}

// Title of the earliest detection hit (trigger node with a rule title).
// Nodes without a timestamp sort after those with one; ties keep input order.
function firstTriggerTitle(nodes: TitleNode[] | undefined): string | null {
  if (!nodes) return null;
  let best: TitleNode | null = null;
  for (const node of nodes) {
    if (!node.is_trigger || !node.rule_title || !node.rule_title.trim()) continue;
    if (best === null) {
      best = node;
    } else if (node.timestamp && (!best.timestamp || node.timestamp < best.timestamp)) {
      best = node;
    }
  }
  return best ? (best.rule_title as string).trim() : null;
}

export function incidentTitle(
  incident: {
    matched_scenario?: string | null;
    host?: string | null;
  },
  nodes?: TitleNode[],
): string {
  const hasScenario = typeof incident.matched_scenario === "string" && incident.matched_scenario.trim() !== "";
  const scenario = hasScenario ? humanizeScenario(incident.matched_scenario) : (firstTriggerTitle(nodes) ?? humanizeScenario(null));
  if (incident.host && incident.host.trim()) {
    return `${scenario} on ${incident.host.trim()}`;
  }
  return scenario;
}

export function humanizeTactic(tactic: string | null | undefined): string {
  if (!tactic || typeof tactic !== "string" || !tactic.trim()) {
    return "";
  }
  const cleaned = tactic.replace(/_/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function displayModel(model: string | null | undefined): string {
  if (!model || typeof model !== "string") {
    return "";
  }
  const slashIdx = model.lastIndexOf("/");
  return slashIdx >= 0 ? model.slice(slashIdx + 1) : model;
}

