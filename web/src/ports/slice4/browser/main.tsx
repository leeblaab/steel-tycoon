import * as React from 'react';
import rd from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ViewCamera, ResetViewButton } from './view_camera.tsx';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const { useEffect, useMemo, useRef, useState } = React;
import {
  runSlice4, SCENARIO, KEY_TICKS, EXPECTED_OUTPUTS, NEGATIVE_CONTROLS,
  type RunResult, type TickRecord, type ScenarioVariant,
} from './sim.js';

// Deterministic replay pattern (same as slice1 sim.ts): the FULL run is precomputed
// tick-by-tick from the fixture-faithful sim; playback interpolates between recorded
// per-tick states. The 3D layer never drives logic.
type Mode = 'healthy' | ScenarioVariant;
const RESULTS: Record<Mode, RunResult> = {
  healthy: runSlice4({ variant: 'healthy' }),
  no_charge_delivery: runSlice4({ variant: 'no_charge_delivery' }),
  ladle_never_released: runSlice4({ variant: 'ladle_never_released' }),
};

// ---------- Layout (fixed world coordinates, meters). Flow left -> right. ----------
const LAYOUT = {
  feed:     { x: -10, z: 0 },   // charge/DRI delivery interface
  eaf:      { x: -5,  z: 0 },
  lrf:      { x: 0,   z: 0 },
  ccm:      { x: 5,   z: 0 },
  yard:     { x: 10,  z: -3.5 },   // billet yard on its own plot beside the CCM (bays run along Z)
};
const LADLE_SLOTS = [-3.4, -2.2]; // ladle parking line in front of the stages

// ---------- Camera framing (same bounded elevation pattern as slice1) ----------
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

// ---------- DOM label system (labels outside WebGL, same as slice1) ----------
const LABELS: Array<{ id: string; text: string; world: [number, number, number]; cls: string }> = [];
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
    return { id: L.id, text: L.text, cls: L.cls, x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
  });
  return <div id="labels">{pts.map((p) => <div key={p.id} className={p.cls} style={{ left: p.x, top: p.y }}>{p.text}</div>)}</div>;
}

function Building({ pos, size, label, color, accent }: {
  pos: [number, number, number]; size: [number, number, number]; label: string; color: string; accent?: string;
}) {
  LABELS.push({ id: label, text: label, world: [pos[0], pos[1] + size[1] + 0.6, pos[2]], cls: 'blabel' });
  return (
    <group position={pos}>
      <mesh position={[0, size[1] / 2, 0]}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} />
      </mesh>
      {accent && (
        <mesh position={[0, size[1] / 2, size[2] / 2 + 0.01]}>
          <boxGeometry args={[size[0] * 0.9, 0.12, 0.02]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} />
        </mesh>
      )}
    </group>
  );
}

// ---------- Per-tick machine state derived from the recorded run ----------
function stageState(rec: TickRecord) {
  const eafHot = rec.eaf_busy !== null;
  return {
    eafColor: eafHot ? '#c05030' : '#4a525c',
    lrfColor: rec.lrf_busy ? '#c9a15a' : '#4a525c',
    ccmColor: rec.ccm_busy ? '#5a8ac0' : '#4a525c',
  };
}

// ---------- Ladles as moving objects ----------
// A ladle's stage is read from the recorded tick state (the 3D layer reads records,
// never drives logic). EAF-side ladle identity comes deterministically from the run's
// event log ("ladle Lx reserved" / "-> ladle Lx"), precomputed per mode.
interface LadleView { id: string; x: number; z: number; y: number; carrying: boolean; label: string }
function slotX(id: string): number { return id === 'L1' ? -3.4 : -2.2; }
const EAF_LADLE_BY_TICK: Record<Mode, Map<number, string>> = { healthy: new Map(), no_charge_delivery: new Map(), ladle_never_released: new Map() };
for (const mode of Object.keys(RESULTS) as Mode[]) {
  const map = EAF_LADLE_BY_TICK[mode];
  let current: string | null = null;
  for (const rec of RESULTS[mode].records) {
    for (const e of rec.events) {
      const m = e.match(/ladle (L\d) reserved/) || e.match(/-> ladle (L\d)/);
      if (m) current = m[1];
    }
    if (rec.eaf_busy && current) map.set(rec.tick, current);
  }
}

