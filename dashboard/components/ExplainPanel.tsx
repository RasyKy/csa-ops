"use client";

import React, { useId, useMemo, useState } from "react";
import {
  ChevronRight,
  FileText,
  List,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { CopyMarkdownButton } from "@/components/explain/CopyMarkdownButton";
import { EntityStrip } from "@/components/explain/EntityStrip";
import { RichText } from "@/components/explain/RichText";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Time } from "@/components/ui/Time";
import { Tooltip } from "@/components/ui/Tooltip";
import { entitiesOf } from "@/lib/explainEntities";
import { displayModel } from "@/lib/incidentDisplay";
import { tzLabel } from "@/lib/time";
import type { IncidentTriage } from "@/lib/types";

function Section({
  title,
  icon: Icon,
  iconClassName,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-ink hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle motion-safe:transition-transform group-open:rotate-90" />
        {Icon && (
          <Icon className={`h-4 w-4 shrink-0 ${iconClassName ?? "text-ink-subtle"}`} />
        )}
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

function ExpandableList({
  items,
  limit,
  ordered = false,
  ungrounded,
  id,
}: {
  items: string[];
  limit: number;
  ordered?: boolean;
  ungrounded?: string[];
  id: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  const ListTag = ordered ? "ol" : "ul";
  const listClass = ordered
    ? "list-decimal pl-5 marker:text-ink-subtle space-y-1.5"
    : "list-disc pl-5 marker:text-ink-subtle space-y-1.5";

  return (
    <div>
      <ListTag id={id} className={listClass}>
        {visible.map((item, idx) => (
          <li key={idx} className="text-sm leading-6 text-ink">
            <RichText text={item} ungrounded={ungrounded} />
          </li>
        ))}
      </ListTag>
      {items.length > limit && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-2 text-xs text-ink-muted hover:text-ink hover:underline"
        >
          {expanded ? "Show fewer" : `Show ${items.length - limit} more`}
        </button>
      )}
    </div>
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

  const nextStepsId = useId();
  const notableDetailsId = useId();
  const caveatsId = useId();

  const canExplain = triage !== null && triage.status === "ok";
  const explain = triage?.explain ?? null;
  const modelToShow = triage?.model ?? modelProp;

  const entities = useMemo(() => {
    if (!explain) return [];
    return entitiesOf([
      explain.summary,
      explain.objective,
      ...(explain.next_steps || []),
      ...(explain.notable_details || []),
      ...(explain.caveats || []),
    ]);
  }, [explain]);

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
            {/* Entity strip */}
            {entities.length > 0 && (
              <EntityStrip
                entities={entities}
                ungrounded={explain.ungrounded_mentions}
              />
            )}
            {/* Sections */}
            <div className="divide-y divide-line">
              <Section title="Summary" icon={FileText} defaultOpen={true}>
                <div className="max-w-[68ch]">
                  <p className="text-sm leading-7 text-ink">
                    <RichText
                      text={explain.summary}
                      ungrounded={explain.ungrounded_mentions}
                    />
                  </p>
                  {explain.objective && explain.objective.trim() ? (
                    <p className="mt-2 text-sm leading-6 text-ink-muted">
                      <span className="font-medium text-ink">Likely objective: </span>
                      <RichText
                        text={explain.objective}
                        ungrounded={explain.ungrounded_mentions}
                      />
                    </p>
                  ) : null}
                </div>
              </Section>
              {explain.next_steps.length > 0 && (
                <Section
                  title="Next steps"
                  icon={ListChecks}
                  count={explain.next_steps.length}
                  defaultOpen={true}
                >
                  <div className="max-w-[68ch]">
                    <ExpandableList
                      id={nextStepsId}
                      items={explain.next_steps}
                      limit={4}
                      ordered={true}
                      ungrounded={explain.ungrounded_mentions}
                    />
                  </div>
                </Section>
              )}
              {explain.notable_details.length > 0 && (
                <Section
                  title="Notable details"
                  icon={List}
                  count={explain.notable_details.length}
                  defaultOpen={true}
                >
                  <div className="max-w-[68ch]">
                    <ExpandableList
                      id={notableDetailsId}
                      items={explain.notable_details}
                      limit={3}
                      ordered={false}
                      ungrounded={explain.ungrounded_mentions}
                    />
                  </div>
                </Section>
              )}
              {explain.caveats.length > 0 && (
                <Section
                  title="Caveats"
                  icon={TriangleAlert}
                  iconClassName="text-amber-600 dark:text-amber-400"
                  count={explain.caveats.length}
                  defaultOpen={true}
                >
                  <div className="max-w-[68ch]">
                    <ExpandableList
                      id={caveatsId}
                      items={explain.caveats}
                      limit={2}
                      ordered={false}
                      ungrounded={explain.ungrounded_mentions}
                    />
                  </div>
                </Section>
              )}
            </div>
            {/* Footer */}
            {(explain.generated_time || modelToShow) && (
              <div className="flex items-center justify-between px-4 py-3 text-xs text-ink-subtle">
                <div className="flex items-center gap-1">
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
                <CopyMarkdownButton
                  incidentId={incidentId}
                  explain={explain}
                  model={modelToShow}
                />
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

