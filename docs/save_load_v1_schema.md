# Save/Load v1 — snapshot schema (Roadmap V3 §13 mark: Phase 1 minimal versioned snapshot)

Design decisions locked for implementation (no per-field approval loop; Yasser's "go, not micro" instruction):

1. **Whole-state serialization.** Every hub slice state is JSON-plain data
   (numbers, strings, booleans, arrays, records — verified: slice3 SimState,
   slice4 Slice4State, slice5 Slice5State, and the PRNG lives INSIDE the state:
   `prng_state` in slice3 (xorshift32 word), no RNG in slice4/5 dispatch logic).
   The snapshot therefore stores the entire state verbatim — nothing to hand-pick.
   Rationale: a hand-picked field list silently drops fields on every sim change;
   whole-state + schema_version is what makes restore provably identical (the
   determinism test asserts restored→run N ticks == uninterrupted run).

2. **Versioned envelope** (`schema_version` reject-never-default, same rule as configs):

   SaveFile { format: "steelx-save", format_version: 1, saves: Record<slot, GameSave> }
   GameSave {
     schema_version: 1          // snapshot schema version; loader rejects mismatches
     saved_at: ISO string       // display only
     slice_id: string           // which catalog entry this resume belongs to
     tick: number               // mirror of state.tick (redundant, cross-checked)
     rng_state: { word: number | null }  // explicit RNG capture: xorshift32 word when the
                                         // slice has one (slice3), null otherwise — mirrors
                                         // the Python dump_prng_state model; also present
                                         // inside state, loader asserts both agree
     state: unknown             // full sim state, verbatim
   }

3. **Storage:** localStorage under key `steelx.saves.v1` (mobile-friendly later via a
   storage adapter interface; the hub passes one so tests can use an in-memory map).
   Slots: named string keys ("main" default). New game = fresh loop; continue = load slot.

4. **Integrity checks on load:** schema_version match, slice_id known to catalog,
   state.tick === tick, rng_state.word === state.prng_state when applicable, and the
   registry balance check must pass on the restored state (a save that fails the ledger
   is rejected — you cannot load a corrupted world).
