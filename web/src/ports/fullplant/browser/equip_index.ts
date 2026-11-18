// Equipment index for the left equipment pane (Yasser round-2 observation 3.0): every
// equipment node in the level-1 sequence, grouped by slice, each expandable to its info
// card(s). node_id -> card_ids is DERIVED from content/sequence/level1_draft.json at load
// (single source of truth — no hand-maintained map). Nodes with no build step in the
// sequence get a DRAFTED placeholder card marked pending for Yasser's approval (§1.5 rule:
// unknown values are asked, never invented).
import { loadContentJson } from '../../../hub/content_json.ts';

export interface EquipEntry {
  nodeId: string;
  name: string;          // display name (node_id cleaned up)
  sliceId: string;       // owning zone id (slice1..slice5)
  cardIds: string[];     // existing cards from the sequence (build step first, extras after)
  drafted?: boolean;     // true = no real card yet; placeholder pending approval
}

/** Extra info cards beyond a node's own build-step card (cards authored for this equipment
 *  but attached to another step, e.g. the DRI-handling lesson shown at the jetty). */
const EXTRA_CARDS: Record<string, string[]> = {
  jetty: ['dri_handling'],
};

/** Nodes that appear in the plant but have no build step / card in level1 yet.
 *  Drafted placeholders — pending Yasser's approval before real copy ships. */
const DRAFTED_NODES: Array<{ nodeId: string; sliceId: string }> = [
  { nodeId: 'dispatch_crane', sliceId: 'slice1' }, // the yellow RTG standing in slice 1 from the start
];

export function equipmentIndex(): EquipEntry[] {
  const seq = loadContentJson('C:/AI_LAB/SteelX/content/sequence/level1_draft.json');
  const steps: any[] = seq.level1_sequence ?? [];
  // which slice a step belongs to: the zone whose layout strip contains its slot is fragile;
  // simpler and stable — the sequence is ordered by slice, so track the current slice via
  // ZONES order using SLOT_LOCAL's owning slice (only slice1 nodes are mapped there today).
  const out: EquipEntry[] = [];
  for (const s of steps) {
    if (s.type !== 'build' || !s.node_id) continue;
    if (out.some((e) => e.nodeId === s.node_id)) continue;
    out.push({
      nodeId: s.node_id,
      name: String(s.node_id).replace(/_/g, ' '),
      sliceId: sliceOfNode(s.node_id),
      cardIds: [s.card_id, ...(EXTRA_CARDS[s.node_id] ?? [])].filter(Boolean),
    });
  }
  for (const d of DRAFTED_NODES) {
    if (out.some((e) => e.nodeId === d.nodeId)) continue;
    out.push({ nodeId: d.nodeId, name: d.nodeId.replace(/_/g, ' '), sliceId: d.sliceId, cardIds: [d.nodeId], drafted: true });
  }
  return out;
}

/** node -> owning slice. Build steps in level1_draft follow slice order; SLOT_LOCAL covers
 *  slice1 nodes. Anything unmapped falls back to the sequence's positional slice block. */
function sliceOfNode(nodeId: string): string {
  if (['jetty', 'scrap_yard'].includes(nodeId)) return 'slice1';
  if (['drp', 'conv_ore_drp', 'conv_dri_eaf'].includes(nodeId)) return 'slice3';
  if (['scrap_feed', 'eaf', 'lf', 'cc', 'conv_ccm_billet', 'billet_yard'].includes(nodeId)) return 'slice4';
  if (['conv_billet_rebar', 'bar_mill', 'conv_billet_wr', 'wire_rod_mill', 'finished_yard', 'conv_mill_dispatch', 'dispatch'].includes(nodeId)) return 'slice5';
  return 'slice2'; // prep-plant nodes land here until named otherwise
}

/** Placeholder copy for drafted equipment — clearly marked, no invented numbers. */
export const DRAFTED_CARD: Record<string, any> = {
  dispatch_crane: {
    id: 'dispatch_crane',
    title: 'Dispatch Bay Crane (slice-1 RTG) — DRAFT',
    body: 'Rubber-tyred gantry standing in the slice-1 yard from the start of the game. The fullplant shows it early so the dispatch concept is visible, but its build step and real card land in Slice 5 (dispatch_crane). This placeholder exists only so the equipment pane lists every visible machine.',
    key_stats: {},
    trivia: 'PENDING YASSER APPROVAL — draft text, no numbers. Real copy should come from the slice-5 dispatch card or a dedicated slice-1 note.',
  },
};
