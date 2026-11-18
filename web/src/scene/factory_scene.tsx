// SteelX factory scene — common plant view (Phase 1 build item d).
// One continuous scene, all slices visible as painted zones + slots; per-slice FOCUS mode:
// only the focused slice's sim ticks (hub already runs one loop at a time), neighbors are
// static dioramas. Interaction rule (decision 3): tap machine -> card; no hover-dependent
// UI, no tiny targets — R3F onClick is a touch event and ghost plates are large.
// Pitfall honored: every R3F hook lives INSIDE <Canvas> (LabelCameraBridge precedent).

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { DebugBridge } from './debug_bridge.tsx';
import type { FactoryLayout, SlotDef, ZoneDef } from '../shared/factory_layout.ts';
import { layoutFootprint, zoneCenter } from '../shared/factory_layout.ts';

export interface SceneSlotState {
  /** machine slots: live status from the focused sim's projection */
  busy?: boolean;
  waiting?: boolean;
  detail?: string; // one-line "doing now" text shown under the label
  ship_present?: boolean; // berth slot only (slice1): a real ship sits at this berth — drives the berthed-ship animation
}

const CAM = { current: null as THREE.Camera | null };

/** R3F hook — aims the default camera at the footprint center (inside <Canvas>). */
function CameraAim({ target }: { target: [number, number, number] }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateMatrixWorld();
  }, [camera, target[0], target[1], target[2]]);
  return null;
}

/** R3F hook — must stay inside <Canvas>. Publishes the camera for the DOM label overlay. */
function LabelCameraBridge() {
  const { camera } = useThree();
  CAM.current = camera;
  return null;
}

const LABELS: { id: string; text: string; detail?: string; world: [number, number, number] }[] = [];

function ZonePlate({ zone, focused }: { zone: ZoneDef; focused: boolean }) {
  const c = zoneCenter(zone);
  const w = zone.bounds.x[1] - zone.bounds.x[0];
  const d = zone.bounds.z[1] - zone.bounds.z[0];
  LABELS.push({ id: `zone-${zone.id}`, text: zone.label, world: [c.x, 0.4, zone.bounds.z[0] - 1.2] });
  return (
    <mesh position={[c.x, 0.01, c.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w, d]} />
      {/* painted flat-color zone; diorama zones dim toward the floor color */}
      <meshStandardMaterial color={zone.color} transparent opacity={focused ? 0.85 : 0.3} />
    </mesh>
  );
}

function FlowArrow({ from, to, label }: { from: ZoneDef; to: ZoneDef; label: string }) {
  const a = zoneCenter(from);
  const b = zoneCenter(to);
  const start = new THREE.Vector3(a.x + 2, 0.15, a.z);
  const end = new THREE.Vector3(b.x - 2, 0.15, b.z);
  const dir = end.clone().sub(start);
  const len = dir.length();
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const angle = Math.atan2(dir.z, dir.x);
  return (
    <group position={[mid.x, 0.15, mid.z]} rotation={[0, -angle, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.12, 0.12, len - 2.4, 6]} />
        <meshStandardMaterial color="#8fa3b8" transparent opacity={0.55} />
      </mesh>
      <mesh position={[(len - 2.4) / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.45, 1.2, 6]} />
        <meshStandardMaterial color="#8fa3b8" transparent opacity={0.75} />
      </mesh>
    </group>
  );
}

function MachineSlot({ slot, state, focused, onTap }: {
  slot: SlotDef; state: SceneSlotState | undefined; focused: boolean; onTap: (s: SlotDef) => void;
}) {
  const busy = focused && state?.busy;
  const waiting = focused && state?.waiting;
  const accent = busy ? '#ff7040' : waiting ? '#e8c47a' : '#5a6572';
  LABELS.push({ id: slot.id, text: slot.id, detail: focused ? state?.detail : undefined, world: [slot.position.x, 2.6, slot.position.z] });
  return (
    <group>
      {/* generous hit target (~3 units wide) for touch tap */}
      <mesh
        position={[slot.position.x, 1.1, slot.position.z]}
        onClick={(e) => { e.stopPropagation(); onTap(slot); }}
      >
        <boxGeometry args={[3, 2.2, 3]} />
        <meshStandardMaterial color={focused ? accent : '#39424e'} transparent opacity={focused ? 1 : 0.55} />
      </mesh>
      {/* Berth animation (Phase 2 'essential animations', gameplay checklist: "animation
          reflects actual simulation state"): a hull box appears at the berth ONLY when a
          real ship is berthed in sim state, and it bobs on the water — pure projection of
          st.berth_ships, no independent clock or invented content. */}
      {focused && state?.ship_present && (
        <HullAtBerth x={slot.position.x + 2.6} z={slot.position.z} blocked={waiting} />
      )}
    </group>
  );
}

function GhostSlot({ slot, onTap }: { slot: SlotDef; onTap: (s: SlotDef) => void }) {
  LABELS.push({ id: slot.id, text: `${slot.id} (not built)`, world: [slot.position.x, 1.4, slot.position.z] });
  return (
    <mesh
      position={[slot.position.x, 0.35, slot.position.z]}
      onClick={(e) => { e.stopPropagation(); onTap(slot); }}
    >
      <boxGeometry args={[3.2, 0.7, 3.2]} />
      {/* dashed-look ghost: low-opacity plate with visible outline via edges */}
      <meshStandardMaterial color="#c8d4e0" transparent opacity={0.22} />
    </mesh>
  );
}

