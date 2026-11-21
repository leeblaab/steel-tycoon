import * as React from 'react';
import rd from 'react-dom/client';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { ViewCamera, ResetViewButton } from './view_camera.tsx';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const { useEffect, useMemo, useRef, useState } = React;
import { runSlice5, SCENARIO, PRICE_MID_B500B, type RunResult, type TickRecord } from './sim.js';

// ---------- Simulation (deterministic mirror port; 3D layer never drives logic) ----------
const RESULT: RunResult = runSlice5();
// Print the programmatic fixture verification into the browser console too (verification bar (a)).
console.log(`[S5 verify ${RESULT.verify.ok ? 'ALL MATCH' : 'MISMATCH'}]`);
for (const line of RESULT.verify.lines) console.log(line);

// ---------- Layout (fixed world coordinates, meters) — flow left to right ----------
const LAYOUT = {
  billetYard: { x: -9, z: 0 },
  carrier:    { x: -5.5, z: 0 },   // carrier path billet yard -> mill
  mill:       { x: -2, z: 0 },
  productYard:{ x: 3, z: 0 },
  dispatch:   { x: 6, z: 0 },      // S5.4-prep #7: was 'crane' (box stand-in) — now truck route midpoint
  orders:     { x: 9.5, z: 0 },    // order docks O1/O2/O3 in a vertical line
};

// ---------- Camera framing (same bounded elevation convention as slice1) ----------
function useOrbitCamera(target: [number, number, number], dist: number, azDeg: number, elDeg: number) {
  const el = (Math.min(75, Math.max(15, elDeg)) * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  const pos: [number, number, number] = [
    target[0] + dist * Math.cos(el) * Math.sin(az),
    target[1] + dist * Math.sin(el),
    target[2] + dist * Math.cos(el) * Math.cos(az),
  ];
  return { pos, target };
}

// ---------- DOM label overlay (labels outside WebGL, slice1 pattern) ----------
let LABELS: Array<{ id: string; label: string; world: [number, number, number]; cls?: string }> = [];
const CAM = { current: null as any };
function LabelCameraBridge() { const { camera } = useThree(); CAM.current = camera; return null; }
function LabelLayer() {
  const [, setTick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setTick((t) => t + 1), 100); return () => clearInterval(id); }, []);
  const canvas = typeof document !== 'undefined' ? document.querySelector('#scene canvas') as HTMLCanvasElement | null : null;
  const cam = CAM.current;
  if (!canvas || !cam) return null;
  const rect = canvas.getBoundingClientRect();
  const pts = LABELS.map((L) => {
    const v = new THREE.Vector3(...L.world).project(cam);
    return { id: L.id, label: L.label, cls: L.cls, x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
  });
  return <div id="labels">{pts.map((p) => <div key={p.id} className={`blabel ${p.cls ?? ''}`} style={{ left: p.x, top: p.y }}>{p.label}</div>)}</div>;
}

function Building({ pos, size, label, color, accent }: { pos: [number, number, number]; size: [number, number, number]; label: string; color: string; accent?: string }) {
  if (!LABELS.some((L) => L.id === label)) LABELS.push({ id: label, label, world: [pos[0], pos[1] + size[1] + 0.6, pos[2]] });
  return (
    <group position={pos}>
      <mesh position={[0, size[1] / 2, 0]}><boxGeometry args={size} /><meshStandardMaterial color={color} /></mesh>
      {accent && (
        <mesh position={[0, size[1] / 2, size[2] / 2 + 0.01]}>
          <boxGeometry args={[size[0] * 0.9, 0.12, 0.02]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} />
        </mesh>
      )}
    </group>
  );
}

