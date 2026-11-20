// SteelX full-plant overview — GAMEPLAY HOME (Roadmap V3 Phase 1, GENERAL-LAYOUT
// GAMEPLAY CONTRACT marked 25.10): one continuous scene, all slices visible; this view is
// where play happens (drill-in slices are sub-views). Live sim via GameSession (hub's
// HubTickLoop + registry + quest tracker — slice modules untouched); painted zones from the
// LAYOUT table (layout.ts, Z-shape data); two-tier tap: zone click -> selection rim + live
// inspection card in the right-panel accordion HUD; locked zones dimmed; sim-driven flow
// animation (glow/pulses read tick state, never decorative loops).
import * as React from 'react';
import rd from 'react-dom/client';
const createRoot = rd.createRoot;
import { Canvas, useThree } from '@react-three/fiber'; // NEVER portal DOM into the R3F tree: its reconciler throws on element types ("div is not part of the THREE namespace") and React then unmounts the WHOLE app ("shows then vanishes"). Labels render as a sibling of <Canvas> instead.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ViewCamera, ResetViewButton, ViewNavButtons } from '@slices/slice5/browser/view_camera.tsx';
import { ZONES, type ZoneDef } from './layout.ts';
import { GameSession } from './session.ts';
import { PlantHud } from './hud.tsx';
import { OnboardingCard, notifyOnboard } from './onboarding_ui.tsx';
import { currentStep } from './onboarding.ts';
import { SLOT_LOCAL, stepCardView } from './onboarding_cards.ts';
import { equipmentIndex, DRAFTED_CARD, type EquipEntry } from './equip_index.ts';
import { STREAM, ZONE_PAD, LIGHTING, STATE } from './palette.ts';
import { beltTokenView, yardMoundView } from '../../../shared/ore_belt.ts';

// S0.4 visual-pass A/B bisect (dev-only): URL params override the rig so each suspect gets
// one headless shot without code churn. ?tone=0 -> NoToneMapping, ?exposure=X, ?fog=0 -> no
// fog, ?ground=HEX. Nothing here changes default behaviour when the params are absent.
const RIG_Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const TONE_MODE = RIG_Q.get('tone') === '0' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
const EXPOSURE = RIG_Q.has('exposure') ? Number(RIG_Q.get('exposure')) : 1;
const FOG_ON = RIG_Q.get('fog') !== '0';
const GROUND_COLOR = RIG_Q.get('ground') ? `#${RIG_Q.get('ground')}` : LIGHTING.ground_color;

const { useEffect, useRef, useState } = React;

// quests.json inlined at build time. NOTE: the glob is rooted at this file's dir, so it
// only walks UP to ports/fullplant/browser — content/ sits outside that root and would
// yield an EMPTY map (JSON.parse(undefined) pageerror). catalog.ts solves this by being
// 3 levels under src; here we import the hub's own glob module instead.
import { loadHubQuestsDoc, loadContentJson } from '../../../hub/content_json.ts';

function parseQuests(): any {
  return loadHubQuestsDoc();
}

export const SESSION = new GameSession(
  parseQuests(),
  loadContentJson('C:/AI_LAB/SteelX/content/sequence/level1_draft.json'),
);
/** Card copy for guided steps — single card file (§1.5). */
export const ONBOARD_CARDS: Record<string, any> = Object.fromEntries(
  (loadContentJson('C:/AI_LAB/SteelX/content/cards/cards_phase1_draft.json').items ?? []).map((c: any) => [c.id, c]),
);

// ---------- shared selection (plain mutable ref; HUD + zones read it) ----------
export const SELECTED: { current: string | null } = { current: null };

/** Shared React subscription so the HUD re-renders synchronously on selection (no event
 *  round-trip, no stale closures). */
const selectListeners = new Set<() => void>();
export function subscribeSelect(fn: () => void): () => void {
  selectListeners.add(fn);
  return () => selectListeners.delete(fn);
}

/** Select a zone (contract clause 4: two-tier tap -> rim + card, never modal). Shared by
 *  the 3D zone onClick and the HUD accordion header click. */
export function selectZone(id: string): void {
  SELECTED.current = id;
  window.dispatchEvent(new CustomEvent('steelx-select', { detail: id })); // HUD auto-opens this slice's accordion (card must be visible on tap, not only when the panel was already open)
  for (const fn of selectListeners) fn();
}

// Built-node selection (observation 3.3): tapping a BUILT equipment node (e.g. the jetty)
// opens its info popup instead of selecting the zone. Same listener set -> one re-render path.
export const EQUIP: { current: string | null } = { current: null };
export function selectEquip(nodeId: string): void {
  EQUIP.current = nodeId;
  for (const fn of selectListeners) fn();
}
export function closeEquip(): void {
  EQUIP.current = null;
  for (const fn of selectListeners) fn();
}

// DOM label overlay (slice pattern) ----------
// ---------- Label registry (rebuilt during render; read by LabelLayer) ----------
// LABELS must NEVER be cleared at the top of Scene: Scene renders BEFORE the Canvas subtree
// commits, so a top-of-Scene clear empties the array while the still-mounted LabelLayer reads
// it — every state change shipped one empty-labels frame (the tick-synced flicker Yasser saw;
// gone on pause because no commits happen then). Instead each producer (Zone, LABEL3) clears
// its OWN id prefix before pushing, so a render pass always leaves the previous labels in
// place until fresh ones replace them.
const LABELS: Array<{ id: string; label: string; world: [number, number, number]; cls?: string }> = [];
function pushLabels(prefix: string, items: Array<{ id: string; label: string; world: [number, number, number]; cls?: string }>) {
  for (let i = LABELS.length - 1; i >= 0; i--) if (LABELS[i].id.startsWith(prefix)) LABELS.splice(i, 1);
  for (const it of items) LABELS.push(it);
}
const CAM: { current: THREE.Camera | null } = { current: null };
function LabelCameraBridge() { const { camera } = useThree(); CAM.current = camera; return null; }

// DOM-level zone hit-test fallback for canvas taps. ViewCamera's pointer-capture orbit
// handling can swallow r3f's own click pipeline, so we project each ZONES rect into
// screen space on every real (non-synthetic) canvas click and select via selectZone().
// Built equipment nodes are hit-tested FIRST (observation 3.3: tapping the built jetty
// must open its info popup, not just select slice 1).

/** World-space footprint of a BUILT node -> card_id (from the level sequence steps).
 *  A node is tappable once its step has been REACHED (done or current), not only after
 *  confirm-build: Yasser round-2 observation 3.3 — while step 3 (scrap yard) was current,
 *  neither the jetty's neighbour nodes nor anything else could be clicked. Per-node
 *  footprints sized to the visible geometry, generous per Yasser's request. */
const NODE_FOOTPRINT: Record<string, [number, number]> = {
  jetty: [12, 12],      // S1.3 procedural pier + ship berth (scale 1, origin at quay edge)
  scrap_yard: [9, 9],   // yard pad is 7x7; footprint slightly larger for fat fingers
  conv_ore_drp: [4, 4], // belt strip + head tower (S1.2) — tappable conveyor card
};
/** Non-sequence hit targets (visible equipment with no build step yet): the slice-1 dispatch
 *  RTG stands from the start, tappable via the left pane AND direct tap (observation 3.0). */
