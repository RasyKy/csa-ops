import type { ChainNode } from "@/lib/types";

function basename(path: string): string {
  return path.split("\\").pop()?.split("/").pop() ?? path;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

// The chain's raw event sequence, chronological -- a complement to the
// attack-chain graph (which shows structure/relations) rather than a
// replacement for it. command_line is nullable (docs/interfaces.md
// section 1a: the real ingestion pipeline doesn't populate it yet), shown
// as a plain note instead of blank space when absent.
export function EventTimeline({ nodes }: { nodes: ChainNode[] }) {
  const sorted = [...nodes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (sorted.length === 0) {
    return <p className="text-sm text-zinc-500">No events in this chain.</p>;
  }

  return (
    <ul className="space-y-3 text-sm">
      {sorted.map((node) => (
        <li key={node.event_id} className="flex gap-3">
          <span className="w-20 shrink-0 text-xs text-zinc-500">{formatTime(node.timestamp)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-xs">{basename(node.image)}</span>
              <span className="shrink-0 text-xs text-zinc-500">pid {node.pid}</span>
              {node.technique && (
                <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                  {node.technique}
                </span>
              )}
            </div>
            {node.command_line ? (
              <p className="truncate font-mono text-xs text-zinc-500" title={node.command_line}>
                {node.command_line}
              </p>
            ) : (
              <p className="text-xs italic text-zinc-400">Command line unavailable</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