// ---------- Model-loading isolation seam (rule 5) ----------
// Each object type gets its own small component so a Kenney GLB swap later touches ONLY that
// component. Boxes are the current stand-ins; when Yasser drops e.g. assets/crane.glb next to
// main.tsx, replace the box inside DispatchCraneModel with <primitive object={model.clone()} ... />
// (clone per instance — verified pitfall: <primitive> mutates the shared loaded model).
// ---------- Attached GLB models (ComfyUI meshes, quantized+simplified; slice3/4 pattern) ----------
function GlbModel({ url }: { url: string }) {
  const [gltf, setGltf] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    new GLTFLoader().load(url, (g: { scene: THREE.Group }) => { if (alive) setGltf(g.scene); }, undefined, (err: unknown) => console.error(`GLB load failed (${url}):`, err));
    return () => { alive = false; };
  }, [url]);
  return gltf;
}

// ---------- Gantry yards: S5.4-prep hero swaps #5/#6 (FORGED F-01 procedural heroes) ----------
// The old inline construction (YardGantrySide/BilletRack/YardCrane + makeGantrySide/
// ProductRack/GantryCrane duplicates) had MIXED scale math — posts placed in bay coords but
// scaled 0.6x, crane group offset [0,-1,-6] buried the bridge: "random parts thrown
// everywhere" (Yasser 21.11). Replaced by ONE coherent GLB per yard built at final size
// (tools/blender/hero_gantry_yard.py): floor + runway rails on real columns + 5 rack bays +
// gantry crane riding the rails, all aligned by construction. Same hero-swap seam as S5.3.
// Yasser 21.11 pass 2: heroes read ~3x too big next to the mill and sat off-centre (hero
// geometry runs z=0..11.76 forward from its origin while LAYOUT pins sit at z=0) — scaled
// 1/3 and re-pinned so each yard's centre lands on its layout point.
const YARD_BILLET_GLB_URL = new URL('./assets/gantry_yard_billet.glb', import.meta.url).href;
const YARD_PRODUCT_GLB_URL = new URL('./assets/gantry_yard_product.glb', import.meta.url).href;
const YARD_BAYS = [0, 1, 2, 3, 4];                 // five storage bays (hero stock_b0..b4)
const YARD_SCALE_H = 1 / 3;                        // hero size knob (Yasser: a third of built size)
const BAY_PITCH_H = 1.92, BAY_Z0_H = 2.16;         // hero design constants (anim stays in model-local units)
// hero design extents X -2.88..2.88, Z 0..11.76 -> centre offset for re-pinning:
const YARD_CX = 0, YARD_CZ = 5.88;                 // (must match build-script constants)
// bridge-local rest heights: hero world y minus BRIDGE_Y (4.32) — hook 3.55, payload 3.16
const HOOK_LOCAL_Y = -0.77, PAYLOAD_LOCAL_Y = -1.16;

