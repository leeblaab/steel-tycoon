// Shared sim-run state + fixed-rate transport (Roadmap V3 Phase 1, backlog items 4+5).
// The five slice browser mains each hand-rolled the same pattern: a setInterval at a
// fixed tick rate (120–160 ms) stepping an impure mutable sim. The hub replaces that
// with: (a) SimRun — the pure accumulator over any parity port's `tick(state) -> state`,
// and (b) FixedTickTransport — a setInterval driver that advances ONE logical tick per
// interval while the UI frame rate stays independent of sim speed.
// No per-slice imports; works with any state whose advance is `(state) => state`.

import { useEffect, useRef } from 'react';

/** Minimal seam every parity port satisfies: an immutable advance of one logical tick. */
export type TickAdvance<S> = (state: S) => S;

/** One accumulator step: advance the sim and append this tick's events. Pure. */
export function stepRun<S extends { tick: number; events: Array<{ tick: number; event: string }> }>(
  run: { state: S; log: Array<{ tick: number; event: string }> },
  advance: TickAdvance<S>,
): { state: S; log: Array<{ tick: number; event: string }> } {
  const next = advance(run.state);
  const fresh = next.events.filter((e) => e.tick === next.tick);
  return { state: next, log: [...run.log, ...fresh] };
}

export interface FixedTickTransport {
  playing: boolean;
  /** Start/keep the fixed-rate driver running. */
  play(): void;
  pause(): void;
  toggle(): void;
  /** Advance exactly one logical tick (no-op while playing is irrelevant — always allowed). */
  step(): void;
}

/**
 * Fixed-tick-rate transport hook. Calls `onTick()` once per interval while playing;
 * `stepOnce` advances a single tick regardless of play state. The interval NEVER
 * coalesces or skips ticks: if the UI lags, pending intervals still each advance one tick.
 */
export function useFixedTickLoop(onTick: () => void, ms: number): FixedTickTransport & { stepOnce(): void } {
  const playingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cbRef = useRef(onTick);
  cbRef.current = onTick;

  const stopTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  return {
    get playing() {
      return playingRef.current;
    },
    play() {
      if (playingRef.current) return;
      playingRef.current = true;
      stopTimer();
      timerRef.current = setInterval(() => cbRef.current(), ms);
    },
    pause() {
      playingRef.current = false;
      stopTimer();
    },
    toggle() {
      if (playingRef.current) this.pause();
      else this.play();
    },
    step() {
      cbRef.current();
    },
    stepOnce() {
      cbRef.current();
    },
  };
}

/** Auto-clear the interval when the hosting component unmounts. */
export function useTransportCleanup(t: { pause(): void }): void {
  useEffect(() => () => t.pause(), []);
}
