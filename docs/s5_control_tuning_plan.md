# Slice 5 mirror control-tuning patch plan (2026-10-18)

Status: PLAN ONLY — no code changed yet. Pending Yasser approval before applying.

## Context

`python mirror/slice5_mirror.py` as it stands prints `PASS N1 / FAIL N2 / FAIL N3 / FAIL N4`. The fixture's own `expected_outputs.negative_controls` block (RE-DERIVED 2026-10-17 under the lazy-dispatch Option-A decision) already documents why each baseline-form control is weak and what variant proves it. The mirror code was never updated to run those proven variants — so the printed FAILs are stale control scripts, not rule bugs:

- **N2 (crane never releases):** completion divergence is real (`broken dispatch=0 vs healthy 10`), but the assert also demands `crane_wait_ticks > 0`, which cannot fire under lazy enqueue (a stuck crane never re-attempts against an empty yard). Fixture weakness_note says control validity rests on completion divergence.
- **N3 (capacity refusal):** capacity 40 t never fires because lazy dispatch drains the yard at production cadence (peak = one 9.8 t batch). Fixture proves reachability separately: **capacity 5 t → 10 refusals at roll-completion ticks [11,18,…,74], balance closed**.
- **N4 (double-count):** seam only shows a residual when product is resident in the yard at measurement; lazy dispatch empties it. Fixture proves the variant: **dispatch_crane.move_ticks = 10 → 8.4 t resident → −8.4 residual**.

## Proposed minimal changes (mirror test code only — zero production-rule changes)

1. **N2:** assert completion divergence (`broken == 0 and healthy > 0`); drop the `crane_wait_ticks > 0` conjunct; keep the documented weakness note in the detail string.
2. **N3:** change control capacity 40 → 5 (the proven variant); assert refusals == 10 at ticks [11,18,…,74] and balance closed.
3. **N4:** run the broken control with `dispatch_crane.move_ticks = 10` (resident-yard variant); assert healthy residual ≈ 0 and broken residual < −8 (i.e., |residual| > 1). Healthy reference run stays baseline-form.

No changes to `tick()`, `run()`, `validate_scenario()`, or the fixture scenario values. Expected result after patch: N1–N4 all PASS from a single honest run, matching the fixture's negative_controls documentation.

## Follow-up (after approval)

Re-run once; if green, the mirror is the frozen parity source for the TS port (backlog item 2 in `docs/phase0_implementation_map.md`). Fixture `status: proposed` stays until Yasser accepts it.
