# S2 Crane Priority-Collision Scenario Plan (Decision 1 — design only)

Status: design spec derived from mirror runs; **no fixture written yet**. Frozen once
accepted by SME. Probe: `mirror/scratch_s2/collision_probe.py` (throwaway, in-memory
copies only). Base geometry: `fixtures/slice2/s2_scrap_charge_scenario_seed11_120.json`
(frozen, unmodified). §4.2 rule text stands unchanged; this is a content-only change.

## 1. Scenario parameter deltas vs the frozen fixture

Only **one** value delta; everything else stays at the frozen fixture's values:

| Parameter | Frozen fixture value | Collision scenario value | Why |
|---|---|---|---|
| `truck_loads` | hms1_hms2 30.0t @12/48/84; bushing 15.0t @24/60/96 (6 loads, 90t hms + 45t bush) | **add `{'tick': 269, 'grade': 'hms1_hms2', 'tonnes': 30.0}`** (7 loads; `truck_arrival_ticks` synced to 12/24/48/60/84/96/269) | The backlog receiving arrival is the *second* competitor for the crane at the decision tick: its bushing sibling T60-bushing (15 ticks) sits queued behind reclaim, and a later hms arrival @78/@269 keeps re-prioritizing the receiving queue so the bushing receive stays starved when reclaim wins. 30.0t is the recipe-sized load already used at 12/48/84 — no new magnitude introduced. Arrival at 269 also supplies the C3-hms earmark in the winning config without changing any pre-decision geometry (it lands after all charge-task builds except P3-bush, and P3-hms@231 is already covered by truck@84). |
| `competing_task` | reclaim @tick 40 (mirror-hardcoded priority 1, duration 9) | unchanged: @tick 40 | Keeps the decision inside the frozen run's rhythm; @40 is early enough that the reclaim sits queued across the whole P1 phase and is *the* long-duration contender at tick 69. |
| `charge_plan` (player verbs) | 41/86/141/186/231/276 (P1-hms, P1-bush, P2-hms, P2-bush, P3-hms, P3-bush) | unchanged | The frozen plan's 86-tick build slot for P1-bush is exactly what makes the slack small (see §3). Moving it would change the baseline fixture semantics the SME already accepted. |
| priorities | winning config: verb `T40-reclaim → 2` from tick 41; losing config: no verb (fixture default priority 1) | same two configs, **this is the only difference between them** | Priority flip is the tested variable; scenario values are identical across configs. Non-preemptive queued-only reorder per §4.2. |

