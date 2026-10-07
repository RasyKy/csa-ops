// Title and meta line of an incident in the Incidents list and the Overview.
// Pure and import-free; nothing here throws on odd input.

export interface AlertTitleInfo {
  title?: string | null;
  timestamp?: string | null;
}

export interface ListTitleIncident {
  matched_scenario?: string | null;
  alert_ids?: string[] | null;
  techniques?: string[] | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function humanize(scenario: string): string {
  const spaced = scenario.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function epoch(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

// 1. the humanized scenario; 2. the rule title of the earliest alert that has a
// title (ties and alerts without a time keep input order, timed alerts first);
// 3. "Technique <first id>"; 4. "Incident".
export function incidentListTitle(
  incident: ListTitleIncident | null | undefined,
  alertsById: Record<string, AlertTitleInfo> | null | undefined,
): string {
  try {
    const scenario = text(incident?.matched_scenario);
    if (scenario) return humanize(scenario);

    if (alertsById && typeof alertsById === "object" && Array.isArray(incident?.alert_ids)) {
      let best: { title: string; at: number | null } | null = null;
      for (const id of incident.alert_ids) {
        if (typeof id !== "string") continue;
        const alert = alertsById[id];
        const title = text(alert?.title);
        if (!title) continue;
        const at = epoch(alert?.timestamp);
        if (best === null || (at !== null && (best.at === null || at < best.at))) best = { title, at };
      }
      if (best) return best.title;
    }

    const technique = Array.isArray(incident?.techniques) ? text(incident.techniques[0]) : null;
    if (technique) return `Technique ${technique}`;
  } catch {
    // fall through to the generic title
  }
  return "Incident";
}

// "<host> · <user> · <n> alert" (plural for anything but 1). A missing part is left out.
export function incidentMeta(host: unknown, user: unknown, alertCount: unknown): string {
  const parts: string[] = [];
  const h = text(host);
  const u = text(user);
  if (h) parts.push(h);
  if (u) parts.push(u);
  if (typeof alertCount === "number" && Number.isFinite(alertCount) && alertCount >= 0) {
    const n = Math.floor(alertCount);
    parts.push(`${n} ${n === 1 ? "alert" : "alerts"}`);
  }
  return parts.join(" · ");
}
