"use client";

import { useId, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/ui/Card";
import { Time } from "@/components/ui/Time";
import { eventSentence } from "@/lib/caseDisplay";
import type { CaseEvent } from "@/lib/types";

import { useCaseContext } from "./CaseProvider";
import { NoteBox } from "./NoteBox";

const VISIBLE_WHEN_COLLAPSED = 6;

// Case text is always rendered as plain text by React, never as HTML.
function noteText(event: CaseEvent): string | null {
  const data = event.data ?? {};
  const value = event.type === "note_added" ? data.text : event.type === "resolved" ? data.note : null;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function CaseActivity() {
  const { caseData, loading, error } = useCaseContext();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const events = useMemo(() => [...(caseData?.events ?? [])].reverse(), [caseData?.events]);
  const shown = expanded ? events : events.slice(0, VISIBLE_WHEN_COLLAPSED);
  const hiddenCount = events.length - shown.length;

  return (
    <Card data-testid="case-activity">
      <CardHeader
        title="Case activity"
        actions={
          <span className="text-xs text-ink-subtle" data-testid="case-activity-count">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
        }
      />
      <NoteBox />

      {events.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-muted" data-testid="case-activity-empty">
          {loading && !caseData
            ? "Loading activity..."
            : !caseData && error
              ? "Case activity is unavailable right now."
              : "No activity yet. Notes and status changes appear here."}
        </p>
      ) : (
        <>
          <ol id={listId} aria-label="Case events" className="divide-y divide-line">
            {shown.map((event) => {
              const body = noteText(event);
              return (
                <li key={event.id} className="flex items-start gap-3 px-4 py-3" data-testid="case-event" data-type={event.type}>
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-subtle" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink" data-testid="case-event-sentence">
                      {eventSentence(event)}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      <Time iso={event.time} />
                    </p>
                    {body && (
                      <div
                        className="mt-2 whitespace-pre-wrap break-words rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink"
                        data-testid="case-event-note"
                      >
                        {body}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {events.length > VISIBLE_WHEN_COLLAPSED && (
            <div className="border-t border-line px-4 py-2">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((v) => !v)}
                className="rounded text-sm text-ink underline underline-offset-2 hover:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {expanded ? "Show fewer events" : `Show all ${events.length} events`}
              </button>
              {!expanded && hiddenCount > 0 && <span className="sr-only">{hiddenCount} more events hidden</span>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
