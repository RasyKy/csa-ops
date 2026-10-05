"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // silent failure
    }
  };

  return (
    <button
      type="button"
      aria-label="Copy command line"
      onClick={handleCopy}
      className={buttonClasses({
        variant: "ghost",
        size: "icon",
        className:
          "absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100",
      })}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      <span
        aria-live="polite"
        className="sr-only"
      >
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
