// Quest panel (Roadmap V3 §5.4): campaign spine for the hub sidebar.
// Shows every Level-1 quest with its lifecycle status (§5.2), live progress against the
// current sim state, and a one-line next-action when the active quest is met-or-stalled.
// Presentation only — it never mutates the tracker or the sim (cards explain what the
// player already sees, §5.4 GAMEPLAY mark).

import type { QuestDef, QuestProgressMap } from './quest_tracker.ts';

const STATUS_LABEL: Record<string, string> = {
  locked: 'locked',
  available: 'optional',
  active: 'ACTIVE',
  completed: 'done ✓',
};

/** Live progress line for one condition against the current state (read-only). */
function condProgress(c: { field: string; op: string; value: number | boolean }, st: Record<string, any>): string {
  const v = st[c.field];
  if (v === undefined) return `${c.field}: —`;
  const shown = typeof v === 'number' ? Math.round(v * 100) / 100 : String(v);
  return `${c.field} ${c.op} ${c.value} (now: ${shown})`;
}

export function QuestPanel({
  defs,
  progress,
  simState,
  note,
}: {
  defs: QuestDef[];
  progress: QuestProgressMap;
  simState: Record<string, any>;
  note: string | null;
}) {
  const activeId = defs.find((d) => !d.optional && progress[d.id]?.status === 'active')?.id ?? null;
  return (
    <section className="steelx-quest-panel" aria-label="quests">
      <h2>Level 1 — The First Flow</h2>
      {note ? <p className="steelx-quest-note">{note}</p> : null}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {defs.map((q) => {
          const p = progress[q.id];
          if (!p || p.status === 'locked') {
            return (
              <li key={q.id} className="steelx-quest-row" data-status="locked" style={{ opacity: 0.45 }}>
                <strong>{q.title}</strong> <em>🔒 locked</em>
              </li>
            );
          }
          const isLive = q.id === activeId;
          return (
            <li key={q.id} className="steelx-quest-row" data-status={p.status} data-active={isLive || undefined}>
              <div>
                <strong>{q.title}</strong>{' '}
                <em>{STATUS_LABEL[p.status]}</em>
                {p.status === 'completed' && p.completed_at_tick !== null ? (
                  <span style={{ opacity: 0.6 }}> @ tick {p.completed_at_tick}</span>
                ) : null}
              </div>
              {q.optional ? null : (
                <div style={{ fontSize: 12 }}>
                  {isLive || p.status === 'available'
                    ? q.success_criteria.conditions.map((c) => condProgress(c, simState)).join(' · ')
                    : q.goal ?? ''}
                </div>
              )}
              {isLive ? <div style={{ fontSize: 12, opacity: 0.8 }}>{q.goal}</div> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
