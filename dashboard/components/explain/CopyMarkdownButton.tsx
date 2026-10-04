"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toMarkdown } from "@/lib/explainEntities";
import { displayModel } from "@/lib/incidentDisplay";
import { formatUtc } from "@/lib/time";
import type { Explain } from "@/lib/types";

export interface CopyMarkdownButtonProps {
  incidentId: string;
  explain: Explain;
  model?: string;
}

export function CopyMarkdownButton({
  incidentId,
  explain,
  model,
}: CopyMarkdownButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const md = toMarkdown({
        incidentId,
        generatedUtc: formatUtc(explain.generated_time),
        modelLabel: displayModel(model),
        summary: explain.summary,
        objective: explain.objective,
        nextSteps: explain.next_steps,
        notableDetails: explain.notable_details,
        caveats: explain.caveats,
      });
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // silent failure
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="text-xs text-ink-muted hover:text-ink"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      <span>{copied ? "Copied" : "Copy as markdown"}</span>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}