function GantryYardHero({ url, rec, tonnage, capacity, label, accent, busy }: {
  url: string; rec: TickRecord; tonnage: number; capacity: number;
  label: string; accent: [string, string]; busy: boolean;
}) {
  const gltf = GlbModel({ url });
  const rig = useMemo(() => {
    if (!gltf) return null;
    const root: THREE.Group = gltf.clone();
    root.scale.setScalar(YARD_SCALE_H);            // size knob lives on the model, not the anim
    const crane = root.getObjectByName('crane_bridge');
    const payload = root.getObjectByName('crane_payload');
    const hook = root.getObjectByName('crane_hook');
    // move the whole crane as one unit: re-parent its parts under the bridge node
    const group = new THREE.Group();
    for (const nm of ['truck_-2.6', 'truck_2.6', 'rope_-0.18', 'rope_0.18', 'crane_hook', 'crane_payload']) {
      const o = root.getObjectByName(nm);
      if (o && crane) { o.position.sub(crane.position); group.add(o); }
    }
    if (crane) crane.add(group);
    if (payload) payload.visible = false;
    // per-bay stock nodes for tonnage-driven show/hide
    const bays = YARD_BAYS.map((i) => root.getObjectByName(`stock_b${i}`)).filter(Boolean) as THREE.Object3D[];
    root.traverse((o: THREE.Object3D) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    return { holder: root, crane, hook, payload, bays, phase: 0, hookDy: 0 };
  }, [gltf]);

  const fill = Math.min(1, tonnage / capacity);
  useFrame((_, dt) => {
    if (!rig) return;
    // stock level: whole bays visible from bay 0 up (presentation of sim tonnes)
    const lit = Math.ceil(fill * YARD_BAYS.length - 1e-9);
    rig.bays.forEach((b, i) => { b.visible = i < lit; });
    // crane travel + hoist loop while the zone is active; parks at middle bay otherwise.
    // Hook/payload ride in the bridge's LOCAL space: local y = hero world y - BRIDGE_Y(4.32).
    if (busy) rig.phase = (rig.phase + dt * 0.45) % 1;
    const t = rig.phase;
    if (rig.crane) {
      rig.crane.position.z = busy ? BAY_Z0_H + t * (YARD_BAYS.length - 1) * BAY_PITCH_H : BAY_Z0_H + 2 * BAY_PITCH_H;
      const dy = busy ? (t < 0.5 ? THREE.MathUtils.lerp(0, -2.8, t * 2) : THREE.MathUtils.lerp(-2.8, 0, (t - 0.5) * 2)) : 0;
      if (rig.hook) rig.hook.position.y = HOOK_LOCAL_Y + dy;
      if (rig.payload) {
        const carry = busy && t > 0.5 && t < 0.98;
        rig.payload.visible = carry;
        rig.payload.position.y = PAYLOAD_LOCAL_Y + dy;
      }
    }
  });

  const pos = label === 'Billet Yard' ? LAYOUT.billetYard : LAYOUT.productYard;
  return (
    <group position={[pos.x, 0, pos.z]}>
      <Building pos={[0, 0, 0]} size={[0.001, 2.6, 0.001]} label={label} color="#2a3038" accent={tonnage > 0 ? accent[0] : accent[1]} />
      {/* pin the hero by its CENTRE: layout point = middle of the yard footprint */}
      {rig && <primitive object={rig.holder} position={[-YARD_CX * YARD_SCALE_H, 0, -YARD_CZ * YARD_SCALE_H]} />}
    </group>
  );
}

// S5.3 hero swap #4: procedural rebar mill (tools/blender/hero_rebar_mill.py, FORGED F-01).
// Replaces "rm 1024.glb" (ComfyUI box line, 1.63MB) -> 43KB / 572 tris / 4 draws.
// Built at FINAL scene size (scale 1): furnace x -4.1..-1.1, 4 stands, run-out to +x
// toward the product yard. charge_gate is the named animatable node (slides while the
// mill feeds); mouth glow + bar-on-table overlays are renderer-side, busy-gated.
const MILL_GLB_URL = new URL('./assets/rebar_mill_hero.glb', import.meta.url).href;

function RebarMillModel({ rec }: { rec: TickRecord }) {
  const busy = rec.mill_busy;
  const gltf = GlbModel({ url: MILL_GLB_URL });
  const rig = React.useMemo(() => {
    if (!gltf) return null;
    const root: THREE.Group = gltf.clone();
    const gate = root.getObjectByName('charge_gate');
    if (gate) (gate as THREE.Mesh).userData.bindX = gate.position.x;
    root.traverse((o: THREE.Object3D) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    // furnace mouth glow — visible ONLY while rolling (charge side faces -x)
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.15, 1.0),
      new THREE.MeshStandardMaterial({ color: '#ff7040', emissive: '#ff7040', emissiveIntensity: 0.8 }));
    glow.position.set(-1.22, 0.72, 0); glow.visible = false;
    root.add(glow);
    // hot bar on the run-out table while a batch is in process (roll centreline y~0.9)
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.6, 8),
      new THREE.MeshStandardMaterial({ color: '#c98a3a', emissive: '#c98a3a', emissiveIntensity: 0.6 }));
    bar.rotation.z = Math.PI / 2; bar.position.set(1.4, 0.95, 0); bar.visible = false;
    root.add(bar);
    const holder = new THREE.Group(); holder.add(root);
    return { holder, gate, glow, bar };
  }, [gltf]);

  // charge-gate slide: eased open while feeding (roll start), eased shut otherwise.
  useFrame((_, dt) => {
    if (!rig) return;
    const open = busy ? 0.9 : 0;
    const cur = (rig as any).gateDisp ?? 0;
    const next = cur + (open - cur) * (1 - Math.exp(-dt / 0.8));
    (rig as any).gateDisp = next;
    if (rig.gate) rig.gate.position.x = (rig.gate.userData.bindX as number) + next;
    rig.glow.visible = busy;
    rig.bar.visible = rec.mill_in_process_t > 0;
    (rig.bar.material as THREE.MeshStandardMaterial).emissiveIntensity = busy ? 0.6 : 0.2;
  });

  return (
    <>
      {/* mill hall label anchor (invisible; accent band shows busy state) */}
      <Building pos={[LAYOUT.mill.x, 0, 0]} size={[0.001, 5.5, 0.001]} label="Rebar Mill" color="#333b45" accent={busy ? '#e07070' : '#5a6572'} />
      {rig && <primitive object={rig.holder} position={[LAYOUT.mill.x, 0, 0]} />}
    </>
  );
}


