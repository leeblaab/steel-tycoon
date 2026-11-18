import { test } from 'vitest';
import assert from 'node:assert';
import { prngInit, xorshift32Next } from '../src/prng.js';

// Gate test #0 — must pass before any parity fixture runs.
// Canonical vector, seed 1, first three outputs (Python reference, verified 2026-10-12):
//   6.295018830870981e-05, 0.01574742817686578, 0.6164041025602268
test('gate #0: canonical xorshift32 vector, seed 1', () => {
  const expected = [6.295018830870981e-05, 0.01574742817686578, 0.6164041025602268];
  let g = prngInit(1);
  const got = [];
  for (let i = 0; i < 3; i++) {
    const r = xorshift32Next(g.state);
    g = { state: r.newState };
    got.push(r.draw);
  }
  assert.deepStrictEqual(got, expected);
});

test('zero-seed guard rejects', () => {
  assert.throws(() => prngInit(0));
});
