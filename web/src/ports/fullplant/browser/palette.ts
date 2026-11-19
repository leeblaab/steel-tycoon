// S0.4 visual constants (PLAN_FORGED §2 — the approved palette as DATA, one module).
// Stream colors are the PRIMARY grammar everywhere: ground strips, belts, tokens, UI,
// cards. Zone tints are DEMOTED to secondary pad color only (they no longer name an area's
// identity — the stream running through it does).
export const STREAM = {
  scrap: '#8a5a3c',        // rust orange-brown
  ore: '#6e3b2e',          // dark red-brown (pellets)
  dri: '#9aa3ad',          // silver-gray (DRI/HBI)
  hot_metal: '#ff9a3c',    // incandescent — emissive
  slag: '#4a4f45',         // dark gray-green
  billet_hot: '#ff7a1f',   // fades to steel blue-gray as it cools
  rebar: '#5b7c99',        // steel blue (straight strapped bundles)
  wire_rod: '#7d9cc0',     // lighter blue (coils)
  water: '#3fa8a0',        // utilities teal
  gas: '#d9c14a',          // yellow
  oxygen: '#9fc6e8',       // light blue
} as const;

/** Zone PAD tints — secondary layer only (F-05: zone rainbow demoted). Muted steel-toned
 *  pads so stream strips and equipment read first. */
export const ZONE_PAD: Record<string, string> = {
  slice1: '#2a3a46',
  slice2: '#33404c',
  slice3: '#3a4048',
  slice4: '#41414a',
  slice5: '#39434f',
};

/** Fixed golden-hour lighting rig (PLAN_FORGED §2 — NO day/night, NO DOF). */
export const LIGHTING = {
  sun_color: '#ffd9a6',      // warm sun
  sun_dir: [28, 20, 14] as [number, number, number], // ~35° elevation, long shadows
  sun_intensity: 2.2,
  sky_color: '#7ea6c8',      // hemisphere fill: sky-blue top / rust bounce bottom
  ground_bounce: '#5a4636',
  hemi_intensity: 0.55,
  fog_color: '#1d2733',      // steel-blue distance fog
  fog_near: 55,
  fog_far: 150,
  ground_color: '#232d38',   // continuous plant floor (fog-matched, not pure black)
} as const;

/** State grammar on every machine (F-05): idle desaturated / running stream-emissive /
 *  blocked-starved amber ring. */
export const STATE = {
  blocked_ring: '#ffb347', // amber warning
  rim_sel: '#59e6a0',
} as const;
