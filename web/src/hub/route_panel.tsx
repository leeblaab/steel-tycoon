// Phase 2 route-connections panel (§7.2 phased scope / §7.4 Connect verb): the player
// picks two process nodes and connects them; validation is delegated to RouteLedger →
// validateRouteEdge (mirror port), so this component owns NO rule — it only renders
// choices and surfaces the validator's reason + explainRouteFailure feedback line.
import { useState } from 'react';

export interface RoutePanelProps {
  nodeIds: string[];
  connections: Array<{ from: string; to: string; connected_at_tick: number }>;
  onConnect: (fromId: string, toId: string) => { ok: boolean; reason: string; feedback: string };
}

export function RoutePanel({ nodeIds, connections, onConnect }: RoutePanelProps) {
  const [fromId, setFromId] = useState(nodeIds[0]);
  const [toId, setToId] = useState(nodeIds[1]);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="steelx-route-panel" style={{ border: '1px solid #444', padding: 8, margin: '8px 0' }}>
      <h3 style={{ margin: '4px 0' }}>Route connections</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          from{' '}
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {nodeIds.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span>→</span>
        <label>
          to{' '}
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {nodeIds.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button onClick={() => setNote(onConnect(fromId, toId).feedback)}>Connect</button>
      </div>
      {/* §7.4: invalid routes must be understandable — the validator's explanation is
          surfaced verbatim, never swallowed. */}
      {note && (
        <div className="steelx-route-note" role="status" style={{ margin: '6px 0', fontStyle: 'italic' }}>
          {note}
        </div>
      )}
      <ul className="steelx-route-list" style={{ listStyle: 'none', padding: 0, fontSize: 13 }}>
        {connections.map((c) => (
          <li key={`${c.from}->${c.to}`} data-connected="true">
            {c.from} → {c.to} <span title="connected at tick">{c.connected_at_tick}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
