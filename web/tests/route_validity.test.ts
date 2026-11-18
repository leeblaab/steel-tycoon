// Parity tests for the route validator — TS port of mirror/connection_validity_mirror.py
// (§7.4: port the rule, do not invent one). The mirror's declared-edge sweep and its
// five negative cases are reproduced here 1:1; the Python run is the parity source.

import { describe, it, expect } from 'vitest';
import nodesDoc from '../../content/nodes/nodes_phase1.json';
import { buildRouteGraph, validateRouteEdge, explainRouteFailure, routeGraph } from '../src/shared/route_validity.ts';

const graph = buildRouteGraph(nodesDoc as any);

describe('route validator — parity with connection_validity_mirror.py', () => {
  it('graph shape matches the mirror: same node count and flow edge count', () => {
    expect(graph.nodeIds.size).toBe((nodesDoc as any).phase1_nodes.length);
    expect(graph.flow.length).toBe((nodesDoc as any).flow.length);
    // adjacency sanity (mirror builds upstream/downstream from flow entries only)
    expect(graph.downstream.get('drp')).toContain('eaf');
    expect(graph.upstream.get('eaf')).toContain('drp');
    expect(graph.upstream.get('eaf')).toContain('scrap_yard');
  });

  it('ALL DECLARED EDGES VALID — mirror sweep result reproduced', () => {
    for (const e of graph.flow) {
      const v = validateRouteEdge(graph, e.from, e.to);
      expect(v.ok, `${e.from} -> ${e.to}: ${v.reason}`).toBe(true);
      expect(v.reason).toBe('valid');
    }
  });

  it("mirror's five negative cases fail with the mirror's exact reason strings", () => {
    const cases: Array<[string, string, string]> = [
      ['eaf', 'drp', 'edge not in declared flow'],            // reverse direction
      ['scrap_yard', 'drp', 'edge not in declared flow'],     // no declared edge
      ['jetty', 'jetty', 'self-loop'],                        // self-loop
      ['bar_mill', 'billet_yard', 'edge not in declared flow'], // reverse of declared edge
      ['ghost_node', 'eaf', 'unknown node id'],               // unknown id
    ];
    for (const [a, b, reason] of cases) {
      const v = validateRouteEdge(graph, a, b);
      expect(v.ok, `${a} -> ${b}`).toBe(false);
      expect(v.reason).toBe(reason);
    }
  });

  it('invalid routes produce understandable player feedback (§7.4)', () => {
    expect(explainRouteFailure('edge not in declared flow')).toContain('declared route');
    expect(explainRouteFailure('direction violation (from is not upstream of to)')).toContain('downstream');
    expect(explainRouteFailure('cycle detected')).toContain('loop');
    expect(explainRouteFailure('self-loop')).toContain('itself');
    expect(explainRouteFailure('unknown node id')).toContain("doesn't exist");
  });

  it('module-level routeGraph is the same doc (hub wiring convenience export)', () => {
    expect(routeGraph.nodeIds.size).toBe(graph.nodeIds.size);
    expect(validateRouteEdge(routeGraph, 'cc', 'billet_yard').ok).toBe(true);
  });
});
