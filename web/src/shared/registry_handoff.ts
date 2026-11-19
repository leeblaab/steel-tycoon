// S1.1 registry handoff primitives — TS port of mirror/registry_handoff_mirror.py.
// Parity oracle: the Python mirror (frozen). Exact-value parity, no RNG involved.
// Rules proven by the mirror:
//  - pure state-in/state-out (structural clone per call, never mutates the caller's state)
//  - two-phase handoff: transfer consumes source + releases its earmark, opens an
//    in_transit record; destination credit happens ONLY inside tick() at arrival_tick
//  - travel_ticks integer >= 1 — same-tick teleport is a hard error
//  - reserve is accounting-only (earmark), refuses double-earmarks; release never negative
//  - ledger closure: sum(usable) + sum(in_transit) == sum(deposits) within 1e-6 t (D-02)

export const REGISTRY_TOL = 1e-6;

export interface RegistryInventory {
  usable_t: number;
}

export interface InTransitRecord {
  transfer_id: string;
  from_id: string;
  to_id: string;
  tonnes: number;
  depart_tick: number;
  arrival_tick: number;
}

export interface RegistryEvent {
  tick: number;
  event: string;
}

export interface RegistryState {
  tick: number;
  inventories: Record<string, RegistryInventory>;
  reserved: Record<string, number>; // inventory_id -> earmarked t (accounting-only)
  in_transit: InTransitRecord[];
  events: RegistryEvent[];
}

export function freshRegistryState(): RegistryState {
  return { tick: 0, inventories: {}, reserved: {}, in_transit: [], events: [] };
}

function clone(s: RegistryState): RegistryState {
  return JSON.parse(JSON.stringify(s)) as RegistryState;
}

function ev(s: RegistryState, msg: string): void {
  s.events.push({ tick: s.tick, event: msg });
}

/** usable minus earmarked — the quantity a new reserve may claim. */
export function availableT(s: RegistryState, invId: string): number {
  const inv = s.inventories[invId];
  if (!inv) return 0.0;
  return inv.usable_t - (s.reserved[invId] ?? 0.0);
}

export function registerInventory(s: RegistryState, invId: string): RegistryState {
  const n = clone(s);
  if (invId in n.inventories) throw new Error(`inventory ${invId} already registered`);
  n.inventories[invId] = { usable_t: 0.0 };
  return n;
}

/** Scenario helper for stock arrival (berth credit, production). Positive only. */
export function deposit(s: RegistryState, invId: string, tonnes: number): RegistryState {
  if (!(tonnes > 0)) throw new Error('deposit must be positive');
  const n = clone(s);
  if (!(invId in n.inventories)) throw new Error(`unknown inventory ${invId}`);
  n.inventories[invId].usable_t += tonnes;
  return n;
}

/** Earmark accounting-only. Refused (state unchanged + event) if un-earmarked is short. */
export function reserve(s: RegistryState, invId: string, tonnes: number, reason: string): RegistryState {
  if (!(tonnes > 0)) throw new Error('reserve must be positive');
  const n = clone(s);
  if (!(invId in n.inventories)) {
    ev(n, `reserve refused ${invId} ${tonnes}t (${reason}): unknown inventory`);
    return n;
  }
  if (tonnes > availableT(n, invId) + REGISTRY_TOL) {
    ev(n, `reserve refused ${invId} ${tonnes}t (${reason}): short (${availableT(n, invId)}t)`);
    return n;
  }
  n.reserved[invId] = (n.reserved[invId] ?? 0.0) + tonnes;
  return n;
}

/** Give back an earmark. Refused if it would take reservations negative. */
export function releaseReserve(s: RegistryState, invId: string, tonnes: number): RegistryState {
  if (!(tonnes > 0)) throw new Error('release must be positive');
  const n = clone(s);
  const held = n.reserved[invId] ?? 0.0;
  if (tonnes > held + REGISTRY_TOL) {
    ev(n, `release refused ${invId} ${tonnes}t: only ${held}t earmarked`);
    return n;
  }
  n.reserved[invId] = held - tonnes;
  return n;
}

/** Two-phase handoff. Commits tonnage (consumes usable_t AND its earmark if reserved)
 *  and opens an in_transit record; nothing appears at to_id until arrival_tick. */
export function transfer(
  s: RegistryState, fromId: string, toId: string, tonnes: number, travelTicks: number,
): RegistryState {
  if (!(tonnes > 0)) throw new Error('transfer must be positive');
  if (!Number.isInteger(travelTicks) || travelTicks < 1) {
    throw new Error('travel_ticks must be an integer >= 1 (never same-tick teleport)');
  }
  const n = clone(s);
  for (const invId of [fromId, toId]) {
    if (!(invId in n.inventories)) {
      ev(n, `transfer refused ${fromId}->${toId} ${tonnes}t: unknown inventory ${invId}`);
      return n;
    }
  }
  if (fromId === toId) {
    ev(n, `transfer refused ${tonnes}t: from == to (${fromId})`);
    return n;
  }
  const inv = n.inventories[fromId];
  const held = n.reserved[fromId] ?? 0.0;
  if (tonnes > inv.usable_t + REGISTRY_TOL) {
    ev(n, `transfer refused ${fromId}->${toId} ${tonnes}t: usable short (${inv.usable_t}t)`);
    return n;
  }
  // consume earmark first (reserved tonnes are the ones a task is allowed to move)
  const fromEarmark = Math.min(held, tonnes);
  n.reserved[fromId] = held - fromEarmark;
  inv.usable_t -= tonnes;
  const tid = `T${n.tick}:${fromId}->${toId}`;
  n.in_transit.push({
    transfer_id: tid, from_id: fromId, to_id: toId, tonnes,
    depart_tick: n.tick, arrival_tick: n.tick + travelTicks,
  });
  ev(n, `transfer ${tid} ${tonnes}t departs (${travelTicks}t travel)`);
  return n;
}

/** Pure tick: +1 clock, then credit every in-transit record with arrival_tick <= now. */
export function registryTick(s: RegistryState): RegistryState {
  const n = clone(s);
  n.tick += 1;
  const still: InTransitRecord[] = [];
  for (const rec of n.in_transit) {
    if (rec.arrival_tick <= n.tick) {
      n.inventories[rec.to_id].usable_t += rec.tonnes;
      ev(n, `transfer ${rec.transfer_id} arrives at ${rec.to_id} (${rec.tonnes}t)`);
    } else {
      still.push(rec);
    }
  }
  n.in_transit = still;
  return n;
}

/** Closure: sum(usable) + sum(in_transit) == initial_deposits within REGISTRY_TOL. */
export function ledgerClosure(s: RegistryState, initialDeposits: number): { ok: boolean; total: number } {
  let total = 0;
  for (const inv of Object.values(s.inventories)) total += inv.usable_t;
  for (const rec of s.in_transit) total += rec.tonnes;
  return { ok: Math.abs(total - initialDeposits) < REGISTRY_TOL, total };
}

/** 0 <= reserved[inv] <= usable_t[inv]. */
export function reservationsValid(s: RegistryState): { ok: boolean; badId: string | null } {
  for (const [invId, held] of Object.entries(s.reserved)) {
    if (held < -REGISTRY_TOL || held > s.inventories[invId].usable_t + REGISTRY_TOL) {
      return { ok: false, badId: invId };
    }
  }
  return { ok: true, badId: null };
}