// S5.4-prep hero swap #7: the dispatch-crane box stand-in is GONE (ugly next to the yard
// heroes, Yasser 21.11). Dispatch is now a FLEET OF 3 flatbed trucks (tools/blender/
// hero_truck.py, 264 tris / 22.5 KB) driving each dispatch move from the product yard to
// the order dock lane. The sim resource stays abstract `dispatch_crane` (engine untouched,
// F-07 breadth freeze) — visual grammar only. Trucks idle parked in a layby at x=6; one is
// assigned per move (round-robin), drives along the ground (no payload arc), spins its
// wheels, carries the green bundle node while loaded, returns empty after delivery.
const TRUCK_GLB_URL = new URL('./assets/flatbed_truck.glb', import.meta.url).href;
const TRUCK_LAYBY_Z = 4.6;                          // idle parking row (south of the route)
const TRUCK_PARK_X = [5.2, 6.1, 7.0];               // three layby slots

interface MoveInfo { orderIdx: number; tonnage: number }

// Deterministic reconstruction of every dispatch move from the recorded ticks — no RNG,
// no playback state: which tick a move starts, for which dock lane, and its tonnage.
function buildDispatchMoves(): Map<number, MoveInfo> {
  const moves = new Map<number, MoveInfo>();
  let prevT = 0;
  RESULT.records.forEach((r, i) => {
    if (r.crane_busy_task_type === 'dispatch' && r.product_yard_t < prevT - 1e-9) {
      moves.set(i, { orderIdx: ['O1', 'O2', 'O3'].indexOf(r.crane_busy_order ?? ''), tonnage: prevT - r.product_yard_t });
    }
    prevT = r.product_yard_t;
  });
  return moves;
}
const DISPATCH_MOVES = buildDispatchMoves();

// Which truck drives the move active at record idx i, and its [0..1] route progress.
// Sub-tick smoothness comes from the TruckFleet frame loop (position eased per frame),
// so this stays a pure tick->state map — no hooks inside.
function truckStateAt(idx: number): { slot: number; startIdx: number; orderIdx: number } | null {
  const span = SCENARIO.dispatch_crane.move_ticks;
  for (let s = Math.max(0, idx - span + 1); s <= idx; s++) {
    const m = DISPATCH_MOVES.get(s);
    if (!m) continue;
    return { slot: [...DISPATCH_MOVES.keys()].indexOf(s) % 3, startIdx: s, orderIdx: m.orderIdx };
  }
  return null;
}

