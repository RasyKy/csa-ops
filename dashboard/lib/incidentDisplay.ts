export function humanizeScenario(scenario: string | null | undefined): string {
  if (!scenario || typeof scenario !== "string" || !scenario.trim()) {
    return "Incident";
  }
  const cleaned = scenario.replace(/_/g, " ").trim();
  if (!cleaned) return "Incident";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function incidentTitle(incident: {
  matched_scenario?: string | null;
  host?: string | null;
}): string {
  const scenario = humanizeScenario(incident.matched_scenario);
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

