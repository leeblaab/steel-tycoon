// S4.2 cast-chapter pose projections (PLAN_FORGED Stage 4). Pure TARGETS from the
// EXISTING slice4 sim signals (ccm.busy_ladle_id / remaining_ticks, billet_yard_t,
// "CCM casts ladle" events) — presentation only, never feeds back, no RNG.
// The renderer smooths heavy motion (turret tau ~1.4 s); oscillation/travel are
// wall-clock continuous while casting (a caster mold never stops oscillating).

export const TORCH_HOME_X = 2.35; // hero-authored torch park position (ccm local)

export interface CasterPose {
  turretTarget: number; // rad: 0 = active seat over mold; PI = indexed (waiting)
  moldOsc: number;      // vertical oscillation offset (scene units)
  torchX: number;       // absolute torch x (hero local); renderer applies bindX offset
  casting: boolean;
}

export function casterPoseView(
  ccm: { busy_ladle_id?: string | null; remaining_ticks?: number } | null | undefined,
  tSec: number,
): CasterPose {
  const casting = !!ccm?.busy_ladle_id;
  return {
    turretTarget: casting ? 0 : Math.PI,
    moldOsc: casting ? Math.sin(tSec * 2 * Math.PI * 0.9) * 0.045 : 0,
    torchX: casting ? TORCH_HOME_X + Math.sin(tSec * 0.7) * 0.22 : TORCH_HOME_X,
    casting,
  };
}

// ---- billet yard: instanced rows, hot->cold fade tied to sim billet age ----
// Age = ticks since the last "CCM casts ladle" completion event (existing sim output).
// Each slot = one visual billet; newer slots (higher index) are hotter. Design values
// sme_pending: tonnes-per-slot, cooling window, stagger.
export const BILLET_SLOTS = 18;
export const BILLET_T_PER_SLOT = 10;
export const BILLET_COOL_TICKS = 48;
export const BILLET_STAGGER_TICKS = 6;

export interface BilletYardView { count: number; heat: number[]; }

export function billetYardView(billetYardT: number, ageTicks: number): BilletYardView {
  const count = Math.max(0, Math.min(BILLET_SLOTS, Math.floor(Math.max(0, billetYardT) / BILLET_T_PER_SLOT)));
  const heat: number[] = [];
  for (let i = 0; i < BILLET_SLOTS; i++) {
    const age = Math.max(0, ageTicks) + (count - 1 - i) * BILLET_STAGGER_TICKS;
    heat.push(Math.max(0, Math.min(1, 1 - age / BILLET_COOL_TICKS)));
  }
  return { count, heat };
}

/** Ticks since the most recent CCM cast-completion event; huge when none found (all cold). */
export function lastCastAgeTicks(
  events: Array<{ tick: number; event: string }> | null | undefined,
  currentTick: number,
): number {
  if (!events || !events.length) return 1e9;
  for (let i = events.length - 1; i >= Math.max(0, events.length - 60); i--) {
    if (events[i].event.startsWith('CCM casts ladle')) return Math.max(0, currentTick - events[i].tick);
  }
  return 1e9;
}