function TruckFleet({ rec }: { rec: TickRecord }) {
  const gltf = GlbModel({ url: TRUCK_GLB_URL });
  const rigs = useMemo(() => {
    if (!gltf) return null;
    return [0, 1, 2].map(() => {
      const root: THREE.Group = gltf.clone();
      const wheels = ['fl', 'fr', 'ml', 'mr', 'rl', 'rr'].map((n) => root.getObjectByName(`wheel_${n}`)).filter(Boolean) as THREE.Object3D[];
      const bundle = root.getObjectByName('bundle');
      if (bundle) bundle.visible = false;
      root.traverse((o: THREE.Object3D) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      return { root, wheels, bundle, travel: 0 };
    });
  }, [gltf]);

  const idx = RESULT.records.indexOf(rec);
  useFrame((_, dt) => {
    if (!rigs) return;
    const st = truckStateAt(idx);
    // frame-eased progress within the active move (playback advances one record / 160 ms)
    const span = SCENARIO.dispatch_crane.move_ticks;
    const targetT = st ? Math.min(1, (idx - st.startIdx + 1) / span) : 0;
    rigs.forEach((rig, slot) => {
      rig.travel = rig.travel + (targetT - rig.travel) * Math.min(1, dt * 8);
      const driving = !!st && st.slot === slot;
      const t = driving ? rig.travel : 0;
      // route: product yard -> dock lane (x lerps, z fans out to the order lane)
      const oz = driving && st.orderIdx >= 0 ? (st.orderIdx - 1) * 2.6 : 0;
      const x = driving ? LAYOUT.productYard.x + (LAYOUT.orders.x - LAYOUT.productYard.x) * t : TRUCK_PARK_X[slot];
      const z = driving ? oz * t : TRUCK_LAYBY_Z;
      rig.root.position.set(x, 0, z);
      // face the travel direction (outbound: +x with a z fan toward the dock lane)
      rig.root.rotation.y = driving ? Math.atan2(oz, LAYOUT.orders.x - LAYOUT.productYard.x) : Math.PI;
      // honest wheel roll while moving (0.3 m radius -> rad/s from route speed)
      rig.wheels.forEach((w) => { w.rotation.x -= dt * (driving ? 4 : 0); });
      if (rig.bundle) rig.bundle.visible = driving && t < 0.999;
    });
  });

  return (
    <>
      {/* dispatch-yard label anchor (accent band shows crane-resource busy state honestly) */}
      <Building pos={[LAYOUT.dispatch.x, 0, TRUCK_LAYBY_Z]} size={[0.001, 2.2, 0.001]} label="Dispatch" color="#2a3038" accent={rec.crane_busy_task_type ? '#5a9fd4' : '#5a6572'} />
      {rigs && rigs.map((rig, i) => <primitive key={i} object={rig.root} />)}
    </>
  );
}

// ---------- Animated carriers (interpolated between recorded tick states) ----------
// A move spans [startTick, startTick + moveTicks]; the payload cube lerps along its path and
// carries a tonnage label. Progress within the current tick comes from the playback clock.
function useLerp(recIdx: number, speedMs: number) {
  const p = useRef(0);
  useFrame((_, delta) => { p.current = Math.min(1, p.current + (delta * 1000) / speedMs); });
  return p.current;
}

function CarrierMove({ rec, prev }: { rec: TickRecord; prev: TickRecord }) {
  // carrier move active when transit payload exists this tick or started last tick
  const active = rec.carrier_busy && (rec.carrier_transit_t > 0 || prev.carrier_transit_t > 0);
  const deliveredNow = rec.carrier_transit_t === 0 && prev.carrier_transit_t > 0;
  const frac = useLerp(rec.tick, 160 * SCENARIO.billet_carrier.move_ticks);
  if (!active && !deliveredNow) return null;
  const ton = Math.max(rec.carrier_transit_t, prev.carrier_transit_t);
  const t = deliveredNow ? 1 : frac;
  const x = LAYOUT.billetYard.x + (LAYOUT.mill.x - LAYOUT.billetYard.x) * t;
  const y = 1.1 + Math.sin(Math.PI * t) * 0.8;
  LABELS.push({ id: 'carrier', label: `${ton.toFixed(1)} t billet`, world: [x, y + 0.45, 0], cls: 'tonlabel' });
  return <mesh position={[x, y, 0]}><boxGeometry args={[0.7, 0.5, 0.7]} /><meshStandardMaterial color="#e8a94f" emissive="#7a5320" emissiveIntensity={0.4} /></mesh>;
}

// Dispatch payload is now carried by the truck itself (TruckFleet bundle node) — the old
// flying-box arc was deleted with the crane stand-in (hero swap #7).

// Competing reclaiming task: crane is preempted/reserved honestly — dispatch waits (non-preemptive
// cycle; priority only reorders the queue). Shown as an amber pulse on the crane + queue badge.
function CompetingBadge({ rec }: { rec: TickRecord }) {
  const active = rec.crane_busy_task_type === 'reclaiming' || rec.competing_queued;
  if (!active) return null;
  LABELS.push({ id: 'competing', label: rec.crane_busy_task_type === 'reclaiming' ? 'crane busy: reclaiming (priority 1)' : 'reclaiming queued (priority 1)', world: [LAYOUT.dispatch.x, 4.3, TRUCK_LAYBY_Z], cls: 'tonlabel' });
  return null;
}

function OrderDocks({ rec }: { rec: TickRecord }) {
  return (
    <>
      {rec.orders.map((o, i) => {
        const z = (i - 1) * 2.6;
        const done = o.status === 'completed';
        const color = done ? '#4fae7d' : o.status === 'failed' ? '#c05050' : '#3f7fbf';
        LABELS.push({ id: `order-${o.order_id}`, label: `${o.order_id} ${o.dispatched_t.toFixed(1)}/${o.required_t} t`, world: [LAYOUT.orders.x, 1.9, z], cls: 'tonlabel' });
        return (
          <group key={o.order_id} position={[LAYOUT.orders.x, 0, z]}>
            <mesh position={[0, 0.75, 0]}><boxGeometry args={[1.6, 1.5, 1.6]} /><meshStandardMaterial color="#2a3038" /></mesh>
            <mesh position={[0, 1.52, 0]}><boxGeometry args={[1.6, 0.14, 1.6]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={done ? 0.8 : 0.3} /></mesh>
          </group>
        );
      })}
    </>
  );
}

function Scene({ idx }: { idx: number }) {
  LABELS = [];
  const rec = RESULT.records[idx];
  const prev = RESULT.records[Math.max(0, idx - 1)];
  const target: [number, number, number] = [0, 1.4, 0];
  const aspect = (typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1.6);
  const dist = Math.max(20, 21 / (2 * Math.tan((45 * Math.PI / 180) / 2)) * (aspect < 1.6 ? 1.6 / aspect : 1));
  const { pos } = useOrbitCamera(target, dist, 0, 35);
  return (
    <Canvas camera={{ position: pos, fov: 45 }} shadows
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1 }}>
      <LabelCameraBridge />
      <ViewCamera home={{ target, azDeg: 0, elDeg: 35, dist, minDist: 8, maxDist: 55 }} />
      {/* S5.4-prep: same golden-hour rig as fullplant (palette.ts LIGHTING) — the slice twin was
          ambient-only dark while the full game read daylight; Yasser 21.11. Fog skipped: the
          slice plot is ~26 wide, fog_near 120 would be dead weight. */}
      <color attach="background" args={[new THREE.Color('#3d4a58')]} />
      <hemisphereLight color="#a8c4de" groundColor="#7a5f4b" intensity={1.1} />
      <directionalLight
        position={[-30, 42, 60]} color="#ffe2b8" intensity={3.2} castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-25} shadow-camera-right={25}
        shadow-camera-top={25} shadow-camera-bottom={-25}
        shadow-camera-far={160} shadow-bias={-0.0005} />
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[26, 14]} /><meshStandardMaterial color="#17202a" roughness={0.95} /></mesh>
      {/* carrier rail + dispatch gantry path cues */}
      <mesh position={[(LAYOUT.billetYard.x + LAYOUT.mill.x) / 2, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[LAYOUT.mill.x - LAYOUT.billetYard.x + 2, 0.8]} /><meshStandardMaterial color="#232c36" /></mesh>
      <GantryYardHero url={YARD_BILLET_GLB_URL} rec={rec} tonnage={rec.billet_yard_t} capacity={450}
        label="Billet Yard" accent={['#c98a3a', '#5a6572']}
        busy={rec.mill_busy || (rec.billet_yard_t > 0 && rec.mill_in_process_t > 0)} />
      <RebarMillModel rec={rec} />
      <GantryYardHero url={YARD_PRODUCT_GLB_URL} rec={rec} tonnage={rec.product_yard_t} capacity={SCENARIO.product_yard.capacity_t}
        label="Product Yard" accent={['#4fae7d', '#5a6572']} busy={rec.crane_busy_task_type !== null} />
      <TruckFleet rec={rec} />
      <OrderDocks rec={rec} />
      <CarrierMove rec={rec} prev={prev} />
      <CompetingBadge rec={rec} />
    </Canvas>
  );
}

