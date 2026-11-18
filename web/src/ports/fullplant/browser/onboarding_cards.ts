// Onboarding step cards (docs/gameplay.md §1.5): the right-panel guided-build card shown
// one step at a time — technical intro for the equipment, then the build-confirm button.
// Card copy source: content/cards_phase1_draft.json (single card file). Slot positions map
// node_id -> world point inside the slice1 group of main.tsx (presentation only).

import { ZONE_BY_ID } from './layout.ts';

export interface StepCardView {
  title: string;
  body: string;
  stats: Array<[string, string]>;
  trivia?: string;
  action: 'dismiss' | 'build';
  actionLabel: string;
}

/** node_id -> local offset inside the slice1 group (matches main.tsx Slice1 geometry). */
export const SLOT_LOCAL: Record<string, [number, number, number]> = {
  jetty: [-8, 3, 0], // matches Slice1 geometry in main.tsx (berth inside water rect)
  scrap_yard: [4, 2.5, 0],
  conv_ore_drp: [-1, 1.5, 0],
};

/** World-space pointer target for a node (slot highlight), or null if unmapped. */
export function slotWorld(nodeId: string): [number, number, number] | null {
  const local = SLOT_LOCAL[nodeId];
  if (!local) return null;
  const z = ZONE_BY_ID['slice1'];
  return [z.pos[0] + local[0], local[1], z.pos[2] + local[2]];
}

export function stepCardView(card: any | null, stepType: 'card' | 'build'): StepCardView {
  if (!card) {
    return { title: 'SteelX', body: '', stats: [], action: stepType === 'build' ? 'build' : 'dismiss', actionLabel: stepType === 'build' ? 'Build' : 'Continue' };
  }
  const stats = Object.entries(card.key_stats ?? {}).flatMap(([k, v]) => {
    const label = k.replace(/_/g, ' ');
    if (v !== null && typeof v === 'object') {
      // nested stat objects (e.g. tramp_by_grade) -> one row per inner key
      return Object.entries(v as Record<string, unknown>).map(([ik, iv]) => [`${label} · ${ik.replace(/_/g, ' ')}`, String(iv)] as [string, string]);
    }
    return [[label, String(v)] as [string, string]];
  });
  return {
    title: card.title ?? card.id,
    body: card.body ?? '',
    stats,
    trivia: card.trivia,
    action: stepType === 'build' ? 'build' : 'dismiss',
    actionLabel: stepType === 'build' ? `Build ${card.title?.split(' ')[0] ?? 'it'}` : 'Continue',
  };
}
