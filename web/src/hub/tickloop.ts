// Hub authoritative tick loop (Roadmap V3 §8.1: "one authoritative tick loop + shared
// inventory registry wrapping per-slice sim modules"). Plain TS core — no React, so
// vitest can drive it directly; the hub main.tsx renders over this same core.
//
// The loop owns ONLY: which slice is active, the current state, the fixed-rate transport
// bookkeeping, and the registry balance check after each tick. Slice RULES stay inside
// the parity ports (untouched); the hub just advances them one logical tick at a time.

import { InventoryRegistry, type BalanceCheckResult } from '../shared/inventory_registry.ts';
import { stepRun, type TickAdvance } from '../ui/runloop.ts';

export interface HubSliceModule<S> {
  id: string;
  label: string;
  fresh(): S;
  advance: TickAdvance<S>;
}

export interface HubEvent {
  tick: number;
  event: string;
}

export class HubTickLoop<S extends { tick: number; events: Array<{ tick: number; event: string }> }> {
  private run: { state: S; log: HubEvent[] };
  private lastCheck: BalanceCheckResult | null = null;

  constructor(
    private readonly mod: HubSliceModule<S>,
    private readonly registry: InventoryRegistry,
  ) {
    this.run = { state: mod.fresh(), log: [] };
  }

  get state(): S {
    return this.run.state;
  }

  get tick(): number {
    return this.run.state.tick;
  }

  get log(): HubEvent[] {
    return this.run.log;
  }

  /** Registry balance view of the current state (also cached from the last step). */
  get balanceCheck(): BalanceCheckResult {
    return this.registry.check(this.mod.id, this.run.state);
  }

  get lastBalanceCheck(): BalanceCheckResult | null {
    return this.lastCheck;
  }

  /** Advance exactly ONE logical tick through the parity port, then re-check the ledger. */
  step(): BalanceCheckResult {
    this.run = stepRun(this.run, this.mod.advance);
    this.lastCheck = this.registry.check(this.mod.id, this.run.state);
    return this.lastCheck;
  }

  /** Advance N ticks (used by determinism tests and catch-up after lag). */
  runTicks(n: number): BalanceCheckResult {
    let last: BalanceCheckResult | null = null;
    for (let i = 0; i < n; i++) last = this.step();
    return last!;
  }

  reset(): void {
    this.run = { state: this.mod.fresh(), log: [] };
    this.lastCheck = null;
  }

  /** Resume from a restored snapshot (save/load v1): replaces the run state, re-checks
   * the ledger immediately so a bad restore fails loudly at resume time. */
  resume(state: S): BalanceCheckResult {
    this.run = { state, log: [] };
    this.lastCheck = this.registry.check(this.mod.id, state);
    return this.lastCheck;
  }
}
