// Hub slice catalog: wires each shared parity port (slice1/3/4/5) into a HubSliceModule.
// Fixtures and content JSON are loaded from the repo (same files the parity tests use);
// ports stay untouched — adapters here only READ their state for the registry.

import * as s3 from '../ports/slice3/shared/slice3_sim.ts';
import * as s4 from '../ports/slice4/shared/slice4_sim.ts';
import * as s5 from '../ports/slice5/shared/slice5_sim.ts';
import { freshSlice1HubStateV2, advanceSlice1HubStateV2 } from '../ports/slice1/slice1_decide.ts';
import { slice1Adapter, slice3Adapter, slice4Adapter, slice5Adapter } from '../shared/port_adapters.ts';
import type { AdapterRegistration } from '../shared/inventory_registry.ts';
import type { HubSliceModule } from './tickloop.ts';
import { seedSlice3, seedSlice4, seedSlice5 } from './scenario_seed.ts';

const REPO = 'C:/AI_LAB/SteelX';

// Fixtures/content JSON inlined into the browser build (vite glob, raw text).
// Keys are relative to this file, e.g. '../../../fixtures/slice3/...json'.
const jsonModules = import.meta.glob('../../../{fixtures,content}/**/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, unknown>;

function loadJson(path: string): any {
  const rel = `../../../${path.slice(REPO.length + 1)}`;
  const raw = jsonModules[rel];
  const text = typeof raw === 'string' ? raw : (raw as any)?.default;
  if (typeof text !== 'string') throw new Error(`loadJson: no raw text for ${rel} (got ${typeof raw})`);
  return JSON.parse(text);
}

export interface CatalogEntry {
  id: string;
  label: string;
  /** Either a React element factory result or plain text — the hub renders body as-is. */
  module: HubSliceModule<any>;
  adapter: AdapterRegistration;
  /** Raw scenario fixture (read-only reference for HUD denominators/capacity bars). */
  fixture: any;
  cardTitle: string;
  cardBody: string;
}

export function buildCatalog(): CatalogEntry[] {
  const fx3 = loadJson(`${REPO}/fixtures/slice3/s3_dri_buffer_scenario_seed11_120.json`) as s3.S3Fixture;
  const fx4 = loadJson(`${REPO}/fixtures/slice4/s4_eaf_lrf_ccm_billet_seed11_120.json`) as s4.Slice4Fixture;
  const fx5 = loadJson(`${REPO}/fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json`) as s5.Slice5Fixture;
  const tiers = s4.loadScrapTiers(loadJson(`${REPO}/content/scrap/scrap_tiers.json`));
  const priceMid = s5.loadPriceMid(loadJson(`${REPO}/content/prices/price_ladder_draft.json`));

  return [
    {
      id: 'slice1',
      label: 'Slice 1 — berth → yard → dispatch chain',
      module: {
        id: 'slice1',
        label: 'slice1',
        fresh: () => freshSlice1HubStateV2(),
        advance: (st) => advanceSlice1HubStateV2(st),
      },
      adapter: slice1Adapter(),
      fixture: loadJson(`${REPO}/fixtures/operations_domain3/d3_slice1_berth_bottleneck_seed11_120.json`),
      cardTitle: 'Why does a berth jam the whole yard?',
      cardBody:
        'A ship unloads onto the same yard the crane dispatches from. When the yard fills, unloading blocks (unload_blocked), the next ship refuses at the berth (berth_blocked) and starts burning demurrage days — a throughput problem showing up as money.',
    },
    {
      id: 'slice3',
      label: 'Slice 3 — DRP → DRI buffer → EAF feed',
      module: {
        id: 'slice3',
        label: 'slice3',
        fresh: () => seedSlice3(fx3),
        advance: (st) => s3.tick(st, fx3),
      },
      adapter: slice3Adapter(fx3),
      fixture: fx3,
      cardTitle: 'Why a buffer between DRP and EAF?',
      cardBody:
        'The DRP discharges continuously; the EAF charges in discrete heats. The buffer absorbs trip halts and capacity refusals so a short supply dip does not fabricate a heat — a skipped heat is recorded, never invented.',
    },
    {
      id: 'slice4',
      label: 'Slice 4 — EAF → LRF → CCM ladle cycle',
      module: {
        id: 'slice4',
        label: 'slice4',
        fresh: () => seedSlice4(fx4),
        advance: (st) => s4.tick(st, fx4, tiers),
      },
      adapter: slice4Adapter(fx4),
      fixture: fx4,
      cardTitle: 'Ladle availability is a cycle, not a number',
      cardBody:
        'Each ladle runs EAF-tap → LRF → CCM and only then returns to the pool. A heat that taps with no free ladle waits (ladle_wait); a refined ladle waiting on a busy strand is caster_wait. Bottlenecks show up as waits, not capacity counters.',
    },
    {
      id: 'slice5',
      label: 'Slice 5 — billet yard → rebar mill → dispatch',
      module: {
        id: 'slice5',
        label: 'slice5',
        fresh: () => seedSlice5(fx5),
        advance: (st) => s5.tick(st, fx5, priceMid),
      },
      adapter: slice5Adapter(fx5),
      fixture: fx5,
      cardTitle: 'Revenue fires on dispatch outflow',
      cardBody:
        'Money is booked when tonnes actually leave the product yard on a completed crane cycle — not on arrival at the yard. Non-preemptive crane: a running task finishes its cycle; priority only reorders the queue.',
    },
  ];
}
