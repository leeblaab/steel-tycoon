// Route-connections ledger — the player-side Connect verb over the shared route
// validator (§7.4: "a simple, usable method to connect... the player should be able to
// see why a route is invalid"). This module owns NO validity rule: every connect goes
// through validateRouteEdge (the TS port of mirror/connection_validity_mirror.py), so
// there is no second implementation of the owned business rule (§2.1).
//
// Scope note (v1, deliberate): the Phase-1 flow graph (`content/nodes/nodes_phase1.json`)
// already declares every link, so a connect attempt on the shipped content validates OK.
// The ledger's job in this phase is to make the rule playable and testable: valid
// connects land with an event, invalid ones are REJECTED with the validator's reason +
// explainRouteFailure text — never silently accepted. When ghost route segments enter
// the content (sme_pending), the same ledger gates them with no code change.

import { validateRouteEdge, explainRouteFailure, type RouteGraph } from './route_validity.ts';

export interface RouteConnection {
  from: string;
  to: string;
  /** tick the connect was accepted (hub sim clock). */
  connected_at_tick: number;
}

export interface ConnectResult {
  ok: boolean;
  reason: string; // validator reason ('valid' | rule strings) or 'already connected'
  feedback: string; // player-facing line (§7.4 understandable feedback)
}

export class RouteLedger {
  private readonly connections = new Map<string, RouteConnection>();

  constructor(private readonly graph: RouteGraph) {}

  /** Connect verb — validation is delegated entirely to the shared validator. */
  connect(fromId: string, toId: string, atTick: number): ConnectResult {
    const key = `${fromId}->${toId}`;
    if (this.connections.has(key)) {
      return { ok: false, reason: 'already connected', feedback: 'That route already exists.' };
    }
    const v = validateRouteEdge(this.graph, fromId, toId);
    if (!v.ok) {
      return { ok: false, reason: v.reason, feedback: explainRouteFailure(v.reason) };
    }
    this.connections.set(key, { from: fromId, to: toId, connected_at_tick: atTick });
    return { ok: true, reason: 'valid', feedback: `Route ${fromId} → ${toId} connected.` };
  }

  has(fromId: string, toId: string): boolean {
    return this.connections.has(`${fromId}->${toId}`);
  }

  list(): RouteConnection[] {
    return [...this.connections.values()];
  }

  /** Save/load coverage (§13 mark): connections ride the snapshot. */
  snapshot(): RouteConnection[] {
    return this.list();
  }

  restore(snapshot: RouteConnection[]): void {
    this.connections.clear();
    for (const c of snapshot) this.connections.set(`${c.from}->${c.to}`, c);
  }
}
