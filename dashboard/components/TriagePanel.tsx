import React from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { TriageBadge } from "@/components/TriageBadge";
import { TriageAnalystNote } from "@/components/case/TriageAnalystNote";
import { Notice } from "@/components/ui/Notice";
import { Time } from "@/components/ui/Time";
import { Tooltip } from "@/components/ui/Tooltip";
import { displayModel } from "@/lib/incidentDisplay";
import { tzLabel } from "@/lib/time";
import type { IncidentTriage } from "@/lib/types";

export function TriagePanel({ triage }: { triage: IncidentTriage | null }) {
  const confidenceText = triage?.confidence
    ? `${triage.confidence.charAt(0).toUpperCase() + triage.confidence.slice(1).toLowerCase()} confidence`
    : null;

  return (
    <Card>
      <CardHeader
        title="AI triage"
        actions={
          triage ? (
            <TriageBadge verdict={triage.verdict} status={triage.status} />
          ) : null
        }
      />
      <CardBody>
        {!triage && <p className="text-sm text-ink-subtle">No triage result yet.</p>}

        {triage?.status === "failed" && (
          <Notice tone="neutral">
            Triage failed (model unreachable or output invalid). Response actions were not affected.
          </Notice>
        )}

        {triage?.status === "ok" && (
          <div className="space-y-3">
            {confidenceText && (
              <p className="text-sm text-ink-muted">{confidenceText}</p>
            )}

            {triage.reason && (
              <p className="text-sm leading-6 text-ink">{triage.reason}</p>
            )}

            <div className="text-xs text-ink-subtle">
              Model{" "}
              <Tooltip content={triage.model}>
                <span
                  tabIndex={0}
                  className="cursor-help underline decoration-dotted text-ink"
                >
                  {displayModel(triage.model)}
                </span>
              </Tooltip>{" "}
              · Triaged <Time iso={triage.triage_time} />{" "}
              <span>{tzLabel()}</span>
            </div>
          </div>
        )}

        <TriageAnalystNote aiVerdict={triage?.status === "ok" ? triage.verdict : null} />
      </CardBody>
    </Card>
  );
}

