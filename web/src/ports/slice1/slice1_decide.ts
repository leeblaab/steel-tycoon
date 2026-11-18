// Step B hub port (Decide verbs reach the live game): the slice1 hub state gains a
// `decisions` log — every Decide verb call applied to the loop state, with its tick,
// verb, target and the engine's own human-readable message. The engine functions in
// ops_domain3.ts stay the ONLY mutators (route-ledger discipline); this port is a thin
// wrapper that snapshots the result for save/load v1 (JSON-plain rows) and the panel.

import {
  freshSlice1HubState, advanceSlice1HubState, type Slice1HubState,
} from './slice1_hub.ts';
import {
  decideStop, decideStart, decideScheduleMaintenance, decideCancelMaintenance,
  decideOrderSpare, decideOvertime, loadOpsConfig, type DecideResult,
} from '../../ops_domain3.ts';
import opsDoc from '../../../../content/operations/operations_domain3.json';

export interface DecisionRow {
  tick: number;
  verb: 'stop' | 'start' | 'schedule_maintenance' | 'cancel_maintenance' | 'order_spare' | 'overtime';
  target: string;
  ok: boolean;
  message: string;
}

export interface Slice1HubStateWithDecisions extends Slice1HubState {
  decisions: DecisionRow[];
}

export function freshSlice1HubStateV2(seed?: number): Slice1HubStateWithDecisions {
  return { ...freshSlice1HubState(seed), decisions: [] };
}

export function advanceSlice1HubStateV2(prev: Slice1HubStateWithDecisions): Slice1HubStateWithDecisions {
  const next = advanceSlice1HubState(prev);
  // `decisions` is hub-side, not engine-side: carry it through untouched.
  return { ...next, decisions: prev.decisions };
}

/** Apply one Decide verb to the loop state. Mutates `st` in place via the engine's
 *  decide_* functions ONLY (validation + human-readable rejection live there), then
 *  appends the outcome row for persistence and UI feedback. Rejections are recorded
 *  too — the player sees why a decision was refused. */
export function applyDecision(st: Slice1HubStateWithDecisions, verb: DecisionRow['verb'], target: string, arg?: number): DecideResult {
  const cfg = loadOpsConfig(opsDoc);
  let r: DecideResult;
  switch (verb) {
    case 'stop': r = decideStop(st, target); break;
    case 'start': r = decideStart(st, target); break;
    case 'schedule_maintenance': r = decideScheduleMaintenance(st, target, arg as number); break;
    case 'cancel_maintenance': r = decideCancelMaintenance(st, target); break;
    case 'order_spare': r = decideOrderSpare(st, target, cfg); break;
    case 'overtime': r = decideOvertime(st, arg as number, cfg); break;
    default: return { ok: false, message: `unknown decide verb '${verb}'` };
  }
  st.decisions.push({ tick: st.tick, verb, target, ok: r.ok, message: r.message });
  return r;
}
