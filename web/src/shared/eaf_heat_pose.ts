// S2.2 heat-cycle pose projection (PLAN_FORGED Stage 2 — SME non-negotiables).
// Pure TARGETS from the S2.0 heat-phase enum; the renderer smooths toward them
// (heavy tilt gets a long time constant — hundreds of tonnes never snap).
// Presentation only: never feeds back into the sim, no RNG, deterministic.
//
// SME non-negotiables encoded here:
// - charge: roof swings SIDEWAYS off the shell (rotation about the mast, not a lift)
// - melt: roof closes, electrodes bore down (power on)
// - tap: slow heavy tilt ~30-40 deg on trunnions; stream only once tilt is deep enough
// - electrodes raise + swing away WITH the roof (renderer parents them to pivot_roof)
// - hot ladle glows and travels toward LF; stream off once the ladle leaves the spout

export type HeatPhase = 'charge' | 'melt' | 'refine' | 'tap';

export interface EafPose {
  roofSwing: number;    // rad about the mast: 0 closed .. ROOF_SWING_MAX sideways
  bore: number;         // electrode vertical offset: BORE_RAISED .. BORE_IN
  tilt: number;         // rad on trunnions toward the ladle: 0 .. TILT_MAX
  stream: boolean;      // tap stream target (renderer also gates on ladle position)
  glow: number;         // ladle bath emissive intensity target
  ladleTargetX: number; // EAF-local x: LADLE_HOME_X under spout, LADLE_LF_X at LF
  powerOn: boolean;     // arc glow + state-lamp pulse during melt/refine
}

export const ROOF_SWING_MAX = 1.25; // ~72 deg sideways off the shell
export const TILT_MAX = 0.61;       // ~35 deg — inside the SME 30-40 deg band
export const BORE_RAISED = -0.35;
export const BORE_IN = 0.45;
export const LADLE_HOME_X = 2.15;
export const LADLE_LF_X = 5.0;
export const STREAM_TILT_GATE = 0.35; // tap-progress fraction before steel flows

export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function eafPoseView(
  eaf: { heat_phase?: HeatPhase | null; phase_progress?: number; busy_charge_id?: string | null } | null | undefined,
  ladle: { metal_t?: number; refined?: boolean } | null | undefined,
  opts?: { frac?: number; totalTicks?: number },
): EafPose {
  const phase = eaf?.heat_phase ?? null;
  // Sub-tick interpolation (same wall-clock frac pattern as beltTokenView): a phase band
  // can be exactly 1 tick (tap at the 10-tick fixture cadence), where phase_progress is
  // always 0 — without frac the tilt would never develop. frac = fraction of the current
  // tick elapsed; the renderer passes 1 while paused (hold the end-of-tick pose).
  const BAND_WIDTH: Record<string, number> = { charge: 0.15, melt: 0.55, refine: 0.2, tap: 0.1 };
  const total = Math.max(1, opts?.totalTicks ?? 10);
  const frac = Math.max(0, Math.min(1, opts?.frac ?? 0));
  const bandTicks = phase ? Math.max(1, Math.round(BAND_WIDTH[phase] * total)) : 1;
  const p = Math.max(0, Math.min(1, (eaf?.phase_progress ?? 0) + frac / bandTicks));
  const hotLadle = (ladle?.metal_t ?? 0) > 0;
  const ladleTargetX = hotLadle ? LADLE_LF_X : LADLE_HOME_X;
  // hot ladle glows in transit; during tap the bath heats up as steel lands
  const glow = hotLadle ? 1.8 : phase === 'tap' ? p * 1.2 : 0;
  switch (phase) {
    case 'charge':
      return { roofSwing: easeInOutCubic(p) * ROOF_SWING_MAX, bore: BORE_RAISED, tilt: 0, stream: false, glow, ladleTargetX, powerOn: false };
    case 'melt':
      // roof swings back closed over the first 15% of melt, electrodes bore down
      return {
        roofSwing: (1 - easeInOutCubic(Math.min(1, p / 0.15))) * ROOF_SWING_MAX,
        bore: BORE_RAISED + easeInOutCubic(p) * (BORE_IN - BORE_RAISED),
        tilt: 0, stream: false, glow, ladleTargetX, powerOn: true,
      };
    case 'refine':
      return { roofSwing: 0, bore: BORE_IN, tilt: 0, stream: false, glow, ladleTargetX, powerOn: true };
    case 'tap':
      return {
        roofSwing: 0,
        bore: BORE_IN - easeInOutCubic(p) * (BORE_IN - BORE_RAISED), // power off, electrodes raise
        tilt: easeInOutCubic(p) * TILT_MAX,
        stream: p > STREAM_TILT_GATE,
        glow, ladleTargetX, powerOn: false,
      };
    default: // idle (phase null) — roof closed, electrodes raised, vessel level
      return { roofSwing: 0, bore: BORE_RAISED, tilt: 0, stream: false, glow, ladleTargetX, powerOn: false };
  }
}