// ---------- Moving charge cubes with tonnage labels ----------
function FlowCube({ from, to, frac, color, label }: { from: [number, number, number]; to: [number, number, number]; frac: number; color: string; label?: string }) {
  const x = from[0] + (to[0] - from[0]) * frac;
  const z = from[2] + (to[2] - from[2]) * frac;
  const y = from[1] + (to[1] - from[1]) * frac + 0.9 + 0.25 * Math.sin(Math.PI * frac);
  if (label) LABELS.push({ id: label, text: label, world: [x, y + 0.45, z], cls: 'indicator' });
  return (
    <mesh position={[x, y, z]}>
      <boxGeometry args={[0.45, 0.45, 0.45]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
    </mesh>
  );
}

// ---------- Attached GLB machines (ComfyUI meshes, quantized+simplified) ----------
function GlbModel({ url }: { url: string }) {
  const [gltf, setGltf] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    new GLTFLoader().load(url, (g: { scene: THREE.Group }) => { if (alive) setGltf(g.scene); }, undefined, (err: unknown) => console.error(`GLB load failed (${url}):`, err));
    return () => { alive = false; };
  }, [url]);
  return gltf;
}

const EAF_GLB_URL = new URL('./assets/eaf_hero.glb', import.meta.url).href;
const LRF_GLB_URL = new URL('./assets/lrf.glb', import.meta.url).href;
const CCM_GLB_URL = new URL('./assets/ccm.glb', import.meta.url).href;
const FEED_GLB_URL = new URL('./assets/feed.glb', import.meta.url).href;

// Play-test feedback (23.10): no non-uniform scale (looked stretched) -> original
// model units; lift each model so its bbox bottom sits on the ground plane
// (they were sinking half-below the floor).
const MODEL_SCALE = 3; // uniform x/y/z (play-test: full 3x, no height-only stretch)
function EafModel({ hot }: { hot: boolean }) {
  const gltf = GlbModel({ url: EAF_GLB_URL });
  const scaled = gltf ? gltf.clone() : null;
  if (scaled) scaled.scale.setScalar(1); // S2.1 hero built at final scene size (no normalize knob)
  // lift AFTER scaling: Box3.setFromObject reads world transforms -> bbox bottom at y=0
  const minY = scaled ? new THREE.Box3().setFromObject(scaled).min.y : 0;
  return (
    <group position={[0, -minY, 0]}>
      {scaled && <primitive object={scaled} />}
      {/* removed per play-test screenshot: orange heat-glow band above the EAF */}
    </group>
  );
}

function LrfModel({ hot }: { hot: boolean }) {
  const gltf = GlbModel({ url: LRF_GLB_URL });
  const scaled = gltf ? gltf.clone() : null;
  if (scaled) scaled.scale.setScalar(MODEL_SCALE);
  const minY = scaled ? new THREE.Box3().setFromObject(scaled).min.y : 0;
  return (
    <group position={[0, -minY, 0]}>
      {scaled && <primitive object={scaled} />}
      {/* keep the turret glow when refining */}
      {hot && <mesh position={[0, 0.62, 1.0]}><cylinderGeometry args={[1.0, 1.0, 0.14, 24]} /><meshStandardMaterial color="#e8c47a" emissive="#e8c47a" emissiveIntensity={0.5} /></mesh>}
    </group>
  );
}

function CcmModel({ hot }: { hot: boolean }) {
  const gltf = GlbModel({ url: CCM_GLB_URL });
  const scaled = gltf ? gltf.clone() : null;
  if (scaled) scaled.scale.setScalar(MODEL_SCALE * 2);
  const minY = scaled ? new THREE.Box3().setFromObject(scaled).min.y : 0;
  return (
    <group position={[0, -minY, 0]}>
      {scaled && <primitive object={scaled} />}
      {/* keep the emerging-billet glow while casting */}
      {hot && <mesh position={[1.4, 0.6, 0]}><boxGeometry args={[2.8, 0.15, 0.15]} /><meshStandardMaterial color="#d98040" emissive="#d98040" emissiveIntensity={0.5} /></mesh>}
    </group>
  );
}

