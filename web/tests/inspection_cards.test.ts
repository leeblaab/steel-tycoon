// Inspection-card projection tests — cards must read ONLY fields the parity ports emit
// (slice4_sim.ts: eaf.busy_charge_id/bath_t, lrf.busy_ladle_id, ccm.remaining_ticks, wait
// counters; slice5_sim.ts: mill.busy/batch_t/remaining_ticks, mill wait/starved counters).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseFactoryLayout } from '../src/shared/factory_layout.ts';
import { inspectSlice4Slot, inspectSlice5Slot } from '../src/shared/inspection_cards.ts';

const LAYOUT_PATH = 'C:/AI_LAB/SteelX/content/layout/factory_layout_v1.json';
const layout = parseFactoryLayout(JSON.parse(readFileSync(LAYOUT_PATH, 'utf8')));
const slot = (id: string) => layout.slots.find((s) => s.id === id)!;

describe('slice4 inspection cards (pure projection)', () => {
  const busyState = {
    tick: 30,
    eaf: { busy_charge_id: 'charge-07', remaining_ticks: 5, bath_t: 82.5 },
    lrf: { busy_ladle_id: 'ladle-2', remaining_ticks: 3 },
    ccm: { busy_ladle_id: null, remaining_ticks: 0 },
    counters: { charge_wait_ticks: 4, ladle_wait_ticks: 0, caster_wait_ticks: 2, heats_starved: 1 },
  };

  it('EAF card projects live furnace state', () => {
    const card = inspectSlice4Slot(slot('s4_eaf_main'), busyState);
    expect(card.title).toContain('EAF');
    expect(card.tone).toBe('busy');
    expect(card.lines.join(' ')).toContain('charge-07');
    expect(card.lines.join(' ')).toContain('82.5 t');
    expect(card.lines.join(' ')).toContain('4 wait-ticks');
  });

  it('LRF card projects ladle-on-station', () => {
    const card = inspectSlice4Slot(slot('s4_lrf'), busyState);
    expect(card.tone).toBe('busy');
    expect(card.lines.join(' ')).toContain('ladle-2');
  });

  it('CCM idle-but-contested tone is waiting (caster_wait > 0)', () => {
    const card = inspectSlice4Slot(slot('s4_ccm_strand1'), busyState);
    expect(card.tone).toBe('waiting');
    expect(card.lines.join(' ')).toContain('Strand free');
    expect(card.lines.join(' ')).toContain('2 wait-ticks');
  });

  it('unknown inspect_key throws instead of inventing a card', () => {
    expect(() =>
      inspectSlice4Slot({ id: 'x', zone: 'eaf_zone', kind: 'machine', position: { x: 0, z: 0 }, inspect_key: 'quantum_furnace' }, busyState),
    ).toThrow(/unknown inspect_key/);
  });
});

describe('slice5 inspection card (pure projection)', () => {
  it('mill card projects residence batch + wait/starved counters', () => {
    const st = {
      tick: 40,
      mill: { busy: true, remaining_ticks: 6, batch_t: 45.2 },
      counters: { mill_wait_ticks: 3, mill_starved_ticks: 7 },
    };
    const card = inspectSlice5Slot(slot('s5_rebar_mill'), st);
    expect(card.tone).toBe('busy');
    expect(card.lines.join(' ')).toContain('45.2 t');
    expect(card.lines.join(' ')).toContain('7');
  });

  it('starved mill reads as waiting when idle', () => {
    const st = { tick: 10, mill: { busy: false, remaining_ticks: 0, batch_t: 0 }, counters: { mill_wait_ticks: 0, mill_starved_ticks: 5 } };
    expect(inspectSlice5Slot(slot('s5_rebar_mill'), st).tone).toBe('waiting');
  });
});

describe('card projection reads only fields the ports actually emit', () => {
  it('slice4 port state shape covers every field our view type names', async () => {
    // Structural guard: import the real port and assert our view is a subset of its state.
    const s4 = await import('../src/ports/slice4/shared/slice4_sim.ts');
    const fresh = (s4 as any).fresh ?? null;
    // slice4_sim exports tick/validate pieces; check via the hub seed instead if fresh absent.
    const seed = await import('../src/hub/scenario_seed.ts');
    const fxPath = 'C:/AI_LAB/SteelX/fixtures/slice4/s4_eaf_lrf_ccm_billet_seed11_120.json';
    const fx = JSON.parse(readFileSync(fxPath, 'utf8'));
    const st = (seed as any).seedSlice4(fx);
    expect(st.eaf.busy_charge_id).toBeNull();
    expect(typeof st.eaf.bath_t).toBe('number');
    expect(st.lrf).toHaveProperty('busy_ladle_id');
    expect(st.ccm).toHaveProperty('remaining_ticks');
    for (const k of ['charge_wait_ticks', 'ladle_wait_ticks', 'caster_wait_ticks', 'heats_starved']) {
      expect(st.counters[k]).toBe(0);
    }
  });

  it('slice5 port state shape covers mill fields', async () => {
    const seed = await import('../src/hub/scenario_seed.ts');
    const fx = JSON.parse(readFileSync('C:/AI_LAB/SteelX/fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json', 'utf8'));
    const st = (seed as any).seedSlice5(fx);
    expect(st.mill.busy).toBe(false);
    expect(st.mill).toHaveProperty('batch_t');
    expect(st.counters).toHaveProperty('mill_wait_ticks');
    expect(st.counters).toHaveProperty('mill_starved_ticks');
  });
});
