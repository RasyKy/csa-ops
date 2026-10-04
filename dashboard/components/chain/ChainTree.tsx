import { FilePlus2, KeyRound, Network, ScanEye, ShieldAlert, type LucideIcon } from "lucide-react";

import type { TreeRow } from "@/lib/chainTree";
import { formatTime, formatUtc } from "@/lib/time";

const MAX_VISUAL_DEPTH = 6;
const NAME_TRUNCATE_AT = 28;

const CHIP_CLASSES =
  "inline-flex h-5 items-center gap-1 rounded-full border border-line-strong bg-surface px-2 font-mono text-xs text-ink";

const ACTIVITY: Record<string, { label: string; Icon: LucideIcon }> = {
  network_connection: { label: "Network connection", Icon: Network },
  file_event: { label: "File write", Icon: FilePlus2 },
  registry_event: { label: "Registry write", Icon: KeyRound },
  process_access: { label: "Process access", Icon: ScanEye },
};

function basename(path: string): string {
  return path.split("\\").pop()?.split("/").pop() ?? path;
}

function HitMarker({ row }: { row: TreeRow }) {
  if (!row.hit) return null;
  return (
    <>
      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" aria-hidden="true" />
      <span className="sr-only">Detection hit</span>
    </>
  );
}

function HitDetails({ row }: { row: TreeRow }) {
  if (!row.hit) return null;
  return (
    <>
      {row.node.technique && <span className={CHIP_CLASSES}>{row.node.technique}</span>}
      {row.node.rule_title && (
        <span className="line-clamp-2 min-w-0 text-xs text-ink-muted" title={row.node.rule_title}>
          {row.node.rule_title}
        </span>
      )}
    </>
  );
}

function Columns({ row }: { row: TreeRow }) {
  const visual = Math.min(row.depth, MAX_VISUAL_DEPTH);
  if (visual === 0) return null;
  const cols = [];
  for (let k = 0; k < visual; k++) {
    const isElbow = k === visual - 1;
    cols.push(
      <span key={k} aria-hidden="true" className="relative w-3 shrink-0 self-stretch sm:w-4">
        {!isElbow && row.guides[k] && (
          <span className="absolute bottom-0 left-1/2 top-0 w-px bg-line-strong" />
        )}
        {isElbow && (
          <>
            <span
              className={`absolute left-1/2 top-0 w-px bg-line-strong ${row.isLast ? "h-1/2" : "h-full"}`}
            />
            <span className="absolute left-1/2 right-0 top-1/2 h-px bg-line-strong" />
          </>
        )}
      </span>,
    );
  }
  return <>{cols}</>;
}

function ProcessBody({ row }: { row: TreeRow }) {
  const { node } = row;
  const name = basename(node.image);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-5">
        <span
          className={`font-mono text-[13px] font-medium text-ink ${
            name.length > NAME_TRUNCATE_AT ? "max-w-[28ch] truncate" : ""
          }`}
          title={node.image}
          data-testid="chain-row-name"
        >
          {name}
        </span>
        <span className="text-xs text-ink-subtle">pid {node.pid}</span>
        <HitMarker row={row} />
        <HitDetails row={row} />
      </div>
      {node.command_line && (
        <div
          className="truncate font-mono text-[11px] leading-4 text-ink-subtle"
          title={node.command_line}
          data-testid="chain-row-command"
        >
          {node.command_line}
        </div>
      )}
    </div>
  );
}

function ActivityBody({ row }: { row: TreeRow }) {
  const { node } = row;
  const meta = ACTIVITY[node.event_type ?? ""];
  const Icon = meta?.Icon ?? Network;
  const label = meta?.label ?? node.event_type ?? "Event";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
        <span className="text-xs text-ink-subtle" data-testid="chain-row-name">
          {label}
        </span>
        <HitMarker row={row} />
        <HitDetails row={row} />
      </div>
      {node.detail && (
        <div
          className="line-clamp-2 break-all font-mono text-xs leading-4 text-ink-muted"
          title={node.detail}
          data-testid="chain-row-detail"
        >
          {node.detail}
        </div>
      )}
    </div>
  );
}

export function ChainTree({ rows }: { rows: TreeRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-ink-muted">No events in this chain.</p>;
  }

  return (
    <div>
      <ol aria-label="Process tree" className="px-4 py-2">
        {rows.map((row) => (
          <li
            key={row.node.event_id}
            data-testid="chain-row"
            data-step={row.step}
            data-depth={row.depth}
            data-kind={row.kind}
            data-event-type={row.node.event_type ?? ""}
            className="flex items-stretch"
          >
            <Columns row={row} />
            <div className="flex min-w-0 flex-1 items-start gap-2 py-1.5">
              <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 select-none items-center justify-center rounded-full border border-line-strong font-mono text-xs leading-none text-ink-subtle">
                {row.step}
              </span>
              {row.kind === "process" ? <ProcessBody row={row} /> : <ActivityBody row={row} />}
              {row.node.timestamp && (
                <time
                  dateTime={row.node.timestamp}
                  title={formatUtc(row.node.timestamp)}
                  className="ml-auto shrink-0 self-start pl-2 font-mono text-xs leading-5 tabular-nums text-ink-subtle"
                >
                  {formatTime(row.node.timestamp)}
                </time>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-xs text-ink-muted">
        <ShieldAlert className="h-3.5 w-3.5 text-red-500 dark:text-red-400" aria-hidden="true" />
        <span>Detection hit</span>
      </div>
    </div>
  );
}
