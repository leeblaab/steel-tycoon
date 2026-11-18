// Slice-2 Phase -1 browser scene — INTERPOLATION ONLY (roadmap §15 Phase -1 mark).
// No sim logic here: every position/state is read from the frozen verified timeline
// (fixtures/slice2/s2_timeline.json -> ./timeline.json), generated from the mirror run.
// Visual mix per roadmap §9.4 mark: Kenney Factory Kit GLBs (crane magnet, bucket) +
// procedural three.js primitives (painted ground zones, HMS/bushing stacks, EAF ghost
// slot, charge buckets). Fixed camera now; orbit is a Phase 2 item.
import * as React from 'react';
import rd from 'react-dom/client';
const createRoot = rd.createRoot;
import * as THREE from 'three';

const { useEffect, useMemo, useRef, useState } = React;
import { Canvas, useThree } from '@react-three/fiber';
import { ViewCamera, ResetViewButton } from './view_camera.tsx';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TIMELINE, activeTaskAt, chargeStatusAt, type TimelineTask } from './timeline';

// ---------- Playback state (interpolation driver only) ----------
const TICKS = TIMELINE.ticks; // 300
let tick = 0;
let playing = false;
let speedMul = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function useTick(): number {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((f) => f + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return tick;
}

// ---------- FixedCamera retired (visual-feedback phase 21.10): ViewCamera in App
// gives the agreed 360° orbit + zoom + pan; home pose reproduces the old fixed framing.


// ---------- Ground plane with painted zones (roadmap §9.1 mark) ----------
function zone(x: number, z: number, w: number, d: number, color: string, label: string, opacity = 0.22) {
  return (
    <group>
      <mesh position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.min(w, d) / 2 - 0.06, Math.min(w, d) / 2, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function Ground() {
  return (
    <group>
      {/* asphalt yard */}
      <mesh position={[-2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[46, 30]} />
        <meshStandardMaterial color="#1b2026" />
      </mesh>
      {zone(19, 8, 7, 5.4, '#e8a94f', 'receiving')}
      {zone(-5, 8, 22, 6.4, '#3f7fbf', 'HMS1/HMS2 stack')}
      {zone(7, 0.5, 10, 3.4, '#9a7fd0', 'bushing stack')}
      {zone(-17, 6, 5.4, 8, '#e07070', 'charge buckets')}
      {zone(-19, -5, 8, 6, '#6f8f6f', 'EAF (not_built ghost)')}
    </group>
  );
}

// ---------- Kenney Factory Kit models (loaded once; clone per instance — the
// <primitive> mutates shared objects, slice1 pitfall) ----------
// NOTE: do NOT use new URL('./assets/...', import.meta.url) here. Vite rewrites that
// pattern to `new URL('/assets/...', '' + import.meta.url)` which throws TypeError:
// Invalid URL at module top level in dev (empty base) -> black screen before React mounts.
// Plain public-path strings are served verbatim by vite dev and copied by the build.
const CRANE_URL = '/assets/crane_magnet.glb';
const BUCKET_URL = '/assets/bucket.glb';
const HOPPER_URL = '/assets/hopper.glb';
const SHRED_URL = '/assets/shredder.glb';
const GANTRY_URL = '/assets/gantry.glb';
let CRANE_MODEL: THREE.Group | null = null;
let BUCKET_MODEL: THREE.Group | null = null;
let HOPPER_MODEL: THREE.Group | null = null;
let SHRED_MODEL: THREE.Group | null = null;
let GANTRY_MODEL: THREE.Group | null = null;
new GLTFLoader().load(CRANE_URL, (g) => { CRANE_MODEL = g.scene; notify(); });
new GLTFLoader().load(BUCKET_URL, (g) => { BUCKET_MODEL = g.scene; notify(); });
new GLTFLoader().load(HOPPER_URL, (g) => { HOPPER_MODEL = g.scene; notify(); });
new GLTFLoader().load(SHRED_URL, (g: { scene: THREE.Group }) => { SHRED_MODEL = fitTo(g.scene, 24, 'z', 0.8); notify(); });
new GLTFLoader().load(GANTRY_URL, (g: { scene: THREE.Group }) => { GANTRY_MODEL = fitTo(g.scene, 7.8, 'x', 0.2); notify(); });

// ComfyUI GLBs arrive normalized to ~1 unit across with no materials: uniform-scale the
// model so its extent along `axis` becomes `target` world meters (measured offline: the
// gantry's true span is its X axis, the shredder's long axis is Z), re-center X/Z, and
// seat the BODY BASE at `lift`. CRITICAL: both GLBs carry junk vertices far below the
// real feet (gantry yMin=-3.75 vs leg bottoms ~-1.0; shredder blob to -2.5) — seating on
// Box3.min.y buries the machine (the "both are sinking" report). Instead histogram
// scaled Y in 0.4 m bands and seat at the lowest band holding >2% of vertices, which is
// the leg/foot cluster; everything below it is buried blob/junk clipped under grade.
function fitTo(root: THREE.Group, target: number, axis: 'x' | 'z', lift = 0): THREE.Group {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = target / (axis === 'x' ? size.x : size.z);
  root.scale.setScalar(s);
  const b2 = new THREE.Box3().setFromObject(root);
  const c2 = new THREE.Vector3();
  b2.getCenter(c2);
  // body base = lowest 0.4 m vertex band with a meaningful share of the point cloud
  const ys: number[] = [];
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); ys.push(v.y); }
  });
  const BAND = 0.4;
  const bands = new Map<number, number>();
  for (const y of ys) { const b = Math.floor(y / BAND) * BAND; bands.set(b, (bands.get(b) || 0) + 1); }
  // Vertex-share thresholds fail: the gantry ground-plate band carries 19.5% of all
  // vertices while its real legs only ~1%. Robust separator = horizontal extent: the
  // generator bakes a flat GROUND PLATE around the machine (spans nearly the full X/Z
  // footprint). Drop every bottom-up band whose footprint covers >80% of the model's
  // XZ box; the first surviving band is where the real legs/building start.
  let xlo = Infinity, xhi = -Infinity, zlo = Infinity, zhi = -Infinity;
  const vx = new THREE.Vector3();
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      vx.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      if (vx.x < xlo) xlo = vx.x; if (vx.x > xhi) xhi = vx.x;
      if (vx.z < zlo) zlo = vx.z; if (vx.z > zhi) zhi = vx.z;
    }
  });
  const spanX = xhi - xlo, spanZ = zhi - zlo;
  const bandExtent = new Map<number, [number, number, number, number]>();
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      vx.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      const b = Math.floor(vx.y / BAND) * BAND;
      const e = bandExtent.get(b) || [Infinity, -Infinity, Infinity, -Infinity];
      if (vx.x < e[0]) e[0] = vx.x; if (vx.x > e[1]) e[1] = vx.x;
      if (vx.z < e[2]) e[2] = vx.z; if (vx.z > e[3]) e[3] = vx.z;
      bandExtent.set(b, e);
    }
  });
  const sorted = [...bands.keys()].sort((a, b2_) => a - b2_);
  let baseY = sorted[0];
  for (const b of sorted) {
    if ((bandExtent.get(b)![1] - bandExtent.get(b)![0]) > 0.8 * spanX &&
        (bandExtent.get(b)![3] - bandExtent.get(b)![2]) > 0.8 * spanZ) continue; // ground plate
    baseY = b; break;
  }
  const seatY = lift - baseY;
  root.position.set(-c2.x, seatY, -c2.z);
  root.updateMatrixWorld(true);
  // flat-material stand-in so the model reads against the dark yard (same pitfall as
  // EAF/CCM/LRF: ComfyUI GLBs export one untextured material that renders near-black)
  root.traverse((o: THREE.Object3D) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (m && !m.map) { m.color = new THREE.Color('#8d97a5'); m.roughness = 0.85; m.metalness = 0.25; }
    }
  });
  return root;
}

