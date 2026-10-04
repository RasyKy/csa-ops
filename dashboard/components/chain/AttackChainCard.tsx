"use client";

import { useMemo, useState } from "react";
import { ListTree, Waypoints } from "lucide-react";

import { ChainTree } from "@/components/chain/ChainTree";
import { IncidentGraph } from "@/components/IncidentGraph";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { buildChainTree } from "@/lib/chainTree";
import type { ChainNode, Graph } from "@/lib/types";

type ChainView = "graph" | "tree";

const GRAPH_DESCRIPTION = "Drag to pan. Hold Ctrl or Cmd and scroll to zoom.";
const TREE_DESCRIPTION = "Process tree. Numbers show the order events happened.";

export function AttackChainCard({ graph, chainNodes }: { graph: Graph; chainNodes: ChainNode[] }) {
  const [view, setView] = useState<ChainView>(chainNodes.length <= 4 ? "graph" : "tree");

  const rows = useMemo(() => {
    const titles = new Map(graph.nodes.map((n) => [n.event_id, n.rule_title]));
    return buildChainTree(chainNodes.map((n) => ({ ...n, rule_title: titles.get(n.event_id) ?? null })));
  }, [graph, chainNodes]);

  return (
    <Card data-testid="attack-chain" className="overflow-hidden">
      <CardHeader
        title="Attack chain"
        description={view === "graph" ? GRAPH_DESCRIPTION : TREE_DESCRIPTION}
        actions={
          <div role="group" aria-label="Chain view" className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" aria-pressed={view === "graph"} onClick={() => setView("graph")}>
              <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />
              Graph
            </Button>
            <Button variant="ghost" size="sm" aria-pressed={view === "tree"} onClick={() => setView("tree")}>
              <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
              Tree
            </Button>
          </div>
        }
      />
      {view === "graph" ? (
        <CardBody flush>
          <IncidentGraph graph={graph} chainNodes={chainNodes} />
        </CardBody>
      ) : (
        <CardBody flush>
          <ChainTree rows={rows} />
        </CardBody>
      )}
    </Card>
  );
}