const EXTRA_HIT_NODES: Array<{ id: string; pos: [number, number, number]; size: [number, number] }> = [
  { id: 'dispatch_crane', pos: [-31, 0.05, -2], size: [5, 6] }, // slice1 zone (-40,-2) + RTG local x=9
];
function builtNodeRects(): Array<{ id: string; cardId: string | null; pos: [number, number, number]; size: [number, number] }> {
  const out: Array<{ id: string; cardId: string | null; pos: [number, number, number]; size: [number, number] }> = [];
  for (let i = 0; i < SESSION.seqSteps.length; i++) {
    const step = SESSION.seqSteps[i];
    if (step.type !== 'build' || !step.node_id) continue;
    // tappable once its step is REACHED (done or current); locked future steps stay dark.
    // The card popup shows the node's own content regardless of build order.
    if (i > SESSION.onboard.index) continue;
    const local = SLOT_LOCAL[step.node_id];
    if (!local) continue;
    // jetty footprint follows the model's world placement (-4 centers the x3 GLB over quay+water)
    const wx = step.node_id === 'jetty' ? -4 : local[0];
    out.push({ id: step.node_id, cardId: step.card_id ?? null, pos: [wx, 0.05, local[2]], size: NODE_FOOTPRINT[step.node_id] ?? [16, 4] });
  }
  for (const n of EXTRA_HIT_NODES) out.push({ id: n.id, cardId: n.id, pos: n.pos, size: n.size });
  return out;
}

/** Project a ground rect to screen and test the click against it (shared by node + zone hits). */
function hitRect(cx: number, cy: number, cam: THREE.Camera, rect: DOMRect, v: THREE.Vector3, pos: [number, number, number], size: [number, number]): number | null {
  const [x0, x1] = [pos[0] - size[0] / 2, pos[0] + size[0] / 2];
  const [z0, z1] = [pos[2] - size[1] / 2, pos[2] + size[1] / 2];
  const pts: Array<[number, number, number]> = [[x0, 0.02, z0], [x1, 0.02, z0], [x1, 0.02, z1], [x0, 0.02, z1]];
  const sp: Array<[number, number]> = pts.map((p) => {
    v.set(p[0], p[1], p[2]).project(cam);
    return [(v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height] as [number, number];
  });
  if (!pointInQuad(cx, cy, sp)) return null;
  v.set(pos[0], 0.02, pos[2]);
  return v.applyMatrix4(cam.matrixWorldInverse).z; // camera-space z (negative in front)
}

function ZoneTapFallback() {
  useEffect(() => {
    const canvas = document.querySelector('#scene canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const v = new THREE.Vector3();
    const handler = (e: PointerEvent) => {
      if (!e.isTrusted || !CAM.current) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > 8) return; // orbit drag, not a tap
      const rect = canvas.getBoundingClientRect();
      const cam = CAM.current;
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      // 1) built equipment nodes win over their zone
      let bestNode: { id: string; depth: number } | null = null;
      for (const n of builtNodeRects()) {
        const depth = hitRect(cx, cy, cam, rect, v, n.pos, n.size);
        if (depth !== null && (!bestNode || depth > bestNode.depth)) bestNode = { id: n.id, depth };
      }
      if (bestNode) { selectEquip((bestNode as { id: string }).id); return; }
      // 2) zone rects
      let best: { id: string; depth: number } | null = null;
      for (const z of ZONES) {
        const depth = hitRect(cx, cy, cam, rect, v, z.pos, [z.size[0], z.size[1]]);
        if (depth !== null && (!best || depth > best.depth)) best = { id: z.id, depth };
      }
      if (best) selectZone((best as { id: string }).id);
    };
    const down = { x: 0, y: 0 };
    const downH = (e: PointerEvent) => { down.x = e.clientX; down.y = e.clientY; };
    canvas.addEventListener('pointerdown', downH, true);
    canvas.addEventListener('pointerup', handler, true);
    // dev hook for probes: run the same projection logic and report what it sees
    (window as any).__fpTapProbe = (cx: number, cy: number) => {
      if (!CAM.current) return { err: 'no CAM' };
      const rect = canvas.getBoundingClientRect();
      const cam = CAM.current;
      const out: Record<string, unknown> = {};
      for (const n of builtNodeRects()) {
        const depth = hitRect(cx - rect.left, cy - rect.top, cam, rect, v, n.pos, n.size);
        out[`node:${n.id}`] = { hit: depth !== null };
      }
      for (const z of ZONES) {
        const [x0, x1] = [z.pos[0] - z.size[0] / 2, z.pos[0] + z.size[0] / 2];
        const [z0, z1] = [z.pos[2] - z.size[1] / 2, z.pos[2] + z.size[1] / 2];
        const pts: Array<[number, number, number]> = [[x0, 0.02, z0], [x1, 0.02, z0], [x1, 0.02, z1], [x0, 0.02, z1]];
        const sp = pts.map((q) => { v.set(q[0], q[1], q[2]).project(cam); return [Math.round((v.x * 0.5 + 0.5) * rect.width), Math.round((-v.y * 0.5 + 0.5) * rect.height)]; });
        out[z.id] = { quad: sp, inside: pointInQuad(cx - rect.left, cy - rect.top, sp) };
      }
      return out;
    };
    return () => {
      canvas.removeEventListener('pointerdown', downH, true);
      canvas.removeEventListener('pointerup', handler, true);
      delete (window as any).__fpTapProbe;
    };
  }, []);
  return null;
}

/** Point-in-convex-quad test via consistent cross-product signs (screen space). */
function pointInQuad(x: number, y: number, q: Array<[number, number]>): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cr !== 0) {
      const s = Math.sign(cr);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

// LabelLayer renders as a SIBLING of <Canvas> (never inside it): R3F's reconciler throws on
// DOM element types, and React catches Canvas-subtree errors at the root and UNMOUNTS THE
// WHOLE APP — the "game shows for a fraction of a second then everything disappears" crash.
// Same-commit goal: both trees are children of one createRoot().render() pass, so a state
// change commits LabelLayer's div together with the 3D children that push LABELS (no blank
// frame). The old flicker came from react-dom PORTAL indirection (portal child commits land
// in a separate React pass) — a plain sibling div avoids that entirely. Projection refreshes
// on a 100 ms interval so labels keep tracking camera orbit/zoom between state changes.
function LabelLayer() {
  const [, setTick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setTick((t) => t + 1), 100); return () => clearInterval(id); }, []);
  const cam = CAM.current;
  const sceneEl = typeof document !== 'undefined' ? document.getElementById('scene') : null;
  const rect = (typeof document !== 'undefined' ? (document.querySelector('#scene canvas') as HTMLCanvasElement | null)?.getBoundingClientRect() : null) ?? sceneEl?.getBoundingClientRect() ?? null;
  if (!cam || !rect) return <div id="labels" />; // stable empty row (no remount churn)
  const pts = LABELS.map((L) => {
    const v = new THREE.Vector3(...L.world).project(cam);
    return { id: L.id, label: L.label, cls: L.cls, x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
  });
  return <div id="labels">{pts.map((p) => <div key={p.id} className={`blabel ${p.cls ?? ''}`} style={{ left: p.x, top: p.y }}>{p.label}</div>)}</div>;
}

// ---------- Painted zone strips from the LAYOUT table (contract clause 6) ----------
// S0.4 (F-05): zone rainbow DEMOTED to secondary pad tints — stream-color ground strips
// (StreamStrips, drawn between zones) now carry the primary visual grammar.
const ZONE_COLORS: Record<string, string> = ZONE_PAD;

