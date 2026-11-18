// Route-connection validity validator — TS port of mirror/connection_validity_mirror.py
// (Roadmap V3 §7.4 mark: "port that rule to TS as the route validator; do not invent a
// new one"). Parity source = the Python mirror's validate_edge + its negative tests.
//
// Rules preserved 1:1 from the mirror:
//   1. unknown node id            -> reject
//   2. self-loop                  -> reject
//   3. edge not in declared flow  -> reject
//   4. direction violation        -> reject (from is not upstream of to)
//   5. cycle through downstream   -> reject

import nodesDoc from '../../../content/nodes/nodes_phase1.json';

export interface FlowEdgeDef {
  from: string;
  to: string;
  transport?: string | null;
}

export interface RouteValidity {
  ok: boolean;
  reason: string;
}

export interface RouteGraph {
  nodeIds: Set<string>;
  flow: FlowEdgeDef[];
  downstream: Map<string, string[]>;
  upstream: Map<string, string[]>;
}

/** Build the graph from the nodes content doc (mirror's adjacency build). */
export function buildRouteGraph(doc: { phase1_nodes: Array<{ id: string }>; flow: FlowEdgeDef[] }): RouteGraph {
  const nodeIds = new Set(doc.phase1_nodes.map((n) => n.id));
  const flow = doc.flow;
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const e of flow) {
    if (!downstream.has(e.from)) downstream.set(e.from, []);
    downstream.get(e.from)!.push(e.to);
    if (!upstream.has(e.to)) upstream.set(e.to, []);
    upstream.get(e.to)!.push(e.from);
  }
  return { nodeIds, flow, downstream, upstream };
}

/** validate_edge parity — same checks, same order, same reason strings. */
export function validateRouteEdge(graph: RouteGraph, fromId: string, toId: string): RouteValidity {
  if (!graph.nodeIds.has(fromId) || !graph.nodeIds.has(toId)) return { ok: false, reason: 'unknown node id' };
  if (fromId === toId) return { ok: false, reason: 'self-loop' };
  // Rule 1: edge must exist in the declared flow graph.
  if (!graph.flow.some((e) => e.from === fromId && e.to === toId))
    return { ok: false, reason: 'edge not in declared flow' };
  // Rule 2: direction check — 'from' must be upstream of 'to'.
  if (!(graph.downstream.get(fromId) ?? []).includes(toId))
    return { ok: false, reason: 'direction violation (from is not upstream of to)' };
  // Rule 3: no cycles in the Phase 1 graph (process flow is strictly forward).
  const seen = new Set<string>();
  const stack = [toId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === fromId) return { ok: false, reason: 'cycle detected' };
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(graph.downstream.get(cur) ?? []));
  }
  return { ok: true, reason: 'valid' };
}

/** Player-facing feedback (§7.4: invalid routes must be understandable). */
export function explainRouteFailure(reason: string): string {
  switch (reason) {
    case 'unknown node id': return "That connection references a node that doesn't exist in the process graph.";
    case 'self-loop': return 'A node cannot feed itself.';
    case 'edge not in declared flow': return 'There is no declared route between those two nodes — materials can only follow a declared flow link.';
    case 'direction violation (from is not upstream of to)': return 'Wrong direction: materials flow downstream only, never back up the line.';
    case 'cycle detected': return 'That route would loop material back into itself — the process flow is strictly forward.';
    default: return `Invalid connection (${reason}).`;
  }
}

export const routeGraph = buildRouteGraph(nodesDoc as any);