// ---------- App ----------
function App() {
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  // Negative scenario mode from the fixture's negative_controls.no_billet_stock (verification bar (d)).
  const [noBillet, setNoBillet] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setIdx((i) => { if (i + 1 >= RESULT.records.length) { setRunning(false); return i; } return i + 1; });
    }, 160);
    return () => clearInterval(id);
  }, [running]);

  const rec = RESULT.records[idx];
  const events = useMemo(() => RESULT.records.slice(0, idx + 1).flatMap((r) => r.events.map((e) => ({ tick: r.tick, event: e }))), [idx]);
  const final = RESULT.state;
  const c = final.counters;

  return (
    <>
      <div id="scene">
        <Scene idx={idx} />
        <LabelLayer />
        <ResetViewButton />
        <div id="overlay">
          <div className="big">Tick {rec.tick} / {SCENARIO.ticks}</div>
          <div className="flow">Flow: Billet Yard → Rebar Mill → Product Yard → Dispatch (O1/O2/O3)</div>
          <div>Billet: {rec.billet_yard_t.toFixed(1)} t · On mill: {rec.mill_in_process_t.toFixed(1)} t</div>
          <div>Product yard: {rec.product_yard_t.toFixed(1)} t / {SCENARIO.product_yard.capacity_t} t</div>
          <div className={rec.crane_busy_task_type === 'reclaiming' ? 'blocked' : ''}>
            Crane: {rec.crane_busy_task_type ?? 'idle'}{rec.crane_busy_order ? ` (${rec.crane_busy_order})` : ''}
          </div>
        </div>
      </div>
      <div id="panel">
        <h1>SteelX — Slice 5 (Billet → Rebar → Dispatch)</h1>
        <div className="row">
          <button className="primary" onClick={() => setRunning(true)} disabled={running}>Start</button>
          <button onClick={() => setRunning(false)} disabled={!running}>Pause</button>
          <button onClick={() => { setIdx(0); setRunning(false); }}>Reset</button>
          <button onClick={() => setIdx((i) => Math.min(i + 1, RESULT.records.length - 1))} disabled={running}>Step +1</button>
        </div>
        <div className="row">
          <button onClick={() => setIdx(39)}>Jump to tick 40 (competing task)</button>
          <button onClick={() => setIdx(62)}>Jump to O2 complete @63</button>
        </div>
        <div className="row">
          <button className={noBillet ? 'active' : 'danger'} onClick={() => setNoBillet((v) => !v)}>
            {noBillet ? 'Negative mode: NO BILLET STOCK (on)' : 'Negative mode: no_billet_stock'}
          </button>
        </div>

        <h2>Orders — progress vs deadline</h2>
        {rec.orders.map((o) => {
          // Fixture orders carry required_t=30 (O1/O2/O3); lazy whole-batch dispatch overshoots to
          // 39.2 t per completed order — the bar caps at 100% but the numbers stay exact.
          const frac = Math.min(1, o.dispatched_t / o.required_t);
          const late = rec.tick > o.deadline_tick && o.status !== 'completed';
          return (
            <div className="order" key={o.order_id}>
              <div className="head"><span>{o.order_id} · B500B rebar</span><span>{o.dispatched_t.toFixed(1)} / {o.required_t} t</span></div>
              <div className="bar"><div style={{ width: `${100 * frac}%`, background: o.status === 'completed' ? '#4fae7d' : late ? '#c05050' : '#3f7fbf' }} /></div>
              <span className={`badge ${o.status === 'completed' ? 'ok' : late ? 'on' : 'off'}`}>
                {o.status === 'completed' ? `done @ deadline ${o.deadline_tick}` : o.status === 'failed' ? 'FAILED (deadline)' : `open — deadline ${o.deadline_tick}`}
              </span>
            </div>
          );
        })}

        <h2>Counters @ tick {rec.tick}</h2>
        <div className="stat"><span>Carrier moves completed</span><b>{c.carrier_moves_completed}</b></div>
        <div className="stat"><span>Mill rolls completed</span><b>{c.rolls_completed}</b></div>
        <div className="stat"><span>Dispatch moves completed</span><b>{c.dispatch_moves_completed}</b></div>
        <div className="stat"><span>Dispatch attempts blocked (empty yard)</span><b>{c.dispatch_moves_blocked} ({c.dispatch_moves_blocked_empty})</b></div>
        <div className="stat"><span>Crane wait ticks</span><b>{c.crane_wait_ticks}</b></div>
        <div className="stat"><span>Product-yard refusals</span><b>{c.product_yard_refusals}</b></div>
        <div className="stat"><span>Yield loss</span><b>{c.yield_loss_t.toFixed(1)} t</b></div>
        <div className="stat"><span>Dispatched total</span><b>{c.dispatched_t_total.toFixed(1)} t</b></div>
        <div className="stat"><span>Revenue</span><b>${c.revenue_usd.toFixed(0)}</b></div>

        <h2>Final state — info card</h2>
        <div className="learn">
          <b>WIN: {String(final.win)} (fixture win=false)</b><br />
          O1 completed @35 (&lt;60) and O2 completed @63 (&lt;90); <b>O3 partial 19.6/30 t — stock-limited, not deadline-limited</b>:
          opening 100 t billet → 98 t product (2% rolling yield); whole-batch pipeline leaves only 19.6 t for O3 after
          O1+O2 take 39.2 t each. Last dispatch completes @74, well before O3's deadline (120) — the pipeline could serve
          O3 if opening stock covered demand (~110 t). Revenue {c.revenue_usd.toFixed(0)} USD = {c.dispatched_t_total.toFixed(1)} t dispatched × B500B mid {PRICE_MID_B500B} (sme_pending band, midpoint convention).<br />
          Crane honesty: the reclaiming task enqueued at tick 40 (priority 1) takes the crane when it is free — the running
          dispatch is never preempted (non-preemptive cycle); the next dispatch start moves 60 → 68 and blocks accrue while
          the yard drains to 0. Lazy dispatch: an attempt against an empty yard is recorded as a refusal ({c.dispatch_moves_blocked}), never queued forever.
        </div>

        <h2>Event log</h2>
        <div className="eventlog">{events.slice(-40).map((e, i) => <div key={i}>tick {e.tick}: {e.event}</div>)}</div>
      </div>
    </>
  );
}

rd.createRoot(document.getElementById('root')!).render(<App />);
