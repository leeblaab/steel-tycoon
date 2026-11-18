// S0.3 commissioning fix (PLAN_FORGED): quest completion unlocks the BUILD CHAIN; engines
// start only at sliceBuildDone — never from quest completion alone. "No machine produces
// before you build it." Pure logic, no rendering: GameSession owns the calls.

import type { OnboardingState } from '../ports/fullplant/browser/onboarding.ts';

/** Quest -> which area's BUILD CHAIN its completion unlocks (quest-scripted commissioning,
 *  fixed places, no random placement, no purchase). This maps quests to areas; it does NOT
 *  start any engine. Engine start is decided separately by sliceBuildDone (see GameSession).
 *  Chain order follows the material route: q1 arrival flow proven -> build DRP area;
 *  q2 berth flow moving -> build meltshop; q3 furnace fed -> build mills+dispatch;
 *  q4 first steel -> scrap-prep plant commissioned visually (slice2 has no engine yet). */
export const QUEST_BUILD_UNLOCK: Record<string, string> = {
  l1_q1_first_arrival: 'slice3',
  l1_q2_keep_it_moving: 'slice4',
  l1_q3_feed_the_furnace: 'slice5',
  l1_q4_first_steel: 'slice2',
};

/** Slice -> build nodes that must be placed before its engine may tick. */
export const SLICE_BUILD_NODES: Record<string, string[]> = {
  slice1: ['jetty', 'scrap_yard', 'conv_ore_drp'],
  slice3: ['drp', 'conv_dri_eaf'],
  slice4: ['scrap_feed', 'eaf', 'lf', 'cc', 'conv_ccm_billet', 'billet_yard'],
  slice5: ['conv_billet_rebar', 'bar_mill', 'conv_billet_wr', 'wire_rod_mill', 'finished_yard', 'conv_mill_dispatch', 'dispatch'],
};

/** Is this slice's guided build finished (all its sequence nodes built)? No entry for a
 *  slice (e.g. slice2 — no sequence builds) means it never starts an engine by building. */
export function sliceBuildDone(st: OnboardingState, slice: string): boolean {
  const nodes = SLICE_BUILD_NODES[slice];
  if (!nodes) return false;
  return nodes.every((n) => st.built.includes(n));
}
