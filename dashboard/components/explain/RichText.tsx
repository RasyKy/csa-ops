import React from "react";
import {
  EntityKind,
  isCheckedKind,
  matchesUngrounded,
  tokenize,
} from "@/lib/explainEntities";
import { formatDateTime, tzLabel } from "@/lib/time";

export interface RichTextProps {
  text: string;
  ungrounded?: string[];
}

export function RichText({ text, ungrounded }: RichTextProps) {
  if (!text) return null;

  const tokens = tokenize(text, {
    formatTimestamp: (iso) => `${formatDateTime(iso)} ${tzLabel()}`,
  });

  return (
    <>
      {tokens.map((tok, idx) => {
        if (tok.kind === "text") {
          return tok.text;
        }

        if (tok.kind === "timestamp") {
          const iso = tok.value ?? tok.text;
          return (
            <time key={idx} dateTime={iso} title={iso}>
              {tok.display ?? tok.text}
            </time>
          );
        }

        const kind = tok.kind as EntityKind;
        const val = tok.value ?? tok.text;
        const isUngrounded =
          isCheckedKind(kind) &&
          matchesUngrounded({ kind, value: val }, ungrounded ?? []);

        return (
          <code
            key={idx}
            data-kind={kind}
            data-ungrounded={isUngrounded ? "true" : undefined}
            title={isUngrounded ? "Not found in incident data" : undefined}
            className={`rounded border px-1 font-mono text-[12px] leading-5 text-ink break-all ${
              isUngrounded
                ? "border-dashed border-amber-500 dark:border-amber-400 bg-surface-subtle"
                : "border-line-strong bg-surface-subtle"
            }`}
          >
            {tok.text}
          </code>
        );
      })}
    </>
  );
}

