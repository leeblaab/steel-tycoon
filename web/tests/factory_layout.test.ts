// Factory layout manifest tests — validates content/layout/factory_layout_v1.json itself
// plus the pure query helpers (focus/ownership resolution the scene renderer relies on).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseFactoryLayout,
  zonesForSlice,
  machineSlotsForSlice,
  slotsInZone,
  layoutFootprint,
} from '../src/shared/factory_layout.ts';

const LAYOUT_PATH = 'C:/AI_LAB/SteelX/content/layout/factory_layout_v1.json';

function loadLayout() {
  return parseFactoryLayout(JSON.parse(readFileSync(LAYOUT_PATH, 'utf8')));
}

describe('factory layout manifest (item d)', () => {
  const layout = loadLayout();

  it('manifest parses with schema_version 1', () => {
    expect(layout.schema_version).toBe(1);
    expect(layout.id).toBe('factory_layout_v1');
  });

  it('spatial flow is yard -> drp -> eaf -> lrf -> ccm -> mill and zones are left-to-right', () => {
    const order = layout.zones.map((z) => z.id);
    expect(order).toEqual(['yard', 'drp', 'eaf_zone', 'lrf_zone', 'ccm_zone', 'mill']);
    // each zone starts where the previous one ends (continuous plant, no gaps/overlaps on x)
    for (let i = 1; i < layout.zones.length; i++) {
      expect(layout.zones[i].bounds.x[0]).toBe(layout.zones[i - 1].bounds.x[1]);
    }
    // flow links follow the same order
    expect(layout.flow_links.map((f) => `${f.from}->${f.to}`)).toEqual([
      'yard->drp', 'drp->eaf_zone', 'eaf_zone->lrf_zone', 'lrf_zone->ccm_zone', 'ccm_zone->mill',
    ]);
  });

  it('slice ownership matches the hub catalog: slice4 owns EAF+LRF+CCM zones', () => {
    expect(zonesForSlice(layout, 'slice1').map((z) => z.id)).toEqual(['yard']);
    expect(zonesForSlice(layout, 'slice3').map((z) => z.id)).toEqual(['drp']);
    expect(zonesForSlice(layout, 'slice4').map((z) => z.id)).toEqual(['eaf_zone', 'lrf_zone', 'ccm_zone']);
    expect(zonesForSlice(layout, 'slice5').map((z) => z.id)).toEqual(['mill']);
  });

  it('machine slots exist only where sim state can project them (slice4 x3, slice5 mill)', () => {
    const s4 = machineSlotsForSlice(layout, 'slice4').map((s) => s.inspect_key).sort();
    expect(s4).toEqual(['ccm', 'eaf', 'lrf']);
    const s5 = machineSlotsForSlice(layout, 'slice5').map((s) => s.inspect_key);
    expect(s5).toEqual(['mill']);
  });

  it('every ghost slot carries a full preview card (capacity band + cost band + learning line)', () => {
    const ghosts = layout.slots.filter((s) => s.kind === 'ghost');
    expect(ghosts.length).toBeGreaterThanOrEqual(4);
    for (const g of ghosts) {
      expect(g.preview?.capacity_band).toBeTruthy();
      expect(g.preview?.cost_band_usd).toBeTruthy();
      expect(g.preview?.learning_line).toBeTruthy();
      expect(g.content_ref).toMatch(/^content\/nodes\/nodes_phase1\.json#/);
    }
  });

  it('every slot sits inside its zone bounds', () => {
    const zones = new Map(layout.zones.map((z) => [z.id, z]));
    for (const s of layout.slots) {
      const z = zones.get(s.zone)!;
      expect(s.position.x).toBeGreaterThan(z.bounds.x[0]);
      expect(s.position.x).toBeLessThan(z.bounds.x[1]);
      expect(s.position.z).toBeGreaterThan(z.bounds.z[0]);
      expect(s.position.z).toBeLessThan(z.bounds.z[1]);
    }
  });

  it('footprint covers all zones', () => {
    const fp = layoutFootprint(layout);
    expect(fp.x).toEqual([0, 104]);
  });

  it('validator rejects a broken manifest (slot in unknown zone)', () => {
    const bad = JSON.parse(JSON.stringify(layout));
    bad.slots[0].zone = 'nope';
    expect(() => parseFactoryLayout(bad)).toThrow(/unknown zone/);
  });

  it('validator rejects a ghost slot missing preview fields', () => {
    const bad = JSON.parse(JSON.stringify(layout));
    delete (bad.slots.find((s: any) => s.kind === 'ghost') as any).preview;
    expect(() => parseFactoryLayout(bad)).toThrow(/preview/);
  });

  it('slotsInZone returns zone members', () => {
    expect(slotsInZone(layout, 'eaf_zone').map((s) => s.id)).toEqual(['s4_eaf_main']);
  });
});
