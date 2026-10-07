"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { VERDICT_HELP, VERDICT_ORDER, verdictLabel } from "@/lib/caseDisplay";
import type { Verdict } from "@/lib/types";

import type { MutationResult } from "./useCase";

const NOTE_MAX = 1000;
const NOTE_HELP = "Why did you reach this verdict? It appears in the case activity and in the incident report.";
const NOTE_HINT = "Saying why helps tune the detection rule.";

export function ResolveDialog({
  open,
  pending,
  onClose,
  onResolve,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onResolve: (verdict: Verdict, note: string) => Promise<MutationResult>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const uid = useId();
  // A verdict that says the detection fired for nothing is the useful case to explain.
  const showHint = verdict === "false_positive" || verdict === "benign_activity";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setVerdict(null);
      setNote("");
      setError("");
      dialog.showModal();
    } else if (!open) {
      if (dialog.open) dialog.close();
      // Nothing typed in the dialog outlives it.
      setVerdict(null);
      setNote("");
      setError("");
    }
  }, [open]);

  async function submit() {
    if (!verdict || pending) return;
    setError("");
    const result = await onResolve(verdict, note);
    if (result.ok || result.status === 409) {
      onClose();
      return;
    }
    setError(result.message ?? "The case could not be resolved.");
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${uid}-title`}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === dialogRef.current && !pending) onClose();
      }}
      className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-ink backdrop:opacity-40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="p-5"
      >
        <h2 id={`${uid}-title`} className="text-base font-semibold text-ink">
          Resolve case
        </h2>

        <div role="radiogroup" aria-label="Verdict" className="mt-4 space-y-3">
          {VERDICT_ORDER.map((value) => (
            <div key={value} className="flex items-start gap-2.5">
              <input
                type="radio"
                id={`${uid}-${value}`}
                name="verdict"
                value={value}
                checked={verdict === value}
                onChange={() => setVerdict(value)}
                disabled={pending}
                aria-describedby={`${uid}-${value}-help`}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <div className="min-w-0">
                <label htmlFor={`${uid}-${value}`} className="text-sm font-medium text-ink">
                  {verdictLabel(value)}
                </label>
                <p id={`${uid}-${value}-help`} className="text-xs text-ink-subtle">
                  {VERDICT_HELP[value]}
                </p>
              </div>
            </div>
          ))}
        </div>

        <label htmlFor={`${uid}-note`} className="mt-4 block text-sm font-medium text-ink">
          Resolution note <span className="font-normal text-ink-subtle">(optional)</span>
        </label>
        <textarea
          id={`${uid}-note`}
          aria-describedby={`${uid}-note-help${showHint ? ` ${uid}-note-hint` : ""}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX}
          rows={3}
          disabled={pending}
          className="mt-1 w-full resize-y rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="mt-1 flex items-start justify-between gap-3">
          <p id={`${uid}-note-help`} className="text-xs text-ink-subtle" data-testid="resolve-note-help">
            {NOTE_HELP}
          </p>
          <p className="shrink-0 text-right text-xs text-ink-subtle" aria-live="off">
            {note.length} / {NOTE_MAX}
          </p>
        </div>
        {showHint && (
          <p id={`${uid}-note-hint`} className="mt-1 text-xs text-ink-subtle" data-testid="resolve-note-hint">
            {NOTE_HINT}
          </p>
        )}

        <p role="alert" className="mt-2 min-h-[1.25rem] text-sm text-red-600 dark:text-red-400">
          {error}
        </p>

        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!verdict || pending}>
            Resolve case
          </Button>
        </div>
      </form>
    </dialog>
  );
}
