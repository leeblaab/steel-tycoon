// Slice 1 playable vertical slice — DOM/SVG UI over the pure TS port.
// Learning loop: Build -> Connect -> Operate -> Observe congestion -> Inspect cause ->
// Intervene -> Observe the shifted bottleneck.
// UI text lives in DOM overlays, not embedded in 3D objects (Phase 2 rule).
// Rendering frame rate is decoupled from simulation tick cadence.

import { runSlice1, SLICE1, type TickRecord } from './slice1_berth_yard.js';
import { loadOpsConfig } from '../../ops_domain3.js';
import { readFileSync } from 'node:fs';

const cfg = loadOpsConfig(JSON.parse(readFileSync(
  new URL('../../../../content/operations/operations_domain3.json', import.meta.url), 'utf-8')));

// ---- Simulation layer (pure, no UI) ----
export interface Slice1App {
  records: TickRecord[];
  final: any;
  events: Array<{ tick: number; type: string }>;
  running: boolean;
  currentTick: number;
  playerInterventionApplied: boolean;
}

export function createApp(): Slice1App {
  const app: Slice1App = {
    records: [], final: null, events: [],
    running: false, currentTick: 0, playerInterventionApplied: false,
  };
  // Pre-run the canonical scenario once (deterministic, fixture-verified).
  const run = runSlice1(cfg, SLICE1);
  app.records = run.records;
  app.final = run.final;
  app.events = run.events;
  return app;
}

// Player actions (the only interactions in the vertical slice):
export function runSim(app: Slice1App) { app.running = true; }
export function pauseSim(app: Slice1App) { app.running = false; }
export function applyIntervention(app: Slice1App) {
  // The intervention is the second crane at tick 48 — already in the canonical run.
  // In the playable slice, the player triggers it at the decision moment; the app
  // records the player's action and the UI shows the before/after.
  app.playerInterventionApplied = true;
}

// ---- Status indicators (read directly from simulation state) ----
export function statusIndicators(app: Slice1App, tick: number) {
  const r = app.records[tick - 1];
  return {
    tick,
    dispatch_capacity_tph: r.dispatch_cap,
    yard_capacity_t: cfg.dispatch.yard_capacity_t,
    yard_stock_t: r.yard_stock_t,
    yard_fill_pct: (r.yard_stock_t / cfg.dispatch.yard_capacity_t) * 100,
    congestion: r.congestion_flag,
    upstream_blocked_t: r.upstream_blocked_t,
    ships_at_berth: r.ships_at_berth,
    flow_path_valid: true, // jetty -> conveyor -> yard connected by construction
  };
}

// ---- Learning panel content (what the bottleneck means, why, options) ----
export function learningPanel(app: Slice1App) {
  const c = cfg.dispatch;
  return {
    title: 'The bottleneck',
    what: `The yard fills because the conveyor delivers ${c.arrival_t_per_tick.toFixed(4)} t/tick while dispatch drains only ${SLICE1.dispatchBefore} t/tick. Material can only enter the yard while there is room; when the yard is full, the conveyor is blocked upstream.`,
    why: 'Dispatch capacity was pinned below the conveyor fill rate. The yard is a pure buffer at ' + c.yard_capacity_t + ' t — once it fills, the constraint moves to the yard itself.',
    options: [
      'Increase dispatch capacity (second crane) — throughput improves, but the yard capacity becomes the next binding constraint.',
      'Increase yard capacity — moves the constraint further downstream.',
      'Reduce conveyor throughput — balances the chain at a lower rate.',
    ],
    observed: {
      congestion_first_fire_tick: app.events.find(e => e.type === 'congestion')?.tick ?? null,
      upstream_blocked_at_end: app.final.upstream_blocked_t,
      constraint_shift: 'dispatch capacity -> yard capacity',
    },
  };
}

// ---- SVG scene (simple, clear; text as DOM overlay) ----
export function renderScene(app: Slice1App, tick: number): string {
  const s = statusIndicators(app, tick);
  const fill = Math.min(100, s.yard_fill_pct);
  return `
<svg viewBox="0 0 600 260" xmlns="http://www.w3.org/2000/svg">
  <!-- jetty (berth) -->
  <rect x="20" y="120" width="120" height="60" fill="#334155" stroke="#64748b"/>
  <text x="80" y="150" fill="#e2e8f0" font-size="14" text-anchor="middle">Jetty (berth)</text>
  <text x="80" y="170" fill="#94a3b8" font-size="12" text-anchor="middle">${s.ships_at_berth > 0 ? 'ship at berth' : 'berth free'}</text>
  <!-- conveyor link -->
  <line x1="140" y1="150" x2="300" y2="150" stroke="#64748b" stroke-width="6"/>
  <text x="220" y="140" fill="#94a3b8" font-size="12" text-anchor="middle">conveyor ${s.flow_path_valid ? '✓' : '✗'}</text>
  <!-- yard -->
  <rect x="300" y="110" width="180" height="80" fill="#1e293b" stroke="#64748b"/>
  <rect x="300" y="${190 - fill * 0.8}" width="180" height="${fill * 0.8}" fill="#0e7490" opacity="0.6"/>
  <text x="390" y="150" fill="#e2e8f0" font-size="14" text-anchor="middle">Yard ${s.yard_stock_t.toFixed(1)} / ${s.yard_capacity_t} t</text>
  <!-- dispatch -->
  <line x1="480" y1="150" x2="560" y2="150" stroke="#64748b" stroke-width="4"/>
  <text x="520" y="140" fill="#94a3b8" font-size="12" text-anchor="middle">dispatch ${s.dispatch_capacity_tph} t/tick</text>
  <!-- congestion indicator -->
  ${s.congestion ? '<circle cx="390" cy="90" r="8" fill="#dc2626"/><text x="390" y="70" fill="#f87171" font-size="12" text-anchor="middle">CONGESTED</text>' : ''}
  ${s.upstream_blocked_t > 0 ? `<text x="220" y="170" fill="#f87171" font-size="12" text-anchor="middle">upstream blocked ${s.upstream_blocked_t.toFixed(1)} t</text>` : ''}
</svg>`;
}

// ---- Headless demonstration of the complete learning loop ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  runSim(app);
  console.log('=== Slice 1 vertical slice — learning loop demo ===');
  console.log('Build: jetty + conveyor + yard placed (guided blueprints).');
  console.log('Connect: flow path valid =', statusIndicators(app, 1).flow_path_valid);
  console.log('Operate: running, tick 1..120.');
  const congTick = app.events.find(e => e.type === 'congestion')?.tick;
  console.log('Observe congestion: first fires at tick', congTick);
  console.log('Inspect cause:', learningPanel(app).what);
  applyIntervention(app);
  console.log('Intervene: second crane at tick', SLICE1.interventionTick, '-> dispatch', SLICE1.dispatchBefore, '->', SLICE1.dispatchAfter, 't/tick');
  const before = app.records[SLICE1.interventionTick - 1];
  const after = app.records[app.records.length - 1];
  console.log('Observe shifted bottleneck: dispatched', before.dispatched_t.toFixed(1), '->', after.dispatched_t.toFixed(1),
    't; yard at cap', after.yard_stock_t.toFixed(1), '/', cfg.dispatch.yard_capacity_t,
    '; upstream blocked', after.upstream_blocked_t.toFixed(1), 't');
  console.log('Status indicators at tick 120:', JSON.stringify(statusIndicators(app, 120), null, 2));
  pauseSim(app);
}
