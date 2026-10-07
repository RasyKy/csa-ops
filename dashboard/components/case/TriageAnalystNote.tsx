"use client";

import { verdictLabel } from "@/lib/caseDisplay";
import { disagrees } from "@/lib/caseJoin";

import { AnalystVerdict } from "./AnalystVerdict";
import { useCaseContext } from "./CaseProvider";
import { DisagreementMarker } from "./DisagreementMarker";

// Under the AI triage footer: what the analyst concluded, and whether that
// differs from the AI's call. Nothing until the case is resolved, and nothing
// when the case data cannot be read. Plain text only; no control here.
export function TriageAnalystNote({ aiVerdict }: { aiVerdict: string | null | undefined }) {
  const { caseData } = useCaseContext();
  if (!caseData || caseData.status !== "resolved" || !caseData.verdict) return null;

  const differs = disagrees(aiVerdict, caseData.verdict);
  return (
    <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm text-ink-muted" data-testid="triage-analyst-note">
      <p className="flex flex-wrap items-center gap-1.5">
        <AnalystVerdict verdict={caseData.verdict} variant="line" />
        <span data-testid="triage-analyst-sentence">Analyst resolved this as {verdictLabel(caseData.verdict).toLowerCase()}.</span>
      </p>
      {differs && (
        <p className="flex items-center gap-1.5 text-ink" data-testid="triage-disagree-sentence">
          <DisagreementMarker aiVerdict={aiVerdict} analystVerdict={caseData.verdict} />
          <span>The analyst&apos;s verdict differs from the AI&apos;s.</span>
        </p>
      )}
    </div>
  );
}
