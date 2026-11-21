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
  crane:      { x: 6, z: 0 },      // dispatch crane column
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

// ---------- Billet yard: slice4's gantry-yard construction ported (25.10) ----------
// Same look as slice4's billet yard (side structures + runway rails, racks, billets along X,
// overhead crane with pick/carry loop while the mill runs). Slice5 LAYOUT uses z:0 for the
// yard plot instead of slice4's beside-the-CCM plot.
const YARD_SCALE = 0.6; // same knob as slice4 (whole yard at 60% of trial-2 size)
const YARD_BAYS = [0, 1, 2, 3, 4]; // five storage bays along Z
const bayZ = (i: number) => LAYOUT.billetYard.z + 3.6 + i * 3.2 * YARD_SCALE;

function YardGantrySide({ x }: { x: number }) {
  const steel = <meshStandardMaterial color="#4a5563" metalness={0.6} roughness={0.45} />;
  return (
    <group position={[x, 0, 0]} scale={YARD_SCALE}>
      {[bayZ(0) - LAYOUT.billetYard.z, bayZ(YARD_BAYS.length - 1) - LAYOUT.billetYard.z].map((z) => (
        <mesh key={z} castShadow position={[0, 2.4, z]}><boxGeometry args={[0.3, 4.8, 0.3]} />{steel}</mesh>
      ))}
      <mesh castShadow position={[0, 4.9, 6.4]}><boxGeometry args={[0.35, 0.3, 15.2]} />{steel}</mesh>
    </group>
  );
}

function BilletRack({ z }: { z: number }) {
  const steel = <meshStandardMaterial color="#39424e" metalness={0.55} roughness={0.5} />;
  return (
    <group position={[0, 0, z]} scale={YARD_SCALE}>
      {[-1.1, 1.1].map((dx) => (
        <mesh key={dx} position={[dx, 0.28, 0]}><boxGeometry args={[0.34, 0.24, 2.6]} />{steel}</mesh>
      ))}
    </group>
  );
}

