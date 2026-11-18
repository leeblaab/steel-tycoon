// Fullplant LAYOUT table (Roadmap V3 Phase 1, contract clause 6: "the plant layout is a
// layout TABLE, not code"). Positions/sizes are DATA — re-shaping the plant later means
// editing this file only; no component changes.
//
// Z-shape geography (agreed): Slice 1 → 2 → 3 run forward along +X, Slice 3 sits in the
// bend, Slices 4 → 5 turn and run forward again offset in Z. Values are placeholder
// geometry for now; final mill-exact placement is a later pass.

export interface ZoneDef {
  id: 'slice1' | 'slice2' | 'slice3' | 'slice4' | 'slice5';
  name: string;
  pos: [number, number, number]; // zone center on the ground plane
  size: [number, number];        // painted strip footprint (x, z)
  unlockOrder: number;           // quest-gated land unlock order (contract clause 8)
}

export const ZONES: ZoneDef[] = [
  { id: 'slice1', name: 'Slice 1 — Jetty / berth & scrap yard', pos: [-40, 0, -2], size: [26, 15], unlockOrder: 0 },
  { id: 'slice2', name: 'Slice 2 — Prep plant',               pos: [-22, 0,  6], size: [13, 12], unlockOrder: 1 },
  { id: 'slice3', name: 'Slice 3 — DRP + EAF (bend)',         pos: [ -6, 0, 10], size: [20, 14], unlockOrder: 2 },
  { id: 'slice4', name: 'Slice 4 — Meltshop & billet yard',   pos: [ 14, 0,  2], size: [22, 16], unlockOrder: 3 },
  { id: 'slice5', name: 'Slice 5 — Rebar mill & product yard',pos: [ 36, 0, -8], size: [24, 16], unlockOrder: 4 },
];

export const ZONE_BY_ID: Record<string, ZoneDef> = Object.fromEntries(ZONES.map((z) => [z.id, z]));

// Sim clock (contract clause 3): one tick = 15 plant-minutes; Normal ≈ 1 tick/s, Fast = 3x.
export const TICK_MINUTES = 15;
export const NORMAL_TPS = 1;
export const FAST_MULTIPLIER = 3;
