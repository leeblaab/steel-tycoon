// Patch probe: expose R3F's internal state on window for testability (probe-only hook).
import { useThree } from '@react-three/fiber';

export function DebugBridge() {
  const state = useThree();
  if (typeof window !== 'undefined') {
    (window as any).__r3f = { invalidate: state.invalidate, camera: state.camera, size: state.size };
    (window as any).__r3f_events_connected = state.events.connected?.tagName ?? null;
    (window as any).__r3f_interaction_count = () => state.internal.interaction.length;
    (window as any).__r3f_interaction_names = () => state.internal.interaction.map((o: any) => o.name ?? o.type);
    (window as any).__r3f_scene = state.scene;
    (window as any).__r3f_interaction = () => state.internal.interaction;
  }
  return null;
}
