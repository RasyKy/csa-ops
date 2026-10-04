import React from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Time } from "@/components/ui/Time";
import { describeResponseAction, describeResponseDetail } from "@/lib/responseText";
import type { ResponseAction } from "@/lib/types";

export function ResponseHistoryPanel({ history }: { history: ResponseAction[] }) {
  return (
    <Card>
      <CardHeader title="Response history" />
      {history.length === 0 ? (
        <CardBody>
          <p className="text-sm text-ink-subtle">No response actions yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line">
          {history.map((a) => (
            <li
              key={a.action_id}
              className="flex items-start justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0 w-full">
                <p className="text-sm text-ink">{describeResponseAction(a)}</p>
                {describeResponseDetail(a) && (
                  <p
                    className="mt-0.5 break-words font-mono text-xs text-ink-muted"
                    data-testid="response-detail"
                  >
                    {describeResponseDetail(a)}
                  </p>
                )}
                {a.command_issued_time && (
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    <Time iso={a.command_issued_time} />
                  </p>
                )}
              </div>
              {a.mode === "live" && (
                <div className="shrink-0">
                  <Badge tone="danger">Live</Badge>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

