"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Time } from "@/components/ui/Time";

import { AnalystVerdict } from "./AnalystVerdict";
import { useCaseContext } from "./CaseProvider";
import { ResolveDialog } from "./ResolveDialog";
import { readActorName, saveActorName } from "./useCase";

const UNASSIGNED = "Unassigned";

function useAssignees(current: string | null): string[] {
  const [names, setNames] = useState<string[]>([UNASSIGNED]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cases/assignees", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("status"))))
      .then((list: unknown) => {
        if (cancelled || !Array.isArray(list)) return;
        const strings = list.filter((n): n is string => typeof n === "string");
        setNames([UNASSIGNED, ...strings.filter((n) => n !== UNASSIGNED)]);
      })
      .catch(() => {
        // keep the fallback list; the current assignee is added below
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return current && !names.includes(current) ? [...names, current] : names;
}

function RecordedAs() {
  const [name, setName] = useState("Analyst");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setName(readActorName());
  }, []);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function start() {
    setDraft(name);
    setEditing(true);
  }
  function save() {
    setName(saveActorName(draft));
    setEditing(false);
    requestAnimationFrame(() => changeRef.current?.focus());
  }
  function cancel() {
    setEditing(false);
    requestAnimationFrame(() => changeRef.current?.focus());
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="recorded-as">
        <input
          ref={inputRef}
          aria-label="Your name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Button type="button" size="sm" variant="primary" onClick={save}>
          Save
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={cancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <p className="text-xs text-ink-muted" data-testid="recorded-as">
      Recorded as <span className="font-medium text-ink" data-testid="recorded-as-name">{name}</span>{" "}
      <button
        ref={changeRef}
        type="button"
        onClick={start}
        className="rounded text-xs text-ink underline underline-offset-2 hover:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Change
      </button>
    </p>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3" data-testid="case-skeleton" aria-hidden="true">
      <div className="h-4 w-24 rounded bg-surface-subtle" />
      <div className="h-8 w-full rounded bg-surface-subtle" />
      <div className="h-8 w-40 rounded bg-surface-subtle" />
    </div>
  );
}

export function CaseCard() {
  const { caseData, loading, error, conflict, pending, reload, setAssignee, setStatus, resolve, reopen } =
    useCaseContext();
  const assignees = useAssignees(caseData?.assignee ?? null);
  const selectId = useId();
  const [resolveOpen, setResolveOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  function closeDialog() {
    setResolveOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  return (
    <Card data-testid="case-card">
      <CardHeader title="Case" />
      <CardBody>
        {loading && !caseData ? (
          <Skeleton />
        ) : (
          <div className="space-y-4">
            {error && (
              <div role="alert" data-testid="case-error">
                <Notice
                  icon={Info}
                  actions={
                    <Button size="sm" variant="secondary" onClick={() => void reload()} disabled={pending}>
                      Retry
                    </Button>
                  }
                >
                  {error}
                </Notice>
              </div>
            )}

            {conflict && (
              <div role="status" data-testid="case-conflict">
                <Notice tone="info" icon={Info}>
                  This case was changed by someone else. Showing the latest version.
                </Notice>
              </div>
            )}

            {caseData && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={caseData.status} data-testid="case-status" />
                  {caseData.status === "resolved" && caseData.verdict && (
                    <AnalystVerdict verdict={caseData.verdict} variant="pill" labelTestId="case-verdict" />
                  )}
                </div>

                {caseData.status === "resolved" && (
                  <div className="space-y-1 text-sm" data-testid="case-resolution">
                    {caseData.resolution_note && (
                      <p className="whitespace-pre-wrap break-words text-ink" data-testid="case-resolution-note">
                        {caseData.resolution_note}
                      </p>
                    )}
                    {caseData.resolved_time && (
                      <p className="text-xs text-ink-subtle">
                        Resolved <Time iso={caseData.resolved_time} />
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor={selectId} className="block text-xs text-ink-subtle">
                    Assignee
                  </label>
                  <select
                    id={selectId}
                    value={caseData.assignee ?? UNASSIGNED}
                    disabled={pending}
                    onChange={(e) => void setAssignee(e.target.value === UNASSIGNED ? null : e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    {assignees.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-2">
                  {caseData.status === "open" && (
                    <>
                      <Button variant="primary" disabled={pending} onClick={() => void setStatus("investigating")}>
                        Start investigating
                      </Button>
                      <button
                        ref={openerRef}
                        type="button"
                        disabled={pending}
                        onClick={() => setResolveOpen(true)}
                        className={buttonClasses({ variant: "secondary" })}
                      >
                        Resolve
                      </button>
                    </>
                  )}
                  {caseData.status === "investigating" && (
                    <>
                      <button
                        ref={openerRef}
                        type="button"
                        disabled={pending}
                        onClick={() => setResolveOpen(true)}
                        className={buttonClasses({ variant: "primary" })}
                      >
                        Resolve
                      </button>
                      <Button variant="secondary" disabled={pending} onClick={() => void setStatus("open")}>
                        Mark as open
                      </Button>
                    </>
                  )}
                  {caseData.status === "resolved" && (
                    <Button variant="secondary" disabled={pending} onClick={() => void reopen()}>
                      Reopen
                    </Button>
                  )}
                </div>
              </>
            )}

            <div className="space-y-2 border-t border-line pt-3">
              <RecordedAs />
              <p className="text-xs text-ink-subtle">
                Case changes are for analysts. They never change detections or response actions.
              </p>
            </div>
          </div>
        )}
      </CardBody>

      <ResolveDialog open={resolveOpen} pending={pending} onClose={closeDialog} onResolve={resolve} />
    </Card>
  );
}
