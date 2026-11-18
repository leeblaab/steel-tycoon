# Phase 3 — Slice 1: berth model + conveyor link + yard (TS vertical slice)

Micro-step 1 (Yasser GO 2026-10-12): the TS berth model already exists in the ops port
(`tickOps` berth stages, cadence reproduced exactly). This step makes the slice's three
nodes — jetty (berth), conveyor link, yard — runnable as a standalone scenario, with the
first guided bottleneck (berth occupancy + demurrage) EMERGING from the actual rules.

## Slice rules (no new mechanics — existing verified rules only)

1. **Jetty (berth)** — single berth, FIFO ships, arrivals on `day % 24 == 0` with
   `day += 1` BEFORE the berth stages (cadence boundary reproduced exactly, not "fixed").
   Refused arrivals wait outside (`berth_blocked_t`, tracked separately, never in the identity).
2. **Conveyor link (jetty → yard)** — the berth→yard boundary IS the conveyor:
   `unload_t_per_day / 24` per tick, block rule: material enters the yard ONLY while the
   yard has room; refused unload stays ON BOARD (`unload_blocked_t`).
   **Cause-traceability (Yasser requirement 2026-10-12):** the blocked quantity is split by
   cause — `blocked_by_berth_t` (arrival refused at berth capacity) and
   `blocked_by_conveyor_t` (unload refused because the yard had no room). The player can
   inspect WHICH rule blocked. New fields are additive; existing fields unchanged.
3. **Yard** — pure buffer at `yard_capacity_t`; dispatch drains at `effective_tph`
   (crane-dependent, existing micro-step 5 rule).
4. **Demurrage** — flat USD/day per ship beyond `free_days`, per-tick accrual,
   per-ship free time (existing verified rule, unchanged).
5. **Bottleneck must emerge from rules:** scenario construction = arrival cadence + berth
   capacity + conveyor rate + yard capacity + dispatch rate. No scripted tutorial failure.

## Scenario construction (test construction, documented)

- Yard starts at ZERO (berth accounting contract: identity scenario must start at zero).
- RNG pinned to the no-fire path via the existing test-only seam (FixedDraws), so no
  breakdown contaminates the scenario; injection stays test-only.
- Assertions at ticks where no day-tick lands (no mid-flight arrival transition), per the
  berth accounting contract.
- The two recorded berth test-construction defects (flag consumed before berth stages;
  yard-full vs yard-zero contradiction) are NOT re-opened — this scenario is built to
  avoid them by construction: yard zero + no drain contamination + cause-split fields.

## Bottleneck the scenario demonstrates (problem 1)

**Construction correction (probe run 2026-10-12, documented honestly):** the original
construction (yard pre-filled to 4958.3333 t, one tick of conveyor room) does NOT make the
bottleneck emerge. Dispatch drains 80 t/tick while the conveyor delivers 41.6667 t/tick —
the yard drains faster than it fills, so it can never fill from the conveyor side: the
probe trace shows yard 3080 → 2198 → 1278 → 358 → 0, `blocked_by_conveyor_t = 0`,
`berth_blocked_t = 0`, demurrage 0, every ship departs after unloading. A bottleneck that
never fires is not a bottleneck. The block can only emerge when the yard fills, i.e. when
the drain at the yard boundary stops.

**Corrected construction (pending Yasser GO — one fresh run):** dispatch outage path,
using existing verified rules only (micro-step 5 crane rule, MTTR 8h): crane down while the
conveyor keeps feeding → yard fills → unload refused → cargo stays on board → ship cannot
depart → berth stays occupied → next arrival refused outside → demurrage bills. Cause-split
fields show WHICH rule blocked (`blocked_by_conveyor_t` then `blocked_by_berth_t`). This is
the authentic mill-operator chain (crane → dispatch → yard → jetty congestion). Alternative
if Yasser prefers a capacity-mismatch path: pin dispatch rate below conveyor rate. No
scripted failure either way.

**Identity note (probe, bookkeeping correction not model bug):** the probe assertion mixed
the hypothetical upstream stream with the per-ship partition across a snapshot boundary.
Correct partition over the same boundary: `accepted = departed + credited_ship +
on_board_ship` (Stage 5 per-ship form). At tick 120 the probe closed exactly:
5000 = 4000 departed + 0 credited + 958.3333 on board + 41.6667 credited at tick 24.
Negative control (double-count must break the identity) genuinely detects.

## Files (exclusive ownership: web/src/ports/slice1/)

- `slice1_berth_yard.ts` — pure tick wrapper over the existing ops port (no rule rewrite);
  cause-split accumulators; scenario builder; sandbox what-if.
- `parity_slice1.test.ts` — vitest test inside the owned dir (vitest nested-path pitfall),
  reads the shared fixture; asserts the bottleneck emerges AND the material identity
  partitions cargo over the same snapshot boundary; negative control: double-count must
  break the identity.
- Fixture: `fixtures/operations_domain3/d3_slice1_berth_bottleneck_seed11_71.json`
  (single-owner fixture format; values from ONE fresh Python run under the shared
  xorshift32 spec, read back once).

## Stop condition

One investigation, one fix, one fresh run; if unresolved, document divergence honestly and
defer — never weaken assertions.