// play-test (25.10): "general plant" GLB replaces the Charge + DRI Feed box. Model bbox is
// ~1 unit across -> FEED_MODEL_SCALE brings it to roughly the old 2.2 m footprint; tune here.
const FEED_MODEL_SCALE = MODEL_SCALE * 1.5;
function FeedModel() {
  const gltf = GlbModel({ url: FEED_GLB_URL });
  const scaled = gltf ? gltf.clone() : null;
  if (scaled) scaled.scale.setScalar(FEED_MODEL_SCALE);
  const minY = scaled ? new THREE.Box3().setFromObject(scaled).min.y : 0;
  return (
    <group position={[0, -minY, 0]}>
      {scaled && <primitive object={scaled} />}
    </group>
  );
}

// ---------- Scene ----------
function Scene({ mode, rec, prev, frac }: { mode: Mode; rec: TickRecord; prev: TickRecord | null; frac: number }) {
  LABELS.length = 0;
  const st = stageState(rec);
  const target: [number, number, number] = [1, 1.2, 0];
  const aspect = (typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1.6);
  const dist = Math.max(18, 24 / (2 * Math.tan((45 * Math.PI / 180) / 2)) * (aspect < 1.6 ? 1.6 / aspect : 1));
  const { pos } = useOrbitCamera(target, dist, 0, 32);

  // indicators: maintenance windows + shift changeovers (unobtrusive DOM labels)
  const indicators: Array<{ text: string; world: [number, number, number] }> = [];
  for (const w of SCENARIO.maintenance_windows) {
    if (rec.tick >= w.start_tick && rec.tick < w.start_tick + w.duration_ticks) {
      const p = w.asset === 'EAF' ? LAYOUT.eaf : LAYOUT.ccm;
      indicators.push({ text: `${w.asset} maintenance (${w.duration_ticks}t, indicator only)`, world: [p.x, 3.4, -2.2] });
    }
  }
  for (const s of SCENARIO.shift_changeovers) {
    if (rec.tick === s.tick) indicators.push({ text: `shift ${s.from} → ${s.to}`, world: [1, 4.2, -3.0] });
  }

// ---------- Trial 2: billet yard — steel gantry bays + racks + billets + overhead crane ----------
// play-test round 5: rails run ALONG the billet axis (two side structures on each side of
// the beds); yard pushed to its own plot beside the CCM — no rails crossing LRF/CCM models.
const YARD_SCALE = 0.6; // play-test: whole yard at 60% of the trial-2 size
const YARD_BAYS = [0, 1, 2, 3, 4]; // five storage bays along Z (world), starting just past the CCM
const bayZ = (i: number) => LAYOUT.yard.z + 3.6 + i * 3.2 * YARD_SCALE;

function YardGantry({ x }: { x: number }) {
  const steel = <meshStandardMaterial color="#4a5563" metalness={0.6} roughness={0.45} />;
  return (
    <group position={[x, 0, 0]} scale={YARD_SCALE}>
      {[-1.6, 1.6].map((dx) => (
        <mesh key={dx} castShadow position={[dx, 3.4, 0]}><boxGeometry args={[0.28, 6.8, 0.28]} />{steel}</mesh>
      ))}
      <mesh castShadow position={[0, 6.8, 0]}><boxGeometry args={[3.5, 0.34, 0.4]} />{steel}</mesh>
      {[-1.6, 1.6].map((dx) => (
        <mesh key={`b${dx}`} position={[dx * 0.8, 5.2, 0]} rotation={[0, 0, dx > 0 ? -0.7 : 0.7]}><boxGeometry args={[0.12, 3.2, 0.12]} />{steel}</mesh>
      ))}
    </group>
  );
}

// two side structures the crane runway sits on: columns at z positions + a top rail along Z
function YardSideStructure({ x }: { x: number }) {
  const steel = <meshStandardMaterial color="#4a5563" metalness={0.6} roughness={0.45} />;
  return (
    <group position={[x, 0, 0]} scale={YARD_SCALE}>
      {[bayZ(0) - LAYOUT.yard.z, bayZ(YARD_BAYS.length - 1) - LAYOUT.yard.z].map((z) => (
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

function BilletYard({ frac }: { frac: number }) {
  // bays fill left-to-right; within a bay layers stack bottom-up (real yard practice)
  const total = YARD_BAYS.length * 9; // 5 bays x 3 columns x 3 rows
  const filled = Math.round(frac * total);
  const billets: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < filled; i++) {
    const bay = Math.floor(i / 9), k = i % 9, col = Math.floor(k / 3), row = k % 3;
    // same level for every billet (single flat bed); billets along X = CCM output direction
    billets.push({ x: -0.85 * YARD_SCALE + row * 0.85 * YARD_SCALE, y: 0.42, z: bayZ(bay) - 1.1 * YARD_SCALE + col * 1.1 * YARD_SCALE });
  }
  return (
    <group position={[LAYOUT.yard.x, 0, -3.5]}>
      {/* yard floor plate on its own plot beside the CCM */}
      <mesh position={[0, 0.02, 6.4 * YARD_SCALE]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5 * YARD_SCALE, 16 * YARD_SCALE]} />
        <meshStandardMaterial color="#232c36" />
      </mesh>
      {/* crane runs on TWO side structures only, one on each side of the beds (round 5) */}
      {[-2.6, 2.6].map((dx) => <YardSideStructure key={dx} x={dx * YARD_SCALE} />)}
      {YARD_BAYS.map((b) => <BilletRack key={`r${b}`} z={bayZ(b)} />)}
      {/* billets: 150 mm square, ~6 m long, warm-steel color, lying along X = CCM output direction */}
      {billets.map((b, i) => (
        <mesh key={i} castShadow position={[b.x, b.y, b.z]}>
          <boxGeometry args={[6 * YARD_SCALE, 0.15, 0.15]} />
          <meshStandardMaterial color="#c9a15a" metalness={0.5} roughness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

// overhead yard crane (play-test round 5): bridge spans X across the beds, travels along Z
// on the two side-structure runway rails (one rail each side of the billet beds).
function YardCrane({ active }: { active: boolean }) {
  const bridge = React.useRef<THREE.Group>(null!);
  const hookGroup = React.useRef<THREE.Group>(null!);
  const carried = React.useRef<THREE.Mesh>(null!);
  const phase = React.useRef(0);
  useFrame((_, dt) => {
    if (active) phase.current = (phase.current + dt * 0.45) % 1;
    const t = phase.current;
    // bridge travels the yard along Z on the runway rails; parks over the last bay when idle
    bridge.current.position.z = active ? (3.6 + t * 12.8) * YARD_SCALE : (3.6 + 12.8) * YARD_SCALE;
    // hook: lift height -> down to the billet bed -> back up carrying a billet (pick leg)
    const topY = 4.2, lowY = 0.75;
    const liftY = active ? (t < 0.5 ? THREE.MathUtils.lerp(topY, lowY, t * 2) : THREE.MathUtils.lerp(lowY, topY, (t - 0.5) * 2)) : topY;
    hookGroup.current.position.y = liftY - bridge.current.position.y; // relative to bridge deck
    carried.current.visible = active && t > 0.5;
    if (carried.current.visible) carried.current.position.y = liftY - bridge.current.position.y - 0.35;
  });
  const steel = <meshStandardMaterial color="#c9a13f" metalness={0.5} roughness={0.45} />;
  return (
    <group position={[LAYOUT.yard.x, -1, -6]}>
      <group ref={bridge} position={[0, 4.4, (3.6 + 12.8) * YARD_SCALE]}>
        {/* bridge beam spans along X -> 90 deg to the rails/billet-bay axis */}
        <mesh castShadow><boxGeometry args={[6.4 * YARD_SCALE, 0.4, 0.5]} />{steel}</mesh>
        {/* end trucks riding the two side runway rails */}
        {[-3.2, 3.2].map((dx) => <mesh key={dx} position={[dx * YARD_SCALE, -0.28, 0]}><boxGeometry args={[0.6, 0.35, 0.7]} />{steel}</mesh>)}
        <group ref={hookGroup} position={[0, -3.65, 0]}>
          {/* trolley */}
          <mesh position={[0, 1.05, 0]}><boxGeometry args={[0.8, 0.5, 0.9]} /><meshStandardMaterial color="#8a6d1f" metalness={0.5} roughness={0.45} /></mesh>
          {/* cable */}
          <mesh position={[0, -0.1, 0]}><cylinderGeometry args={[0.03, 0.03, 2.0, 6]} /><meshStandardMaterial color="#20262e" /></mesh>
          {/* electromagnet lifter bar (magnet line parallel to the billets) */}
          <mesh position={[0, -1.2, 0]}><boxGeometry args={[3.4 * YARD_SCALE, 0.2, 0.45]} /><meshStandardMaterial color="#20262e" metalness={0.7} roughness={0.35} /></mesh>
          {/* billet picked up (visible only on the pick leg), aligned along X like the rest */}
          <mesh ref={carried} position={[0, -1.55, 0]} visible={false}>
            <boxGeometry args={[6 * YARD_SCALE, 0.15, 0.15]} />
            <meshStandardMaterial color="#d98040" emissive="#d98040" emissiveIntensity={0.3} metalness={0.5} roughness={0.45} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

  // billet yard: flat plate filling to 186.935 t (visual stack height ∝ tonnage)
  const billet = rec.billet_yard_t;
  const maxT = EXPECTED_OUTPUTS.counters_at_tick_120.billet_t_total;
  const fracYard = Math.min(1, billet / maxT);

  // ladle views (positions from recorded state, interpolated by frac)
  const eafLadleId = EAF_LADLE_BY_TICK[mode].get(rec.tick) ?? null;
  const ladleViews: LadleView[] = (['L1', 'L2'] as const).map((id) => {
    const atEaf = rec.eaf_busy !== null && eafLadleId === id;
    const atLrf = rec.lrf_busy === id;
    const atCcm = rec.ccm_busy === id;
    if (atEaf) return { id, x: LAYOUT.eaf.x, z: 1.5, y: 0.7, carrying: true, label: `${id}·${rec.eaf_busy}` };
    if (atLrf) return { id, x: LAYOUT.lrf.x, z: 1.5, y: 0.7, carrying: true, label: `${id} refining` };
    if (atCcm) return { id, x: LAYOUT.ccm.x, z: 1.5, y: 0.7, carrying: true, label: `${id} casting` };
    return { id, x: slotX(id), z: 2.8, y: 0.45, carrying: false, label: `${id} free` };
  });

  // moving charge cube: delivery leg feed -> EAF (ticks where a delivery happened)
  const delivery = SCENARIO.charge_deliveries.find((d) => d.tick === rec.tick);
  const tapLeg = prev && prev.eaf_busy !== null && rec.eaf_busy === null; // tap leg eaf -> lrf on tap tick

  return (
    <Canvas camera={{ position: pos, fov: 45 }}>
      <LabelCameraBridge />
      <ViewCamera home={{ target, azDeg: 0, elDeg: 32, dist, minDist: 9, maxDist: 50 }} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[12, 18, 8]} intensity={1.4} />
      {/* plant floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 14]} />
        <meshStandardMaterial color="#17202a" />
      </mesh>

      {/* feed interface — play-test 25.10: general-plant GLB replaces the box (label kept) */}
      <group position={[LAYOUT.feed.x, 0, 0]}>
        <FeedModel />
        {LABELS.push({ id: 'feed', text: 'Charge + DRI Feed', world: [LAYOUT.feed.x, 2.6, 0], cls: 'blabel' })}
      </group>
      {/* EAF */}
      {/* ---- Trial 1: attached EAF GLB replaces the procedural shell (old shell kept commented below for revert) ---- */}
      <group position={[LAYOUT.eaf.x, 0, 0]}>
        <EafModel hot={rec.eaf_busy !== null} />
        {/* removed per play-test screenshot: off-gas sniffer hood cone + duct, baghouse box and its label */}
      </group>
      {/* ---- LRF trial: attached LRF GLB replaces the procedural tower/turret ---- */}
      <group position={[LAYOUT.lrf.x, 0, 0]}>
        <LrfModel hot={rec.lrf_busy !== null} />
        {LABELS.push({ id: 'lrf', text: 'LRF', world: [LAYOUT.lrf.x, 5.0, -0.6], cls: 'blabel' })}
      </group>
      {/* ---- CCM trial: attached CCM GLB replaces the procedural mold/tunnel/run-out ---- */}
      <group position={[LAYOUT.ccm.x, 0, 0]}>
      {/* removed per play-test screenshot (red X mark): transfer car rail box near the CCM */}
        <CcmModel hot={rec.ccm_busy !== null} />
        {LABELS.push({ id: 'ccm', text: 'CCM (single strand)', world: [LAYOUT.ccm.x + 2.6, 3.2, 0], cls: 'blabel' })}
      </group>
      {/* ---- Trial 2: billet yard (steel gantry bays + racks + billets + overhead crane) ---- */}
      <BilletYard frac={fracYard} />
      <YardCrane active={rec.ccm_busy !== null} />
      {LABELS.push({ id: 'yard', text: `Billet Yard ${billet.toFixed(2)} t`, world: [LAYOUT.yard.x, 7.6, 0], cls: 'blabel' })}

      {/* ladles as moving objects */}
      {ladleViews.map((lv) => (
        <group key={lv.id} position={[lv.x, lv.y, lv.z]}>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.42, 0.34, 0.7, 12]} />
            <meshStandardMaterial color={lv.carrying ? '#d98040' : '#6a7684'} emissive={lv.carrying ? '#d98040' : '#000000'} emissiveIntensity={lv.carrying ? 0.35 : 0} />
          </mesh>
        </group>
      ))}
      {ladleViews.map((lv, i) => (<React.Fragment key={`lbl-${i}`}>{LABELS.push({ id: `ladle-${i}`, text: lv.label, world: [lv.x, lv.y + 1.1, lv.z], cls: 'indicator' })}</React.Fragment>))}

      {/* material flow cubes with tonnage labels */}
      {delivery && <FlowCube from={[LAYOUT.feed.x, 0.4, 0]} to={[LAYOUT.eaf.x - 1.8, 0.6, 0]} frac={frac} color="#7ab0e8" label="40 t charge" />}
      {tapLeg && <FlowCube from={[LAYOUT.eaf.x, 2.2, 0]} to={[LAYOUT.lrf.x - 1.4, 0.9, 0]} frac={frac} color="#d98040" label="38.15 t metal" />}

      {/* maintenance/shift indicators */}
      {indicators.map((ind, i) => (<React.Fragment key={`ind-${i}`}>{LABELS.push({ id: `ind-${i}`, text: ind.text, world: ind.world, cls: 'indicator' })}</React.Fragment>))}
    </Canvas>
  );
}

// ---------- App ----------
function App() {
  const [mode, setMode] = useState<Mode>('healthy');
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    timer.current = window.setInterval(() => {
      setIdx((i) => { if (i + 1 >= SCENARIO.ticks) { setRunning(false); return i; } return i + 1; });
    }, 140);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [running]);

  const result = RESULTS[mode];
  const rec = result.records[idx];
  const prev = idx > 0 ? result.records[idx - 1] : null;
  const frac = running ? 0.5 : 1; // discrete ticks when paused; mid-leg position while playing

  const keyTick = KEY_TICKS.includes(rec.tick);
  const balanceClosed = Math.abs(rec.balance_error) < 1e-9;

  return (
    <>
      <div id="scene">
        <Scene mode={mode} rec={rec} prev={prev} frac={frac} />
        <LabelLayer />
        <ResetViewButton />
        <div id="overlay">
          <div className="big">Tick {rec.tick} / {SCENARIO.ticks}</div>
          <div className="flow">Flow: Feed → EAF → (ladle) → LRF → (ladle) → CCM → Billet Yard</div>
          <div className={balanceClosed ? '' : 'blocked'}>Balance residual: {rec.balance_error.toFixed(9)} t {balanceClosed ? '(closed)' : '(OPEN — bug!)'}</div>
          {keyTick && <div className="flow">KEY TICK {rec.tick}: ladles_free = {(EXPECTED_OUTPUTS.key_ticks as Record<string, { ladles_free: number; billet_yard_t: number }>)[String(rec.tick)].ladles_free}, billet {(EXPECTED_OUTPUTS.key_ticks as Record<string, { ladles_free: number; billet_yard_t: number }>)[String(rec.tick)].billet_yard_t} t</div>}
        </div>
        {/* ladle availability HUD — the pedagogical core */}
        <div id="ladleHud">
          <div>LADLES FREE</div>
          <div className="big">{rec.ladles_free} / {SCENARIO.ladles}</div>
          <div>{['L1', 'L2'].map((id) => (
            <span key={id}><span className="dot" style={{ background: ladleFreeInView(rec, id, mode) ? '#5ac07a' : '#d98040' }} />{id}</span>
          ))}</div>
          <div className="hint">ladle_wait {result.counters.ladle_wait_ticks} · caster_wait {result.counters.caster_wait_ticks}</div>
        </div>
      </div>
      <div id="panel">
        <h1>SteelX — Slice 4 (EAF → LRF → CCM ladle cycle)</h1>
        <div className="row">
          <button className="primary" onClick={() => setRunning(true)} disabled={running}>Start</button>
          <button onClick={() => setRunning(false)} disabled={!running}>Pause</button>
          <button onClick={() => { setIdx(0); setRunning(false); }}>Reset</button>
          <button onClick={() => setIdx((i) => Math.min(i + 1, SCENARIO.ticks - 1))} disabled={running}>Step +1</button>
        </div>
        <div className="row">
          {KEY_TICKS.map((t) => (
            <button key={t} className={rec.tick === t ? 'active' : ''} onClick={() => { setIdx(t - 1); setRunning(false); }}>Key tick {t}</button>
          ))}
        </div>

        <h2>Scenario mode (fixture negative controls)</h2>
        <div className="row">
          <button className={mode === 'healthy' ? 'active' : ''} onClick={() => { setMode('healthy'); setIdx(0); }}>Healthy</button>
          <button className={mode === 'no_charge_delivery' ? 'danger' : ''} onClick={() => { setMode('no_charge_delivery'); setIdx(0); setRunning(false); }}>N1: no charge delivery</button>
          <button className={mode === 'ladle_never_released' ? 'danger' : ''} onClick={() => { setMode('ladle_never_released'); setIdx(0); setRunning(false); }}>N2: ladle never released</button>
        </div>
        <div className="hint">{NEGATIVE_CONTROLS.find((n) => n.id === mode)?.note ?? 'Positive scenario: 5 heats, 2-ladle cycle, balance closed every tick.'}</div>

        <h2>Facility inspection</h2>
        <div className="stat"><span>EAF</span><b>{rec.eaf_busy ? `heat ${rec.eaf_busy}` : 'idle'}</b></div>
        <div className="stat"><span>LRF</span><b>{rec.lrf_busy ? `refining ${rec.lrf_busy}` : 'idle'}</b></div>
        <div className="stat"><span>CCM strand</span><b>{rec.ccm_busy ? `casting ${rec.ccm_busy}` : 'idle'}</b></div>
        <div className="stat"><span>Billet yard</span><b>{rec.billet_yard_t.toFixed(3)} t / {EXPECTED_OUTPUTS.counters_at_tick_120.billet_t_total} t</b></div>
        <div className="bar"><div style={{ width: `${100 * Math.min(1, rec.billet_yard_t / EXPECTED_OUTPUTS.counters_at_tick_120.billet_t_total)}%` }} /></div>

        <h2>Cycle counters (fixture asserts @120)</h2>
        <div className="stat"><span>Heats tapped</span><b>{result.counters.heats_tapped} / {EXPECTED_OUTPUTS.counters_at_tick_120.heats_tapped}</b></div>
        <div className="stat"><span>Heats starved (idle ticks)</span><b>{result.counters.heats_starved} / {EXPECTED_OUTPUTS.counters_at_tick_120.heats_starved}</b></div>
        <div className="stat"><span>Refines completed</span><b>{result.counters.refines_completed} / 5</b></div>
        <div className="stat"><span>Casts completed</span><b>{result.counters.casts_completed} / 5</b></div>
        <div className="stat"><span>Energy (indicator)</span><b>{result.counters.energy_kwh_total.toLocaleString()} kWh @ 600 kWh/t</b></div>

        <h2>Event log</h2>
        <div className="eventlog">
          {result.allEvents.filter((e) => e.tick <= rec.tick).slice(-40).map((e, i) => <div key={i}>tick {e.tick}: {e.event}</div>)}
        </div>

        <h2>Learning panel</h2>
        <div className="learn">
          Ladle availability is a <b>cycle, not a capacity number</b>: each ladle runs EAF-tap → LRF → CCM and only returns to the pool after casting.
          With {SCENARIO.ladles} ladles ({SCENARIO.eaf_heat_ticks}-tick heats, {SCENARIO.lrf_ticks_per_ladle}-tick refines, {SCENARIO.ccm_ticks_per_ladle}-tick casts),
          a heat can only start when a charge is delivered <i>and</i> a ladle is free — watch the HUD: at key ticks 19/30/66 it reads 1/1/2.
          Starvation (EAF idle with no delivered charge) and waits (ladle/caster) are counted, never fabricated.
        </div>
      </div>
    </>
  );
}

function ladleFreeInView(rec: TickRecord, id: string, mode: Mode): boolean {
  return rec.lrf_busy !== id && rec.ccm_busy !== id && EAF_LADLE_BY_TICK[mode].get(rec.tick) !== id;
}

rd.createRoot(document.getElementById('root')!).render(<App />);