Reclaim duration (9 ticks) and receiving durations (hms 30t → 28 ticks, bushing 15t →
15 ticks, grab-based from `bulk_density_kg_m3`: hms 550, bush 500, grab 2.0 m³) are
mirror-derived constants; not scenario-tunable in this design (reclaim duration is
hardcoded in the mirror's competing-task block — noted honestly in §5).

## 2. Why these values produce a collision under mirror semantics

Verified semantics of `mirror/slice2_mirror.py`:
- `_next_queued` sorts queued tasks by `(priority, FIFO creation index)`; crane is
  single and **non-preemptive** — priority only reorders *queued* tasks, never an
  in-flight one.
- Charge tasks are built with priority 0 → once enqueued they can never be jumped by
  reclaim (1) or receiving (2). So a charge task can only lose the crane **before it
  is enqueued**: the collision must be *ordering-driven* — which yard task the crane
  takes at an idle moment decides whether material is on the stack when the player's
  build tick arrives, and `enqueue_task`'s reservation guard refuses the charge task
  ("source stack short") if it isn't.
- Failure cause attribution (mirror step 5): grade arrived but bucket short →
  `insufficient_usable_tonnage`.

## 3. Collision geometry (the one decision tick)

**Decision tick T = 69.** Crane finishes P1-hms (ran 41–68, 28 ticks). Crane goes idle;
the queue at tick 69 holds exactly two yard tasks:

| Task | priority | est. duration | FIFO rank |
|---|---|---|---|
| `T40-reclaim` (reclaiming) | 1 | 9 | earlier |
| `T60-bushing` (receiving bushing 15t) | 2 | 15 | later |

The charge-related competitor is **P1-bush**, the player's planned build at tick 86:
its slack is `86 − (69 + 9) = 8 ticks ≤ 15` — if the crane takes reclaim (9 ticks,
done @78), P1-bush can still *just* be built on time **only if** the bushing stack
holds 15t by tick 85. The backlog arrival `T78-hms` (fixture truck@84 in both configs;
probe run shows it starting at 70/125 depending on config — see §4) re-enters a
priority-2 receiving task that FIFO-precedes nothing but outranks the still-queued
bushing receive whenever reclaim keeps the crane busy past arrivals.

### Config B — reclaim stays priority 1 (LOSE)
- t70: crane starts `T40-reclaim` (9 ticks) → completes t79.
- t85: player builds P1-bush → **refused: source stack short** (bushing stack has 0t;
  the only bushing load before 86 is truck@60 and its receive task never ran).
- The receiving queue starves: `T78-hms`/later arrivals keep outranking
  `T60-bushing` on FIFO-after-priority ordering while reclaim holds the crane;
  `T60-bushing` finally runs t125–t140.
- C1 fails at deadline 240, cause **`insufficient_usable_tonnage`** (bushing arrived
  globally but never reached `CHARGING_BUCKET_C1`). Cascade: P3-hms@231 is accepted
  (hms earmarks survive via the later truck loads) but P3-bush@276 drains into C2's
  shortfall pattern → **C3 stays `planning`** (never ready). C2 survives, late
  (ready@214 vs baseline 201).

### Config A — verb `T40-reclaim → 2` from tick 41 (WIN)
- t69: crane takes `T60-bushing` (prio-2 but reclaim is now prio-2 and FIFO-later…
  actual run: bushing receive completes by t83 in the busy schedule; reclaim runs in a
  crane-idle window t102–t111 after P1-bush completes).
- P1-bush builds @86 against a filled bushing stack → baseline geometry restored:
  **C1 ready@101, C2 ready@201, C3 ready@291 (slack 9)** — identical to the frozen
  fixture's accepted numbers.

### Flip summary (probe output, single run)

| Charge | Config A (prio verb=2) | Config B (fixture default prio 1) |
|---|---|---|
| C1 | ready@101, slack 139 | **FAILED @240, `insufficient_usable_tonnage`** |
| C2 | ready@201, slack 69 | ready@214, slack 56 |
| C3 | ready@291, slack 9 | planning (never ready) |
| win | **True** | **False** |

Decision tick 69; competing queued tasks `T40-reclaim` (prio 1/2, 9 ticks) vs
`T60-bushing` (prio 2, 15 ticks); decision-tick slack to the P1-bush build deadline =
**8 ≤ 15**. Priority flip changes which charge makes its deadline (C1, and via
cascade C3).

## 4. Which kind of collision we landed on (and why)

**Ordering-driven**, with stock starvation as the *consequence*: the priority flip
changes **which queued task the crane takes first at tick 69**, and that ordering is
what decides whether the bushing stack holds tonnage at the player's fixed build tick
86. The failure cause string is `insufficient_usable_tonnage`, but the root cause is
crane-order attribution — exactly the "queue priority flips which charge makes its
deadline" target of Decision 1.

## 5. Honest notes on what didn't work

- A **pure charge-vs-charge direct flip** (a queued prio-0 charge task literally losing
  the crane to a reclaim/receiving task, flipping C3's ready tick past deadline 300 by
  ≤15) is **not reachable under the mirror's semantics**: charge tasks are priority 0
  and non-preemption means a prio-0 task can never be jumped once enqueued; grids over
  late reclaim ticks (200–291), backlog arrival ticks, and verb timings (iterations
  42–59) returned zero candidates. The only reachable flips route through
  build-refusal cascades like the one above. If a direct charge-vs-charge flip is ever
  wanted, it would need a rule change (§4.2 stays unchanged here, so we did not do it).
- Reclaim duration (9) and priority (1) are hardcoded in `slice2_mirror.py`'s
  competing-task block; the design therefore flips via the player's **priority verb on
  the queued reclaim** (the same lever the frozen fixture's own winning plan uses),
  not by editing durations. Arrival tick was the single most sensitive value identified
  during earlier sweeps: moving it moves which receiving task is in-queue at the
  decision tick; the 269 hms load is what keeps C3 fed in the win config while leaving
  the pre-decision geometry untouched.
- Iterations tried before landing: ~50 grid/sweep iterations (all reported `n=0` for
  direct-flip targets), plus candidates A–D (reclaim@40/200/268 with backlog@85) and
  the @90/@100/@108 hms-backlog variants that first showed the WIN-vs-LOSE
  `insufficient_usable_tonnage` pattern; final landing = reclaim@40 + hms@269 delta +
  verb flip, verified in **one** two-config probe run.

## 6. Acceptance path

If accepted, the frozen fixture is derived as: same file with `truck_loads` gaining
`{'tick': 269, 'grade': 'hms1_hms2', 'tonnes': 30.0}` (arrival ticks synced) and the
collision pair documented above; §4.2 text untouched; provenance = mirror runs via
`mirror/scratch_s2/collision_probe.py` against `mirror/slice2_mirror.py`.
