import * as React from 'react';
import rd from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ViewCamera, ResetViewButton } from './view_camera.tsx';
const { useEffect, useMemo, useRef, useState } = React;
import { runSlice1, SLICE1, type RunResult, type TickRecord } from './sim.js';

// ---------- Simulation (real engine, no hardcoded gameplay) ----------
const RESULT: RunResult = runSlice1();

// ---------- Layout (fixed world coordinates, meters) ----------
// Flow runs left to right: water/jetty -> conveyor -> yard -> dispatch.
const LAYOUT = {
  water:    { x: -12, z: 0 },
  jetty:    { x: -6,  z: 0 },
  conveyor: { x: 0,   z: 0 },
  yard:     { x: 4,   z: 0 },
  dispatch: { x: 8,   z: 0 },
};

// ---------- Camera framing (Phase A, item 1) ----------
// Bounded elevation ~15-75 deg per Phase 2 contract; full azimuth.
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

// ---------- Building shell + DOM label (identity system, not debug text) ----------
// Labels are DOM overlay (Phase 2 contract: no text drawn inside WebGL).
// World anchors for labels; DOM labels render in LabelLayer (outside Canvas).
const LABELS: Array<{ id: string; label: string; world: [number, number, number] }> = [];

function Building({
  pos, size, label, color, accent,
}: {
  pos: [number, number, number];
  size: [number, number, number];
  label: string;
  color: string;
  accent?: string;
}) {
  LABELS.push({ id: label, label, world: [pos[0], pos[1] + size[1] + 0.6, pos[2]] });
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

// Shared camera ref: LabelCameraBridge (inside Canvas) stores it; LabelLayer (DOM, outside Canvas) projects.
const CAM = { current: null as any };

function LabelCameraBridge() {
  const { camera } = useThree();
  CAM.current = camera;
  return null;
}

function LabelLayer() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, []);
  const canvas = typeof document !== 'undefined' ? document.querySelector('#scene canvas') as HTMLCanvasElement | null : null;
  const cam = CAM.current;
  if (!canvas || !cam) return null;
  const rect = canvas.getBoundingClientRect();
  const pts = LABELS.map((L) => {
    const v = new THREE.Vector3(...L.world).project(cam);
    return { id: L.id, label: L.label, x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
  });
  return (
    <div id="labels">
      {pts.map((p) => <div key={p.id} className="blabel" style={{ left: p.x, top: p.y }}>{p.label}</div>)}
    </div>
  );
}

// ---------- Scene (simple geometry; labels in DOM overlay, not WebGL text) ----------
function Yard({ rec }: { rec: TickRecord }) {
  const frac = Math.min(1, rec.yard_stock_t / rec.yard_capacity_t);
  return (
    <>
      <Building pos={[LAYOUT.yard.x, 0, 0]} size={[6, 1.5, 4.5]} label="Material Yard" color="#2a3038" accent={rec.congestion_flag ? '#c05050' : '#3f7fbf'} />
      {/* growing pile - the yard IS the bottleneck visualization */}
      <mesh position={[LAYOUT.yard.x, 1.5 + 0.8 * frac, 0]}>
        <boxGeometry args={[5.4, Math.max(0.08, 1.6 * frac), 4.0]} />
        <meshStandardMaterial color={rec.congestion_flag ? '#c05050' : '#3f7fbf'} />
      </mesh>
    </>
  );
}