// ---------- S1.2 ore belt (visual layer over the ledger) -------------------------------
// The belt built at onboarding step 4 is a REAL transfer edge (session.stepPlant ticks it).
// This component draws only what the ledger says is in flight: one token per in_transit
// record, eased along its leg between tick boundaries. Sim tonnes never move continuously —
// presentation reads registry.tick + wall-clock frac from the HUD pump cadence.
const BELT_HEAD: [number, number, number] = (() => {
  const z = ZONES.find((zz) => zz.id === 'slice1')!;
  const local = SLOT_LOCAL['conv_ore_drp']!; // [-1, 1.5, 0] relative to slice1 center
  return [z.pos[0] + local[0], 0, z.pos[2] + local[2]]; // (-41, 0, -2)
})();
const BELT_DRP: [number, number, number] = [-8, 0, 10]; // slice3 side of the bend (SLOT_LOCAL drp slot area)

function OreBelt() {
  const snap = SESSION.beltVisualSnapshot();
  if (!snap) return null; // belt not built yet — draw nothing
  // Physical strip: trough from yard edge to head tower, second hop to DRP once commissioned.
  const group: THREE.Group = React.useMemo(() => {
    const g: any = new THREE.Group();
    const mkTrough = (a: [number, number, number], b: [number, number, number]) => {
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const len = Math.hypot(dx, dz);
      const t: any = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 0.28, len),
        new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.7, metalness: 0.35 }),
      );
      t.position.set((a[0] + b[0]) / 2, 0.55, (a[2] + b[2]) / 2);
      t.rotation.y = Math.atan2(dx, dz) + Math.PI / 2; // BoxGeometry z-axis along the leg
      g.add(t);
      const s: any = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, len),
        new THREE.MeshStandardMaterial({ color: STREAM.ore, transparent: true, opacity: 0.35, roughness: 0.9 }),
      );
      s.rotation.x = -Math.PI / 2;
      s.position.set((a[0] + b[0]) / 2, 0.02, (a[2] + b[2]) / 2);
      s.rotation.z = Math.atan2(dx, dz); // stream-color grammar under the trough
      g.add(s);
    };
    mkTrough([BELT_HEAD[0] + 7, 0, BELT_HEAD[2]], BELT_HEAD); // yard edge -> head tower (leg A)
    const hop: any = new THREE.Group();
    const hd: any = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 3.4, 1.8),
      new THREE.MeshStandardMaterial({ color: '#565d66', roughness: 0.6, metalness: 0.4 }),
    );
    hd.position.set(BELT_HEAD[0], 1.7, BELT_HEAD[2]); // head tower the tokens arc over
    g.add(hd);
    hop.visible = snap.state.drpCommissioned; // second hop painted only once DRP is commissioned
    mkTroughInto(hop, BELT_HEAD, BELT_DRP); // leg B (buffer -> drp_intake)
    g.add(hop);
    return g as THREE.Group;
  }, [snap.state.drpCommissioned]);
  function mkTroughInto(holder: any, a: [number, number, number], b: [number, number, number]) {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    const t: any = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.28, len),
      new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.7, metalness: 0.35 }),
    );
    t.position.set((a[0] + b[0]) / 2, 0.55, (a[2] + b[2]) / 2);
    t.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    holder.add(t);
  }
  // Ore tokens: instanced dodecahedra (low-poly pellets), one per in_transit record.
  const tokensRef = React.useRef<{ mesh: any; keys: string[] } | null>(null);
  const tokenMesh: any = React.useMemo(() => {
    const geo = new THREE.DodecahedronGeometry(0.32, 0);
    const mat = new THREE.MeshStandardMaterial({ color: STREAM.ore, roughness: 1.0 });
    const im: any = new THREE.InstancedMesh(geo, mat, 48); // cap: in-flight records never exceed ~rate/chunk*travel
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    return im;
  }, []);
  tokensRef.current = { mesh: tokenMesh, keys: [] };

  useRafLoop(() => {
    const holder = tokensRef.current;
    if (!holder) return;
    const s = SESSION.beltVisualSnapshot();
    const im = holder.mesh;
    if (!s) { im.count = 0; return; }
    const tickMs = SESSION.tickIntervalMs();
    // frac: fraction of the current pump interval elapsed. The HUD pump steps on a
    // setInterval aligned to wall clock; we recompute frac from last snapshot's registry
    // tick vs performance.now() drift — good enough for smooth motion (presentation only).
    const frac = Math.min(0.999, (performance.now() % tickMs) / tickMs);
    const view = beltTokenView(s.state, frac);
    const shown = Math.min(view.tokens.length, 48);
    for (let i = 0; i < shown; i++) {
      const tok = view.tokens[i];
      // leg A: yard edge -> head tower (p in [0,1] along that span). Leg B continues to DRP.
      let x: number, y: number, z: number;
      if (tok.leg === 'yard-buffer') {
        const p = tok.progress * 0.35; // first 35% of the visual loop is leg A
        x = BELT_HEAD[0] + 7 + (BELT_HEAD[0] - (BELT_HEAD[0] + 7)) * p;
        z = BELT_HEAD[2];
        y = 1.0;
      } else {
        const p = 0.35 + tok.progress * 0.65;
        x = BELT_HEAD[0] + (BELT_DRP[0] - BELT_HEAD[0]) * ((p - 0.35) / 0.65);
        z = BELT_HEAD[2] + (BELT_DRP[2] - BELT_HEAD[2]) * ((p - 0.35) / 0.65);
        y = 1.0;
      }
      const sc = tok.size;
      _m4.makeScale(sc, sc, sc);
      _m4.setPosition(x, y, z);
      im.setMatrixAt(i, _m4);
    }
    im.count = shown;
    im.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={group} />;
}
const _m4 = new THREE.Matrix4();

// ---------- S1.4 ore-yard mound fill (PLAN_FORGED: every inventory = fill level) ----------
// The conical ore mound IS the yard_ore ledger tonnage — pure projection via the same
// beltVisualSnapshot the tokens read (structuredClone per frame; renderer can never mutate
// the sim). Scrap stays a static bin beside it: scrap is truck-fed, only ore rides the belt.
function OreYardMound() {
  const meshRef = React.useRef<any>(null); // any: fullplant's ambient three stub is incomplete (file convention)
  const geo = React.useMemo(() => new THREE.ConeGeometry(1, 1, 12), []);
  const mat = React.useMemo(() => new THREE.MeshStandardMaterial({ color: STREAM.ore, roughness: 1.0, flatShading: true }), []);
  useRafLoop(() => {
    const m = meshRef.current; if (!m) return;
    (window as any).__steelxMound = m; // dev probe hook (same pattern as __steelxSession)
    const snap = SESSION.beltVisualSnapshot();
    const v = yardMoundView(snap ? snap.state : null);
    m.scale.set(v.radius, v.height, v.radius);
    m.position.set(4, v.height / 2 + 0.03, 0); // cone origin is its center -> seat base on pad
  });
  return <mesh ref={meshRef} castShadow geometry={geo} material={mat} position={[4, 0.15, 0]} />;
}

/** Stream-color ground strips connecting adjacent zones along the material route
 *  (PLAN_FORGED §2: "stream-color ground strips + arrows drawn between zones").
 *  One thin quad per route leg, colored by the MATERIAL that travels it. */
const ROUTE_LEGS: Array<{ from: string; to: string; stream: string }> = [
  { from: 'slice1', to: 'slice2', stream: STREAM.scrap }, // scrap arrives and is prepped
  { from: 'slice2', to: 'slice3', stream: STREAM.ore },   // ore/scrap blend into the DRP bend
  { from: 'slice3', to: 'slice4', stream: STREAM.dri },   // DRI into the meltshop
  { from: 'slice4', to: 'slice5', stream: STREAM.billet_hot }, // billets to the mills
];
function StreamStrips() {
  const quads = ROUTE_LEGS.map((leg) => {
    const a = ZONES.find((z) => z.id === leg.from)!, b = ZONES.find((z) => z.id === leg.to)!;
    const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2];
    const len = Math.hypot(dx, dz);
    const mx = (a.pos[0] + b.pos[0]) / 2, mz = (a.pos[2] + b.pos[2]) / 2;
    const ang = Math.atan2(dx, dz); // strip runs along the leg
    return { key: `${leg.from}-${leg.to}`, mx, mz, len, ang, stream: leg.stream };
  });
  // THREE objects (not JSX) — fullplant has no @types/three and the ambient three typing
  // stub is incomplete (Object3D members missing); cast to any around construction only.
  const group: THREE.Group = React.useMemo(() => {
    const g: any = new THREE.Group();
    for (const q of quads) {
      const strip: any = new THREE.Mesh(new THREE.PlaneGeometry(1.4, q.len), new THREE.MeshStandardMaterial({ color: q.stream, transparent: true, opacity: 0.5, roughness: 0.9 }));
      strip.rotation.x = -Math.PI / 2;
      const holder: any = new THREE.Group();
      holder.position.set(q.mx, 0.025, q.mz);
      holder.rotation.y = q.ang; // leg direction along +Z local
      holder.add(strip);
      const arrow: any = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshStandardMaterial({ color: q.stream, transparent: true, opacity: 0.75, roughness: 0.9 }));
      arrow.rotation.x = -Math.PI / 2;
      arrow.rotation.z = Math.PI / 4; // diamond -> chevron-ish pointer
      arrow.position.set(0, 0, q.len / 2 - 1.6);
      holder.add(arrow);
      g.add(holder);
    }
    return g as THREE.Group;
  }, []);
  return <primitive object={group} />;
}

