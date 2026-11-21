// S5.4 — mill nod animations: pure projection from TickRecord to visual channels.
// Determinism rule 5 (PLAN_FORGED): these are PURE projections of state — no RNG,
// no clocks. The renderer interpolates between consecutive frames; it never invents.
// Phase bands mirror MILL_PHASE_BANDS in slice5_sim.ts / slice5_mirror.py:
//   reheat 0-0.30, rolling 0.30-0.55, cooling 0.55-0.80, shear 0.80-1.0 of roll_ticks.
export const MILL_BANDS: ReadonlyArray<readonly [string, number, number]> = [
  ['reheat', 0.0, 0.3], ['rolling', 0.3, 0.55], ['cooling', 0.55, 0.8], ['shear', 0.8, 1.0],
];

// Game-balance design value (sme_pending), NOT industry fact: real billet->rebar
// total elongation is ~100-150x from the pass schedule; 12x reads at diorama scale.
export const ELONGATION_TOTAL = 12.0;

// The mill hero GLB's four visible stands (local x). stands_count in the sim is 6
// (the real 6-stand bar mill); the visual map projects the logical stand index onto
// the geometry we actually show — presentation view, never a process claim.
export const STAND_XS = [-1.05, -0.45, 0.15, 0.75];

export interface MillFlow {
  active: boolean;          // a roll cycle is on this batch
  phase: string | null;     // reheat | rolling | cooling | shear
  pp: number;               // progress inside the whole roll (0..1)
  barHeadX: number | null;  // glowing bar head position, mill-local x (null = no bar)
  elongation: number;       // length multiplier while threading stands (1 -> 12)
  bedWalk: number;          // 0..1 across the cooling bed (cooling/shear only)
  glow: number;             // 1 hot orange -> 0 black (cooling fade, SME rule)
  shearing: boolean;
  discharging: boolean;     // reheat discharge window (roll start)
}

function bandOf(pp: number): [string, number] {
  for (const [name, a, b] of MILL_BANDS) {
    if (pp < b || name === 'shear') return [name, Math.min(1, Math.max(0, (pp - a) / (b - a)))];
  }
  return ['shear', 1];
}

/** Pure per-tick projection. `busy`/`elapsed` come from the TickRecord stream:
 *  elapsed = roll_ticks - mill.remaining_ticks at that record (renderer derives it). */
export function millFlow(busy: boolean, elapsedTicks: number, rollTicks: number): MillFlow {
  if (!busy || rollTicks <= 0) {
    return { active: false, phase: null, pp: 0, barHeadX: null, elongation: 1,
      bedWalk: 0, glow: 0, shearing: false, discharging: false };
  }
  const pp = Math.min(1, elapsedTicks / rollTicks);
  const [phase, ip] = bandOf(pp);
  const flow: MillFlow = { active: true, phase, pp, barHeadX: null, elongation: 1,
    bedWalk: 0, glow: 0, shearing: phase === 'shear', discharging: phase === 'reheat' };
  if (phase === 'rolling') {
    // Bar head threads the stands left->right; length grows as it thins.
    const n = STAND_XS.length;
    const s = ip * n;                       // continuous stand index
    const k = Math.min(n - 1, Math.floor(s));
    flow.elongation = 1 + (ELONGATION_TOTAL - 1) * ip;
    flow.barHeadX = STAND_XS[k] + (STAND_XS[n - 1] - STAND_XS[0]) * (s - k) / n;
    flow.glow = 1;
  } else if (phase === 'cooling') {
    // Bars walk out on the cooling bed, glow fading hot -> black (SME non-negotiable).
    flow.bedWalk = ip;
    flow.glow = 1 - ip;
    flow.elongation = ELONGATION_TOTAL;
  } else if (phase === 'shear') {
    // Cold bar at the bed exit being cut to length + bundled.
    flow.bedWalk = 1;
    flow.glow = 0;
    flow.elongation = ELONGATION_TOTAL;
  } else {
    // reheat: billet in the furnace mouth, charge-gate already animated by its own view.
    flow.glow = 1;
  }
  return flow;
}

/** Interpolate between two consecutive per-tick projections for smooth playback. */
export function lerpFlow(a: MillFlow, b: MillFlow, t: number): MillFlow {
  if (!a.active || !b.active) return t < 0.5 ? a : b;
  const mix = (x: number, y: number) => x + (y - x) * t;
  const num = (v: number | null) => (v === null ? Number.NaN : v);
  const an = num(a.barHeadX), bn = num(b.barHeadX);
  return {
    active: true, phase: t < 0.5 ? a.phase : b.phase, pp: mix(a.pp, b.pp),
    barHeadX: (Number.isNaN(an) || Number.isNaN(bn)) ? (t < 0.5 ? a.barHeadX : b.barHeadX) : mix(an, bn),
    elongation: mix(a.elongation, b.elongation),
    bedWalk: mix(a.bedWalk, b.bedWalk), glow: mix(a.glow, b.glow),
    shearing: t < 0.5 ? a.shearing : b.shearing,
    discharging: t < 0.5 ? a.discharging : b.discharging,
  };
}
