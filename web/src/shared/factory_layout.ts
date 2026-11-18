// SteelX factory layout manifest — pure data layer over content/layout/factory_layout_v1.json.
// No sim values, no rendering: this module validates the manifest shape and answers
// spatial/ownership questions for the scene renderer, focus mode, and card wiring.
// Design source of truth: docs/factory_scene_design_v1.md (four binding decisions).

export interface ZoneDef {
  id: string;
  slice: string; // owning slice — drives the focus/diorama rule
  label: string;
  color: string;
  bounds: { x: [number, number]; z: [number, number] };
}

export interface FlowLinkDef {
  from: string;
  to: string;
  label: string;
}

export interface GhostPreviewDef {
  capacity_band: string;
  cost_band_usd: string;
  learning_line: string;
}

export interface SlotDef {
  id: string;
  zone: string;
  kind: 'machine' | 'ghost';
  position: { x: number; z: number };
  inspect_key?: string; // machine slots only — projection key into sim state
  content_ref?: string; // ghost slots — "content/nodes/nodes_phase1.json#<node_id>"
  preview?: GhostPreviewDef; // ghost slots — preview card data (decision 4)
  note?: string;
}

export interface FactoryLayout {
  schema_version: number;
  id: string;
  zones: ZoneDef[];
  flow_links: FlowLinkDef[];
  slots: SlotDef[];
}

/** Manifest validation — same reject-style idiom as production_core.loadNodes. */
export function parseFactoryLayout(raw: unknown): FactoryLayout {
  const rejects: string[] = [];
  const reject = (where: string, what: string) => rejects.push(`${where}: ${what}`);

  const doc = raw as FactoryLayout;
  if (doc.schema_version !== 1) reject('layout', 'schema_version missing or != 1');
  if (!Array.isArray(doc.zones) || doc.zones.length === 0) reject('layout', 'zones missing or empty');
  if (!Array.isArray(doc.slots) || doc.slots.length === 0) reject('layout', 'slots missing or empty');
  if (rejects.length) throw new Error(`factory layout invalid — ${rejects.join('; ')}`);

  const zoneIds = new Set<string>();
  for (const z of doc.zones) {
    if (!z.id || !z.slice || !z.color || !z.bounds) reject(`zone ${z.id ?? '?'}`, 'missing id/slice/color/bounds');
    if (zoneIds.has(z.id)) reject('layout', `duplicate zone id '${z.id}'`);
    zoneIds.add(z.id);
  }
  for (const fl of doc.flow_links ?? []) {
    if (!zoneIds.has(fl.from)) reject(`flow_link ${fl.from}->${fl.to}`, 'unknown from zone');
    if (!zoneIds.has(fl.to)) reject(`flow_link ${fl.from}->${fl.to}`, 'unknown to zone');
  }
  const slotIds = new Set<string>();
  for (const s of doc.slots) {
    if (!zoneIds.has(s.zone)) reject(`slot ${s.id}`, `unknown zone '${s.zone}'`);
    if (s.kind !== 'machine' && s.kind !== 'ghost') reject(`slot ${s.id}`, `kind must be machine|ghost`);
    if (s.kind === 'machine' && !s.inspect_key) reject(`slot ${s.id}`, 'machine slot needs inspect_key');
    if (s.kind === 'ghost') {
      if (!s.preview?.capacity_band || !s.preview?.cost_band_usd || !s.preview?.learning_line)
        reject(`slot ${s.id}`, 'ghost slot needs preview capacity_band + cost_band_usd + learning_line');
    }
    if (slotIds.has(s.id)) reject('layout', `duplicate slot id '${s.id}'`);
    slotIds.add(s.id);
  }
  if (rejects.length) throw new Error(`factory layout invalid — ${rejects.join('; ')}`);
  return doc;
}

/** Zones owned by a slice (render order: manifest order = material flow order). */
export function zonesForSlice(layout: FactoryLayout, sliceId: string): ZoneDef[] {
  return layout.zones.filter((z) => z.slice === sliceId);
}

/** All slots in a zone. */
export function slotsInZone(layout: FactoryLayout, zoneId: string): SlotDef[] {
  return layout.slots.filter((s) => s.zone === zoneId);
}

/** Machine slots owned by a slice (what tap-to-inspect can read for that sim). */
export function machineSlotsForSlice(layout: FactoryLayout, sliceId: string): SlotDef[] {
  const zoneSet = new Set(zonesForSlice(layout, sliceId).map((z) => z.id));
  return layout.slots.filter((s) => s.kind === 'machine' && zoneSet.has(s.zone));
}

/** Center point of a zone's bounds (for painting the flat-color plate). */
export function zoneCenter(z: ZoneDef): { x: number; z: number } {
  return { x: (z.bounds.x[0] + z.bounds.x[1]) / 2, z: (z.bounds.z[0] + z.bounds.z[1]) / 2 };
}

/** Overall footprint of the plant from zone bounds (plant-floor plate size). */
export function layoutFootprint(layout: FactoryLayout): { x: [number, number]; z: [number, number] } {
  const xs = layout.zones.flatMap((z) => z.bounds.x);
  const zs = layout.zones.flatMap((z) => z.bounds.z);
  return { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] };
}
