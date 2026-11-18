// SteelX shared interactive camera (visual-feedback phase, 21.10).
// Agreed controls: 360° orbit + zoom + pan (left/right/up/down), elevation clamped
// 15–75° per the Phase-2 framing contract, distance clamped to a per-slice range.
// Mouse: left-drag orbit, right-drag pan, wheel zoom. Touch: 1-finger orbit,
// 2-finger pinch zoom + 2-finger drag pan (mobile tycoon target).
// Camera mutation happens INSIDE <Canvas> (ViewCamera); DOM labels keep projecting
// through the existing LabelCameraBridge pattern — no R3F hooks outside Canvas.
import * as React from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
const { useEffect, useRef } = React;

export interface ViewHome {
  target: [number, number, number]; // default look-at
  azDeg: number;                    // default azimuth
  elDeg: number;                    // default elevation (15–75)
  dist: number;                     // default distance (fit-to-frame value from the slice)
  minDist: number;                  // zoom-in clamp
  maxDist: number;                  // zoom-out clamp
}

export function ViewCamera({ home }: { home: ViewHome }) {
  const { camera, gl } = useThree();
  const st = useRef({ az: (home.azDeg * Math.PI) / 180, el: (Math.min(75, Math.max(15, home.elDeg)) * Math.PI) / 180, dist: home.dist });
  const tgt = useRef(new THREE.Vector3(...home.target));

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.style.touchAction = 'none'; // own the touch gestures on the scene
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist0 = 0, pinchEl0 = 0, pinchAz0 = 0, pinchDistCam0 = 0;

    const apply = () => {
      const s = st.current;
      camera.position.set(
        tgt.current.x + s.dist * Math.cos(s.el) * Math.sin(s.az),
        tgt.current.y + s.dist * Math.sin(s.el),
        tgt.current.z + s.dist * Math.cos(s.el) * Math.cos(s.az),
      );
      camera.lookAt(tgt.current);
    };
    apply();

    const panBy = (dx: number, dy: number) => {
      // screen-relative pan: left/right along camera right, up/down in the view plane
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      const k = st.current.dist * Math.tan((((camera as any).fov ?? 45) * Math.PI) / 360) * 2 / (canvas.clientHeight || 1);
      tgt.current.addScaledVector(right, -dx * k);
      tgt.current.addScaledVector(up, dy * k);
      tgt.current.y = Math.max(0.2, Math.min(8, tgt.current.y)); // keep the plant in frame
    };

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y);
        pinchAz0 = st.current.az; pinchEl0 = st.current.el; pinchDistCam0 = st.current.dist;
      }
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId)!;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        if (e.button === 2 || e.shiftKey) panBy(dx, dy); // right-drag / shift-drag = movement
        else { st.current.az -= dx * 0.006; st.current.el = Math.min(75 * Math.PI / 180, Math.max(15 * Math.PI / 180, st.current.el + dy * 0.006)); }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist0 > 0) {
          st.current.dist = Math.min(home.maxDist, Math.max(home.minDist, pinchDistCam0 * (pinchDist0 / Math.max(d, 1)))); // pinch = zoom
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          void mx; void my;
          panBy((e.clientX - prev.x), (e.clientY - prev.y)); // 2-finger drag = pan
        }
      }
      apply();
    };
    const onPointerUp = (e: PointerEvent) => { pointers.delete(e.pointerId); pinchDist0 = 0; };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      st.current.dist = Math.min(home.maxDist, Math.max(home.minDist, st.current.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      apply();
    };
    const onContext = (e: Event) => e.preventDefault(); // suppress menu for right-drag pan

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    (window as any).__steelxResetView = () => { st.current = { az: (home.azDeg * Math.PI) / 180, el: (Math.min(75, Math.max(15, home.elDeg)) * Math.PI) / 180, dist: home.dist }; tgt.current.set(...home.target); apply(); };
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      delete (window as any).__steelxResetView;
    };
  }, [camera, gl, home]);

  return null;
}

// DOM button OUTSIDE <Canvas> — plain React only, calls the reset published by ViewCamera.
export function ResetViewButton() {
  return (
    <div id="viewctl">
      <button onClick={() => (window as any).__steelxResetView?.()}>⟲ Reset view</button>
      <span className="hint">drag orbit · wheel/pinch zoom · right-drag or 2-finger pan</span>
    </div>
  );
}
