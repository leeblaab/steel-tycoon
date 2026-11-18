// SteelX guided placement — equipment lifecycle state machine (Roadmap V3 §14.4 mark,
// implemented in Phase 2; gameplay.md §1.4 Build verb).
//
// Pure TS state machine over the settled lifecycle rule:
//   not_built -> built (from this tick) -> operational
// No rendering, no React — vitest drives it directly, and the hub advances it one
// logical tick at a time on the authoritative slice1 loop (§8.1/§8.6: construction
// time spans N ticks on the same clock that runs the sim).
//
// Contract rules (from the §14.4 mark):
// - Ghost slots start `not_built`; pre-placed machines are declared "pre-built starter
//   state" — they enter as `operational`, never hardcoded scenery.
// - Building takes N ticks: build(slot, tick) -> `built` at (tick + duration_ticks),
//   operational from its built tick (a machine appearing mid-run is live immediately).
// - Construction progress lives in THIS module's state; the sim modules are untouched
//   and keep tolerating a machine appearing mid-run.

export type LifecycleState = 'not_built' | 'built_pending' | 'operational';

export interface SlotLifecycle {
  slot_id: string;
  state: LifecycleState;
  /** tick the build was ordered (null before build / for pre-built) */
  built_from_tick: number | null;
  /** tick the machine becomes operational (null unless pending/operational) */
  ready_at_tick: number | null;
}

export interface ConstructionEvent {
  tick: number;
  event: string;
}

export interface BuildResult {
  ok: boolean;
  reason: string;
}

/** Static per-slot construction config (guided placement: durations are content-side,
 * sme_pending like the quest thresholds — v1 uses one shared default). */
// sme_pending: v1 placeholder until Yasser sets per-machine construction times.
export const DEFAULT_BUILD_DURATION_TICKS = 10;

export class ConstructionLedger {
  private slots = new Map<string, SlotLifecycle>();
  private _events: ConstructionEvent[] = [];

  /** Register a slot. Pre-built starter machines enter directly as `operational`
   * (§14.4 mark); ghost slots enter as `not_built`. */
  register(slotId: string, opts: { preBuilt?: boolean; builtAtTick?: number } = {}): void {
    if (this.slots.has(slotId)) return; // idempotent — resume() re-registers safely
    if (opts.preBuilt) {
      this.slots.set(slotId, {
        slot_id: slotId,
        state: 'operational',
        built_from_tick: opts.builtAtTick ?? 0,
        ready_at_tick: opts.builtAtTick ?? 0,
      });
    } else {
      this.slots.set(slotId, { slot_id: slotId, state: 'not_built', built_from_tick: null, ready_at_tick: null });
    }
  }

  get(slotId: string): SlotLifecycle | undefined {
    return this.slots.get(slotId);
  }

  slots_(): SlotLifecycle[] {
    return [...this.slots.values()];
  }

  get events(): ConstructionEvent[] {
    return this._events;
  }

  /** Build verb: order construction on a ghost slot. Takes `durationTicks` ticks on the
   * authoritative clock; ready_at = tick + duration (§14.4: built from this tick). */
  build(slotId: string, atTick: number, durationTicks = DEFAULT_BUILD_DURATION_TICKS): BuildResult {
    const s = this.slots.get(slotId);
    if (!s) return { ok: false, reason: `unknown slot '${slotId}'` };
    if (s.state !== 'not_built') return { ok: false, reason: `slot '${slotId}' is ${s.state}, not buildable` };
    if (!Number.isInteger(durationTicks) || durationTicks < 1)
      return { ok: false, reason: `build duration must be >= 1 tick (got ${durationTicks})` };
    s.state = 'built_pending';
    s.built_from_tick = atTick;
    s.ready_at_tick = atTick + durationTicks;
    this._events.push({ tick: atTick, event: `construction_started:${slotId}` });
    return { ok: true, reason: `building '${slotId}', operational at tick ${s.ready_at_tick}` };
  }

  /** Advance one authoritative tick: pending builds flip to operational when their
   * ready tick arrives. Idempotent for the same tick (safe under re-run). */
  tick(nowTick: number): void {
    for (const s of this.slots.values()) {
      if (s.state === 'built_pending' && s.ready_at_tick !== null && nowTick >= s.ready_at_tick) {
        s.state = 'operational';
        this._events.push({ tick: nowTick, event: `construction_complete:${s.slot_id}` });
      }
    }
  }

  /** Construction progress as a fraction for the hub UI (1.0 when operational). */
  progress(slotId: string, nowTick: number): number {
    const s = this.slots.get(slotId);
    if (!s) return 0;
    if (s.state === 'operational') return 1;
    if (s.state !== 'built_pending' || s.ready_at_tick === null || s.built_from_tick === null) return 0;
    const span = s.ready_at_tick - s.built_from_tick;
    return Math.max(0, Math.min(1, (nowTick - s.built_from_tick) / span));
  }

  // ---- snapshot/restore for save/load (§13 coverage: construction progress persists) ----

  snapshot(): SlotLifecycle[] {
    return this.slots_().map((s) => ({ ...s }));
  }

  restore(snapshot: SlotLifecycle[]): void {
    this.slots.clear();
    for (const s of snapshot) this.slots.set(s.slot_id, { ...s });
  }

  /** Remove construction events logged at or after `tick` (a load rewinds the clock —
   * stale started/complete entries must not linger in the hub event log). */
  dropEventsFrom(tick: number): void {
    this._events = this._events.filter((e) => e.tick < tick);
  }
}
