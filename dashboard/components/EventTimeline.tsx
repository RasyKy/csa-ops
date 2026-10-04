import { ShieldAlert } from "lucide-react";

import { CopyButton } from "@/components/ui/CopyButton";
import { formatTime, formatUtc } from "@/lib/time";
import type { ChainNode } from "@/lib/types";

function basename(path: string): string {
  return path.split("\\").pop()?.split("/").pop() ?? path;
}

const CHIP_CLASSES =
  "inline-flex h-5 items-center gap-1 rounded-full border border-line-strong bg-surface px-2 font-mono text-xs text-ink";

const TIMELINE_EVENT_LABELS: Record<string, string> = {
  network_connection: "Network connection",
  file_event: "File write",
  registry_event: "Registry write",
  process_access: "Process access",
};

function getUnavailableText(node: ChainNode): string {
  if (node.event_type && node.event_type !== "process_start") {
    const label = TIMELINE_EVENT_LABELS[node.event_type] ?? node.event_type;
    return node.detail ? `${label}: ${node.detail}` : label;
  }
  return "Command line unavailable";
}

// The chain's raw event sequence, chronological -- a complement to the
// attack-chain graph (which shows structure/relations) rather than a
// replacement for it. command_line is nullable (docs/interfaces.md
// section 1a: the real ingestion pipeline doesn't populate it yet), shown
// as a plain note instead of blank space when absent.
export function EventTimeline({ nodes }: { nodes: ChainNode[] }) {
  const sorted = [...nodes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (sorted.length === 0) {
    return <p className="px-4 py-3 text-sm text-ink-muted">No events in this chain.</p>;
  }

  return (
    <ul data-testid="event-timeline" className="divide-y divide-line">
      {sorted.map((node) => (
        <li key={node.event_id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-4 px-4 py-3">
          {/* Time cell */}
          <time
            dateTime={node.timestamp}
            title={formatUtc(node.timestamp)}
            className="self-start font-mono text-xs leading-5 tabular-nums text-ink-subtle"
          >
            {formatTime(node.timestamp)}
          </time>

          {/* Content cell */}
          <div className="min-w-0">
            {/* Line 1 */}
            <div className="flex flex-wrap items-center gap-2 leading-5">
              <span
                className="font-mono text-[13px] font-medium text-ink"
                title={node.image}
              >
                {basename(node.image)}
              </span>
              <span className="text-xs text-ink-subtle">pid {node.pid}</span>
              {node.technique && (
                <span className={CHIP_CLASSES}>
                  {node.rule_id && <ShieldAlert className="h-3 w-3 text-red-500 dark:text-red-400" />}
                  {node.technique}
                </span>
              )}
            </div>
            {/* Line 2 */}
            {node.command_line ? (
              <div className="relative mt-1.5 group">
                <code className="block rounded-md border border-line bg-surface-subtle py-1.5 pl-2.5 pr-9 font-mono text-xs leading-5 text-ink-muted whitespace-pre-wrap break-all max-h-40 overflow-auto">
                  {node.command_line}
                </code>
                <CopyButton text={node.command_line} />
              </div>
            ) : (
              <p className="text-xs text-ink-subtle mt-0.5">{getUnavailableText(node)}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
