import * as React from 'react';
import rd from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { ViewCamera, ResetViewButton } from './view_camera.tsx';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// [OPEN QUESTION 1] Kenney model swap point: slice1 loads GLBs via GLTFLoader at module
// scope (see ports/slice1/browser/main.tsx Ship/Cranes). When Yasser drops DRP.glb into
// ./assets/, replace DrpUnit's box with a loader + <primitive object={model.clone()}> —
// clone per instance (verified pitfall: primitive mutates the shared loaded model).
const { useEffect, useMemo, useRef, useState } = React;
import {
  runSlice3, compareFixture, balanceResidual, summarize,
  S3_STARVE_FIXTURE, S3_FILL_FIXTURE,
  type RunResult, type TickRecord, type S3Fixture,
} from './sim.js';

// ---------- Simulation (mirror-derived deterministic replay; the 3D layer never drives logic) ----------
const RESULTS: Record<string, RunResult> = {
  starve: runSlice3(S3_STARVE_FIXTURE),
  fill: runSlice3(S3_FILL_FIXTURE),
};

// Fixture parity printed in the browser console too (verification bar item (a)).
for (const key of ['starve', 'fill'] as const) {
  const res = RESULTS[key];
  for (const c of compareFixture(res)) {
    console.log(`[${key}] ${c.field}: ${c.match ? 'MATCH' : 'MISMATCH'}${c.sim_len !== undefined ? ` (${c.sim_len} ticks)` : ''}`);
  }
  const resid = balanceResidual(res);
  console.log(`[${key}] balance residual @tick120: ${resid.toFixed(6)} ${Math.abs(resid) < 1e-9 ? 'CLOSED' : 'OPEN'}`);
}

// ---------- Layout (fixed world coordinates, meters). Flow left -> right. ----------
const LAYOUT = {
  drp:      { x: -8, z: 0 },
  conveyor: { x: -4, z: 0 },
  buffer:   { x: 0,  z: 0 },
  feeder:   { x: 4,  z: 0 },
  eaf:      { x: 7.5, z: 0 },
};

// ---------- Camera framing (same bounded elevation contract as slice1) ----------
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

// ---------- DOM labels (identity system; no text drawn inside WebGL) ----------
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
  if (!LABELS.some((L) => L.id === label)) LABELS.push({ id: label, label, world: [pos[0], pos[1] + size[1] + 0.6, pos[2]] });
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

// ---------- Attached GLB models (ComfyUI meshes, quantized+simplified; slice4 pattern) ----------
function GlbModel({ url }: { url: string }) {
  const [gltf, setGltf] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    new GLTFLoader().load(url, (g: { scene: THREE.Group }) => { if (alive) setGltf(g.scene); }, undefined, (err: unknown) => console.error(`GLB load failed (${url}):`, err));
    return () => { alive = false; };
  }, [url]);
  return gltf;
}

// EAF reuses slice4's S2.1 procedural hero (shared asset, built at final scene size).
const EAF_GLB_URL = new URL('../../slice4/browser/assets/eaf_hero.glb', import.meta.url).href;
function EafModel() {
  const gltf = GlbModel({ url: EAF_GLB_URL });
  const scaled = gltf ? gltf.clone() : null;
  if (scaled) scaled.scale.setScalar(1); // hero at final size — no normalize knob
  const minY = scaled ? new THREE.Box3().setFromObject(scaled).min.y : 0;
  return (
    <group position={[0, -minY, 0]}>
      {scaled && <primitive object={scaled} />}
    </group>
  );
}

// ---------- DRP unit (isolated per-object-type component — model swap point) ----------
// ---------- DRP unit: S1.3 hero swap (F-06) — procedural Blender-Python shaft ----------
// drp_shaft.glb: 668 tris / 59 KB, built at FINAL scene size to fit the 7.2 x 6.4 pad,
// top 9.3 (lamp/label anchors unchanged). Named pivots: pivot_charge_conveyor, pivot_bustle_ring.
const DRP_GLB_URL = new URL('./assets/drp_shaft.glb', import.meta.url).href;
const DRP_MODEL_SCALE = 1; // hero built at final size — no normalize knob

