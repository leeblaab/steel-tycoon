// Canonical xorshift32 — byte-identical to mirror/xorshift32_check.py (shared spec).
// Generator state lives INSIDE the simulation state (one 32-bit word).
// Non-zero seed guard: zero state is degenerate (stuck forever) — reject, never default.

export interface PrngState {
  state: number; // uint32, never 0
}

export function prngInit(seed: number): PrngState {
  const x = seed >>> 0;
  if (x === 0) throw new Error("zero generator state rejected (xorshift32 is degenerate at 0)");
  return { state: x };
}

// Advance the generator and return the draw in [0,1). Pure w.r.t. caller copies:
// the tick contract passes the generator state as part of sim state; this returns
// the new word — the tick writes it into the new state, never mutating the input.
export function xorshift32Next(state: number): { newState: number; draw: number } {
  let x = state >>> 0;
  if (x === 0) throw new Error("zero generator state reached — contract violation");
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  x = x >>> 0;
  return { newState: x, draw: x / 0xFFFFFFFF };
}
