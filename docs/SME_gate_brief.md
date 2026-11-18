# SteelX — SME Decisions Gate Brief (Roadmap V3 §15 gate)

Prepared 2026-10-18 from live repo evidence (fixtures, mirrors, git history). Four decisions to settle in chat with Yasser. **No code during the gate.** Decision text lands as 【MARKED】 entries in `docs/Raodmap V3.md` once approved.

Evidence pulled: `fixtures/slice2/s2_scrap_charge_scenario_seed11_120.json` (frozen a160825), `mirror/slice2_mirror.py`, `fixtures/slice3/*` (both fixtures read in full), git log `ad37d61` / `d3614e6`, `mirror/slice4_mirror.py`, `mirror/slice5_mirror.py`.

---

## Decision 1 — S2 priority story (blocks Phase 3 gameplay design)

**The mechanic (verified in mirror):** crane is a single shared resource; queue sorts by `(priority, FIFO)`; **non-preemptive** — player priority reorders *queued* tasks only (`_next_queued`, `slice2_mirror.py:94-100`). Receiving tasks default priority 2; an approved Option-A pattern has charge-related work outrank receiving (mirror comment lines 136-139).

**Why it is inert in the frozen fixture:** the a160825 run wins with C3 slack of only 9 ticks, but no scenario in the fixture demonstrates a priority change altering any readiness time. The rule text ("queue priorities must have a visible, understandable effect") has no demonstrable gameplay case.

**Options:**
- **(a) Engineer a collision scenario** — content-only change (no sim rule change): backlog receiving + reclaim + charge tasks so two queued tasks compete for the crane right before a deadline; priority 0 vs 2 flips which charge makes its deadline. Design target: slack ≤ grab-duration gap (~5-15 ticks) at the decision tick, mirroring how tight C3 already is (slack 9). Pro: keeps the §4.2 rule intact and teaches queue management directly. Con: one more fixture to freeze + a small mirror run to derive expectations.
- **(b) Soften the §4.2 Level-2 rule text** — drop "visible, understandable effect" to "priorities exist and reorder queued work." Pro: zero new content. Con: removes a genuinely good teaching hook (queue priority is real mill practice) and weakens quest design room in Phase 3.

**Recommendation:** (a). The tight-slack geometry already exists in the frozen run; a collision fixture reuses it cheaply, and priority management is one of the most transferable real-world crane-yard lessons.

---

## Decision 2 — S3 starvation fixture (blocks Phase 4 quest 5)

**Verified current state:** the contradiction recorded in git `ad37d61` ("identical DRP params, opposite expectations") **is already resolved on disk**. The approved parameter change was applied under Yasser GO 2026-10-15 (fixture note): `heat_plan` cadence 10 ticks → demand 2.0 t/tick exceeds effective supply 2.0 t/tick at the mirror's 20 t heat, with trips at 20/45/70 breaking the balance.

- `s3_dri_buffer_scenario_seed11_120.json` (starve): win **false**, heats H30/H50/H80 skipped with cause `buffer_starved`, starve_ticks [30, 50, 80] — expectations re-derived from the single mirror run.
- `s3_fill_negative_seed11_120.json` (fill): win **true**, blocked ticks at capacity — a genuinely different scenario (heat_plan cadence 20).

Both fixtures now assert mirror-derived values and the mirror validates both buffer states plus cause attribution (`buffer_starved` vs `plan_overdraw`).

**Decision needed:** confirm this resolved state is the SME-approved baseline for Phase 4 quest 5 ("Resolve a supply interruption" = H30/H50/H80 starvation pattern), or request parameter recalibration (e.g. trip cadence, buffer thresholds) before freezing it into quests.

**Recommendation:** accept as-is; all four scenario parameters are labeled `game-balance` provenance so they can be retuned later without touching rules. The only value with an industry label is `capacity_t` (engineering-estimate).

---

## Decision 3 — Billet grade contract (blocks Phase 5/6 plumbing)

**Verified asymmetry:**
- **S4 side carries grades upstream:** EAF consumes `grade_composition` rows and applies per-grade yield (`_yield_pct`, scrap tiers) — but its output is a scalar `billet_yard_t`. The grade information is *consumed and lost* at casting.
- **S5 side needs grades downstream:** orders carry `product_grade` priced via `content/prices/price_ladder_draft.json`; the billet yard is tonnage-only (`billet_yard_t`, carrier batch moves). Today the §4.2 hedge "if required by the current Slice 5 contract" resolves to *not required* — any billets satisfy any order.

**Options:**
- **(a) Add grade/compatibility to the billet entity in V3.** Real practice supports it (rolling lines are grade-family-specific). Cost: touches S4 output events, a new billet-batch structure in the shared registry, S5 allocation logic, and re-derived expectations in both mirrors — the most expensive of the four gate decisions.
- **(b) Declare compatibility out of V3 scope explicitly.** Keep tonnage-only billets; orders constrain product grade only at the finished-goods end (mill output grade is fixed per mill line). Cost: zero plumbing now; §4.2 rule text gets an explicit "not modeled in V3" mark so nobody rediscovers it during Phase 6.

**Recommendation:** (b) for V3, with a recorded intent that grade routing is a post-V3 extension point at the billet entity. It preserves the honest "no fabricated inventory / no invisible rule" principle by *naming* the simplification instead of silently letting two orders demand incompatible billets that the sim can't see. If (a) is chosen, it must land before Phase 5 handoff, not during Phase 6 integration.

---

## Decision 4 — Save snapshot scope confirmation (Phase 1 shell)

**Agreed minimum (§13 mark):** versioned snapshot of **tick + running/paused state + inventories + unlocks + RNG state**; placement/connections/quest progress added incrementally as each phase produces them. No server backend; browser local persistence (localStorage + export/import JSON).

**Confirmation asked:** approve the v1 snapshot schema exactly as:
`{ save_version, level_id, tick, running, rng_state, inventories[], unlocks[], quest_progress? }`
— `quest_progress` included from Phase 2 (quests exist by then), `placement/connections` from Phase 2 (guided slots), invalid/incompatible saves fail with a clear message rather than silent reset.

**Recommendation:** approve as written; it matches §13.1's preserved-state list minus what doesn't exist yet, and versioning guards every later phase.

---

## After the gate

Phase 1 kickoff: consolidation plan for the four `sim.ts` reimplementations (verdicts in `docs/phase0_audit_sims.md`), shared tick loop + inventory registry, minimal save/load per Decision 4.
