// Phase 2 guided placement panel (Roadmap V3 §7.2 phased scope: predefined build slots;
// gameplay.md §1.4 Build verb). Lists the focused slice's ghost slots with their preview
// data (decision 4), a Build button, and live construction progress driven by the hub's
// authoritative tick — no rendering-side timers.

import { ProgressBar } from '../ui/hud.tsx';
import type { ConstructionLedger } from '../shared/construction.ts';
import type { FactoryLayout } from '../shared/factory_layout.ts';

export interface PlacementPanelProps {
  layout: FactoryLayout;
  construction: ConstructionLedger;
  tick: number;
  onBuild: (slotId: string) => void;
}

const STATE_LABEL: Record<string, string> = {
  not_built: 'not built',
  built_pending: 'under construction',
  operational: 'operational',
};

export function PlacementPanel({ layout, construction, tick, onBuild }: PlacementPanelProps) {
  const zoneIdsInFocus = new Set(layout.zones.map((z) => z.id)); // panel filters via ledger slots
  const ghosts = layout.slots.filter((s) => s.kind === 'ghost' && zoneIdsInFocus.has(s.zone));

  return (
    <section className="steelx-placement" style={{ margin: '10px 0', padding: 10, border: '1px solid #2a3038', borderRadius: 6 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 14 }}>Build slots (guided placement)</h2>
      {ghosts.map((s) => {
        const lc = construction.get(s.id);
        if (!lc) return null; // slot belongs to another slice's ledger — not buildable here
        const frac = construction.progress(s.id, tick);
        const remaining = lc.ready_at_tick !== null ? Math.max(0, lc.ready_at_tick - tick) : null;
        return (
          <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '6px 0' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13 }}>
                {s.id} <span style={{ opacity: 0.6 }}>({s.zone})</span> —{' '}
                <strong>{STATE_LABEL[lc.state]}</strong>
                {lc.state === 'built_pending' && remaining !== null && (
                  <span style={{ opacity: 0.7 }}> · operational at tick {lc.ready_at_tick} ({remaining} ticks)</span>
                )}
              </div>
              {s.preview && lc.state !== 'operational' && (
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {s.preview.capacity_band} · {s.preview.cost_band_usd} — {s.preview.learning_line}
                </div>
              )}
              {lc.state === 'built_pending' && <ProgressBar fraction={frac} label="construction" />}
            </div>
            {lc.state === 'not_built' && (
              <button onClick={() => onBuild(s.id)} title="Build verb: ghost slot -> real machine over N ticks">
                Build
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
