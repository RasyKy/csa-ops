// Plain-language wording for cases. Pure and import-free.

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
};

const VERDICT_LABELS: Record<string, string> = {
  true_positive: "True positive",
  false_positive: "False positive",
  benign_activity: "Benign activity",
  undetermined: "Undetermined",
};

export const VERDICT_ORDER = ["true_positive", "false_positive", "benign_activity", "undetermined"] as const;

export const VERDICT_HELP: Record<string, string> = {
  true_positive: "A real attack or malicious activity.",
  false_positive: "The detection fired but nothing harmful happened.",
  benign_activity: "Real activity, but expected and harmless.",
  undetermined: "There is not enough evidence to decide.",
};

function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  return spaced === "" ? spaced : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function statusLabel(status: unknown): string {
  return typeof status === "string" ? (STATUS_LABELS[status] ?? humanize(status)) : "Unknown";
}

export function verdictLabel(verdict: unknown): string {
  return typeof verdict === "string" ? (VERDICT_LABELS[verdict] ?? humanize(verdict)) : "Unknown";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// One sentence per audit event. Never throws: anything unexpected becomes
// "<actor> updated this case".
export function eventSentence(event: unknown): string {
  const e = (typeof event === "object" && event !== null ? event : {}) as Record<string, unknown>;
  const actor = text(e.actor) ?? "Someone";
  const data = (typeof e.data === "object" && e.data !== null ? e.data : {}) as Record<string, unknown>;
  const fallback = `${actor} updated this case`;

  switch (e.type) {
    case "created":
      return "Case opened";
    case "status_changed": {
      const from = text(data.from);
      const to = text(data.to);
      return from && to
        ? `${actor} changed the status from ${statusLabel(from)} to ${statusLabel(to)}`
        : fallback;
    }
    case "assignee_changed": {
      const from = text(data.from);
      const to = text(data.to);
      if (to && from) return `${actor} reassigned this from ${from} to ${to}`;
      if (to) return `${actor} assigned this to ${to}`;
      if (from) return `${actor} unassigned this`;
      return fallback;
    }
    case "note_added":
      return `${actor} added a note`;
    case "resolved": {
      const verdict = text(data.verdict);
      return verdict ? `${actor} resolved this as ${verdictLabel(verdict).toLowerCase()}` : `${actor} resolved this`;
    }
    case "reopened":
      return `${actor} reopened this case`;
    default:
      return fallback;
  }
}