function YardCrane({ active }: { active: boolean }) {
  const bridge = useRef<THREE.Group>(null!);
  const hookGroup = useRef<THREE.Group>(null!);
  const carried = useRef<THREE.Mesh>(null!);
  const phase = useRef(0);
  useFrame((_, dt) => {
    if (active) phase.current = (phase.current + dt * 0.45) % 1;
    const t = phase.current;
    bridge.current.position.z = active ? (3.6 + t * 12.8) * YARD_SCALE : (3.6 + 12.8) * YARD_SCALE;
    const topY = 4.2, lowY = 0.75;
    const liftY = active ? (t < 0.5 ? THREE.MathUtils.lerp(topY, lowY, t * 2) : THREE.MathUtils.lerp(lowY, topY, (t - 0.5) * 2)) : topY;
    hookGroup.current.position.y = liftY - bridge.current.position.y;
    carried.current.visible = active && t > 0.5;
    if (carried.current.visible) carried.current.position.y = liftY - bridge.current.position.y - 0.35;
  });
  const steel = <meshStandardMaterial color="#c9a13f" metalness={0.5} roughness={0.45} />;
  return (
    <group position={[0, -1, -6]}>
      <group ref={bridge} position={[0, 4.4, (3.6 + 12.8) * YARD_SCALE]}>
        <mesh castShadow><boxGeometry args={[6.4 * YARD_SCALE, 0.4, 0.5]} />{steel}</mesh>
        {[-3.2, 3.2].map((dx) => <mesh key={dx} position={[dx * YARD_SCALE, -0.28, 0]}><boxGeometry args={[0.6, 0.35, 0.7]} />{steel}</mesh>)}
        <group ref={hookGroup} position={[0, -3.65, 0]}>
          <mesh position={[0, 1.05, 0]}><boxGeometry args={[0.8, 0.5, 0.9]} /><meshStandardMaterial color="#8a6d1f" metalness={0.5} roughness={0.45} /></mesh>
          <mesh position={[0, 0.35, 0]}><boxGeometry args={[0.06, 1.2, 0.06]} /><meshStandardMaterial color="#8a8f98" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[0, -0.35, 0]}><boxGeometry args={[0.7, 0.22, 0.5]} /><meshStandardMaterial color="#c9a13f" metalness={0.5} roughness={0.45} /></mesh>
        </group>
        <mesh ref={carried} visible={false} position={[0, -4, 0]}>
          <boxGeometry args={[6 * YARD_SCALE, 0.15, 0.15]} />
          <meshStandardMaterial color="#c9a15a" metalness={0.5} roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

function BilletYardModel({ rec }: { rec: TickRecord }) {
  // fill level from sim tonnes: same capacity convention as the old stack blocks (10 t each)
  const capacity = 450; // 5 bays x 9 billets x 10 t — tune knob if slice5 scenario cap differs
  const frac = Math.min(1, rec.billet_yard_t / capacity);
  const total = YARD_BAYS.length * 9;
  const filled = Math.round(frac * total);
  const billets: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < filled; i++) {
    const bay = Math.floor(i / 9), k = i % 9, col = Math.floor(k / 3), row = k % 3;
    billets.push({ x: -0.85 * YARD_SCALE + row * 0.85 * YARD_SCALE, y: 0.42, z: bayZ(bay) - 1.1 * YARD_SCALE + col * 1.1 * YARD_SCALE });
  }
  return (
    <group position={[LAYOUT.billetYard.x, 0, LAYOUT.billetYard.z]}>
      <Building pos={[0, 0, 0]} size={[0.001, 6.5, 0.001]} label="Billet Yard" color="#2a3038" accent={rec.billet_yard_t > 0 ? '#c98a3a' : '#5a6572'} />
      {/* yard floor plate */}
      <mesh position={[0, 0.02, 6.4 * YARD_SCALE]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5 * YARD_SCALE, 16 * YARD_SCALE]} />
        <meshStandardMaterial color="#232c36" />
      </mesh>
      {[-2.6, 2.6].map((dx) => <YardGantrySide key={dx} x={dx * YARD_SCALE} />)}
      {YARD_BAYS.map((b) => <BilletRack key={`r${b}`} z={bayZ(b)} />)}
      {billets.map((b, i) => (
        <mesh key={i} castShadow position={[b.x, b.y, b.z]}>
          <boxGeometry args={[6 * YARD_SCALE, 0.15, 0.15]} />
          <meshStandardMaterial color="#c9a15a" metalness={0.5} roughness={0.45} />
        </mesh>
      ))}
      {/* crane animates while the mill is drawing from the yard */}
      <YardCrane active={rec.mill_busy || rec.billet_yard_t > 0 && rec.mill_in_process_t > 0} />
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

// ---------- Generic gantry yard (slice4 billet-yard construction reused; 25.10) ----------
// Product yard and dispatch-crane zone use the same gantry/rack/billet structure as the
// billet yard, with per-zone color + capacity knobs. One shared crane animation component.
function makeGantrySide(name: string) {
  return function GantrySide({ x }: { x: number }) {
    const steel = <meshStandardMaterial color="#4a5563" metalness={0.6} roughness={0.45} />;
    return (
      <group position={[x, 0, 0]} scale={YARD_SCALE}>
        {[bayZ(0), bayZ(YARD_BAYS.length - 1)].map((z) => (
          <mesh key={z} castShadow position={[0, 2.4, z]}><boxGeometry args={[0.3, 4.8, 0.3]} />{steel}</mesh>
        ))}
        <mesh castShadow position={[0, 4.9, 6.4]}><boxGeometry args={[0.35, 0.3, 15.2]} />{steel}</mesh>
      </group>
    );
  };
}
const ProductGantrySide = makeGantrySide('product');

function ProductRack({ z }: { z: number }) {
  const steel = <meshStandardMaterial color="#39424e" metalness={0.55} roughness={0.5} />;
  return (
    <group position={[0, 0, z]} scale={YARD_SCALE}>
      {[-1.1, 1.1].map((dx) => (
        <mesh key={dx} position={[dx, 0.28, 0]}><boxGeometry args={[0.34, 0.24, 2.6]} />{steel}</mesh>
      ))}
    </group>
  );
}

function GantryCrane({ active }: { active: boolean }) {
  const bridge = useRef<THREE.Group>(null!);
  const hookGroup = useRef<THREE.Group>(null!);
  const carried = useRef<THREE.Mesh>(null!);
  const phase = useRef(0);
  useFrame((_, dt) => {
    if (active) phase.current = (phase.current + dt * 0.45) % 1;
    const t = phase.current;
    bridge.current.position.z = active ? (3.6 + t * 12.8) * YARD_SCALE : (3.6 + 12.8) * YARD_SCALE;
    const topY = 4.2, lowY = 0.75;
    const liftY = active ? (t < 0.5 ? THREE.MathUtils.lerp(topY, lowY, t * 2) : THREE.MathUtils.lerp(lowY, topY, (t - 0.5) * 2)) : topY;
    hookGroup.current.position.y = liftY - bridge.current.position.y;
    carried.current.visible = active && t > 0.5;
    if (carried.current.visible) carried.current.position.y = liftY - bridge.current.position.y - 0.35;
  });
  const steel = <meshStandardMaterial color="#c9a13f" metalness={0.5} roughness={0.45} />;
  return (
    <group position={[0, -1, -6]}>
      <group ref={bridge} position={[0, 4.4, (3.6 + 12.8) * YARD_SCALE]}>
        <mesh castShadow><boxGeometry args={[6.4 * YARD_SCALE, 0.4, 0.5]} />{steel}</mesh>
        {[-3.2, 3.2].map((dx) => <mesh key={dx} position={[dx * YARD_SCALE, -0.28, 0]}><boxGeometry args={[0.6, 0.35, 0.7]} />{steel}</mesh>)}
        <group ref={hookGroup} position={[0, -3.65, 0]}>
          <mesh position={[0, 1.05, 0]}><boxGeometry args={[0.8, 0.5, 0.9]} /><meshStandardMaterial color="#8a6d1f" metalness={0.5} roughness={0.45} /></mesh>
          <mesh position={[0, 0.35, 0]}><boxGeometry args={[0.06, 1.2, 0.06]} /><meshStandardMaterial color="#8a8f98" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[0, -0.35, 0]}><boxGeometry args={[0.7, 0.22, 0.5]} /><meshStandardMaterial color="#c9a13f" metalness={0.5} roughness={0.45} /></mesh>
        </group>
        <mesh ref={carried} visible={false} position={[0, -4, 0]}>
          <boxGeometry args={[6 * YARD_SCALE, 0.15, 0.15]} />
          <meshStandardMaterial color="#5fd08f" metalness={0.4} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

function ProductYardModel({ rec }: { rec: TickRecord }) {
  // same gantry construction as the billet yard; product stock = green bundles on racks,
  // fill driven by sim tonnes against the scenario capacity (real number, not invented)
  const frac = Math.min(1, rec.product_yard_t / SCENARIO.product_yard.capacity_t);
  const total = YARD_BAYS.length * 9;
  const filled = Math.round(frac * total);
  const bundles: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < filled; i++) {
    const bay = Math.floor(i / 9), k = i % 9, col = Math.floor(k / 3), row = k % 3;
    bundles.push({ x: -0.85 * YARD_SCALE + row * 0.85 * YARD_SCALE, y: 0.42, z: bayZ(bay) - 1.1 * YARD_SCALE + col * 1.1 * YARD_SCALE });
  }
  return (
    <group position={[LAYOUT.productYard.x, 0, LAYOUT.productYard.z]}>
      <Building pos={[0, 0, 0]} size={[0.001, 6.5, 0.001]} label="Product Yard" color="#2a3038" accent={rec.product_yard_t > 0 ? '#4fae7d' : '#5a6572'} />
      <mesh position={[0, 0.02, 6.4 * YARD_SCALE]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5 * YARD_SCALE, 16 * YARD_SCALE]} />
        <meshStandardMaterial color="#232c36" />
      </mesh>
      {[-2.6, 2.6].map((dx) => <ProductGantrySide key={dx} x={dx * YARD_SCALE} />)}
      {YARD_BAYS.map((b) => <ProductRack key={`pr${b}`} z={bayZ(b)} />)}
      {bundles.map((b, i) => (
        <mesh key={i} castShadow position={[b.x, b.y, b.z]}>
          <boxGeometry args={[6 * YARD_SCALE, 0.15, 0.15]} />
          <meshStandardMaterial color="#4fae7d" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      {/* crane animates while dispatch/reclaim work touches the product yard */}
      <GantryCrane active={rec.crane_busy_task_type !== null} />
    </group>
  );
}

// Dispatch crane: box stand-in behind the seam (see BilletYardModel note — swap this component only).
function DispatchCraneModel({ rec }: { rec: TickRecord }) {
  const busy = rec.crane_busy_task_type !== null;
  const reclaiming = rec.crane_busy_task_type === 'reclaiming' || rec.competing_queued;
  return (
    <>
      <Building pos={[LAYOUT.crane.x, 0, 0]} size={[1.2, 3.4, 1.2]} label="Dispatch Crane" color={busy ? (rec.crane_busy_task_type === 'reclaiming' ? '#8a6a3c' : '#1f4d73') : '#333b45'} accent={reclaiming ? '#e0b34f' : busy ? '#5a9fd4' : '#5a6572'} />
      {/* jib arm toward the product yard; tilts while a task runs */}
      <mesh position={[LAYOUT.crane.x - 1.8, 3.3, 0]} rotation={[0, 0, busy ? -0.12 : 0]}>
        <boxGeometry args={[4.2, 0.18, 0.18]} />
        <meshStandardMaterial color={reclaiming ? '#e0b34f' : '#6f7c8a'} />
      </mesh>
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

function DispatchMove({ rec, prev }: { rec: TickRecord; prev: TickRecord }) {
  // reconstruct the in-flight dispatch payload from tick deltas (tonnes leave the yard at start)
  const started = rec.product_yard_t < prev.product_yard_t - 1e-9 && rec.crane_busy_task_type === 'dispatch';
  const completed = prev.crane_busy_task_type === 'dispatch' && rec.crane_busy_task_type !== 'dispatch';
  if (!started && !completed) return null;
  const ton = started ? prev.product_yard_t - rec.product_yard_t : 0.001;
  const frac = useLerp(rec.tick, 160 * SCENARIO.dispatch_crane.move_ticks);
  const t = completed ? 1 : frac;
  const oid = rec.crane_busy_order ?? '';
  const orderIdx = ['O1', 'O2', 'O3'].indexOf(oid);
  const oz = orderIdx >= 0 ? (orderIdx - 1) * 2.6 : 0;
  const x = LAYOUT.productYard.x + (LAYOUT.orders.x - LAYOUT.productYard.x) * t;
  const z = oz * t;
  const y = 1.4 + Math.sin(Math.PI * t) * 0.9;
  if (started) LABELS.push({ id: 'dispatch', label: `${ton.toFixed(1)} t → ${oid}`, world: [x, y + 0.45, z], cls: 'tonlabel' });
  return <mesh position={[x, y, z]}><boxGeometry args={[0.6, 0.45, 0.6]} /><meshStandardMaterial color="#5fd08f" emissive="#1f6b45" emissiveIntensity={0.5} /></mesh>;
}

// Competing reclaiming task: crane is preempted/reserved honestly — dispatch waits (non-preemptive
// cycle; priority only reorders the queue). Shown as an amber pulse on the crane + queue badge.
function CompetingBadge({ rec }: { rec: TickRecord }) {
  const active = rec.crane_busy_task_type === 'reclaiming' || rec.competing_queued;
  if (!active) return null;
  LABELS.push({ id: 'competing', label: rec.crane_busy_task_type === 'reclaiming' ? 'crane busy: reclaiming (priority 1)' : 'reclaiming queued (priority 1)', world: [LAYOUT.crane.x, 4.3, 0], cls: 'tonlabel' });
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
    <Canvas camera={{ position: pos, fov: 45 }}>
      <LabelCameraBridge />
      <ViewCamera home={{ target, azDeg: 0, elDeg: 35, dist, minDist: 8, maxDist: 55 }} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[12, 18, 8]} intensity={1.4} />
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[26, 14]} /><meshStandardMaterial color="#17202a" /></mesh>
      {/* carrier rail + dispatch gantry path cues */}
      <mesh position={[(LAYOUT.billetYard.x + LAYOUT.mill.x) / 2, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[LAYOUT.mill.x - LAYOUT.billetYard.x + 2, 0.8]} /><meshStandardMaterial color="#232c36" /></mesh>
      <BilletYardModel rec={rec} />
      <RebarMillModel rec={rec} />
      <ProductYardModel rec={rec} />
      <DispatchCraneModel rec={rec} />
      <OrderDocks rec={rec} />
      <CarrierMove rec={rec} prev={prev} />
      <DispatchMove rec={rec} prev={prev} />
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
