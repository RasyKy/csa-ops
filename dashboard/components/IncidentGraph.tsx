"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Lock, LockOpen, Maximize, Minus, Plus } from "lucide-react";

import { EventNode } from "@/components/graph/EventNode";
import { buttonClasses } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { layoutGraph } from "@/lib/graphLayout";
import type { ChainNode, Graph as GraphData, GraphNode as GraphNodeData } from "@/lib/types";

const nodeTypes = {
  event: EventNode,
  default: EventNode,
};

export interface IncidentGraphProps {
  graph: GraphData & { nodes: (GraphNodeData & { timestamp?: string })[] };
  chainNodes?: ChainNode[];
}

function GraphToolbar({
  locked,
  onToggleLock,
}: {
  locked: boolean;
  onToggleLock: () => void;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleFitView = () => {
    if (locked) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    fitView({ padding: 0.025, maxZoom: 1, duration: prefersReducedMotion ? 0 : 200 });
  };

  const handleZoomIn = () => {
    if (locked) return;
    zoomIn();
  };

  const handleZoomOut = () => {
    if (locked) return;
    zoomOut();
  };

  return (
    <Panel position="top-right" className="m-2">
      <div className="flex items-center rounded-md border border-line-strong bg-surface p-0.5 shadow-none">
        <Tooltip content="Zoom in">
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={locked}
            aria-label="Zoom in"
            className={buttonClasses({ variant: "ghost", size: "icon" })}
          >
            <Plus className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content="Zoom out">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={locked}
            aria-label="Zoom out"
            className={buttonClasses({ variant: "ghost", size: "icon" })}
          >
            <Minus className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content="Fit view">
          <button
            type="button"
            onClick={handleFitView}
            disabled={locked}
            aria-label="Fit view"
            className={buttonClasses({ variant: "ghost", size: "icon" })}
          >
            <Maximize className="h-4 w-4" />
          </button>
        </Tooltip>

        <div className="mx-0.5 h-4 w-px bg-line-strong" />

        <Tooltip content={locked ? "Unlock graph" : "Lock graph"}>
          <button
            type="button"
            onClick={onToggleLock}
            aria-label="Lock graph"
            aria-pressed={locked}
            className={buttonClasses({ variant: "ghost", size: "icon" })}
          >
            {locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
          </button>
        </Tooltip>
      </div>
    </Panel>
  );
}

function GraphLegend() {
  return (
    <Panel position="bottom-left" className="m-2">
      <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-muted shadow-none">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-red-500 bg-surface dark:border-red-400" />
          <span>Detection hit</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-line-strong bg-surface" />
          <span>Event</span>
        </div>
      </div>
    </Panel>
  );
}

function IncidentGraphContent({ graph, chainNodes }: IncidentGraphProps) {
  const [locked, setLocked] = useState(false);
  const [resolvedMarkerColor, setResolvedMarkerColor] = useState<string>("var(--ink-subtle)");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const initialHeight = useMemo(() => {
    const rawNodes: Node[] = graph.nodes.map((n) => {
      const isTrigger = Boolean(n.is_trigger);
      return {
        id: n.event_id,
        type: "event",
        position: { x: 0, y: 0 },
        data: {
          ...n,
          height: isTrigger ? 84 : 44,
          width: 184,
        },
      };
    });
    const rawEdges: Edge[] = graph.edges.map((e, i) => ({
      id: `${e.from}-${e.to}-${i}`,
      source: e.from,
      target: e.to,
    }));
    const { bounds } = layoutGraph(rawNodes, rawEdges);
    return Math.min(Math.max(bounds.height + 112, 240), 440);
  }, [graph]);

  const [containerHeight, setContainerHeight] = useState<number>(initialHeight);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px), (pointer: coarse)").matches
    ) {
      setLocked(true);
    }
  }, []);

  useEffect(() => {
    const updateColors = () => {
      const computed = getComputedStyle(document.documentElement).getPropertyValue("--ink-subtle").trim();
      if (computed) {
        setResolvedMarkerColor(computed);
      }
    };
    updateColors();
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const timestampMap = useMemo(() => {
    const map = new Map<string, string>();
    if (chainNodes) {
      for (const cn of chainNodes) {
        map.set(cn.event_id, cn.timestamp);
      }
    }
    return map;
  }, [chainNodes]);

  useEffect(() => {
    const rawNodes: Node[] = graph.nodes.map((n) => {
      const timestamp =
        (n as GraphNodeData & { timestamp?: string }).timestamp ?? timestampMap.get(n.event_id);
      const isTrigger = Boolean(n.is_trigger);
      return {
        id: n.event_id,
        type: "event",
        position: { x: 0, y: 0 },
        data: {
          ...n,
          timestamp,
          height: isTrigger ? 84 : 44,
          width: 184,
        },
      };
    });

    const rawEdges: Edge[] = graph.edges.map((e, i) => {
      const isNetwork = e.relation === "network";
      return {
        id: `${e.from}-${e.to}-${i}`,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        style: {
          stroke: "var(--line-strong)",
          strokeWidth: 1.5,
          strokeDasharray: isNetwork ? "4 3" : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: resolvedMarkerColor,
        },
        label: e.relation,
        labelStyle: {
          fontSize: 12,
          fill: "var(--ink-muted)",
          fontWeight: 500,
        },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: {
          fill: "var(--surface)",
          stroke: "var(--line)",
          strokeWidth: 1,
        },
      };
    });

    const layouted = layoutGraph(rawNodes, rawEdges);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
    const height = Math.min(Math.max(layouted.bounds.height + 112, 240), 440);
    setContainerHeight(height);
  }, [graph, timestampMap, resolvedMarkerColor]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  return (
    <div
      role="region"
      aria-label="Attack chain graph. The event timeline below lists the same events."
      style={{ height: containerHeight }}
      className="relative w-full bg-surface-subtle"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable={!locked}
        nodesConnectable={false}
        panOnDrag={!locked}
        zoomOnScroll={false}
        panOnScroll={false}
        zoomOnPinch={!locked}
        zoomOnDoubleClick={false}
        zoomActivationKeyCode={locked ? null : ["Control", "Meta"]}
        preventScrolling={false}
        selectionOnDrag={false}
        deleteKeyCode={null}
        minZoom={0.4}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.025, maxZoom: 1 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--line-strong)" />
        <GraphToolbar locked={locked} onToggleLock={() => setLocked((prev) => !prev)} />
        <GraphLegend />
      </ReactFlow>
    </div>
  );
}

export function IncidentGraph(props: IncidentGraphProps) {
  return (
    <ReactFlowProvider>
      <IncidentGraphContent {...props} />
    </ReactFlowProvider>
  );
}

