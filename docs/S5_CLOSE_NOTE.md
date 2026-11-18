# S5 Close Note — Billet→Rebar Dispatch & Order Fulfilment (2026-10-17)

## Status: CLOSED at demo level (Option A decision by Yasser)

**Decision recorded:** the lazy dispatch rule is canonical — a dispatch attempt takes
`min(stock, order_remaining)` at the moment it starts; a new attempt enqueues lazily per the
crane_task contract. The fixture's `expected_outputs` block was re-derived from a fresh mirror
run; **no scenario values were touched** (verified byte-identical to git HEAD).

## What the fresh run proves (fixture expectations == run, field by field)

- Pipeline: 10 carrier moves (starts 1,6,…,46 — 5-tick cadence from non-preemptive cycles),
  10 rolls (completions 11,18,…,74), 10 dispatch moves (starts 11,18,…,74).
- Orders: O1 completed @35 (<60), O2 completed @63 (<90), **O3 partial 19.6/30 t — stock-limited**:
  opening 100 t billet → 98 t product; whole-batch pipeline leaves only 19.6 t for O3. Last
  dispatch completes @74, well before O3's deadline (120): the pipeline itself is proven able to
  serve O3 if opening stock covered demand (~110 t needed). `win: false` with this note in the fixture.
- Material balance closes every tick (residual ~2e-14); blocked-attempt counters asserted
  separately from inventory terms.
- Revenue 62 230 USD = dispatched t × price_mid 635.0 (B500B, `sme_pending` band midpoint —
  convention stated explicitly in the fixture).

## Known limitations (documented, deferred to the later tuning pass)

1. **O3 demo miss** — scenario-data fix (opening stock or order sizes) not applied yet.
2. **N2 crane-stuck control**: diverges on completions (0 vs 10) but `crane_wait_ticks` stays 0
   under lazy enqueue (a stuck crane never re-attempts against an empty yard). Control validity
   rests on the completion divergence.
3. **N3 capacity-40 control does not fire**: lazy drain matches production cadence exactly, so
   product-yard peak is one 9.8 t batch; capacity 60 t unreachable (baseline asserts refusals==0).
   Reachability proven separately at capacity 5 t → 10 refusals with balance closed.
4. **N4 double-count seam control** needs resident yard product to show a residual; verified via
   variant dispatch_crane.move_ticks=10 (yard 8.4 t, broken residual −8.4). Baseline form is weak.

## Files changed this round
- `fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json` — expectation block only
  (events, key_ticks, counters@120 incl. revenue, win=false + note, negative_controls notes).
- No engine or mirror logic changes in the S5 round; no commits made.