function DrpUnit({ rec }: { rec: TickRecord }) {
  const tripped = rec.drp_tripped;
  const accent = tripped ? '#e07070' : '#4fa3d9';
  const gltf = GlbModel({ url: DRP_GLB_URL });
  const scaled: THREE.Group | null = gltf ? gltf.clone() : null;
  if (scaled) {
    scaled.scale.setScalar(DRP_MODEL_SCALE);
    scaled.traverse((o: THREE.Object3D) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  }
  const minY = scaled ? new THREE.Box3().setFromObject(scaled).min.y : 0;
  return (
    <>
      {/* footprint pad + label anchor */}
      <mesh position={[LAYOUT.drp.x, 0.02, -0.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7.2, 6.4]} />
        <meshStandardMaterial color="#1d2530" />
      </mesh>
      <Building pos={[LAYOUT.drp.x, 0, 0]} size={[0.001, 9.4, 0.001]} label="DRP (DRI Plant)" color="#17202a" accent={accent} />
      {scaled && <primitive object={scaled} position={[LAYOUT.drp.x, -minY, 0]} />}
      {/* running/tripped lamp on the tower */}
      <mesh position={[LAYOUT.drp.x - 0.6, 9.2, -0.4]}>
        <sphereGeometry args={[0.26, 16, 16]} />
        <meshStandardMaterial color={tripped ? '#e07070' : '#3fd97a'} emissive={tripped ? '#e07070' : '#3fd97a'} emissiveIntensity={0.8} />
      </mesh>
    </>
  );
}

// ---------- Conveyor: DRP -> buffer (material flow = moving cubes, see FlowCubes) ----------
function Conveyor({ rec }: { rec: TickRecord }) {
  const flowing = rec.drp_discharged_this_tick_t > 0;
  return (
    <>
      {[-1.2, 0, 1.2].map((dx) => (
        <mesh key={dx} position={[LAYOUT.conveyor.x + dx, 0.35, 0]}>
          <boxGeometry args={[0.16, 0.7, 1.1]} />
          <meshStandardMaterial color="#3a424d" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <Building pos={[LAYOUT.conveyor.x, 0, 0]} size={[3.0, 0.3, 1.2]} label="Conveyor" color={rec.flags.blocked ? '#7a5a30' : (flowing ? '#5a6572' : '#4a525c')} />
      {[-1.6, 1.6].map((dx) => (
        <mesh key={dx} position={[LAYOUT.conveyor.x + dx, 0.55, 0]}>
          <boxGeometry args={[0.45, 0.7, 1.3]} />
          <meshStandardMaterial color="#454f5b" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
    </>
  );
}

// ---------- DRI buffer: tonnage as a rising/falling level gauge inside an open tank ----------
// Level color is state-driven ONLY from recorded flags: full=amber, starved=red, normal=blue.
function Buffer({ rec }: { rec: TickRecord }) {
  const sc = RESULTS.starve.fixture.scenario.buffer; // thresholds identical in both fixtures
  const capH = 4.0;                                   // world height of the tank interior
  LABELS.push({ id: 'DRI Buffer', label: 'DRI Buffer', world: [LAYOUT.buffer.x, capH + 0.6, 0] });
  const frac = Math.min(1, rec.buffer_t / sc.capacity_t);
  const fillFrac = sc.fill_state_threshold_t / sc.capacity_t;
  const starveFrac = sc.starve_threshold_t / sc.capacity_t;
  const color = rec.flags.starved ? '#d04545' : rec.flags.full ? '#d9a13f' : '#3f7fbf';
  return (
    <>
      {/* tank shell: back wall + floor + two side walls (open front so the level reads) */}
      <mesh position={[LAYOUT.buffer.x, capH / 2, -1.6]}>
        <boxGeometry args={[3.4, capH, 0.12]} />
        <meshStandardMaterial color="#3a4450" transparent opacity={0.9} />
      </mesh>
      <mesh position={[LAYOUT.buffer.x - 1.7, capH / 2, 0]}>
        <boxGeometry args={[0.12, capH, 3.2]} />
        <meshStandardMaterial color="#3a4450" transparent opacity={0.9} />
      </mesh>
      <mesh position={[LAYOUT.buffer.x + 1.7, capH / 2, 0]}>
        <boxGeometry args={[0.12, capH, 3.2]} />
        <meshStandardMaterial color="#3a4450" transparent opacity={0.9} />
      </mesh>
      <mesh position={[LAYOUT.buffer.x, 0.05, 0]}>
        <boxGeometry args={[3.4, 0.1, 3.2]} />
        <meshStandardMaterial color="#232830" />
      </mesh>
      {/* the level gauge: rising/falling block = buffer tonnage */}
      <mesh position={[LAYOUT.buffer.x, 0.1 + (capH * frac) / 2, 0]}>
        <boxGeometry args={[3.2, Math.max(0.06, capH * frac), 3.0]} />
        <meshStandardMaterial color={color} emissive={rec.flags.starved ? '#d04545' : '#000000'} emissiveIntensity={rec.flags.starved ? 0.45 : 0} />
      </mesh>
      {/* threshold rails: fill_state (amber) and starve (red) */}
      <mesh position={[LAYOUT.buffer.x, 0.1 + capH * fillFrac, 1.62]}>
        <boxGeometry args={[3.4, 0.05, 0.05]} />
        <meshStandardMaterial color="#d9a13f" emissive="#d9a13f" emissiveIntensity={rec.flags.full ? 0.8 : 0.2} />
      </mesh>
      <mesh position={[LAYOUT.buffer.x, 0.1 + capH * starveFrac, 1.62]}>
        <boxGeometry args={[3.4, 0.05, 0.05]} />
        <meshStandardMaterial color="#d04545" emissive="#d04545" emissiveIntensity={rec.flags.starved ? 0.8 : 0.2} />
      </mesh>
      {/* blocked-discharge marker: refused tonnage this tick */}
      {rec.flags.blocked && (
        <mesh position={[LAYOUT.buffer.x, capH + 0.5, 0]}>
          <boxGeometry args={[1.0, 0.35, 1.0]} />
          <meshStandardMaterial color="#d9a13f" emissive="#d9a13f" emissiveIntensity={0.7} />
        </mesh>
      )}
    </>
  );
}

// ---------- EAF feed interface + furnace block ----------
function Eaf({ rec, mode }: { rec: TickRecord; mode: string }) {
  const skipped = rec.heat_status === 'skipped';
  const charged = rec.heat_status === 'charged';
  return (
    <>
      <Building pos={[LAYOUT.feeder.x, 0, 0]} size={[1.6, 1.0, 1.6]} label="EAF Feed" color={skipped ? '#7a3030' : '#4a525c'} accent={charged ? '#3fd97a' : skipped ? '#e07070' : undefined} />
      {/* EAF block -> slice4's S2.1 procedural hero (shared asset, scale 1 + Box3 lift) */}
      <group position={[LAYOUT.eaf.x, 0, 0]}>
        <EafModel />
      </group>
      <Building pos={[LAYOUT.eaf.x, 0, 0]} size={[0.001, 6.5, 0.001]} label="EAF" color="#17202a" accent={charged ? '#ffb347' : skipped ? '#e07070' : '#5a6572'} />
      {/* furnace mouth glow: charged heats glow, skipped flashes red */}
      <mesh position={[LAYOUT.eaf.x - 1.85, 1.2, 0]}>
        <boxGeometry args={[0.1, 1.4, 1.6]} />
        <meshStandardMaterial color={charged ? '#ffb347' : skipped ? '#e07070' : '#20262e'} emissive={charged ? '#ff8c1a' : skipped ? '#e07070' : '#000000'} emissiveIntensity={charged || skipped ? 0.9 : 0} />
      </mesh>
    </>
  );
}

// ---------- Flow cubes: DRP -> buffer (discharge) and buffer -> EAF (charge), interpolated
// between recorded events per render frame. Logic is recorded; this only animates it. ----------
function FlowCubes({ idx, mode }: { idx: number; mode: string }) {
  const res = RESULTS[mode];
  const rec = res.records[idx];
  const groupRef = useRef<THREE.Group>(null);
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => { setT((v) => v + 1 / 60); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // [OPEN QUESTION 2] Replay pacing: tickAdvance is wall-clock animation speed only
  // (game-balance presentation choice; fixture semantics unaffected).
  const tickAdvance = 10 / 60; // ticks per second at 60fps
  const frac = ((t * tickAdvance) % 1 + 1) % 1;

  // discharge cubes: appear only on ticks where the sim recorded a discharge/refusal
  const discharging = rec.drp_discharged_this_tick_t > 0 || rec.flags.blocked;
  const refused = rec.flags.blocked;

  // charge cube: appears on heat ticks (charged -> travels into EAF, skipped -> stalls red)
  const heatTick = rec.heat_status !== null;

  return (
    <group ref={groupRef}>
      {discharging && (
        <>
          {/* one cube per recorded discharge lot, animated along conveyor path */}
          {[0, 1].map((i) => {
            const f = Math.min(1, frac + i * 0.5) % 1;
            const x = LAYOUT.drp.x + 2 + f * (LAYOUT.buffer.x - LAYOUT.drp.x - 3.4);
            return (
              <mesh key={`d${i}`} position={[x, 1.0, 0]}>
                <boxGeometry args={[0.5, 0.5, 0.5]} />
                <meshStandardMaterial color={refused ? '#d9a13f' : '#8fb3d9'} emissive={refused ? '#d9a13f' : '#2f6da0'} emissiveIntensity={0.4} />
              </mesh>
            );
          })}
        </>
      )}
      {heatTick && (
        (() => {
          const charged = rec.heat_status === 'charged';
          // charged: cube travels buffer -> EAF; skipped: stalls at the feed interface, red
          const f = charged ? frac : Math.min(frac, 0.45);
          const x = LAYOUT.buffer.x + 2 + f * (LAYOUT.eaf.x - LAYOUT.buffer.x - 3.6);
          return (
            <mesh key="h" position={[x, 1.6, 0]}>
              <boxGeometry args={[charged ? 1.0 : 0.7, charged ? 1.0 : 0.7, charged ? 1.0 : 0.7]} />
              <meshStandardMaterial color={charged ? '#ffb347' : '#d04545'} emissive={charged ? '#ff8c1a' : '#d04545'} emissiveIntensity={0.6} />
            </mesh>
          );
        })()
      )}
    </group>
  );
}

function Scene({ rec, idx, mode }: { rec: TickRecord; idx: number; mode: string }) {
  LABELS.length = 0;
  const target: [number, number, number] = [-0.5, 1.6, 0];
  const aspect = (typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1.6);
  const dist = Math.max(17, 18 / (2 * Math.tan((45 * Math.PI / 180) / 2)) * (aspect < 1.6 ? 1.6 / aspect : 1));
  const { pos } = useOrbitCamera(target, dist, 0, 32);
  const home = { target, azDeg: 0, elDeg: 32, dist, minDist: 7, maxDist: 45 };
  return (
    <Canvas camera={{ position: pos, fov: 45 }}>
      <LabelCameraBridge />
      <ViewCamera home={home} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[12, 18, 8]} intensity={1.4} />
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[26, 14]} />
        <meshStandardMaterial color="#17202a" />
      </mesh>
      <DrpUnit rec={rec} />
      <Conveyor rec={rec} />
      <Buffer rec={rec} />
      <Eaf rec={rec} mode={mode} />
      <FlowCubes idx={idx} mode={mode} />
    </Canvas>
  );
}

// ---------- App (two-mode switch = the fixture pair) ----------
function App() {
  const [mode, setMode] = useState<'starve' | 'fill'>('starve');
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  const res = RESULTS[mode];
  const fixture: S3Fixture = mode === 'starve' ? S3_STARVE_FIXTURE : S3_FILL_FIXTURE;
  const summary = useMemo(() => summarize(res), [res]);

  useEffect(() => {
    if (!running) return;
    timer.current = window.setInterval(() => {
      setIdx((i) => {
        if (i + 1 >= res.records.length) { setRunning(false); return i; }
        return i + 1;
      });
    }, 120);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [running, mode]);

  const rec = res.records[idx];
  const events = res.records.slice(0, idx + 1).flatMap((r) => r.events.map((e) => ({ tick: r.tick, event: e })));
  const sc = fixture.scenario;

  const starvedNow = rec.flags.starved || (rec.heat_status === 'skipped');
  const bottleneck = useMemo(() => {
    if (mode === 'starve') {
      return starvedNow
        ? `Buffer starved at heat ${rec.tick}: the EAF needs ${sc.eaf.charge_t} t and the buffer holds ${rec.buffer_t.toFixed(1)} t — the heat is SKIPPED (cause: buffer_starved). Demand outruns DRP supply.`
        : 'Demand > supply cadence: DRP trips drain the buffer below the charge size between heats; skipped heats are the failure mode of this scenario.';
    }
    return rec.flags.blocked
      ? `Buffer at capacity: DRP discharge is REFUSED (blocked) — supply outruns EAF consumption. Blocked tonnage accumulates upstream, never silently dropped.`
      : 'Supply > demand cadence: buffer fills toward the fill_state threshold; refusals fire whenever it hits capacity.';
  }, [rec, mode, starvedNow]);

  return (
    <>
      <div id="scene">
        <Scene rec={rec} idx={idx} mode={mode} />
        <LabelLayer />
        <ResetViewButton />
        <div id="overlay">
          <div className="big">Tick {rec.tick} / {sc.ticks}</div>
          <div className="flow">Flow: DRP → Conveyor → DRI Buffer → EAF Feed → EAF</div>
          <div className={starvedNow ? 'blocked' : ''}>
            {starvedNow ? 'STARVED — heat skipped' : rec.flags.blocked ? 'BLOCKED — discharge refused at capacity' : rec.flags.full ? 'Buffer FULL state' : 'Flowing'}
          </div>
          <div>Buffer: {rec.buffer_t.toFixed(2)} t / {sc.buffer.capacity_t} t</div>
          <div>DRP: {rec.drp_tripped ? 'TRIPPED (halted)' : 'discharging'}</div>
        </div>
      </div>
      <div id="panel">
        <h1>SteelX — Slice 3 (DRI buffer: fill &amp; starvation)</h1>

        <h2>Scenario mode (fixture pair)</h2>
        <div className="row">
          <button className={mode === 'starve' ? 'danger' : ''} onClick={() => { setMode('starve'); setIdx(0); setRunning(false); }}>Starvation (demand &gt; supply)</button>
          <button className={mode === 'fill' ? 'primary' : ''} onClick={() => { setMode('fill'); setIdx(0); setRunning(false); }}>Fill (supply &gt; demand)</button>
        </div>
        <div className="hint">{fixture.fixture_id} — heat_plan cadence {sc.eaf.heat_plan.length > 5 ? 10 : 20} ticks, same DRP parameters.</div>

        <div className="row">
          <button className="primary" onClick={() => setRunning(true)} disabled={running}>Start</button>
          <button onClick={() => setRunning(false)} disabled={!running}>Pause</button>
          <button onClick={() => { setIdx(0); setRunning(false); }}>Reset</button>
        </div>
        <div className="row">
          <button onClick={() => setIdx((i) => Math.min(i + 1, res.records.length - 1))} disabled={running}>Step +1</button>
        </div>

        <h2>Facility inspection</h2>
        <div className="stat"><span>Buffer level</span><b>{rec.buffer_t.toFixed(2)} t</b></div>
        <div className="bar">
          <div style={{ width: `${100 * Math.min(1, rec.buffer_t / sc.buffer.capacity_t)}%`, background: starvedNow ? '#d04545' : rec.flags.full ? '#d9a13f' : '#3f7fbf' }} />
        </div>
        <div className="stat"><span>Capacity</span><b>{sc.buffer.capacity_t} t</b></div>
        <div className="stat"><span>Fill threshold</span><b>{sc.buffer.fill_state_threshold_t} t</b></div>
        <div className="stat"><span>Starve threshold</span><b>{sc.buffer.starve_threshold_t} t</b></div>
        <div className="stat"><span>DRP discharge rate</span><b>{sc.drp.discharge_t_per_tick} t/tick</b></div>
        <div className="stat"><span>EAF charge size</span><b>{sc.eaf.charge_t} t</b></div>
        <div className="stat"><span>Discharged (cumulative)</span><b>{res.discharged_t.toFixed(1)} t</b></div>
        <div className="stat"><span>Refused at capacity (cumulative)</span><b>{res.refused_t.toFixed(1)} t</b></div>
        <div className="stat"><span>Taken by EAF (cumulative)</span><b>{res.taken_t.toFixed(1)} t</b></div>
        <div className="stat"><span>Balance residual @120</span><b>{balanceResidual(res).toFixed(6)}</b></div>

        <h2>Indicators</h2>
        <span className={`badge ${rec.drp_tripped ? 'on' : 'off'}`}>{rec.drp_tripped ? 'DRP tripped' : 'DRP running'}</span>
        <span className={`badge ${rec.flags.full ? 'on' : 'off'}`}>{rec.flags.full ? 'Buffer full state' : 'Below fill threshold'}</span>
        <span className={`badge ${rec.flags.blocked ? 'on' : 'off'}`}>{rec.flags.blocked ? 'Discharge refused' : 'Discharge accepted'}</span>
        <span className={`badge ${starvedNow ? 'on' : 'off'}`}>{starvedNow ? 'Buffer starved' : 'Buffer OK'}</span>

        <h2>Heats (fixture parity)</h2>
        {Object.entries(summary.heats).map(([hid, [st, cause]]) => (
          <div className="stat" key={hid}><span>{hid}</span><b style={{ color: st === 'charged' ? '#3fd97a' : '#e07070' }}>{st}{cause ? ` (${cause})` : ''}</b></div>
        ))}
        <div className="stat"><span>win</span><b>{String(summary.win)}</b></div>

        <h2>Trip ticks (fixture)</h2>
        <div className="hint">trips fired: {summary.trip_fired_ticks.join(', ')} · skipped heats: {summary.starve_ticks.join(', ') || 'none'}</div>

        <h2>Event log</h2>
        <div className="eventlog">
          {events.map((e, i) => <div key={i}>tick {e.tick}: {e.event}</div>)}
        </div>

        <h2>Learning panel</h2>
        <div className="learn">
          {bottleneck}
          <br /><br />
          Operational consequence: the buffer decouples continuous DRP supply from discrete EAF batches. When demand outruns supply, heats get skipped with cause-attribution (buffer_starved) — never partially consumed. When supply outruns demand, the buffer saturates and discharges are refused at capacity (blocked), never silently dropped. The same plant, two failure modes.
        </div>
      </div>
    </>
  );
}

rd.createRoot(document.getElementById('root')!).render(<App />);
