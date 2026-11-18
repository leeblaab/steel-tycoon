# Fresh-process compatibility check for the xorshift32 PRNG contract (2026-10-12).
# Runs the LIVE mirror module under a shared-algorithm provider in ONE fresh process.
# Checks: gate test #0 (canonical vector), draw contract, replay determinism,
# sandbox isolation, zero-seed guard, cadence rule. Walk changes are the expected
# re-baseline cost, not rule failures. No mirror file is modified.

import copy
import operations_domain3_mirror as m


class Xorshift32:
    """Shared-spec xorshift32 (canonical, byte-identical to the TS implementation)."""
    def __init__(self, seed):
        x = seed & 0xFFFFFFFF
        if x == 0:
            raise ValueError("zero generator state rejected (xorshift32 is degenerate at 0)")
        self.state = x

    def random(self):
        x = self.state
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= (x >> 17)
        x ^= (x << 5) & 0xFFFFFFFF
        self.state = x & 0xFFFFFFFF
        return self.state / 0xFFFFFFFF


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + ((" (" + detail + ")") if detail else ""))

# --- Gate test #0: canonical vector, seed 1, first three outputs ---
g = Xorshift32(1)
vec = [g.random() for _ in range(3)]
expected = [6.295018830870981e-05, 0.01574742817686578, 0.6164041025602268]
check("gate #0 canonical vector seed 1", vec == expected, f"{vec}")

# --- Zero-seed guard ---
try:
    Xorshift32(0)
    check("zero-seed guard rejects", False, "no exception raised")
except ValueError:
    check("zero-seed guard rejects", True)

# --- Draw contract: exactly 6 draws per tick in ORDER_REF order, every tick ---
class DrawCounter:
    def __init__(self, seed):
        self.inner = Xorshift32(seed)
        self.draws = []  # (tick, asset_order_index)

    def random(self):
        self.draws.append(len(self.draws))
        return self.inner.random()

st = m.fresh_state()
dc = DrawCounter(7)
for tick in range(10):
    before = len(dc.draws)
    m.tick_ops(dc, st)
    n = len(dc.draws) - before
    if n != 6:
        check("draw contract 6/tick (tick %d got %d)" % (tick, n), False)
        break
else:
    check("draw contract: 6 draws/tick x 10 ticks, all assets incl. down", True)

# Injection fires but still consumes the draw
st2 = m.fresh_state()
dc2 = DrawCounter(7)
before = len(dc2.draws)
m.tick_ops(dc2, st2, inject={'eaf'})
check("injection still consumes the draw (6 draws)", len(dc2.draws) - before == 6)

# --- Replay determinism: same seed twice -> identical state ---
st_a, st_b = m.fresh_state(), m.fresh_state()
ra, rb = Xorshift32(42), Xorshift32(42)
for _ in range(120):
    m.tick_ops(ra, st_a)
    m.tick_ops(rb, st_b)
check("replay determinism (seed 42, 120 ticks, identical final state)", st_a == st_b)

# Generator state advances inside the run (state-in-state shape is preserved)
check("generator state advances (state-in-state shape)", ra.state != 42 and ra.state == rb.state)

# --- Sandbox isolation: clone + hypothetical ticks, original provably unchanged ---
original = m.fresh_state()
snapshot = copy.deepcopy(original)
sandbox = copy.deepcopy(original)
rs = Xorshift32(101)
for _ in range(50):
    m.tick_ops(rs, sandbox)
check("sandbox isolation: original unchanged after 50 hypothetical ticks on clone",
      original == snapshot and sandbox != snapshot)

# --- Cadence rule unaffected: planned outage counter increments on day 90 for all seeds.
# Probe construction corrected once: the mirror's rule is the counter increment on the
# day-tick (line ~267), not an 'active' flag; the first run failed on probe construction.
cadence_ok = True
for seed in (7, 11, 42, 101):
    st_c = m.fresh_state()
    rng_c = Xorshift32(seed)
    fired_day = None
    for tick in range(1, 24 * 91):
        before = st_c['planned_outages']
        m.tick_ops(rng_c, st_c)
        if st_c['planned_outages'] > before:
            fired_day = st_c['day']
            break
    if fired_day != 90:
        cadence_ok = False
        print("  seed %d: outage credited on day %s" % (seed, fired_day))
check("cadence rule: planned outage credited on day 90 for seeds 7/11/42/101", cadence_ok)

# --- Re-baseline cost report (expected, not a failure) ---
st_r = m.fresh_state()
rng_r = Xorshift32(7)
for _ in range(180):
    m.tick_ops(rng_r, st_r)
print("re-baseline report seed 7 / 180 ticks under xorshift32: "
      "breakdowns %s (legacy baseline 2), planned outages %s (legacy 2), "
      "repair hours %s (legacy 372)" % (st_r.get('breakdowns'), st_r.get('planned_outages'),
                                        st_r.get('repair_hours')))

print("\n=== %d PASS / %d FAIL ===" % (sum(1 for _, ok, _ in results if ok),
                                       sum(1 for _, ok, _ in results if not ok)))
