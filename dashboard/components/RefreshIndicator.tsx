"use client";

import { useEffect, useReducer } from "react";

import { formatTime, tzLabel } from "@/lib/time";

const DEFAULT_POLL_MS = 3000;

// A quiet note about the data on screen: "Refreshing" while cached data is being
// revalidated, and a failure note when a refresh could not be done and the data is
// older than two poll intervals. The slot keeps its height whether or not it has
// text, so showing and hiding it never moves the page.
export function RefreshIndicator({
  refreshing,
  fetchedAt,
  failed,
  pollMs = DEFAULT_POLL_MS,
  className = "",
}: {
  refreshing: boolean;
  fetchedAt: number | null;
  failed: boolean;
  pollMs?: number;
  className?: string;
}) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const staleAfter = pollMs * 2;
  const showFailure = failed && fetchedAt !== null && Date.now() - fetchedAt > staleAfter;

  // re-check when the data crosses the two-interval line, even if nothing else renders
  useEffect(() => {
    if (!failed || fetchedAt === null) return;
    const wait = fetchedAt + staleAfter - Date.now();
    if (wait <= 0) return;
    const id = setTimeout(tick, wait + 25);
    return () => clearTimeout(id);
  }, [failed, fetchedAt, staleAfter]);

  let text = "";
  if (showFailure && fetchedAt !== null) {
    text = `Couldn't refresh. Showing data from ${formatTime(new Date(fetchedAt).toISOString())} ${tzLabel()}.`;
  } else if (refreshing) {
    text = "Refreshing";
  }

  return (
    <span
      // a live region from the start, so the note is announced when it appears; it is a
      // status only while it has something to say (an empty one is not another status on the page)
      aria-live="polite"
      role={text ? "status" : undefined}
      data-testid="refresh-indicator"
      title={text || undefined}
      className={`block h-4 min-w-0 truncate text-xs leading-4 text-ink-muted ${className}`.trim()}
    >
      {text}
    </span>
  );
}
