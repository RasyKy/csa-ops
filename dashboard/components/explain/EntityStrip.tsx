import React from "react";
import { ShieldCheck } from "lucide-react";
import {
  Entity,
  isCheckedKind,
  matchesUngrounded,
  shortenPath,
} from "@/lib/explainEntities";

export interface EntityStripProps {
  entities: Entity[];
  ungrounded?: string[];
}

export function EntityStrip({ entities, ungrounded }: EntityStripProps) {
  if (!entities || entities.length === 0) return null;

  const N = entities.filter((e) => isCheckedKind(e.kind)).length;

  let verificationNode: React.ReactNode = null;
  if (Array.isArray(ungrounded) && ungrounded.length > 0) {
    verificationNode = (
      <span className="font-medium text-amber-600 dark:text-amber-400">
        {ungrounded.length} not found in incident data
      </span>
    );
  } else if (Array.isArray(ungrounded) && ungrounded.length === 0 && N > 0) {
    verificationNode = (
      <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>All {N} verified against incident data</span>
      </span>
    );
  }

  const visible = entities.slice(0, 10);
  const remaining = entities.length - visible.length;

  return (
    <div className="border-b border-line bg-surface-subtle px-4 py-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-subtle">Mentioned in this analysis</span>
        {verificationNode}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map((e, idx) => {
          const isUngrounded =
            isCheckedKind(e.kind) &&
            matchesUngrounded(e, ungrounded ?? []);
          const displayVal = e.kind === "path" ? shortenPath(e.value) : e.value;
          const title =
            e.kind === "path"
              ? e.value
              : isUngrounded
              ? "Not found in incident data"
              : undefined;

          return (
            <code
              key={idx}
              data-kind={e.kind}
              data-ungrounded={isUngrounded ? "true" : undefined}
              title={title}
              className={`rounded border px-1 font-mono text-[12px] leading-5 text-ink break-all ${
                isUngrounded
                  ? "border-dashed border-amber-500 dark:border-amber-400 bg-surface"
                  : "border-line-strong bg-surface"
              }`}
            >
              {displayVal}
            </code>
          );
        })}
        {remaining > 0 && (
          <span className="text-xs text-ink-subtle">+{remaining} more</span>
        )}
      </div>
    </div>
  );
}