function Zone({ zone }: { zone: ZoneDef }) {
  const [hover, setHover] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('steelx-select', h);
    return () => window.removeEventListener('steelx-select', h);
  }, []);
  const unlocked = SESSION.slices[zone.id]?.unlocked;
  const sel = SELECTED.current === zone.id;
  pushLabels(`z-${zone.id}`, [{ id: `z-${zone.id}`, label: zone.name, world: [zone.pos[0], 0.4, zone.pos[2] - zone.size[1] / 2 + 0.6], cls: 'zlabel' }]);
  return (
    <mesh
      position={[zone.pos[0], 0.015, zone.pos[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => { e.stopPropagation(); selectZone(zone.id); }}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      <planeGeometry args={[zone.size[0], zone.size[1]]} />
      <meshStandardMaterial color={ZONE_COLORS[zone.id]} transparent opacity={unlocked ? (sel ? 0.42 : hover ? 0.32 : 0.18) : 0.06} />
    </mesh>
  );
}

// Orange selection rim around the selected zone (contract clause 4: rim, never a modal).
function SelectionRim() {
  const ref = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const m = ref.current; if (!m) return;
      const z = ZONES.find((zz) => zz.id === SELECTED.current);
      m.visible = !!z;
      if (z) {
        m.position.set(z.pos[0], 0.05, z.pos[2]);
        const r = Math.max(z.size[0], z.size[1]) / 2 + 0.4;
        (m.geometry as THREE.BufferGeometry).dispose();
        // segments fixed at 4 (diamond rim) so the geometry type never widens the union type
        m.geometry = new THREE.RingGeometry(r, r + 0.45, 4 as 4);
      }
    }, 250);
    return () => clearInterval(id);
  }, []);
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, Math.PI / 4]} visible={false}>
      <ringGeometry args={[13.4, 13.85, 4]} />
      <meshBasicMaterial color="#ff9d3f" transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---------- GLB loader (GlbModel pattern; assets referenced cross-slice) ----------
const glbBoundsCache = new Map<string, { min: number[]; max: number[] } | null>();
function GlbModel({ url }: { url: string }) {
  const [gltf, setGltf] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    // Bounds probe on the raw JSON chunk (jetty.glb's own accessors carry a +/-32767
    // quantization artifact that poisons Box3 — Yasser round-2 observation 2.2: an
    // invisible giant mesh from it cast shadow over the whole jetty). Cached per URL;
    // resolved before the model renders so placement uses clean bounds on first frame.
    if (!glbBoundsCache.has(url)) {
      glbBoundsCache.set(url, null);
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          const dv = new DataView(buf);
          const clen = dv.getUint32(12, true);
          const gj = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, clen)));
          let mn: number[] | null = null;
          let mx: number[] | null = null;
          for (const acc of gj.accessors ?? []) {
            if (acc.type !== 'VEC3' || !acc.min || !acc.max) continue; // real geometry bounds
            if (Math.abs(acc.min[0]) > 30000 && Math.abs(acc.max[0]) > 30000) continue; // quantization artifact
            if (!mn || !mx) { mn = [...acc.min]; mx = [...acc.max]; }
            else for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], acc.min[i]); mx![i] = Math.max(mx![i], acc.max[i]); }
          }
          glbBoundsCache.set(url, mn && mx ? { min: mn, max: mx } : null);
        })
        .catch(() => glbBoundsCache.set(url, null));
    }
    new GLTFLoader().load(url, (g: { scene: THREE.Group }) => { if (alive) setGltf(g.scene); }, undefined, (err: unknown) => console.error(`GLB load failed (${url}):`, err));
    return () => { alive = false; };
  }, [url]);
  return gltf;
}
function Glb({ url, scale, pos }: { url: string; scale: number; pos: [number, number, number] }) {
  const gltf = GlbModel({ url });
  const scaled: THREE.Group | null = gltf ? gltf.clone() : null;
  if (scaled) {
    // Drop meshes whose vertex data is the ±32767 quantization artifact — invisible at
    // render scale but their bounding volume casts shadow over the model (the brown box
    // over the jetty, observation 2.2).
    let culled = 0;
    scaled.traverse((o: THREE.Object3D) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      const posAttr = (o.geometry as THREE.BufferGeometry)?.attributes?.position;
      if (posAttr && Math.max(Math.abs(posAttr.array[0] ?? 0), Math.abs(posAttr.array[1] ?? 0), Math.abs(posAttr.array[2] ?? 0)) > 30000) { o.visible = false; culled++; }
    });
    if (culled) console.info(`Glb ${url}: culled ${culled} quantization-artifact mesh(es)`);
    scaled.scale.setScalar(scale);
  }
  // Seat the model on y=0 using CLEAN bounds when available (Box3 above would include the
  // artifact and sink/lift the model).
  let minY = 0;
  if (scaled) {
    const b = glbBoundsCache.get(url);
    minY = b ? b.min[1] * scale : new THREE.Box3().setFromObject(scaled).min.y;
  }
  return <primitive object={scaled ?? new THREE.Group()} position={[pos[0], pos[1] - minY, pos[2]]} />;
}

// asset URLs (same GLBs the slice scenes use — one shared set of models).
// Absolute @fs URLs: root-relative '../' paths get collapsed by the browser and SPA-fallback to index.html.
const SRC = '/@fs/C:/AI_LAB/SteelX/web/src/ports/';
const S1 = `${SRC}slice1/browser/assets/`;
const S3 = `${SRC}slice3/browser/assets/`;
const S4 = `${SRC}slice4/browser/assets/`;
const S5 = `${SRC}slice5/browser/assets/`;

