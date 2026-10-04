"use client";

import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { GraphNode } from "@/lib/types";

export interface EventNodeData extends GraphNode {
  timestamp?: string;
  step?: number;
  height?: number;
  width?: number;
}

function basename(path: string): string {
  return path.split("\\").pop()?.split("/").pop() ?? path;
}

const EVENT_LABELS: Record<string, string> = {
  process_start: "Process start",
  process_access: "Process access",
  file_event: "File write",
  registry_event: "Registry write",
  network_connection: "Network connection",
};

const SHORT_EVENT_LABELS: Record<string, string> = {
  process_access: "Process access",
  file_event: "File",
  registry_event: "Registry",
  network_connection: "Network",
};

function EventNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as EventNodeData;
  const isTrigger = Boolean(nodeData.is_trigger);

  const fullLabel = nodeData.event_type ? (EVENT_LABELS[nodeData.event_type] ?? nodeData.event_type) : null;
  const nodeTitle = fullLabel
    ? nodeData.detail
      ? `${fullLabel}: ${nodeData.detail}`
      : fullLabel
    : undefined;

  return (
    <div
      tabIndex={0}
      title={nodeTitle}
      className={`relative box-border flex w-[184px] h-[84px] flex-col justify-between rounded-md bg-surface p-2 text-ink shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        isTrigger
          ? "border border-red-500 dark:border-red-400"
          : "border border-line-strong"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-none !opacity-0"
      />

      {isTrigger && <span className="sr-only">Detection hit</span>}

      {/* Row 1: step number circle (18px) + process basename (mono 13px medium, min-w-0, full remaining width) */}
      <div className="flex items-center min-w-0 gap-1.5 leading-none">
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-xs text-ink-subtle leading-none select-none">
          {nodeData.step ?? 1}
        </span>
        <span
          className="truncate font-mono text-[13px] font-medium text-ink min-w-0 flex-1 leading-tight"
          title={nodeData.image}
        >
          {basename(nodeData.image)}
        </span>
      </div>

      {/* Row 2: pid N (12px, ink-subtle) and technique chip (hit nodes) or short label (non-hit non-process_start) */}
      <div className="flex items-center justify-between min-w-0 gap-1 leading-none">
        <span className="shrink-0 text-xs text-ink-subtle">
          pid {nodeData.pid}
        </span>
        {isTrigger && nodeData.technique && (
          <span className="shrink-0 rounded border border-line-strong px-1 py-0.5 font-mono text-xs text-ink leading-none">
            {nodeData.technique}
          </span>
        )}
        {!isTrigger &&
          nodeData.event_type &&
          nodeData.event_type !== "process_start" && (
            <span className="shrink-0 text-xs text-ink-subtle">
              {SHORT_EVENT_LABELS[nodeData.event_type] ?? nodeData.event_type}
            </span>
          )}
      </div>

      {/* Row 3: rule title (hit, up to 2 lines, full text) or detail / No rule matched (non-hit) */}
      <div className="min-w-0 text-xs leading-4">
        {isTrigger ? (
          nodeData.rule_title ? (
            <div
              className="line-clamp-2 text-ink-muted break-words"
              title={nodeData.rule_title}
            >
              {nodeData.rule_title}
            </div>
          ) : null
        ) : nodeData.detail ? (
          <div
            className="truncate text-ink-subtle"
            title={nodeData.detail}
          >
            {nodeData.detail}
          </div>
        ) : (
          <div className="text-ink-subtle">No rule matched</div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-none !opacity-0"
      />
    </div>
  );
}

export const EventNode = memo(EventNodeComponent);
