// Timeline loader — S2 is INTERPOLATION-ONLY (Phase -1 rule, roadmap §15 Phase -1 mark):
// no simulation logic lives here. The timeline JSON was generated from the verified
// mirror run (mirror/slice2_mirror.py __main__, fresh process 2026-10-18, commit a160825)
// and frozen at fixtures/slice2/s2_timeline.json. win=true; C1 ready@101, C2@201, C3@291.
// NOTE: vite serves .json?import as named exports (no default export in dev), so import * as.
import * as timelineRaw from './timeline.json';

export interface TimelineTask {
  task_id: string;
  task_type: 'receiving' | 'charging' | 'reclaiming';
  material_grade: string | null;
  source_location: string;
  destination_location: string;
  tonnes: number;
  estimated_duration: number;
  priority: number;
  start: number; // crane actually starts (tick)
  end: number;   // crane completes (tick)
}

export interface TimelineEvent { tick: number; event: string }
export interface TimelineCharge {
  charge_id: string; recipe_id: string; deadline: number;
  status: string; readiness_timestamp: number | null;
}
export interface TruckLoad { tick: number; grade: string; tonnes: number }

export interface Timeline {
  fixture_id: string; ticks: number; win: boolean;
  charges: TimelineCharge[];
  truck_loads: TruckLoad[];
  recipes: Array<{ recipe_id: string; name: string; composition: Array<{ grade: string; required_usable_t: number }> }>;
  tasks: TimelineTask[];
  events: TimelineEvent[];
}

export const TIMELINE = timelineRaw as unknown as Timeline;

// ---------- Derived per-tick state (pure interpolation helpers, no sim) ----------
export function taskActive(t: TimelineTask, tick: number): boolean {
  return tick >= t.start && tick <= t.end;
}
export function activeTaskAt(tasks: TimelineTask[], tick: number): TimelineTask | null {
  // the single non-preemptive crane runs exactly one task per tick window
  for (const t of tasks) if (taskActive(t, tick)) return t;
  return null;
}
export function chargeStatusAt(charges: TimelineCharge[], events: TimelineEvent[], tick: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of charges) out[c.charge_id] = 'planning';
  for (const e of events) {
    if (e.tick > tick) break;
    const m = /^charge (C\d) (READY|FAILED)/.exec(e.event);
    if (m) out[m[1]] = m[2] === 'READY' ? 'ready' : 'failed';
  }
  return out;
}
