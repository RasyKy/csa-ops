import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 84;
export const HIT_NODE_HEIGHT = 84;
export const NON_HIT_NODE_HEIGHT = 84;

export interface GraphLayoutBounds {
  width: number;
  height: number;
}

export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[]; bounds: GraphLayoutBounds } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 20, ranksep: 74 });

  nodes.forEach((node) => {
    const height = (node.data as { height?: number })?.height ?? NODE_HEIGHT;
    const width = (node.data as { width?: number })?.width ?? NODE_WIDTH;
    g.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => g.setEdge(edge.source, edge.target));

  dagre.layout(g);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const layoutedNodes = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    const height = (node.data as { height?: number })?.height ?? NODE_HEIGHT;
    const width = (node.data as { width?: number })?.width ?? NODE_WIDTH;
    const posX = x - width / 2;
    const posY = y - height / 2;

    minX = Math.min(minX, posX);
    maxX = Math.max(maxX, posX + width);
    minY = Math.min(minY, posY);
    maxY = Math.max(maxY, posY + height);

    return { ...node, position: { x: posX, y: posY } };
  });

  const bounds = {
    width: nodes.length > 0 ? maxX - minX : 0,
    height: nodes.length > 0 ? maxY - minY : 0,
  };

  return { nodes: layoutedNodes, edges, bounds };
}
