// RouteLedger tests — Connect verb over the shared validator (§7.4). Parity source is
// the mirror port's rule set: the ledger must never accept what validateRouteEdge
// rejects, and every rejection carries the player-facing explanation.

import { describe, it, expect } from 'vitest';
import { RouteLedger } from '../src/shared/route_ledger.ts';
import { routeGraph } from '../src/shared/route_validity.ts';

function ledger() {
  return new RouteLedger(routeGraph);
}

describe('RouteLedger Connect verb', () => {
  it('valid declared-flow connect lands and is listed with its tick', () => {
    const l = ledger();
    const r = l.connect('cc', 'billet_yard', 12);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('valid');
    expect(l.has('cc', 'billet_yard')).toBe(true);
    expect(l.list()).toEqual([{ from: 'cc', to: 'billet_yard', connected_at_tick: 12 }]);
  });

  it('direction-reversed connect is REJECTED with the mirror reason + feedback line', () => {
    const l = ledger();
    const r = l.connect('billet_yard', 'cc', 5); // cc feeds billet_yard, never back
    expect(r.ok).toBe(false);
    // Parity with the mirror port: reverse of a declared edge is rejected as
    // 'edge not in declared flow' (the rule order route_validity.test.ts pins).
    expect(r.reason).toBe('edge not in declared flow');
    expect(r.feedback).toContain('declared route');
    expect(l.has('billet_yard', 'cc')).toBe(false);
    expect(l.list()).toHaveLength(0); // rejection never lands
  });

  it('unknown node, self-loop and non-declared edge are rejected with explanations', () => {
    const l = ledger();
    const cases: Array<[string, string, string]> = [
      ['bogus_node', 'eaf', 'unknown node id'],
      ['eaf', 'eaf', 'self-loop'],
      ['jetty', 'bar_mill', 'edge not in declared flow'], // reverse of a declared edge: rule 1 fires first,
      // same rule order the mirror port pins (route_validity.test.ts negative cases)
    ];
    for (const [from, to, reason] of cases) {
      const r = l.connect(from, to, 1);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe(reason);
      expect(r.feedback.length).toBeGreaterThan(10); // understandable line, not a code
    }
    expect(l.list()).toHaveLength(0);
  });

  it('duplicate connect is rejected as already connected (not re-validated)', () => {
    const l = ledger();
    l.connect('drp', 'eaf', 3);
    const r = l.connect('drp', 'eaf', 9);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('already connected');
    expect(l.list()).toHaveLength(1);
    expect(l.list()[0].connected_at_tick).toBe(3); // original stands
  });

  it('snapshot/restore round-trip carries connections verbatim', () => {
    const l = ledger();
    l.connect('eaf', 'lf', 20);
    l.connect('lf', 'cc', 25);
    const snap = JSON.parse(JSON.stringify(l.snapshot()));

    const revived = new RouteLedger(routeGraph);
    revived.restore(snap);
    expect(revived.has('eaf', 'lf')).toBe(true);
    expect(revived.has('lf', 'cc')).toBe(true);
    expect(revived.list()).toEqual(l.list());

    // A restored ledger still gates new connects through the validator.
    const bad = revived.connect('cc', 'eaf', 30);
    expect(bad.ok).toBe(false);
  });
});
