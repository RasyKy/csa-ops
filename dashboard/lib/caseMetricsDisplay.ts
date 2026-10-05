// Wording for the case metrics on the Overview. Pure and import-free.
// Counts only: nothing here turns a handful of resolved incidents into a
// percentage, because small samples are illustrations, not statistics.

function whole(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

// "45 s", "12 min", "3 h 5 min", "2 d 4 h". Rounds to the nearest unit shown.
export function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 59.5) return `${Math.round(seconds)} s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }

  const totalHours = Math.round(seconds / 3600);
  const days = Math.floor(totalHours / 24);
  const rest = totalHours % 24;
  return rest === 0 ? `${days} d` : `${days} d ${rest} h`;
}

interface AgreementLike {
  resolved_total?: unknown;
  agree?: unknown;
  disagree?: unknown;
  ai_uncertain?: unknown;
  unscored?: unknown;
}

// "5 of 7 resolved incidents": the incidents where the AI and the analyst gave the
// same side, out of every resolved incident. Always counts, never a percentage.
export function agreementText(m: AgreementLike | null | undefined): string {
  const total = whole(m?.resolved_total);
  if (total === 0) return "No resolved incidents yet";
  return `${whole(m?.agree)} of ${total} resolved incident${total === 1 ? "" : "s"}`;
}

// The rest of the resolved incidents, for a muted second line, for example
// "1 disagree, 2 not scored, 1 uncertain". null when there is nothing to add.
export function agreementDetailText(m: AgreementLike | null | undefined): string | null {
  if (whole(m?.resolved_total) === 0) return null;
  const parts: string[] = [];
  const disagree = whole(m?.disagree);
  const unscored = whole(m?.unscored);
  const uncertain = whole(m?.ai_uncertain);
  if (disagree > 0) parts.push(`${disagree} disagree`);
  if (unscored > 0) parts.push(`${unscored} not scored`);
  if (uncertain > 0) parts.push(`${uncertain} uncertain`);
  return parts.length > 0 ? parts.join(", ") : null;
}

interface StatusCountsLike {
  open?: unknown;
  investigating?: unknown;
  resolved?: unknown;
}

// "3 open · 2 investigating · 3 resolved"
export function statusCountsText(counts: StatusCountsLike | null | undefined): string {
  return `${whole(counts?.open)} open · ${whole(counts?.investigating)} investigating · ${whole(counts?.resolved)} resolved`;
}

interface ResolveTimeLike {
  count?: unknown;
  median_seconds?: unknown;
}

// "Median time to resolve: 12 min (3 resolved)"; null when no case has been resolved.
export function medianResolveText(stats: ResolveTimeLike | null | undefined): string | null {
  const count = whole(stats?.count);
  const median = stats?.median_seconds;
  if (count === 0 || typeof median !== "number" || !Number.isFinite(median)) return null;
  return `Median time to resolve: ${formatDuration(median)} (${count} resolved)`;
}
