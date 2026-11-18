# SteelX — Step B semantics spec v1 (operational Decide verbs) — DRAFT for Yasser ratification

Date: 2026-10-20. Status: PROPOSAL. Four verbs chosen by Yasser: Start/Stop,
Schedule Maintenance (planned stoppage / preventive maintenance), Order Spare
Parts, Crew Shift/Overtime. Route priority + berth sequencing parked.

Design law (unchanged): the player never edits numbers directly — they issue
decisions; the sim rules turn decisions into consequences with understandable
feedback (§7.4). Mirror first: extend `mirror/operations_domain3_mirror.py`
with a decide layer, prove behavior in Python tests, then port 1:1 to TS
(`ops_decide_ledger.ts`) over the frozen engine parity oracle.

New state fields (all inside OpsState, save-serialized):
- running: Record<asset, bool>        (default true)
- maintenance_queue: {asset, start_day}[]  (start_day = day index when outage begins)
- overtime_until_day: number          (0 = none active)
- overtime_days_used: number          (KPI + fatigue counter)

---

## V1 — Start / Stop  (Run/Idle a machine)

Semantics:
- `stop(asset)` while running → asset goes idle. While idle:
  - produces 0 t; upstream material accumulates as BUFFERED (same rule as down).
  - accrues NO operating hours → no random-breakdown dice roll consumed? NO —
    RNG contract is sacred: the draw per asset per tick is STILL consumed for
    every asset (idle included), matching the frozen "one draw per asset,
    down or running" contract. Idle simply cannot fire a breakdown (no operating
    stress) but the generator advances identically.
  - wages continue in full (staff stays paid — no wage lever yet).
- `start(asset)` while idle → resume production next tick.
- Cannot start/stop an asset that is DOWN (feedback: "machine is under repair").
- Crane stop = dispatch capacity 0 (same as crane down) — realistic but a trap;
  feedback warns on stopping the crane.

Why it matters in slice1 today: idle is mostly a cost (lost production), so its
first real use is protecting a machine before a known bottleneck, or teaching
"stopping one link starves the next". Consequence visibility via ledger KPIs.

## V2 — Schedule Maintenance (planned stoppage / preventive maintenance)

Semantics:
- `schedule_maintenance(asset, start_day)` — must be a future day (>= current+1),
  asset not already queued or down. Queued outage duration = PM_DURATION_DAYS
  (config; proposal 2 days — shorter than reactive repair MTTR + spare lead,
  which is the whole teaching point).
- On the start day: asset goes down for PM_DURATION; planned_outages += 1;
  NO breakdown counter, NO spares consumed.
- Preventive effect (the core rule): completing a scheduled maintenance RESETS
  the asset's operating_hours to 0 — wear clock restarts, so the next random
  breakdown needs a full MTBF again. Reactive repair does NOT reset hours.
  (This is the condition-based-maintenance story: run-to-failure vs scheduled.)
- Player may cancel a queued job before its start day (`cancel_maintenance`).

## V3 — Order Spare Parts

Semantics:
- `order_spare(asset)` → adds 1 unit to a new `spares_pipeline` queue with an
  arrival day = current_day + SPARE_DELIVERY_DAYS (7). On arrival day it moves
  into `spares[asset]` stock (capped at MAX_SPARES_PER_ASSET, proposal 3).
- Existing auto-consumption rule unchanged: breakdown uses stock if > 0, else
  repair += 7-day delivery wait. Ordering ahead converts a 7+ day outage into an
  MTTR-only outage — directly visible in repair_hours_total.
- No cost yet (economy lands Level 2; the lead-time is the current bite).
  Cost placeholder marked sme_pending for Yasser's numbers later.

## V4 — Crew Shift / Overtime

Semantics:
- `overtime(days)` — activates overtime for N days (1..7) from current day.
  While active: morale band multiplier applies one band UP (70→90 mult 0.5,
  50→70 mult 0.7; already at 90 stays 0.5) → fewer breakdowns while overtime runs.
- Fatigue tail (the balancing lesson): when overtime ends, morale_mult applies
  one band DOWN for an equal number of days (recovery period). Stacking a new
  overtime before recovery ends is refused with feedback ("crew needs rest").
- No wage cost yet (Level 2 economy; flagged sme_pending).

## Verb plumbing (all four)
- Actions ride the existing `Action[]` seam: type 'decide', fields per verb —
  tick-scoped like inject. Ledger module (`ops_decide_ledger.ts`) validates
  (reject with human-readable reason, never silent default), stores decision
  history, snapshot/restore for Save; hub panel = one card per verb.
- New tunables go in `content/operations/operations_domain3.json` under a
  `decide` block, each sme_pending=true: pm_duration_days, max_spares_per_asset,
  overtime_max_days, recovery_rule params.

## Open questions for Yasser (answer = GO or amend)
NOTE on Q2: the TS port already consumes the generator step for every asset per
tick (`ops_domain3.ts` lines 135-141 — `draw(st.generator_state)` runs before
any down/idle branch). The proposal simply extends that frozen contract to idle
assets; no RNG behavior changes.

Q1 Idle wage rule: wages continue at full while idle (proposal) — OK?
Q2 Idle assets still consume the RNG draw but cannot break down (proposal,
   protects the frozen draw contract) — OK?
Q3 PM resets operating_hours to 0 (wear-clock reset is the preventive effect);
   reactive repair does not. Duration proposal 2 days vs reactive MTTR 12-36h+7d.
   OK or different mechanic/duration?
Q4 Spare stock cap 3/asset, pipeline arrival after existing 7-day lead — OK?
Q5 Overtime morale-band-shift mechanic with equal-length fatigue tail; max 7
   days active — OK?
Q6 Verb panel placement: new "Operations" panel between RoutePanel and
   TransportControls in hub — OK?