function HullAtBerth({ x, z, blocked }: { x: number; z: number; blocked?: boolean }) {
  const groupRef = useRef<THREE.Group | null>(null);
  useFrame(({ clock, invalidate }) => {
    if (groupRef.current) groupRef.current.position.y = 0.35 + Math.sin(clock.elapsedTime * 1.6) * 0.08;
    invalidate(); // frameloop="demand": keep animating while a ship is berthed
  });
  return (
    <group ref={groupRef} position={[x, 0.35, z]}>
      <mesh>
        <boxGeometry args={[4.2, 1.1, 1.8]} />
        <meshStandardMaterial color={blocked ? '#e8c47a' : '#4f7fa8'} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[1.4, 0.7, 1.2]} />
        <meshStandardMaterial color="#c8d4e0" />
      </mesh>
    </group>
  );
}

/** DOM overlay labels — outside <Canvas>, reads the camera only via the bridge ref. */
function LabelLayer() {
  const [, setTick] = useState(0);
  useMemo(() => {
    if (typeof window !== 'undefined') {
      const id = window.setInterval(() => setTick((t) => t + 1), 150);
      return () => window.clearInterval(id);
    }
  }, []);
  const canvas = typeof document !== 'undefined' ? document.querySelector('#factory-scene canvas') as HTMLCanvasElement | null : null;
  const cam = CAM.current;
  if (!canvas || !cam) return null;
  const rect = canvas.getBoundingClientRect();
  const pts = LABELS.map((L) => {
    const v = new THREE.Vector3(...L.world).project(cam);
    return { id: L.id, text: L.text, detail: L.detail, x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
  });
  return (
    <div id="factory-labels" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {pts.map((p) => (
        <div key={p.id} style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%,-100%)', fontSize: 12, color: '#e6edf3', textShadow: '0 1px 2px #000' }}>
          {p.text}
          {p.detail ? <div style={{ fontSize: 11, color: '#b6c2cf' }}>{p.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function FactoryScene({ layout, focusSlice, slotStates, onTapSlot }: {
  layout: FactoryLayout;
  focusSlice: string;
  slotStates: Record<string, SceneSlotState>; // machine-slot live states (focused slice only)
  onTapSlot: (slot: SlotDef) => void;
}) {
  const fp = layoutFootprint(layout);
  const width = fp.x[1] - fp.x[0];
  const depth = fp.z[1] - fp.z[0];
  const cx = (fp.x[0] + fp.x[1]) / 2;
  const cz = (fp.z[0] + fp.z[1]) / 2;
  const zoneById = new Map(layout.zones.map((z) => [z.id, z]));

  // Fit-to-bounds camera: pick distance so the whole footprint fits the canvas box.
  // Measure the actual canvas box via ResizeObserver so fit math matches reality.
  const fov = 45;
  const halfFovRad = (fov / 2) * (Math.PI / 180);
  const [rect, setRect] = useState({ w: 960, h: 420 });
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = hostRef.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setRect({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);
  const aspect = rect.w / rect.h;
  // Binding constraint is the horizontal extent (long plant): half-width must fit hFov = vFov*aspect.
  // Camera aims at the footprint center so near/far edges project symmetrically inside the box.
  const hFit = width / 2 / (Math.tan(halfFovRad) * aspect);
  const dist = Math.max(hFit, depth / 2 / Math.tan(halfFovRad), 30) + 6;
  const aimY = 1.2;

  return (
    <div id="factory-scene" ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Fixed cinematic camera — free orbit is Phase 2 build mode (decision 1). */}
      <Canvas key={`${Math.round(rect.w)}x${Math.round(rect.h)}`} camera={{ position: [cx, aimY + dist * 0.62, cz + dist * 0.78], fov }} frameloop="demand">
        <CameraAim target={[cx, aimY, cz]} />
        <LabelCameraBridge />
        <DebugBridge />
        <ambientLight intensity={0.4} />
        <directionalLight position={[cx + 12, 30, cz + 18]} intensity={1.2} />
        {/* plant floor */}
        <mesh position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[width + 8, depth + 8]} />
          <meshStandardMaterial color="#17202a" />
        </mesh>
        {layout.zones.map((z) => (
          <ZonePlate key={z.id} zone={z} focused={z.slice === focusSlice} />
        ))}
        {layout.flow_links.map((fl, i) => {
          const from = zoneById.get(fl.from)!;
          const to = zoneById.get(fl.to)!;
          return <FlowArrow key={`flow-${i}`} from={from} to={to} label={fl.label} />;
        })}
        {layout.slots.map((s) =>
          s.kind === 'machine' ? (
            <MachineSlot key={s.id} slot={s} state={slotStates[s.id]} focused={zoneById.get(s.zone)!.slice === focusSlice} onTap={onTapSlot} />
          ) : (
            <GhostSlot key={s.id} slot={s} onTap={onTapSlot} />
          ),
        )}
      </Canvas>
      <LabelLayer />
    </div>
  );
}