// ---------- Locked-zone veil (contract clause 8: locked / under-construction / live) ----------
function LockedVeil({ zone }: { zone: ZoneDef }) {
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('steelx-tick', h);
    return () => window.removeEventListener('steelx-tick', h);
  }, []);
  if (SESSION.slices[zone.id]?.unlocked) return null;
  // S0.4: a locked area is an EMPTY PAD, not a black box — the old solid dark veil made
  // every future zone a void that swallowed the relit scene (SME visual pass 19.11).
  return (
    <mesh position={[zone.pos[0], 0.02, zone.pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[zone.size[0], zone.size[1]]} />
      <meshStandardMaterial color="#10161d" transparent opacity={0.35} depthWrite={false} roughness={1} />
    </mesh>
  );
}

// ---------- Slice 1: water + jetty GLB + raw yard + dispatch RTG ----------
// §1.5 guided build: nothing exists until its step completes — unbuilt equipment shows an
// empty ghost footprint; built equipment reveals with a cheap ~1s scale+fade pop ("animate
// material, not machines"). Slot pointer = the current step's highlighted ghost.
function GhostSlot({ pos, size, active }: { pos: [number, number, number]; size: [number, number]; active: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useRafLoop((t) => {
    const m = ref.current; if (!m) return;
    (m.material as THREE.MeshBasicMaterial).opacity = active ? 0.35 + Math.sin(t * 2.4) * 0.18 : 0.16;
  });
  return (
    <mesh ref={ref} position={[pos[0], 0.06, pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={size} />
      <meshBasicMaterial color={active ? '#ff9d3f' : '#5a6673'} transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// Build-complete indicator (Yasser 04.11 observation 3.2): the old zoom/stretch scale loop is
// replaced by a glowing-then-dimming green ring + floor wash — ambient pulse, no geometry
// animation ("will fix this for all plants" — this pattern extends slice-wide later).
function BuiltGlow({ center, w = 6, h = 5 }: { center: [number, number]; w?: number; h?: number }) {
  const mat = React.useMemo(() => new THREE.MeshBasicMaterial({ color: '#37d67a', transparent: true, opacity: 0.28, depthWrite: false }), []);
  const ringMat = React.useMemo(() => new THREE.MeshBasicMaterial({ color: '#59e6a0', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }), []);
  useRafLoop((t) => {
    const p = 0.5 + 0.5 * Math.sin(t * 1.4); // slow breathing pulse
    mat.opacity = 0.12 + 0.22 * p;
    ringMat.opacity = 0.35 + 0.35 * p;
  });
  return (
    <group>
      <mesh position={[center[0], 0.03, center[1]]} rotation={[-Math.PI / 2, 0, 0]} material={mat}>
        <planeGeometry args={[w, h]} />
      </mesh>
      <mesh position={[center[0], 0.05, center[1]]} rotation={[-Math.PI / 2, 0, 0]} material={ringMat}>
        <ringGeometry args={[Math.min(w, h) * 0.42, Math.min(w, h) * 0.47, 48]} />
      </mesh>
    </group>
  );
}

// Clickable built-equipment hit target (Yasser 04.11 observation 3.3): an invisible box over a
// placed node; tapping it opens the node's info card via onboarding_ui's tap handler.
function NodeHit({ nodeId, center, size }: { nodeId: string; center: [number, number]; size: [number, number] }) {
  return (
    <mesh position={[center[0], 2.5, center[1]]} userData={{ node: nodeId }}>
      <boxGeometry args={[size[0], 5, size[1]]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  );
}

// One-shot scale pop on build (slices 3-5): runs once per mount then stops. The old loop never
// reset t0 across re-renders, which read as a repeated zoom/stretch (Yasser 04.11 observation
// 3.2). Slice 1 instead uses the green-glow indicator; this stays for park-per-node reveals.
function Reveal({ built, children }: { built: boolean; children: React.ReactNode }) {
  if (!built) return null;
  const ref = useRef<THREE.Group>(null);
  useRafLoop((t) => {
    const g = ref.current; if (!g) return;
    if (g.userData.done) return;
    if (g.userData.t0 === undefined) g.userData.t0 = t;
    const p = Math.min(1, (t - g.userData.t0) / 1.0); // ~1s cheap reveal
    g.scale.setScalar(0.92 + 0.08 * p);
    if (p >= 1) { g.userData.done = true; g.scale.setScalar(1); }
  });
  return <group ref={ref}>{children}</group>;
}

// `labelSink` is NO LONGER rendered inside the 3D group — any DOM element in the R3F tree
// crashes the reconciler (see LabelLayer comment). Slice1 keeps its own LABEL3 pushes; the
// projected label row renders as a sibling of <Canvas> in Scene.
function Slice1({ at }: { at: [number, number, number] }) {
  const step = currentStep(SESSION.seqSteps, SESSION.onboard);
  const nextNode = step?.type === 'build' ? step.node_id : undefined;
  const jetty = SESSION.builtNode('jetty');
  const yard = SESSION.builtNode('scrap_yard');
  return (
    <group position={at}>
      <mesh position={[-12, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[14, 16]} /><meshStandardMaterial color="#1d3a52" /></mesh>
      {jetty ? (
        // S1.3 hero swap (F-06): procedural pier + Kenney kitbash crane/ship, built at
        // FINAL scene size (scale 1). Model origin = quay edge, placed at local x=-5 so
        // the pier reaches into the water rect (x -19..-5) and the ship lies alongside
        // inside the water. Named pivots: pivot_crane (rail travel), pivot_ship (berth
        // arrival/departure). Green glow marks build-complete; invisible hit box keeps
        // it tappable (footprint generous, observation 3.3).
        <>
          <Glb url={`${S1}jetty_pier.glb`} scale={1} pos={[-5, 0, 0]} />
          <BuiltGlow center={[-10, 0]} w={14} h={10} />
          <NodeHit nodeId="jetty" center={[-10.5, 0]} size={[12, 12]} />
        </>
      ) : (
        <GhostSlot pos={[-8, 0, 0]} size={[6, 5]} active={nextNode === 'jetty'} />
      )}
      {yard ? (
        <>
          <mesh position={[4, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[7, 7]} /><meshStandardMaterial color="#232c36" /></mesh>
          {/* S1.4: live ore mound (scale = yard_ore inventory) + static scrap bin + stacker boom */}
          <OreYardMound />
          <mesh castShadow position={[5.7, 0.75, -1.9]}><boxGeometry args={[1.7, 1.5, 2.4]} /><meshStandardMaterial color={STREAM.scrap} metalness={0.3} roughness={0.7} /></mesh>
          <mesh castShadow position={[2.3, 1.6, 1.8]}><boxGeometry args={[0.18, 3.2, 0.18]} /><meshStandardMaterial color="#4a525c" metalness={0.4} roughness={0.6} /></mesh>
          <mesh castShadow position={[3.15, 3.1, 0.9]} rotation={[0, Math.atan2(1.7, -1.8), 0]}><boxGeometry args={[0.14, 0.14, 2.6]} /><meshStandardMaterial color="#4a525c" metalness={0.4} roughness={0.6} /></mesh>
          <NodeHit nodeId="scrap_yard" center={[4, 0]} size={[9, 9]} />
        </>
      ) : (
        <GhostSlot pos={[4, 0, 0]} size={[7, 7]} active={nextNode === 'scrap_yard'} />
      )}
      {/* Dispatch RTG stands from the start of Slice 1 (its label always showed): tappable
          via DOM footprint even though its build step comes in Slice 5. */}
      <mesh position={[9, 3.5, 0]}><boxGeometry args={[2.2, 0.4, 4.6]} /><meshStandardMaterial color="#c9a13f" /></mesh>
      {[-1, 1].map((dz) => (
        <group key={dz}>
          <mesh position={[8.2, 1.7, dz * 2.1]}><boxGeometry args={[0.24, 3.4, 0.24]} /><meshStandardMaterial color="#c9a13f" metalness={0.4} roughness={0.5} /></mesh>
          <mesh position={[9.8, 1.7, dz * 2.1]}><boxGeometry args={[0.24, 3.4, 0.24]} /><meshStandardMaterial color="#c9a13f" metalness={0.4} roughness={0.5} /></mesh>
        </group>
      ))}
      <LABEL3 at={at} items={[...(jetty ? [['Jetty', -6, 7]] : []), ...(yard ? [['Raw Yard', 4, 3.2]] : []), ['Dispatch', 9, 4.4]] as Array<[string, number, number]>} />
    </group>
  );
}

// ---------- Slice 2: painted zones only (visual redesign pending) ----------
function Slice2({ at }: { at: [number, number, number] }) {
  return (
    <group position={at}>
      <mesh castShadow position={[-5, 1.1, 4]}><boxGeometry args={[8, 2.2, 4]} /><meshStandardMaterial color="#3f7fbf" metalness={0.5} roughness={0.55} /></mesh>
      <mesh castShadow position={[6, 0.9, 0.5]}><boxGeometry args={[5, 1.8, 2]} /><meshStandardMaterial color="#9a7fd0" metalness={0.5} roughness={0.55} /></mesh>
      <LABEL3 at={at} items={[['Scrap Yard (S2)', 0, 3.6]]} />
    </group>
  );
}

// ---------- Slice 3: DRP GLB + conveyor + DRI buffer tank ----------
// Guided-build reveal: each node appears only once its build step is confirmed.
// No EAF model here: the single EAF lives in the slice-4 meltshop zone (the S3
// "EAF" was a duplicate ghost — same GLB, and it popped into slice 3 as soon as
// the shared 'eaf' node_id got built for slice 4). Slice 3 ends at the DRI buffer;
// its sim consumes charges from that buffer.
function Slice3({ at }: { at: [number, number, number] }) {
  const drp = SESSION.builtNode('drp');
  const driBufferBuilt = SESSION.builtNode('conv_dri_eaf');
  return (
    <group position={at}>
      {drp && <Reveal built={drp}><Glb url={`${S3}drp_shaft.glb`} scale={1} pos={[-8, 0, 0]} /></Reveal>}
      {drp && <>
      <mesh position={[-4, 0.35, 0]}><boxGeometry args={[3.0, 0.3, 1.2]} /><meshStandardMaterial color="#4a525c" metalness={0.5} roughness={0.5} /></mesh>
      <FlowPulse from={[-5.4, 0.7, 0]} to={[-1.2, 2.4, 0]} active={() => { const s = SESSION.stateOf('slice3') as any; return !!s && Array.isArray(s.buffer) && s.buffer.some((l: any) => l.usable_t > 0); }} color="#d9a13f" />
      </>}
      {driBufferBuilt && <>
      <mesh castShadow position={[0, 2, 0]}><cylinderGeometry args={[1.6, 1.6, 4, 20]} /><meshStandardMaterial color="#39424e" metalness={0.5} roughness={0.5} /></mesh>
      </>}
      <LABEL3 at={at} items={[...(drp ? [['DRP', -8, 9]] : []), ...(driBufferBuilt ? [['DRI Buffer', 0, 5]] : [])] as Array<[string, number, number]>} />
    </group>
  );
}

// ---------- Slice 4: feed + EAF + LRF + CCM GLBs + billet-yard gantry ----------
const YARD_SCALE = 0.6;
const BAY_Z = (i: number) => 3.6 + i * 3.2 * YARD_SCALE;
function Slice4({ at }: { at: [number, number, number] }) {
  const steel = <meshStandardMaterial color="#4a5563" metalness={0.6} roughness={0.45} />;
  // guided-build reveal per node (same rule as slice1/slice3)
  const feed = SESSION.builtNode('scrap_feed');
  const eaf4 = SESSION.builtNode('eaf');
  const lf = SESSION.builtNode('lf');
  const cc = SESSION.builtNode('cc');
  const yard4 = SESSION.builtNode('billet_yard');
  return (
    <group position={at}>
      {feed && <Reveal built={feed}><Glb url={`${S4}feed.glb`} scale={4.5} pos={[-10, 0, 0]} /></Reveal>}
      {eaf4 && <><Glb url={`${S4}eaf_hero.glb`} scale={1} pos={[-5, 0, 0]} />
      <EafGlow pos={[-5, 1.0, 0]} active={() => !!(SESSION.stateOf('slice4') as any)?.eaf?.busy_charge_id} /></>}
      {lf && <Reveal built={lf}><Glb url={`${S4}lrf.glb`} scale={3} pos={[0, 0, 0]} /></Reveal>}
      {cc && <><Glb url={`${S4}ccm.glb`} scale={6} pos={[5, 0, 0]} />
      <FlowPulse from={[-2.5, 0.8, 0]} to={[3.5, 0.8, 0]} active={() => !!(SESSION.stateOf('slice4') as any)?.ccm?.busy_ladle_id} color="#e07070" /></>}
      {/* billet yard gantry (same construction as slices' yards), compact here */}
      {yard4 && <group position={[10, 0, -3.5]}>
        {[-2.6, 2.6].map((dx) => (
          <group key={dx} position={[dx * YARD_SCALE, 0, 0]} scale={YARD_SCALE}>
            {[BAY_Z(0) + 3.5, BAY_Z(4) + 3.5].map((z) => (
              <mesh key={z} castShadow position={[0, 2.4, z]}><boxGeometry args={[0.3, 4.8, 0.3]} />{steel}</mesh>
            ))}
            <mesh castShadow position={[0, 4.9, 6.4]}><boxGeometry args={[0.35, 0.3, 15.2]} />{steel}</mesh>
          </group>
        ))}
        {[0, 1, 2].map((b) => (
          <group key={b} position={[0, 0, BAY_Z(b)]} scale={YARD_SCALE}>
            {[-1.1, 1.1].map((dx) => <mesh key={dx} position={[dx, 0.28, 0]}><boxGeometry args={[0.34, 0.24, 2.6]} /><meshStandardMaterial color="#39424e" metalness={0.55} roughness={0.5} /></mesh>)}
          </group>
        ))}
        {Array.from({ length: 18 }).map((_, i) => {
          const bay = Math.floor(i / 9), k = i % 9;
          return <mesh key={i} castShadow position={[-0.85 * YARD_SCALE + (k % 3) * 0.85 * YARD_SCALE, 0.42, BAY_Z(bay) - 1.1 * YARD_SCALE + Math.floor(k / 3) * 1.1 * YARD_SCALE]}>
            <boxGeometry args={[6 * YARD_SCALE, 0.15, 0.15]} /><meshStandardMaterial color="#c9a15a" metalness={0.5} roughness={0.45} />
          </mesh>;
        })}
      </group>}
      <LABEL3 at={at} items={[...(feed ? [['Feed', -10, 6]] : []), ...(eaf4 ? [['EAF (S4)', -5, 6]] : []), ...(lf ? [['LRF', 0, 6]] : []), ...(cc ? [['CCM', 5, 8]] : []), ...(yard4 ? [['Billet Yard', 10, 5]] : [])] as Array<[string, number, number]>} />
    </group>
  );
}

// ---------- Slice 5: rebar mill GLB + product-yard gantry + order docks ----------
function Slice5({ at }: { at: [number, number, number] }) {
  const steel = <meshStandardMaterial color="#4a5563" metalness={0.6} roughness={0.45} />;
  // guided-build reveal per node (same rule as slice1/slice3)
  const mill = SESSION.builtNode('bar_mill');
  const yard5 = SESSION.builtNode('finished_yard');
  const docks = SESSION.builtNode('dispatch');
  return (
    <group position={at}>
      {mill && <><Glb url={`${S5}rebar_mill.glb`} scale={4} pos={[-2, 0, 0]} />
      <FlowPulse from={[-6, 0.8, 0]} to={[1.5, 0.7, 0]} active={() => !!(SESSION.stateOf('slice5') as any)?.mill?.busy} color="#4fae7d" />
      {/* cooling bed */}
      <mesh position={[0.6, 0.45, 0]}><boxGeometry args={[2.6, 0.3, 1.4]} /><meshStandardMaterial color="#2a3038" metalness={0.5} roughness={0.5} /></mesh></>}
      {/* product yard gantry with green bundles */}
      {yard5 && <group position={[3, 0, 0]}>
        {[-2.6, 2.6].map((dx) => (
          <group key={dx} position={[dx * YARD_SCALE, 0, 0]} scale={YARD_SCALE}>
            {[BAY_Z(0), BAY_Z(4)].map((z) => (
              <mesh key={z} castShadow position={[0, 2.4, z]}><boxGeometry args={[0.3, 4.8, 0.3]} />{steel}</mesh>
            ))}
            <mesh castShadow position={[0, 4.9, 6.4]}><boxGeometry args={[0.35, 0.3, 15.2]} />{steel}</mesh>
          </group>
        ))}
        {[0, 1, 2].map((b) => (
          <group key={b} position={[0, 0, BAY_Z(b)]} scale={YARD_SCALE}>
            {[-1.1, 1.1].map((dx) => <mesh key={dx} position={[dx, 0.28, 0]}><boxGeometry args={[0.34, 0.24, 2.6]} /><meshStandardMaterial color="#39424e" metalness={0.55} roughness={0.5} /></mesh>)}
          </group>
        ))}
        {Array.from({ length: 18 }).map((_, i) => {
          const bay = Math.floor(i / 9), k = i % 9;
          return <mesh key={i} castShadow position={[-0.85 * YARD_SCALE + (k % 3) * 0.85 * YARD_SCALE, 0.42, BAY_Z(bay) - 1.1 * YARD_SCALE + Math.floor(k / 3) * 1.1 * YARD_SCALE]}>
            <boxGeometry args={[6 * YARD_SCALE, 0.15, 0.15]} /><meshStandardMaterial color="#4fae7d" metalness={0.4} roughness={0.5} />
          </mesh>;
        })}
      </group>}
      {/* order docks */}
      {docks && [-2.6, 0, 2.6].map((dz) => (
        <mesh key={dz} position={[9, 0.3, dz]}><boxGeometry args={[1.4, 0.6, 1.8]} /><meshStandardMaterial color="#333b45" /></mesh>
      ))}
      <LABEL3 at={at} items={[...(mill ? [['Rebar Mill', -2, 7]] : []), ...(yard5 ? [['Product Yard', 3, 5]] : []), ...(docks ? [['Order Docks', 9, 2.4]] : [])] as Array<[string, number, number]>} />
    </group>
  );
}

// ---------- Sim-driven animation (contract clause 5: state-driven, not decorative) ----------
/** Travelling tonnage pulse along a conveyor line — active() reads live sim state. */
function FlowPulse({ from, to, active, color }: { from: [number, number, number]; to: [number, number, number]; active: () => boolean; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useRafLoop((t) => {
    const m = ref.current; if (!m) return;
    const on = active();
    m.visible = on;
    if (!on) return;
    const p = (t % 2.4) / 2.4; // one traverse per 2.4 s while the flow is active
    m.position.set(from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p, from[2] + (to[2] - from[2]) * p);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.28, 10, 10]} />
      <meshBasicMaterial color={color} transparent opacity={0.85} />
    </mesh>
  );
}

/** EAF hot glow while melting — reads busy_charge_id / charged heats each frame. */
function EafGlow({ pos, active }: { pos: [number, number, number]; active: () => boolean }) {
  const ref = useRef<THREE.PointLight>(null);
  useRafLoop((t) => {
    const l = ref.current; if (!l) return;
    l.intensity = active() ? 6 + Math.sin(t * 5) * 2 : 0;
  });
  return <pointLight ref={ref} position={pos} color="#ff7a3f" distance={9} intensity={0} />;
}

/** Plain rAF loop helper (avoids the useFrame-import black-screen pitfall). */
function useRafLoop(fn: (t: number) => void) {
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = () => { fn((performance.now() - start) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fn]);
}

function LABEL3({ at, items }: { at: [number, number, number]; items: Array<[string, number, number]> }) {
  pushLabels(`l3-${at.join(',')}`, items.map(([label, x, y]) => ({ id: `l3-${at.join(',')}-${label}`, label, world: [at[0] + x, y, at[2]] })));
  return null;
}

/** Resolve the card for an equipment id — sequence build-step card first, else a known
 *  content card by id (e.g. dispatch_crane), else the drafted placeholder. */
function equipCardFor(id: string): { card: any | null; drafted: boolean } {
  const step = SESSION.seqSteps.find((s) => s.type === 'build' && s.node_id === id);
  if (step?.card_id && ONBOARD_CARDS[step.card_id]) return { card: ONBOARD_CARDS[step.card_id], drafted: false };
  if (ONBOARD_CARDS[id]) return { card: ONBOARD_CARDS[id], drafted: false };
  if (DRAFTED_CARD[id]) return { card: DRAFTED_CARD[id], drafted: true };
  return { card: null, drafted: false };
}

/** Equipment info popup (observation 3.0): tapping a BUILT node — or the left equipment
 *  pane's expand arrow — shows its card content in a compact overlay over the play area.
 *  Content = the same card copy as the guided step (stepCardView), minus the build button. */
function EquipPopup() {
  const id = EQUIP.current;
  if (!id) return null;
  const { card, drafted } = equipCardFor(id);
  const view = stepCardView(card, 'card');
  return (
    <div id="equip-card">
      <button className="ob-close" onClick={closeEquip} aria-label="Close">✕</button>
      <div className="ob-step">Equipment · {id.replace(/_/g, ' ')}{drafted ? ' · DRAFT — pending approval' : ''}</div>
      <b className="ob-title">{view.title}</b>
      {view.body && <p>{view.body}</p>}
      {view.stats.length > 0 && (
        <table className="ob-stats">
          <tbody>{view.stats.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
        </table>
      )}
      {view.trivia && <div className="ob-trivia">{view.trivia}</div>}
    </div>
  );
}

// ---------- Left equipment pane (Yasser round-2 observation 3.0) ----------
// The in-world tap popup proved unreliable, so discovery moves to a collapsible left panel:
// every piece of equipment in the level is listed; tapping its ▾ expands the related info
// card(s) inline (accordion pattern, same as the right-panel HUD). Missing cards show the
// drafted placeholder clearly marked PENDING APPROVAL.
const EQUIP_PANE_OPEN: { current: boolean } = { current: false };

function EquipPane() {
  const [open, setOpen] = useState(EQUIP_PANE_OPEN.current);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    window.addEventListener('steelx-tick', h);
    window.addEventListener('steelx-onboard', h);
    return () => { window.removeEventListener('steelx-tick', h); window.removeEventListener('steelx-onboard', h); };
  }, []);
  const toggle = () => { EQUIP_PANE_OPEN.current = !open; setOpen(!open); };
  if (!open) {
    return (
      <div id="eqpane-collapsed">
        <button onClick={toggle} aria-label="Open equipment list">☰ Equipment</button>
      </div>
    );
  }
  const entries = equipmentIndex();
  const bySlice: Record<string, EquipEntry[]> = {};
  for (const e of entries) (bySlice[e.sliceId] ??= []).push(e);
  return (
    <div id="eqpane">
      <div id="eqpane-head">
        <b>Equipment</b>
        <button onClick={toggle} aria-label="Close equipment list">✕</button>
      </div>
      {ZONES.map((z) => {
        const list = bySlice[z.id];
        if (!list?.length) return null;
        return (
          <section key={z.id} className="eq-slice">
            <h4>{z.name}</h4>
            {list.map((e) => {
              const built = SESSION.builtNode(e.nodeId) || e.drafted;
              const isOpen = !!expanded[e.nodeId];
              return (
                <div key={e.nodeId} className={`eq-item${built ? '' : ' eq-locked'}`}>
                  <button className="eq-head" onClick={() => setExpanded((m) => ({ ...m, [e.nodeId]: !isOpen }))} aria-expanded={isOpen}>
                    <span className="eq-caret">{isOpen ? '▾' : '▸'}</span>
                    <span className="eq-name">{e.name}</span>
                    {!built && <span className="eq-lock">🔒</span>}
                    {e.drafted && <span className="eq-draft">DRAFT</span>}
                  </button>
                  {isOpen && e.cardIds.map((cid) => {
                    const { card, drafted } = equipCardFor(cid) as any;
                    const view = stepCardView(card ?? (e.drafted ? DRAFTED_CARD[e.nodeId] : null), 'card');
                    return (
                      <div className="eq-card" key={cid}>
                        {drafted && <div className="ob-step">DRAFT — pending Yasser approval</div>}
                        <b>{view.title}</b>
                        {view.body && <p>{view.body}</p>}
                        {view.stats.length > 0 && (
                          <table className="ob-stats"><tbody>{view.stats.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
                        )}
                        {view.trivia && <div className="ob-trivia">{view.trivia}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Scene ----------
function Scene() {
  const [, setFlow] = useState(0); // re-render when the guided flow moves (slice visibility, park banner)
  useEffect(() => {
    const bump = () => setFlow((n) => n + 1);
    window.addEventListener('steelx-tick', bump);
    window.addEventListener('steelx-onboard', bump);
    const unsub = subscribeSelect(bump); // equip popup opens/closes on tap -> re-render Scene
    return () => { window.removeEventListener('steelx-tick', bump); window.removeEventListener('steelx-onboard', bump); unsub(); };
  }, []);
  // NO top-of-Scene LABELS clear — see Label registry comment (that clear = the flicker).
  const target: [number, number, number] = [-2, 1.5, 6];
  const aspect = (typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1.6);
  const dist = Math.max(58, 92 / (2 * Math.tan((45 * Math.PI / 180) / 2)) * (aspect < 1.6 ? 1.6 / aspect : 1));
  const home = { target, azDeg: 0, elDeg: 42, dist, minDist: 12, maxDist: 170 };
  const posOf = (id: string): [number, number, number] => {
    const z = ZONES.find((zz) => zz.id === id)!;
    return [z.pos[0], 0, z.pos[2]];
  };
  return (
    <div id="scene">
      <Canvas camera={{ fov: 45 }} shadows gl={{ antialias: true, toneMapping: TONE_MODE, toneMappingExposure: EXPOSURE }}>
        <LabelCameraBridge />
        <ZoneTapFallback />
        <ViewCamera home={home} />
        {/* S0.4 lighting rig (PLAN_FORGED §2): fixed golden-hour — warm sun ~35° with long
            shadows, hemisphere sky/rust fill, steel-blue distance fog. NO day/night, NO DOF. */}
        <color attach="background" args={[new THREE.Color(LIGHTING.fog_color)]} />
        {FOG_ON && <fog attach="fog" args={[LIGHTING.fog_color, LIGHTING.fog_near, LIGHTING.fog_far]} />}
        <hemisphereLight color={LIGHTING.sky_color} groundColor={LIGHTING.ground_bounce} intensity={LIGHTING.hemi_intensity} />
        <directionalLight
          position={LIGHTING.sun_dir}
          color={LIGHTING.sun_color}
          intensity={LIGHTING.sun_intensity}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-60}
          shadow-camera-right={60}
          shadow-camera-top={60}
          shadow-camera-bottom={-60}
          shadow-camera-far={160}
          shadow-bias={-0.0005}
        />
        {/* continuous plant ground */}
        <mesh position={[-2, -0.01, 6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[110, 46]} />
          <meshStandardMaterial color={GROUND_COLOR} roughness={0.95} />
        </mesh>
        <StreamStrips />
        {SESSION.builtNode('conv_ore_drp') && <OreBelt />}
        {ZONES.map((z) => <Zone key={z.id} zone={z} />)}
        <SelectionRim />
        {ZONES.map((z) => <LockedVeil key={`veil-${z.id}`} zone={z} />)}
        <Slice1 at={posOf('slice1')} />
        {/* slices 2-5 geometry stays hidden until the guided flow builds that slice's
            nodes (per-slice design work; Yasser observation 2026-10-26) */}
        {SESSION.sliceBuildDone('slice2') && <Slice2 at={posOf('slice2')} />}
        {SESSION.sliceBuildDone('slice3') && <Slice3 at={posOf('slice3')} />}
        {SESSION.sliceBuildDone('slice4') && <Slice4 at={posOf('slice4')} />}
        {SESSION.sliceBuildDone('slice5') && <Slice5 at={posOf('slice5')} />}
      </Canvas>
      <LabelLayer />
      <EquipPane />
      <EquipPopup />
      <div id="hud"><b>SteelX — full plant (play home)</b><br /><small>{SESSION.onboard.clockRunning ? 'tap a zone for its live card · sim runs while you look around' : 'guided build — follow the step card in the panel'}</small></div>
      {SESSION.slice1BuildDone() && !SESSION.onboardingComplete() && SESSION.onboard.index >= 0 && SESSION.seqSteps[SESSION.onboard.index]?.type === 'park' && (
        <div id="park-banner"><b>Slice 1 is built — now play it.</b><br /><small>Finish the Slice 1 quests in the panel to unlock building the next slice.</small></div>
      )}
      <ResetViewButton />
      <ViewNavButtons />
      <div id="panel">
        <OnboardingCard
          steps={SESSION.seqSteps}
          state={SESSION.onboard}
          cardsById={ONBOARD_CARDS}
          onDismiss={() => { SESSION.dismissCard(); notifyOnboard(); }}
          onBuild={() => { SESSION.confirmBuild(); window.dispatchEvent(new Event('steelx-tick')); notifyOnboard(); }}
        />
        <PlantHud session={SESSION} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Scene />);

// Test/dev hook: programmatic zone selection (probes use this to exercise the two-tier tap
// path without raycast guesswork; harmless in production).
(window as any).__steelxSelect = selectZone;
(window as any).__steelxEquip = selectEquip;
(window as any).__steelxSession = SESSION; // perf/quest probes (S0.4 baseline script) — read-only usage

// S0.5 boot restore: a valid fullplant save resumes the campaign mid-game (onboarding
// skipped to its saved step); missing/corrupt/old-schema saves fall through to a fresh
// game (reject-never-default). Runs BEFORE render so the 3D tree paints the restored plant.
const RESUMED = SESSION.tryRestore();
if (RESUMED) window.dispatchEvent(new Event('steelx-onboard')); // HUD/accordions re-read state
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') SESSION.autosave(); // tab close / phone background
});

// S0.4 dev probe hook: ViewCamera publishes the live renderer/scene/camera so rig probes can
// read tone mapping + light params from real pixels' source of truth (dev-only, harmless).
