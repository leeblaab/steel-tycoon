// Shared info-card / event-log renderer (Roadmap V3 Phase 1, backlog item 4).
// Every slice panel renders the same two things: a rolling log of this-run tick events,
// and an expandable "learn" card carrying the learning layer. Per Roadmap V3 §8.1 the
// card popup is the learning surface; the hub feeds it from event metadata until real
// card JSON (docs/card schema) is wired — CardData below is that seam.
// Theme-agnostic: semantic classNames only, no per-slice imports.

import { useState } from 'react';
import type { ReactNode } from 'react';

export interface EventLogEntry {
  tick: number;
  event: string;
}

/** Rolling event log (newest first), capped so panels stay readable. */
export function EventLog({
  entries,
  limit = 40,
  title = 'events',
}: {
  entries: EventLogEntry[];
  limit?: number;
  title?: ReactNode;
}) {
  const shown = entries.slice(-limit).reverse();
  return (
    <div className="steelx-eventlog">
      {title !== undefined && <h2>{title}</h2>}
      {shown.length === 0 ? (
        <p className="steelx-eventlog-empty">no events yet</p>
      ) : (
        shown.map((e, i) => (
          <div className="steelx-eventrow" key={`${e.tick}-${i}`}>
            <span className="steelx-eventtick">t{e.tick}</span>
            <span>{e.event}</span>
          </div>
        ))
      )}
    </div>
  );
}

/** Learning/info card. `body` is the learning layer payload (markdown-ish text or JSX);
 *  when real card JSON lands (docs card schema), CardData maps 1:1 onto this shape. */
export interface CardData {
  id: string;
  title: string;
  body: ReactNode;
  /** Optional source/authority note, e.g. "AIST MENA band — engineering estimate". */
  source?: string;
}

/** Collapsible info card (the "learn" panel idiom, generalized). */
export function InfoCard({ card, initiallyOpen = false }: { card: CardData; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="steelx-card">
      <button className="steelx-card-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} {card.title}
      </button>
      {open && (
        <div className="steelx-card-body">
          {card.body}
          {card.source !== undefined && <p className="steelx-card-source">{card.source}</p>}
        </div>
      )}
    </div>
  );
}

/** Card popup overlay: click-to-open card detail over the panel (roadmap "card popup"). */
export function CardPopup({ card, onClose }: { card: CardData; onClose: () => void }) {
  return (
    <div className="steelx-cardpopup" role="dialog" aria-label={card.title}>
      <div className="steelx-cardpopup-inner">
        <h3>{card.title}</h3>
        <div className="steelx-card-body">{card.body}</div>
        {card.source !== undefined && <p className="steelx-card-source">{card.source}</p>}
        <button onClick={onClose}>close</button>
      </div>
    </div>
  );
}
