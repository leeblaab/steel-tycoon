# S4 Gap Check — mirror verification + run-vs-fixture comparison

Date: 2026-10-19 · Method: line-level inspection of `mirror/slice4_mirror.py` (403 lines)
plus a fresh mirror run, cross-checked against `fixtures/slice4/s4_eaf_lrf_ccm_billet_seed11_120.json`.
TS side (`web/src/ports/slice4/browser/sim.ts`, 427 lines) inspected only to adjudicate the audit's claims.
No file other than this one was created or modified; the mirror was **not** patched.

---

## 1. Per-gap verdicts

### Gap 1 — "hardcoded yields vs runtime-loaded `content/scrap/scrap_tiers.json`"
**Verdict: REFUTED for the mirror · CONFIRMED for TS.**

Mirror evidence:
- L39 `SCRAP_PATH = os.path.join(REPO, 'content', 'scrap', 'scrap_tiers.json')`
- L52–55 `load_scrap_tiers()` → `{g['id']: g for g in doc['grades']}`
- L91 `_yield_pct` returns `100.0 - tiers[grade]['yield_loss_pct']` (DRI branch L89–90 reads the fixture's `yield_convention.dri_yield_pct`)
- L160 loss computed per composition row through `_yield_pct(..., tiers, fx)`
- L391 `tiers = load_scrap_tiers()` in `__main__`

The mirror loads the JSON at runtime on every run; nothing about grade yields is hardcoded.
TS side (L109–112) hardcodes `grade_yield_loss_pct: { hms1_hms2: 5.0, bushing: 3.0, shredded: 8.0 }`.
Values verified identical to the JSON today (`hms1_hms2` 5.0, `bushing` 3.0, `shredded` 8.0), so no numeric drift yet — but the audit's drift risk (content is Yasser-calibrated) is real for TS only.

### Gap 2 — "missing `dri_materials` ledger with per-item `consumed_t`"
**Verdict: REFUTED for the TS claim about the mirror being richer than described · CONFIRMED for TS.**

Mirror evidence:
- L62 `'dri_materials': []` in state; L299–304 seeded from `scenario.dri_plan` with `'consumed_t': 0.0` (L303)
- **However**, `consumed_t` is *never written anywhere* in the file — no assignment outside its initialization. After a full 120-tick run all five records read `consumed_t = 0.0` (verified by replay).
- L251–258 documents the deliberate decision (Yasser, 2026-10-15): the ledger is **informational only**, not a balance term; DRI tonnage enters the identity via the charge's `grade_composition` at heat consumption. Counting it again double-counts.

So the mirror has the *field* but it is a vestigial, always-zero placeholder — a contract-shaped record, not a live ledger. The audit overstates the mirror ("keeps a per-item `consumed_t`"). TS genuinely lacks any DRI material lineage: `dri_plan`/`dri_deliveries` are scenario config (L93, L101), no `dri_materials` state array, no `consumed_t`.

### Gap 3 — "no explicit `bath_t` state field"
**Verdict: CONFIRMED for TS · mirror has the field but it is dead.**

Mirror evidence:
- L65 `'eaf': {..., 'bath_t': 0.0}` — the field exists in state
- L147 `eaf['bath_t'] = 0.0` at heat start (the only write)
- Replay over all 120 ticks: `eaf['bath_t']` distinct values = `{0.0}` — **it never becomes non-zero**
- The *actual* balance bath is a local recomputation at L277–280 from charges with `status == 'in_furnace'`. On 50 of 120 ticks the derived bath is 40.0 t while the state field reports 0.0 (max divergence 40.0).
- The per-tick snapshot (`records`, L317–326) does not expose bath at all, and the fixture's `expected_outputs` never mention it.

TS evidence: L164/189 `eaf: { busy_charge_id; remaining_ticks }` — no `bath_t`; bath derived locally at L375–377, identical formula to the mirror's balance term.

Net: both implementations derive the bath from charge status for the identity (so they are observationally equal), but **neither maintains a truthful live `bath_t` state field**. The mirror's is worse in kind: it advertises a field that is structurally always zero, which is exactly the shape a shared inventory registry (§8.1) would consume incorrectly.

### Gap 4 — "negative controls modeled differently"
**Verdict: CONFIRMED (real divergence), fixture-neutral.**

Mirror evidence:
- N2 L348 `fx2['scenario']['ccm_ticks_per_ladle'] = 10**6` — knob-based, matches the fixture's `ladle_never_released` semantics via the same code path.
- N4 L380–383 double-count control **arithmetically subtracts** `st['billet_yard_t']` from the residual (`dc = residual - billet_yard_t`) — no phantom record is injected into state.

TS evidence: L329–332, L349 models N2 as a branch `if (variant !== 'ladle_never_released')` ("never release the ladle"), and its own header carries `[OPEN QUESTION]` flagging that this stands in for `ccm_ticks_per_ladle = 10**6`; the double-count control injects a phantom entry.

Divergence is real at the modeling level, but observable outcomes agree: fixture `negative_controls` assert only outcome tuples (`casts_completed == 0`, `ladle_wait_ticks > 0`, `double_count_residual > 1.0`) and both sides satisfy them. Fixture-neutral, representation-divergent.

---

## 2. Fresh run vs fixture `expected_outputs`

Command: `cd C:/AI_LAB/SteelX && python mirror/slice4_mirror.py` (exit 0). Event ticks and key
ticks verified programmatically by replaying `run()` and filtering `records`.

### Console output (verbatim)
```
scenario: s4_eaf_lrf_ccm_billet_seed11_120
win: True
heats tapped: 5  starved: 65
refines: 5  casts: 5
ladle wait ticks: 0  caster wait ticks: 0
energy: 120000.0 kWh (SEC 600.0 kWh/t, source-backed band, per-heat application engineering-estimate)
billet yard: 186.935 t
balance error at end: 0.0
negative tests:
  PASS N1 no-charge starvation (no fabricated heat, balance closed) — tapped=0 starved=120 balance=0.0
  PASS N2 ladle-cycle non-release diverges from healthy — broken casts=0 healthy casts=5 broken ladle_wait=56
  PASS N3 caster wait fires iff physically reachable (fixture cadence: asserts 0) — reachable=False caster_wait=0
  PASS N4 double-count control detects via balance — healthy residual=0.0 double-count residual=-186.935
```

### Comparison table — every `expected_outputs` value vs actual

| Category | Key | Expected (fixture) | Actual (mirror run) | Match |
|---|---|---|---|---|
| events | heat_starts | [1,12,24,36,48] | [1,12,24,36,48] | ✅ |
| events | taps | [11,22,34,46,58] | [11,22,34,46,58] | ✅ |
| events | refines_complete | [14,25,37,49,61] | [14,25,37,49,61] | ✅ |
| events | casts_complete | [19,30,42,54,66] | [19,30,42,54,66] | ✅ |
| events | maintenance_events | [60,90] | [60,90] | ✅ |
| events | shift_changeovers | [30,60,90] | [30,60,90] | ✅ |
| key_ticks | 19.ladles_free / billet_yard_t / balance_error | 1 / 37.387 / 0.0 | 1 / 37.387 / 0.0 | ✅ |
| key_ticks | 30.ladles_free / billet_yard_t / balance_error | 1 / 74.774 / 0.0 | 1 / 74.774 / 0.0 | ✅ |
| key_ticks | 66.ladles_free / billet_yard_t / balance_error | 2 / 186.935 / 0.0 | 2 / 186.935 / 0.0 | ✅ |
| material_balance | balance_error_at_end (tol 1e-9) | 0.0 | 0.0 | ✅ |
| counters@120 | heats_tapped | 5 | 5 | ✅ |
| counters@120 | heats_starved | 65 | 65 | ✅ |
| counters@120 | refines_completed | 5 | 5 | ✅ |
| counters@120 | casts_completed | 5 | 5 | ✅ |
| counters@120 | charge_wait_ticks | 0 | 0 | ✅ |
| counters@120 | ladle_wait_ticks | 0 | 0 | ✅ |
| counters@120 | caster_wait_ticks | 0 | 0 | ✅ |
| counters@120 | energy_kwh_total | 120000.0 | 120000.0 | ✅ |
| counters@120 | billet_t_total | 186.935 | 186.935 | ✅ |
| negative_controls | no_charge_delivery: tapped / starved / balance_closed | 0 / 120 / true | 0 / 120 / 0.0 (closed) | ✅ |
| negative_controls | ladle_never_released: casts / ladle_wait>0 / diverges | 0 / >0 / true | 0 / 56 / true | ✅ |
| negative_controls | caster_wait_reachability: fires false, asserts ==0 | fires=false, 0 | reachable=False, caster_wait=0 | ✅ |
| negative_controls | double_count_control: healthy_residual / dc>1.0 | 0.0 / >1.0 | 0.0 / \|−186.935\| = 186.935 > 1.0 | ✅ |

Additional invariant beyond the fixture: `balance_error` is exactly 0.0 on **all 120 ticks**
(max abs error 0.0), not only at tick boundaries. `win: True`.

**Result: 23/23 assertions match, zero mismatches.**

---

## 3. Genuine mirror weaknesses to fix before the mirror is used as parity source

Ordered by impact on a TS port. Described only — **no patches applied**.

1. **`eaf['bath_t']` is a dead field (highest priority).** Declared L65, written once to `0.0` at
   L147, never updated; the real bath lives as a local variable in the balance stage (L277–280).
   A parity port copying the *shape* would faithfully reproduce a field that lies 40 t on half the
   ticks — precisely the §8.1 "independent copy of production inventory" hazard, and it is worse
   than TS's honest absence.
   *Proposed minimal patch:* set `eaf['bath_t']` to the charge's total `actual_usable_t` at heat
   start (replace L147), zero it at tap (in the L155–173 completion block), and replace the local
   recomputation at L277–280 with `bath = eaf['bath_t']`. Balance output is unchanged (verified:
   derived bath equals charge tonnage exactly for all 50 residence ticks), so fixtures stay green.

2. **`consumed_t` never written.** Vestigial per-item field, always 0.0 after a full run.
   Either populate it at heat consumption (add `+= row['actual_usable_t']` to the matching
   `dri_materials` record inside the tap loop L159–162 when `row['grade'] == 'DRI'`) while keeping
   it out of the balance identity per the documented 2026-10-15 decision, **or** delete the field
   and label the ledger explicitly informational. A TS port should not be asked to reproduce a
   field that never changes.

3. **N4 double-count control is arithmetic, not state-level.** `dc = residual - billet_yard_t`
   (L382) perturbs the formula rather than injecting a duplicate record, so it cannot catch a
   *double-add* bug in the accumulation code at L222–223 — only a mis-signed identity.
   *Proposed minimal patch:* run a second pass with an extra `s['billet_yard_t'] += billet` injected
   in the CCM completion block via a flag, and assert that run's residual exceeds 1.0.

4. **N3 guard uses `ladles >= 3` (L370) while the fixture clause says `ladles >= 2`**
   (`negative_controls.caster_wait_reachability.requires`). At the shipped cadence both evaluate to
   *unreachable* so results agree, but a future config at `ladles == 2` with an inside-window LRF
   completion would be wrongly declared unreachable by the mirror. Align the constant or document
   the stricter bound as intentional.

5. **Fixture drift note (not a code fix).** The fixture's `feasibility_check` narrative (L240)
   hand-derives taps at 12/23/35/47/59 and casts at 22/33/45/57/69, which disagree with the
   authoritative `expected_outputs` (11/22/34/46/58; 19/30/42/54/66) that the mirror produces. The
   fixture's own note already defers to the mirror as arbiter, so this is stale prose only — flag
   it when the fixture next moves from `status: "proposed"`.

---

## 4. Go / no-go recommendation for the S4 TS parity port

**GO — conditional.** The mirror matches its fixture on all 23 assertions with balance closed every
tick and all four negative controls passing, so it is a sound parity source as *behavior*. Two of
the audit's four gaps are refuted against the mirror (yields are runtime-loaded; the ledger field
exists), one is confirmed on TS only (DRI lineage), and one — `bath_t` — is worse than the audit
described because the mirror carries a dead, always-zero field.

Recommended sequence: apply fix 1 (`bath_t`) and resolve fix 2 (`consumed_t`: populate or delete)
in the mirror **first**, re-run against the fixture (both are balance-neutral, so fixtures should
stay green), then port line-by-line in the S1 pattern with `parity_slice4.test.ts` asserting the
full `expected_outputs` table above plus all four negative controls. Fixes 3 and 4 can travel with
the port. If fix 1 is skipped, the port inherits a state field that contradicts its own balance
identity — the exact divergence class §8.1 exists to eliminate.
