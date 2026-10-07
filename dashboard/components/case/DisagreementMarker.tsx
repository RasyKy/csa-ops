import { TriangleAlert } from "lucide-react";

import { Tooltip } from "@/components/ui/Tooltip";
import { disagrees } from "@/lib/caseJoin";

const TEXT = "Analyst disagrees with the AI";

// A small amber warning, only when the analyst's side differs from the AI's.
export function DisagreementMarker({
  aiVerdict,
  analystVerdict,
  tooltipAlign = "center",
}: {
  aiVerdict: string | null | undefined;
  analystVerdict: string | null | undefined;
  tooltipAlign?: "center" | "end";
}) {
  if (!disagrees(aiVerdict, analystVerdict)) return null;
  return (
    <Tooltip content={TEXT} side="bottom" align={tooltipAlign}>
      <span
        role="img"
        tabIndex={0}
        aria-label={TEXT}
        data-testid="disagreement-marker"
        className="inline-flex shrink-0 items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <TriangleAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
