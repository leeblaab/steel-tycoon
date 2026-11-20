// S3.2 state lights (PLAN_FORGED §2 state grammar): idle = desaturated, running =
// stream-green pulse, blocked/starved = AMBER ring. Pure projection of the EXISTING
// sim signals — zone inspection tone (busy/idle/waiting, already derived from the
// slice events by inspection_cards) plus the S3.1 feed shortfall. Presentation only.

export type MachineTone = 'busy' | 'idle' | 'waiting';

export interface StateLightView {
  color: string;   // ring color (hex)
  pulse: boolean;  // opacity/color breathing while active
  amber: boolean;  // blocked/starved — the "where it hurts" signal
  level: number;   // base brightness 0..1
}

export const AMBER = '#ffb347';   // STATE.blocked_ring (palette.ts)
export const RUN_GREEN = '#59e6a0';
export const IDLE_GRAY = '#5a6673';

export function stateLightView(tone: MachineTone | null | undefined, feedShortfall: boolean): StateLightView {
  // Shortfall overrides even a busy tone: the furnace is running but its feed is short.
  if (feedShortfall || tone === 'waiting') return { color: AMBER, pulse: true, amber: true, level: 0.9 };
  if (tone === 'busy') return { color: RUN_GREEN, pulse: true, amber: false, level: 0.55 };
  return { color: IDLE_GRAY, pulse: false, amber: false, level: 0.2 };
}

// S3.2 EAF feed-amber signal: a shortfall event THIS tick, or the persistent condition
// "EAF scrap interface empty" (the furnace has nothing to charge until the next delivery).
export function feedAmberSignal(shortfallThisTick: boolean, eafScrapUsableT: number): boolean {
  return shortfallThisTick || eafScrapUsableT <= 0;
}