// crane_magnet.glb: 1.92 x 3.04 m footprint, 5.68 m tall, origin at ground. Arm extends
// along -x with the magnet at about (-1.35, 5.1). Y=+90deg maps arm to +z; we keep the
// model axis and place the gantry on x=-1 so the arm sweeps the yard along z: crane base
// stays fixed, only the load moves (single non-preemptive crane per frozen timeline).
// ---------- Hero gantry (Gantry.glb, compressed) straddling the yard rail ----------
// Replaces the Kenney crane_magnet as the hero animated element. The frozen timeline
// keeps one non-preemptive crane: the gantry structure stays fixed on its rails, only
// the magnet load travels source -> destination along the interpolated path.
const GANTRY_POS: [number, number, number] = [-1, 0, 8]; // rails run along x now (see below)
function GantryRig({ t }: { t: TimelineTask | null }) {
  if (!GANTRY_MODEL) return null;
  const clone = GANTRY_MODEL.clone();
  clone.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  let loadPos: [number, number, number] | null = null;
  let loadColor = '#8b93a0';
  if (t) {
    const from = locXZ(t.source_location);
    const to = locXZ(t.destination_location);
    const progress = (tick - t.start + 0.5) / (t.end - t.start + 1);
    loadPos = [lerp(from.x, to.x, progress), 6.4, lerp(from.z, to.z, progress)];
    loadColor = GRADE_COLOR[t.material_grade ?? ''] ?? '#8b93a0';
  }
  return (
    <group>
      {/* position lives on the OUTER group only: a `position` prop here would
          overwrite fitTo's seat offset (root.position.y = lift - baseY) every tick */}
      <group position={GANTRY_POS}>
        <primitive object={clone} />
      </group>
      {/* rails the gantry straddles: legs sit at model x≈-0.2/+0.35 -> world -7.4/+4.6,
          so run them along x under each leg line (yard sources/dests all live at z 6..11) */}
      <mesh position={[-2, 0.15, GANTRY_POS[2] - 3.4]}>
        <boxGeometry args={[26, 0.3, 0.5]} />
        <meshStandardMaterial color="#2a3038" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-2, 0.15, GANTRY_POS[2] + 3.4]}>
        <boxGeometry args={[26, 0.3, 0.5]} />
        <meshStandardMaterial color="#2a3038" metalness={0.6} roughness={0.4} />
      </mesh>
      {loadPos && (
        <group position={loadPos}>
          {/* simple procedural load block: chunky scrap, colored by grade */}
          <mesh castShadow>
            <boxGeometry args={[1.4, 0.9, 1.4]} />
            <meshStandardMaterial color={loadColor} roughness={0.9} />
          </mesh>
          {/* magnet cable */}
          <mesh position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 2.4, 6]} />
            <meshBasicMaterial color="#5a6270" />
          </mesh>
        </group>
      )}
    </group>
  );
}

