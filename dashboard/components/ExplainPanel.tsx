"use client";

import React, { useState } from "react";
import { ChevronRight, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Time } from "@/components/ui/Time";
import { Tooltip } from "@/components/ui/Tooltip";
import { displayModel } from "@/lib/incidentDisplay";
import { tzLabel } from "@/lib/time";
import type { IncidentTriage } from "@/lib/types";

function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-ink hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle motion-safe:transition-transform group-open:rotate-90" />
        <span>{title}</span>
        {count !== undefined && (
          <span className="font-normal text-ink-subtle">{count}</span>
        )}
      </summary>
      <div className="px-4 pb-4 text-sm leading-6 text-ink">
        {children}
      </div>
    </details>
  );
}

function formatUngroundedItems(items: string[]): string {
  if (items.length <= 3) {
    return items.join(", ");
  }
  const firstThree = items.slice(0, 3).join(", ");
  const extra = items.length - 3;
  return `${firstThree} and ${extra} more`;
}

export function ExplainPanel({
  incidentId,
  triage: initialTriage,
  model: modelProp,
}: {
  incidentId: string;
  triage: IncidentTriage | null;
  model?: string;
}) {
  const [triage, setTriage] = useState(initialTriage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canExplain = triage !== null && triage.status === "ok";
  const explain = triage?.explain ?? null;
  const modelToShow = triage?.model ?? modelProp;

  const requestExplain = async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/explain/${incidentId}${force ? "?force=true" : ""}`, { method: "POST" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setTriage(await res.json());
    } catch {
      setError("Could not generate explanation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card aria-busy={loading ? "true" : undefined}>
      <CardHeader
        title="AI analysis"
        description="Advisory only. It never changes detections or response actions."
        actions={
          canExplain ? (
            <Button
              variant={explain ? "secondary" : "primary"}
              size="sm"
              disabled={loading}
              onClick={() => requestExplain(explain ? true : false)}
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                  {explain ? "Regenerating..." : "Analyzing..."}
                </>
              ) : explain ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Explain
                </>
              )}
            </Button>
          ) : null
        }
      />
      <CardBody flush>
        {/* Empty state body */}
        {canExplain && !explain && !loading && !error && (
          <p className="px-4 py-4 text-sm text-ink-muted">
            Get a plain-language summary, the likely objective, and suggested next steps for this incident.
          </p>
        )}
        {/* Loading skeleton (no explain yet) */}
        {canExplain && !explain && loading && (
          <div className="space-y-2 px-4 py-4">
            <div className="h-3 w-full rounded bg-surface-subtle motion-safe:animate-pulse" />
            <div className="h-3 w-[92%] rounded bg-surface-subtle motion-safe:animate-pulse" />
            <div className="h-3 w-[60%] rounded bg-surface-subtle motion-safe:animate-pulse" />
          </div>
        )}
        {/* Error */}
        {error && (
          <div className="p-4">
            <Notice
              tone="neutral"
              icon={TriangleAlert}
              actions={
                <Button variant="secondary" size="sm" onClick={() => requestExplain(explain ? true : false)}>
                  Try again
                </Button>
              }
            >
              {error}
            </Notice>
          </div>
        )}
        {/* Not canExplain */}
        {!canExplain && (
          <p className="px-4 py-4 text-sm text-ink-muted">
            {triage ? "Triage failed -- nothing to explain yet." : "No triage yet."}
          </p>
        )}
        {/* Explanation sections */}
        {explain && (
          <div className="divide-y divide-line">
            {/* Stale notice */}
            {explain.is_stale && (
              <div className="p-4">
                <Notice
                  tone="neutral"
                  icon={TriangleAlert}
                  iconClassName="text-amber-600 dark:text-amber-400"
                >
                  Generated with an older version of this analysis. Regenerate for up-to-date advice.
                </Notice>
              </div>
            )}
            {/* Ungrounded mentions */}
            {explain.ungrounded_mentions && explain.ungrounded_mentions.length > 0 && (
              <div className="p-4">
                <Notice
                  tone="neutral"
                  icon={TriangleAlert}
                  iconClassName="text-amber-600 dark:text-amber-400"
                >
                  <span title={explain.ungrounded_mentions.join(", ")}>
                    Not found in incident data: {formatUngroundedItems(explain.ungrounded_mentions)}
                  </span>
                </Notice>
              </div>
            )}
            <Section title="Summary" defaultOpen={true}>
              <p>{explain.summary}</p>
            </Section>
            <Section title="Likely objective" defaultOpen={true}>
              <p>{explain.objective}</p>
            </Section>
            {explain.notable_details.length > 0 && (
              <Section title="Notable details" count={explain.notable_details.length} defaultOpen={false}>
                <ul className="list-disc pl-5 marker:text-ink-subtle space-y-1.5">
                  {explain.notable_details.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </Section>
            )}
            {explain.next_steps.length > 0 && (
              <Section title="Next steps" count={explain.next_steps.length} defaultOpen={false}>
                <ol className="list-decimal pl-5 marker:text-ink-subtle space-y-1.5">
                  {explain.next_steps.map((item, i) => <li key={i}>{item}</li>)}
                </ol>
              </Section>
            )}
            {explain.caveats.length > 0 && (
              <Section title="Caveats" count={explain.caveats.length} defaultOpen={false}>
                <ul className="list-disc pl-5 marker:text-ink-subtle space-y-1.5">
                  {explain.caveats.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </Section>
            )}
            {/* Footer */}
            {(explain.generated_time || modelToShow) && (
              <div className="flex items-center gap-1 px-4 py-3 text-xs text-ink-subtle">
                <span>Generated</span>
                <Time iso={explain.generated_time} className="" />
                <span>{tzLabel()}</span>
                {modelToShow && (
                  <>
                    <span>·</span>
                    <Tooltip content={modelToShow}>
                      <span>{displayModel(modelToShow)}</span>
                    </Tooltip>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