function Conveyor({ rec }: { rec: TickRecord }) {
  // Flow direction yard -> dispatch; blocked (congestion) turns red.
  const flowing = rec.arrived_this_tick_t > 0;
  return (
    <>
      {/* gantry legs */}
      {[-1.5, 0, 1.5].map((dx) => (
        <mesh key={dx} position={[LAYOUT.conveyor.x + dx, 0.42, 0]}>
          <boxGeometry args={[0.16, 0.84, 1.1]} />
          <meshStandardMaterial color="#3a424d" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      {/* belt span + transfer houses at both ends */}
      <Building pos={[LAYOUT.conveyor.x, 0, 0]} size={[3.6, 0.28, 1.2]} label="Conveyor" color={rec.congestion_flag ? '#c05050' : '#5a6572'} />
      {[-1.9, 1.9].map((dx) => (
        <mesh key={dx} position={[LAYOUT.conveyor.x + dx, 0.62, 0]}>
          <boxGeometry args={[0.5, 0.75, 1.3]} />
          <meshStandardMaterial color="#454f5b" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
      {/* moving carry cue on the belt: flow reads left -> right */}
      {flowing && [-1.2, -0.4, 0.4, 1.2].map((dx) => (
        <mesh key={dx} position={[LAYOUT.conveyor.x + dx, 0.86, 0]}>
          <boxGeometry args={[0.35, 0.16, 0.9]} />
          <meshStandardMaterial color="#8fb3d9" emissive="#2f6da0" emissiveIntensity={0.35} />
        </mesh>
      ))}
    </>
  );
}

// ---------- Jetty GLB (ComfyUI, contains gantry crane + ship together) ----------
// jetty.glb: single welded mesh normalized to ~1 unit across (bbox ~0.98), up-axis Y.
// Replaces the old Kenney ship.glb + 4 procedural PortalCrane meshes as ONE assembly
// (Yasser, 25.10). Same GlbModel + Box3 ground-lift pattern as slice4.
function GlbModel({ url }: { url: string }) {
  const [gltf, setGltf] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    new GLTFLoader().load(url, (g: { scene: THREE.Group }) => { if (alive) setGltf(g.scene); }, undefined, (err: unknown) => console.error(`GLB load failed (${url}):`, err));
    return () => { alive = false; };
  }, [url]);
  return gltf;
}

const JETTY_GLB_URL = new URL('./assets/jetty.glb', import.meta.url).href;
// ~1 unit across model -> tune here to fit the jetty/water footprint.
const JETTY_MODEL_SCALE = 8;

function Jetty({ rec }: { rec: TickRecord }) {
  const gltf = GlbModel({ url: JETTY_GLB_URL });
  const scaled: THREE.Group | null = gltf ? gltf.clone() : null;
  if (scaled) {
    scaled.scale.setScalar(JETTY_MODEL_SCALE);
    scaled.traverse((o: THREE.Object3D) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  }
  // lift AFTER scaling so bbox bottom sits on the ground plane
  const minY = scaled ? new THREE.Box3().setFromObject(scaled).min.y : 0;
  return <primitive object={scaled ?? new THREE.Group()} position={[LAYOUT.jetty.x, -minY, LAYOUT.water.z]} />;
}

function Dispatch({ rec }: { rec: TickRecord }) {
  return (
    <>
      {/* dispatch yard pad with painted lane */}
      <mesh position={[LAYOUT.dispatch.x, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.4, 5.4]} />
        <meshStandardMaterial color="#232c36" />
      </mesh>
      {/* hazard-stripe kerb along the dock edge */}
      {[-2, -1, 0, 1, 2].map((dz) => (
        <mesh key={dz} position={[LAYOUT.dispatch.x + 2.7, 0.05, dz * 1.0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.4, 0.8]} />
          <meshStandardMaterial color={dz % 2 === 0 ? '#c9a13f' : '#171d24'} />
        </mesh>
      ))}
      {/* small dispatch office (scale anchor: person-sized doorway) */}
      <Building pos={[LAYOUT.dispatch.x - 1.6, 0, -1.8]} size={[1.8, 2.2, 1.6]} label="Dispatch" color="#333b45" accent={rec.congestion_flag ? '#c05050' : '#5a6572'} />
      <mesh position={[LAYOUT.dispatch.x - 1.6, 0.75, -0.99]}>
        <boxGeometry args={[0.6, 1.2, 0.02]} />
        <meshStandardMaterial color="#11161c" />
      </mesh>
      {/* RTG-style gantry straddling the loading lane (dispatch-area reference) */}
      {[-1, 1].map((dz) => (
        <group key={dz}>
          <mesh position={[LAYOUT.dispatch.x + 0.6, 1.7, dz * 2.1]}><boxGeometry args={[0.24, 3.4, 0.24]} /><meshStandardMaterial color="#c9a13f" metalness={0.4} roughness={0.5} /></mesh>
          <mesh position={[LAYOUT.dispatch.x + 2.2, 1.7, dz * 2.1]}><boxGeometry args={[0.24, 3.4, 0.24]} /><meshStandardMaterial color="#c9a13f" metalness={0.4} roughness={0.5} /></mesh>
        </group>
      ))}
      <mesh position={[LAYOUT.dispatch.x + 1.4, 3.5, 0]}><boxGeometry args={[2.2, 0.4, 4.6]} /><meshStandardMaterial color="#c9a13f" /></mesh>
      <mesh position={[LAYOUT.dispatch.x + 1.4, 3.1, 0]}><boxGeometry args={[0.9, 0.5, 1.2]} /><meshStandardMaterial color="#8b93a0" metalness={0.5} roughness={0.45} /></mesh>
      {/* tractor + flatbed trailer loaded with steel products (long bars, no containers) */}
      <group position={[LAYOUT.dispatch.x + 1.4, 0, 0]}>
        <mesh castShadow position={[-1.9, 0.55, 0]}><boxGeometry args={[1.0, 0.9, 1.5]} /><meshStandardMaterial color="#a03030" metalness={0.3} roughness={0.6} /></mesh>
        <mesh position={[-1.9, 1.12, 0]}><boxGeometry args={[0.7, 0.45, 1.3]} /><meshStandardMaterial color="#20262e" metalness={0.2} roughness={0.4} /></mesh>
        <mesh position={[0.6, 0.42, 0]}><boxGeometry args={[3.4, 0.25, 1.7]} /><meshStandardMaterial color="#2a3038" metalness={0.5} roughness={0.5} /></mesh>
        {/* stacked steel bars on the flatbed */}
        {[0, 1].map((row) => (
          <group key={row}>
            {[-0.9, -0.3, 0.3, 0.9].map((dx) => (
              <mesh key={dx} position={[0.6 + dx * 0.7, 0.72 + row * 0.28, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.11, 0.11, 3.0, 8]} />
                <meshStandardMaterial color={row ? '#6f7c8a' : '#8b93a0'} metalness={0.7} roughness={0.35} />
              </mesh>
            ))}
          </group>
        ))}
        {/* wheels */}
        {[-1.9, 0.2, 1.6].map((dx) => (
          <mesh key={dx} position={[dx * 1.0 - 0.4, 0.3, 0.85]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.22, 12]} /><meshStandardMaterial color="#171d24" roughness={0.9} />
          </mesh>
        ))}
      </group>
    </>
  );
}

function Scene({ rec }: { rec: TickRecord }) {
  LABELS.length = 0;
  const target: [number, number, number] = [1, 1.2, 0];
  // Fit-to-frame: plant spans ~15 world units; distance adapts to viewport aspect.
  const aspect = (typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1.6);
  const dist = Math.max(14, 15 / (2 * Math.tan((45 * Math.PI / 180) / 2)) * (aspect < 1.6 ? 1.6 / aspect : 1));
  const { pos } = useOrbitCamera(target, dist, 0, 35);
  const home = { target, azDeg: 0, elDeg: 35, dist, minDist: 6, maxDist: 40 };
  return (
    <Canvas camera={{ position: pos, fov: 45 }}>
      <LabelCameraBridge />
      <ViewCamera home={home} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[12, 18, 8]} intensity={1.4} />
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[24, 14]} />
        <meshStandardMaterial color="#17202a" />
      </mesh>
      {/* water at the jetty side */}
      <mesh position={[LAYOUT.water.x, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 14]} />
        <meshStandardMaterial color="#1d3a52" />
      </mesh>
      <Jetty rec={rec} />
      <Conveyor rec={rec} />
      <Yard rec={rec} />
      <Dispatch rec={rec} />
    </Canvas>
  );
}

// ---------- App ----------
function App() {
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    timer.current = window.setInterval(() => {
      setIdx((i) => {
        if (i + 1 >= RESULT.records.length) { setRunning(false); return i; }
        return i + 1;
      });
    }, 120);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [running]);

  const rec = RESULT.records[idx];
  const events = RESULT.events.filter((e) => e.tick <= rec.tick);

  const bottleneck = useMemo(() => {
    if (rec.congestion_flag) {
      return rec.dispatch_cap >= RESULT.cfg.dispatch.arrival_t_per_tick
        ? 'Yard capacity is the binding constraint: conveyor delivers 100 t/tick, dispatch drains ' + rec.dispatch_cap.toFixed(1) + ' t/tick, yard is full, upstream is restricted.'
        : 'Dispatch capacity is the binding constraint: it drains slower than the conveyor fills, so the yard fills and congestion fires.';
    }
    return 'No congestion yet — dispatch keeps up with the conveyor.';
  }, [rec]);

  return (
    <>
      <div id="scene">
        <Scene rec={rec} />
        <LabelLayer />
        <ResetViewButton />
        <div id="overlay">
          <div className="big">Tick {rec.tick} / {SLICE1.ticks} (day {rec.day})</div>
          <div className="flow">Flow: Jetty → Conveyor → Yard → Dispatch</div>
          <div className={rec.congestion_flag ? 'blocked' : ''}>
            {rec.congestion_flag ? 'CONGESTED — upstream restricted' : 'Flowing'}
          </div>
          <div>Yard: {rec.yard_stock_t.toFixed(2)} t / {rec.yard_capacity_t} t</div>
          <div>Ship at berth: {rec.ships_at_berth > 0 ? `S${rec.events.length ? '' : ''}${rec.ship_on_board_t.toFixed(1)} t on board` : 'none'}</div>
        </div>
      </div>
      <div id="panel">
        <h1>SteelX — Slice 1</h1>
        <div className="row">
          <button className="primary" onClick={() => setRunning(true)} disabled={running}>Start</button>
          <button onClick={() => setRunning(false)} disabled={!running}>Pause</button>
          <button onClick={() => { setIdx(0); setRunning(false); }}>Reset</button>
        </div>
        <div className="row">
          <button onClick={() => setIdx((i) => Math.min(i + 1, RESULT.records.length - 1))} disabled={running}>Step +1</button>
        </div>

        <h2>Facility inspection</h2>
        <div className="stat"><span>Yard stock</span><b>{rec.yard_stock_t.toFixed(2)} t</b></div>
        <div className="bar"><div style={{ width: `${100 * Math.min(1, rec.yard_stock_t / rec.yard_capacity_t)}%` }} /></div>
        <div className="stat"><span>Dispatch capacity</span><b>{rec.dispatch_cap.toFixed(1)} t/tick</b></div>
        <div className="stat"><span>Conveyor fill</span><b>{RESULT.cfg.dispatch.arrival_t_per_tick.toFixed(1)} t/tick</b></div>
        <div className="stat"><span>Arrived (cumulative)</span><b>{rec.arrived_t.toFixed(2)} t</b></div>
        <div className="stat"><span>Dispatched (cumulative)</span><b>{rec.dispatched_t.toFixed(2)} t</b></div>
        <div className="stat"><span>Upstream blocked</span><b>{rec.upstream_blocked_t.toFixed(2)} t</b></div>
        <div className="stat"><span>Unload blocked</span><b>{rec.unload_blocked_t.toFixed(2)} t</b></div>
        <div className="stat"><span>Berth refusals</span><b>{rec.berth_blocked_t}</b></div>
        <div className="stat"><span>Restricted streak</span><b>{rec.restricted_streak} / {RESULT.cfg.dispatch.congestion_ticks}</b></div>
        <div className="stat"><span>Demurrage</span><b>${rec.demurrage_usd.toFixed(0)}</b></div>

        <h2>Intervention</h2>
        <div className="hint">Second crane at tick {SLICE1.interventionTick}: dispatch 40 → 80 t/tick (applied as config override on the scenario copy).</div>
        <div className="row">
          <button className="danger" onClick={() => setIdx(SLICE1.interventionTick - 1)}>Jump to intervention</button>
        </div>

        <h2>Indicators</h2>
        <span className={`badge ${rec.congestion_flag ? 'on' : 'off'}`}>{rec.congestion_flag ? 'Congestion' : 'No congestion'}</span>
        <span className={`badge ${rec.upstream_blocked_t > 0 ? 'on' : 'off'}`}>{rec.upstream_blocked_t > 0 ? 'Upstream blocked' : 'Upstream clear'}</span>

        <h2>Event log</h2>
        <div className="eventlog">
          {events.map((e, i) => <div key={i}>tick {e.tick}: {e.type}</div>)}
        </div>

        <h2>Learning panel</h2>
        <div className="learn">
          {bottleneck}
          <br /><br />
          Operational consequence: when dispatch capacity is below conveyor fill, the yard fills, the restricted streak reaches {RESULT.cfg.dispatch.congestion_ticks},
          upstream production is throttled, and demurrage accrues while ships wait at the berth. Raising dispatch capacity moves the binding constraint
          from dispatch to yard capacity — visible here as the yard staying full while dispatch catches up.
        </div>
      </div>
    </>
  );
}

rd.createRoot(document.getElementById('root')!).render(<App />);
