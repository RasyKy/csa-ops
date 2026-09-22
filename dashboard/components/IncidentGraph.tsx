"use client";

import { useMemo } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { layoutGraph } from "@/lib/graphLayout";
import type { Graph as GraphData, GraphNode as GraphNodeData } from "@/lib/types";

function basename(path: string): string {
  return path.split("\\").pop()?.split("/").pop() ?? path;
}

function label(node: GraphNodeData) {
  if (node.is_trigger) {
    return (
      <div className="text-xs leading-tight">
        <div className="font-semibold">{node.technique}</div>
        <div>{node.rule_title}</div>
      </div>
    );
  }
  return (
    <div className="text-xs leading-tight">
      <div className="font-mono">{basename(node.image)}</div>
      <div className="text-slate-500">pid {node.pid}</div>
    </div>
  );
}

export function IncidentGraph({ graph }: { graph: GraphData }) {
  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = graph.nodes.map((n) => ({
      id: n.event_id,
      position: { x: 0, y: 0 },
      data: { label: label(n) },
      className: n.is_trigger
        ? "!border-2 !border-red-500 !bg-red-50 dark:!bg-red-950"
        : "!border-slate-300 !bg-slate-50 dark:!border-slate-700 dark:!bg-slate-900",
      style: { width: 220 },
    }));

    const rawEdges: Edge[] = graph.edges.map((e, i) => ({
      id: `${e.from}-${e.to}-${i}`,
      source: e.from,
      target: e.to,
      label: e.relation,
      animated: e.relation === "network",
    }));

    return layoutGraph(rawNodes, rawEdges);
  }, [graph]);

  return (
    <div style={{ height: 420 }} className="rounded border border-slate-200 dark:border-slate-800">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
