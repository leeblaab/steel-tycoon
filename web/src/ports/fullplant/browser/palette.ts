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

/** Fixed golden-hour lighting rig (PLAN_FORGED §2 — NO day/night, NO DOF).
 *  S0.4 visual pass v2 (headless pixel stats: mean RGB ~29,37,47 = cool/dark; camera home
 *  dist ~68 > fog_far 150 blended most geometry toward fog color):
 *  - fog pushed past the widest home framing (near 110 / far 280) so distance fades only
 *    at true horizon, not across the whole plant;
 *  - sun swung to camera-front-right (-36, 24, 52): lights faces visible from the az-0
 *    home cam AND throws long shadows away from camera (sun_dir is light POSITION in three);
 *  - warmer + brighter floor albedo so the diorama base reads instead of going black. */
export const LIGHTING = {
  sun_color: '#ffe2b8',      // warm sun (less orange after ACES desaturation)
  sun_dir: [-30, 42, 60] as [number, number, number], // ~35° elevation per plan, but lifted so long shadows still land inside the ±60 shadow frustum (SME pass 19.11: v2 dir [-36,24,52] put most shadows outside the map → sun looked ambient)
  sun_intensity: 3.2,
  sky_color: '#a8c4de',      // hemisphere fill: brighter sky dome (was too dim for ACES)
  ground_bounce: '#7a5f4b',
  hemi_intensity: 1.1,
  fog_color: '#3d4a58',      // steel-blue distance fog — lighter so fogged far pads read as haze, not void
  fog_near: 120,
  fog_far: 300,
  ground_color: '#5a5b56',   // continuous plant floor — mid concrete; ACES was crushing the darker value near-black
} as const;

/** State grammar on every machine (F-05): idle desaturated / running stream-emissive /
 *  blocked-starved amber ring. */
export const STATE = {
  blocked_ring: '#ffb347', // amber warning
  rim_sel: '#59e6a0',
} as const;
