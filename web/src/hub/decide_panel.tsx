// Phase 2 Step B operations panel (Decide verbs reach the live game): Stop / Start /
// Schedule Maintenance (+cancel) / Order Spare / Overtime. The component owns NO rule —
// every action goes through applyDecision → the engine's decide_* functions in
// ops_domain3.ts, and the engine's human-readable message (accepted OR rejected with a
// reason) is surfaced verbatim, mirroring the route panel's feedback discipline.
import { useState } from 'react';

export interface DecidePanelProps {
  assets: string[];
  decisions: Array<{ tick: number; verb: string; target: string; ok: boolean; message: string }>;
  onDecide: (verb: 'stop' | 'start' | 'schedule_maintenance' | 'cancel_maintenance' | 'order_spare' | 'overtime',
             target: string, arg?: number) => { ok: boolean; message: string };
}

export function DecidePanel({ assets, decisions, onDecide }: DecidePanelProps) {
  const [assetId, setAssetId] = useState(assets[0]);
  const [leadDays, setLeadDays] = useState(3);
  const [otDays, setOtDays] = useState(2);
  const [note, setNote] = useState<string | null>(null);

  type Verb = DecidePanelProps['onDecide'] extends ((verb: infer V, ...a: any) => any) ? V : never;
  const act = (verb: Verb, arg?: number) => setNote(onDecide(verb, assetId, arg).message);

  return (
    <div className="steelx-decide-panel" style={{ border: '1px solid #444', padding: 8, margin: '8px 0' }}>
      <h3 style={{ margin: '4px 0' }}>Operations decisions</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          asset{' '}
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {assets.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button onClick={() => act('stop')}>Stop</button>
        <button onClick={() => act('start')}>Start</button>
        <button onClick={() => act('schedule_maintenance', Math.max(1, Math.round(leadDays)))}>Schedule maintenance</button>
        <label>in{' '}
          <input type="number" min={1} value={leadDays} onChange={(e) => setLeadDays(Number(e.target.value))} style={{ width: 48 }} />d
        </label>
        <button onClick={() => act('cancel_maintenance')}>Cancel maint.</button>
        <button onClick={() => act('order_spare')}>Order spare</button>
        <label>overtime{' '}
          <input type="number" min={1} max={7} value={otDays} onChange={(e) => setOtDays(Number(e.target.value))} style={{ width: 48 }} />d
        </label>
        <button onClick={() => act('overtime', Math.round(otDays))}>Run overtime</button>
      </div>
      {/* Engine feedback surfaced verbatim — rejections explain themselves (§7.4 spirit). */}
      {note && (
        <div className="steelx-decide-note" role="status" style={{ margin: '6px 0', fontStyle: 'italic' }}>
          {note}
        </div>
      )}
      <ul className="steelx-decide-log" style={{ listStyle: 'none', padding: 0, fontSize: 13 }}>
        {decisions.slice(-8).reverse().map((d, i) => (
          <li key={`${d.tick}-${d.verb}-${i}`} data-ok={String(d.ok)}>
            tick {d.tick} · {d.verb} · {d.target}: {d.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
