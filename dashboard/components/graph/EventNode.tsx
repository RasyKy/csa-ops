"use client";

import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ShieldAlert } from "lucide-react";

import type { GraphNode } from "@/lib/types";

export interface EventNodeData extends GraphNode {
  timestamp?: string;
  height?: number;
  width?: number;
}

function basename(path: string): string {
  return path.split("\\").pop()?.split("/").pop() ?? path;
}

function EventNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as EventNodeData;
  const isTrigger = Boolean(nodeData.is_trigger);

  return (
    <div
      tabIndex={0}
      className={`relative box-border flex w-[184px] flex-col rounded-md bg-surface p-2 text-ink shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        isTrigger
          ? "h-[84px] justify-between border border-red-500 dark:border-red-400"
          : "h-[44px] justify-center border border-line-strong"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-none !opacity-0"
      />

      {/* Row 1: process basename, pid, ShieldAlert icon if trigger */}
      <div className="flex items-center justify-between min-w-0 gap-1.5 leading-none">
        <div className="flex items-center min-w-0 gap-1 flex-1">
          {isTrigger && (
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" />
          )}
          <span
            className="truncate font-mono text-[13px] font-medium text-ink"
            title={nodeData.image}
          >
            {basename(nodeData.image)}
          </span>
        </div>
        <span className="shrink-0 text-xs text-ink-subtle">
          pid {nodeData.pid}
        </span>
      </div>

      {/* Hit node: technique chip and full rule title on up to 2 lines */}
      {isTrigger && (
        <div className="flex flex-col min-w-0 gap-1 text-xs">
          {nodeData.technique && (
            <div className="flex items-center">
              <span className="shrink-0 rounded border border-line-strong px-1 py-0.5 font-mono text-xs text-ink">
                {nodeData.technique}
              </span>
            </div>
          )}
          {nodeData.rule_title && (
            <div
              className="text-xs leading-4 text-ink-muted break-words"
              title={nodeData.rule_title}
            >
              {nodeData.rule_title}
            </div>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-none !opacity-0"
      />
    </div>
  );
}

export const EventNode = memo(EventNodeComponent);
