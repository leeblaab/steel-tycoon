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
      // Screen-relative pan: dx moves content WITH the finger (grab-the-ground feel), dy
      // moves forward/back along the view's ground direction. Yasser round-2 observation 1:
      // left arrow must move the VIEW left — i.e. camera + target translate along -screenX,
      // so the scene slides right and what was at the left edge centers. (The old sign came
      // from touch "drag the world" semantics, which read inverted on arrow keys.)
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      right.y = 0; right.normalize(); // ground-plane screen-right
      const fwd = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), right).normalize(); // ground "into the screen"
      const k = st.current.dist * Math.tan((((camera as any).fov ?? 45) * Math.PI) / 360) * 2 / (canvas.clientHeight || 1);
      tgt.current.addScaledVector(right, -dx * k);
      tgt.current.addScaledVector(fwd, dy * k);
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

    // Arrow navigation (Yasser round-2 general observation): arrow keys pan the view along
    // its own ground axes; WASD too. PageUp/PageDown and +/- zoom from the keyboard as well.
    const held = new Set<string>();
    let raf = 0;
    const stepPan = () => {
      let dx = 0, dy = 0;
      if (held.has('arrowleft') || held.has('a')) dx -= 14;
      if (held.has('arrowright') || held.has('d')) dx += 14;
      if (held.has('arrowup') || held.has('w')) dy += 14;
      if (held.has('arrowdown') || held.has('s')) dy -= 14;
      if (dx || dy) { panBy(dx, dy); apply(); }
    };
    const loop = () => { stepPan(); raf = held.size ? requestAnimationFrame(loop) : 0; };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault(); // no page scroll
      if (k === 'pageup' || k === '+' || k === '=') { st.current.dist = Math.max(home.minDist, st.current.dist * 0.92); apply(); return; }
      if (k === 'pagedown' || k === '-') { st.current.dist = Math.min(home.maxDist, st.current.dist * 1.08); apply(); return; }
      if (!held.has(k)) { held.add(k); if (!raf) raf = requestAnimationFrame(loop); }
    };
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    (window as any).__steelxResetView = () => { st.current = { az: (home.azDeg * Math.PI) / 180, el: (Math.min(75, Math.max(15, home.elDeg)) * Math.PI) / 180, dist: home.dist }; tgt.current.set(...home.target); apply(); };
    (window as any).__steelxPan = (dx: number, dy: number) => { panBy(dx, dy); apply(); }; // on-screen nav arrows route through the same pan
    (window as any).__steelxSetView = (azDeg: number, elDeg: number, dist: number) => { st.current.az = (azDeg * Math.PI) / 180; st.current.el = (Math.min(75, Math.max(15, elDeg)) * Math.PI) / 180; st.current.dist = Math.min(home.maxDist, Math.max(home.minDist, dist)); apply(); }; // S0.4 camera presets + probe framing
    (window as any).__steelxSetTarget = (x: number, y: number, z: number) => { tgt.current.set(x, y, z); apply(); }; // preset look-at for zone/machine framing
    return () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContext);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        if (raf) cancelAnimationFrame(raf);
        delete (window as any).__steelxResetView;
        delete (window as any).__steelxPan;
    };
  }, [camera, gl, home]);

  return null;
}

// DOM button OUTSIDE <Canvas> — plain React only, calls the reset published by ViewCamera.
export function ResetViewButton() {
  return (
    <div id="viewctl">
      <button onClick={() => (window as any).__steelxResetView?.()}>⟲ Reset view</button>
      <span className="hint">drag orbit · wheel/pinch zoom · right-drag or 2-finger pan · arrows/WASD move</span>
    </div>
  );
}

// On-screen navigation arrows (Yasser round-2 general observation: rotate/zoom existed,
// panning needed a discoverable control). DOM pad outside <Canvas>, plain React; each press
// routes through __steelxPan (the same panBy path as right-drag), so it works with touch.
export function ViewNavButtons() {
  const pan = (dx: number, dy: number) => (window as any).__steelxPan?.(dx, dy);
  const hold = (dx: number, dy: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    pan(dx, dy);
    const id = window.setInterval(() => pan(dx, dy), 140); // hold-to-repeat
    const stop = () => { clearInterval(id); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  return (
    <div id="viewnav" aria-label="pan the view">
      <button className="vn vn-up" onPointerDown={hold(0, 26)} aria-label="pan forward">▲</button>
      <button className="vn vn-left" onPointerDown={hold(-26, 0)} aria-label="pan left">◀</button>
      <button className="vn vn-right" onPointerDown={hold(26, 0)} aria-label="pan right">▶</button>
      <button className="vn vn-down" onPointerDown={hold(0, -26)} aria-label="pan back">▼</button>
    </div>
  );
}