// ---------- Shredder plant (shredder 1024.glb, compressed) at the east end ----------
// "put some yard then the shredder plant": scrap yard occupies the receiving end,
// the shredder building stands behind it on the asphalt (ground plane ends x=21), its
// long axis (model Z) runs north-south. Static structure; material flow is told by the
// crane + conveyor strips.
function ShredderPlant() {
  if (!SHRED_MODEL) return null;
  const clone = SHRED_MODEL.clone();
  clone.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  // position on the OUTER group so fitTo's seat y survives (no `position` prop on
  // the primitive — it would clobber root.position every render)
  return (
    <group position={[18.5, 0, -4]}>
      <primitive object={clone} />
    </group>
  );
}

// ---------- Scrap piles texture: irregular chunks near the receiving zone ----------
const SCATTER = [
  [17.0, 5.6, 0.9], [18.2, 6.4, -0.4], [19.6, 5.4, 0.7], [20.8, 6.6, -0.6],
  [17.8, 10.4, 0.5], [19.2, 11.0, -0.8], [21.0, 10.2, 0.3], [16.6, 8.0, -0.2],
];
function ScrapScatter() {
  return (
    <group>
      {SCATTER.map(([x, z, rot], i) => (
        <mesh key={i} castShadow position={[x, 0.35, z]} rotation={[rot * 0.7, rot * 2.1, rot]}>
          <boxGeometry args={[0.8 + (i % 3) * 0.3, 0.5, 0.6 + (i % 2) * 0.4]} />
          <meshStandardMaterial color={i % 2 ? '#5f6a76' : '#7d8894'} roughness={0.95} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- Yard stacks that grow per tick (procedural primitives) ----------
const GRADE_COLOR: Record<string, string> = { hms1_hms2: '#c08a4a', bushing: '#7a6fa0' };
function Stack({ x, z, grade, tonnes }: { x: number; z: number; grade: string; tonnes: number }) {
  // 1 chunk = 5t visual block (learning aid: stacks are visible tonnage)
  const chunks = Math.floor(tonnes / 5);
  const meshes = [];
  for (let i = 0; i < chunks; i++) {
    const row = Math.floor(i / 4);
    const col = i % 4;
    meshes.push(
      <mesh key={i} castShadow position={[x + (col - 1.5) * 1.6, 0.45 + row * 0.85, z + (row % 2) * 0.1]}>
        <boxGeometry args={[1.4, 0.8, 1.4]} />
        <meshStandardMaterial color={GRADE_COLOR[grade] ?? '#8b93a0'} roughness={0.95} />
      </mesh>
    );
  }
  return <group>{meshes}</group>;
}

// live stack contents interpolated from the frozen task windows (no sim here).
// Frozen timeline vocabulary: RECEIVING_AREA / HMS1_HMS2_STACK / BUSHING_STACK / CHARGING_BUCKET_C1..C3.
function stacksAt(t: TimelineTask | null): Record<string, number> {
  const s: Record<string, number> = { HMS1_HMS2_STACK: 0, BUSHING_STACK: 0 };
  for (const task of TIMELINE.tasks) {
    if (!task.material_grade) continue; // reclaiming tasks carry grade null
    const key = task.destination_location === 'HMS1_HMS2_STACK' || task.destination_location === 'BUSHING_STACK'
      ? task.destination_location : null;
    if (key === null) continue; // charging moves go to the buckets, not a yard stack
    if (tick >= task.end) s[key] += task.tonnes;
    else if (task.task_type === 'receiving' && tick >= task.start) {
      s[key] += Math.round((task.tonnes * (tick - task.start)) / (task.end - task.start));
    }
  }
  return s;
}

function YardStacks() {
  const t = activeTaskAt(TIMELINE.tasks, tick);
  const s = stacksAt(t);
  return (
    <group>
      <Stack x={-5} z={8} grade="hms1_hms2" tonnes={s.HMS1_HMS2_STACK} />
      <Stack x={7} z={8} grade="bushing" tonnes={s.BUSHING_STACK} />
    </group>
  );
}

// ---------- Trucks at the receiving zone (Kenney bucket as payload proxy, procedural truck) ----------
function Trucks() {
  const arrived = TIMELINE.truck_loads.filter((l) => l.tick <= tick);
  return (
    <group>
      {arrived.map((l, i) => {
        const x = 19 + Math.floor(i / 3) * 2.4;
        const z = 8 - (i % 3) * 1.8;
        return (
          <group key={i} position={[x, 0, z]}>
            {/* simple procedural truck: cab + flatbed with colored scrap pile */}
            <mesh castShadow position={[0, 0.7, 0]}>
              <boxGeometry args={[1.2, 1.1, 1.6]} />
              <meshStandardMaterial color="#39424e" roughness={0.7} />
            </mesh>
            <mesh castShadow position={[1.4, 0.55, 0]}>
              <boxGeometry args={[2.6, 0.5, 1.8]} />
              <meshStandardMaterial color="#2a3038" roughness={0.7} />
            </mesh>
            <mesh castShadow position={[1.4, 1.05, 0]}>
              <boxGeometry args={[2.2, 0.6, 1.5]} />
              <meshStandardMaterial color={GRADE_COLOR[l.grade] ?? '#8b93a0'} roughness={0.95} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ---------- Charge buckets C1/C2/C3 (Kenney bucket GLB + status fill) ----------
const CHARGE_X = -12; // inside the crane gantry span (x=-15..13) so magnet paths stay reachable
const CHARGE_Z: Record<string, number> = { C1: 8.5, C2: 6, C3: 3.5 };
function ChargeBuckets() {
  if (!BUCKET_MODEL) return null;
  const statuses = chargeStatusAt(TIMELINE.charges, TIMELINE.events, tick);
  // Fill per bucket from the frozen charging-task windows (pure interpolation): each
  // P*-hms / P*-bush task delivers its tonnes into CHARGING_BUCKET_Cn at its end tick.
  const filled: Record<string, number> = { C1: 0, C2: 0, C3: 0 };
  for (const task of TIMELINE.tasks) {
    if (task.task_type !== 'charging' || !task.material_grade) continue;
    const m = /CHARGING_BUCKET_(C\d)/.exec(task.destination_location);
    if (!m) continue;
    if (tick >= task.end) filled[m[1]] += task.tonnes;
    else if (tick >= task.start) filled[m[1]] += Math.round((task.tonnes * (tick - task.start)) / (task.end - task.start));
  }
  const recipe = TIMELINE.recipes[0]; // all three charges use R1 in the frozen fixture
  const totalNeeded = recipe ? recipe.composition.reduce((a, c) => a + c.required_usable_t, 0) : 45;
  return (
    <group>
      {TIMELINE.charges.map((c) => {
        const clone = BUCKET_MODEL.clone();
        clone.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
        const status = statuses[c.charge_id];
        const fillFrac = Math.min(1, filled[c.charge_id] / totalNeeded);
        return (
          <group key={c.charge_id} position={[CHARGE_X, 0, CHARGE_Z[c.charge_id]]}>
            <primitive object={clone} scale={1.6} />
            {/* fill indicator: height grows with delivered tonnes */}
            <mesh position={[0, 0.25 + fillFrac * 0.9, 0]}>
              <cylinderGeometry args={[1.0, 1.0, Math.max(0.06, fillFrac * 1.8), 24]} />
              <meshBasicMaterial color={status === 'ready' ? '#245c36' : status === 'failed' ? '#7a3030' : '#c08a4a'} transparent opacity={0.85} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ---------- EAF ghost slot (lifecycle rule §14.4: not_built = dim wireframe) ----------
function EafGhost() {
  const shell = new THREE.BoxGeometry(5, 4, 4);
  const edges = new THREE.EdgesGeometry(shell);
  return (
    <group position={[-19, 2, -5]}>
      <lineSegments>
        <primitive object={edges} attach="geometry" />
        <lineBasicMaterial color="#6f8f6f" transparent opacity={0.7} />
      </lineSegments>
      {/* EAF shell: procedural cylinder + cone (the proven ladle-recipe style) */}
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[1.6, 1.9, 2.4, 20]} />
        <meshStandardMaterial color="#39424e" transparent opacity={0.35} roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[0, 3.1, 0]}>
        <coneGeometry args={[1.2, 1.4, 20]} />
        <meshStandardMaterial color="#39424e" transparent opacity={0.3} roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  );
}

// ---------- Reclaiming bin: Kenney hopper (visual mix per §9.4 mark) ----------
function ReclaimHopper() {
  if (!HOPPER_MODEL) return null;
  const clone = HOPPER_MODEL.clone();
  clone.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return <primitive object={clone} position={[-13, 0, 6]} scale={1.4} />;
}

// ---------- helpers ----------
function lerp(a: number, b: number, t: number) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
function locXZ(loc: string): { x: number; z: number } {
  switch (loc) {
    case 'RECEIVING_AREA': return { x: 19, z: 8 };
    case 'HMS1_HMS2_STACK': return { x: -5, z: 8 };
    case 'BUSHING_STACK': return { x: 7, z: 8 };
    case 'CHARGING_BUCKET_C1': return { x: CHARGE_X, z: 8.5 };
    case 'CHARGING_BUCKET_C2': return { x: CHARGE_X, z: 6 };
    case 'CHARGING_BUCKET_C3': return { x: CHARGE_X, z: 3.5 };
    default: return { x: -13, z: 6 }; // reclaim hopper area
  }
}

// ---------- labels (DOM overlay projected from world positions, slice5 pattern) ----------
const LABELS: Array<{ pos: [number, number, number]; text: string; cls?: string }> = [
  { pos: [19, 2.2, 8], text: 'Receiving area' },
  { pos: [-5, 3.2, 8], text: 'HMS1/HMS2 stack' },
  { pos: [7, 3.2, 8], text: 'Bushing stack' },
  { pos: [-13, 2.4, 6], text: 'Reclaiming bin' },
  { pos: [18.5, 4.5, -4], text: 'Shredder plant' },
  { pos: [CHARGE_X, 3.4, 8.5], text: 'C1' },
  { pos: [CHARGE_X, 3.4, 6], text: 'C2' },
  { pos: [CHARGE_X, 3.4, 3.5], text: 'C3' },
  { pos: [-19, 5.2, -5], text: 'EAF — not built (ghost)' },
];

// slice5 pattern: R3F hooks (useThree/useFrame) only work INSIDE <Canvas>,
// so a bridge inside the Canvas publishes camera+size to module refs, and the
// DOM label overlay outside the Canvas reads them.
const CAM = { current: null as THREE.Camera | null };
const VIEW = { w: 0, h: 0 };

function LabelCameraBridge() {
  const { camera, size, scene } = useThree();
  CAM.current = camera;
  VIEW.w = size.width;
  VIEW.h = size.height;
  return null;
}

function Labels() {
  const [items, setItems] = useState<Array<{ x: number; y: number; text: string; cls?: string }>>([]);
  useEffect(() => {
    let raf = 0;
    const project = () => {
      const camera = CAM.current;
      if (camera && VIEW.w > 0) {
        const out: Array<{ x: number; y: number; text: string; cls?: string }> = [];
        for (const l of LABELS) {
          const v = new THREE.Vector3(...l.pos).project(camera);
          if (v.z > 1) continue;
          out.push({ x: (v.x * 0.5 + 0.5) * VIEW.w, y: (-v.y * 0.5 + 0.5) * VIEW.h, text: l.text, cls: l.cls });
        }
        setItems(out);
      }
      raf = requestAnimationFrame(project);
    };
    raf = requestAnimationFrame(project);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div id="labels">
      {items.map((it, i) => (
        <span key={i} className={`blabel ${it.cls ?? ''}`} style={{ left: it.x, top: it.y }}>{it.text}</span>
      ))}
    </div>
  );
}

// ---------- scene assembly + HUD/panel ----------
function Scene() {
  const t = useTick();
  void t;
  const active = activeTaskAt(TIMELINE.tasks, tick);
  return (
    <group>
      <ViewCamera home={{ target: [-2, 1, 0], azDeg: Math.atan2(34, 30), elDeg: Math.atan2(26 - 1, Math.hypot(34, 30)), dist: Math.hypot(34 + 2, 25, 30), minDist: 8, maxDist: 70 }} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[20, 30, 10]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
      <Ground />
      <ScrapScatter />
      <YardStacks />
      <Trucks />
      <GantryRig t={active} />
      <ShredderPlant />
      <ChargeBuckets />
      <ReclaimHopper />
      <EafGhost />
    </group>
  );
}

function Overlay() {
  useTick();
  const active = activeTaskAt(TIMELINE.tasks, tick);
  const statuses = chargeStatusAt(TIMELINE.charges, TIMELINE.events, tick);
  const ready = Object.values(statuses).filter((s) => s === 'ready').length;
  return (
    <div id="overlay">
      <div className="big">tick {tick} / {TICKS}</div>
      <div className={active ? 'flow' : ''}>{active ? `${active.task_id}: ${active.source_location} → ${active.destination_location} (${active.material_grade ?? 'charge'}, ${active.tonnes}t)` : 'crane idle'}</div>
      <div>charges ready: {ready} / 3</div>
    </div>
  );
}

function Panel() {
  useTick();
  const statuses = chargeStatusAt(TIMELINE.charges, TIMELINE.events, tick);
  const events = TIMELINE.events.filter((e) => e.tick <= tick).slice(-14).reverse();
  return (
    <div id="panel">
      <h1>Slice 2 — frozen verified timeline playback</h1>
      <div className="row">
        <button className="primary" onClick={() => { playing = !playing; notify(); }}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => { tick = Math.max(0, tick - 10); notify(); }}>−10</button>
        <button onClick={() => { tick = Math.min(TICKS, tick + 10); notify(); }}>+10</button>
        <button className="danger" onClick={() => { tick = 0; playing = false; notify(); }}>Reset</button>
      </div>
      <h2>Charge buckets</h2>
      {TIMELINE.charges.map((c) => (
        <div key={c.charge_id} className="charge">
          <div className="head"><span>{c.charge_id}</span><span className={`badge ${statuses[c.charge_id] === 'ready' ? 'ok' : statuses[c.charge_id] === 'failed' ? 'on' : 'off'}`}>{statuses[c.charge_id]}</span></div>
          <div className="hint">deadline {c.deadline} · ready at {c.readiness_timestamp ?? '—'} · recipe {c.recipe_id}</div>
        </div>
      ))}
      <h2>Event log (frozen)</h2>
      <div className="eventlog">
        {events.map((e, i) => <div key={i}>{String(e.tick).padStart(3, '0')} · {e.event}</div>)}
      </div>
      <h2>What this teaches</h2>
      <div className="learn">
        One yard crane serves every move (non-preemptive). Scrap arrives by truck into a
        receiving area, gets stacked by grade, and the crane feeds charge buckets against
        recipe deadlines. Watch how late truck arrivals push stack building past mid-run —
        that is exactly what squeezes C3 before its deadline.
      </div>
    </div>
  );
}

// playback ticker lives outside React: fixed real-time rate per speed multiplier
window.setInterval(() => {
  if (!playing) return;
  tick = Math.min(TICKS, tick + 1);
  if (tick >= TICKS) playing = false;
  notify();
}, 40 / speedMul);

function App() {
  return (
    <>
      <div id="scene">
        <Canvas shadows camera={{ fov: 42 }}>
          <LabelCameraBridge />
          <ViewCamera home={{ target: [-2, 1, 0], azDeg: Math.atan2(34, 30), elDeg: Math.atan2(25, Math.hypot(34, 30)), dist: Math.hypot(36, 25, 30), minDist: 8, maxDist: 70 }} />
          <Scene />
        </Canvas>
        <Overlay />
        <Labels />
        <ResetViewButton />
      </div>
      <Panel />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
