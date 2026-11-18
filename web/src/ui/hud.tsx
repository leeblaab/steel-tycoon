// Shared HUD atoms (Roadmap V3 Phase 1, backlog item 4).
// Extracted from the duplicated panel markup across the five slice browser mains:
//   <div className="stat"><span>label</span><b>value</b></div>, progress bars, badges.
// Theme-agnostic: every element carries only a semantic className (steelx-*); the hub's
// own stylesheet (or any slice's) decides colors. No per-slice imports.

import type { ReactNode } from 'react';

export interface StatRowProps {
  label: ReactNode;
  value: ReactNode;
  /** Optional extra class on the value cell (e.g. a warn tone chosen by the consumer). */
  valueClass?: string;
}

/** One HUD stat row: label + emphasized value ("stat" idiom shared by all slice panels). */
export function StatRow({ label, value, valueClass }: StatRowProps) {
  return (
    <div className="steelx-stat">
      <span>{label}</span>
      <b className={valueClass}>{value}</b>
    </div>
  );
}

/** A block of stat rows with an optional section heading. */
export function StatBar({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="steelx-statbar">
      {title !== undefined && <h2>{title}</h2>}
      {children}
    </div>
  );
}

export interface ProgressBarProps {
  /** 0..1 fraction; values outside the range are clamped. */
  fraction: number;
  label?: ReactNode;
}

/** Horizontal progress/meter bar (the width-% inline-style idiom from slice panels). */
export function ProgressBar({ fraction, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="steelx-progress">
      {label !== undefined && <span>{label}</span>}
      <div className="steelx-progress-track">
        <div className="steelx-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Status badge (ok/warn/bad/neutral tone chosen via data-tone; styling is consumer-side). */
export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return (
    <span className="steelx-badge" data-tone={tone}>
      {children}
    </span>
  );
}
