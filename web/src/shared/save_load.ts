// Save/load v1 (Roadmap V3 §13 Phase 1 mark: minimal versioned snapshot).
// Schema rationale: docs/save_load_v1_schema.md. Whole-state snapshots — every hub slice
// state is JSON-plain and carries its PRNG word inside (slice3 `prng_state`), so restore
// is verbatim and continuation is deterministic. Reject-never-default on versions, same
// rule as configs.
//
// v2 (S0.5): adds an optional `slices` map — per-slice state + rng capture — for the
// multi-slice fullplant port, plus an optional `onboarding` block so a resumed campaign
// does not replay onboarding. The top-level state/rng_state stay as the primary-slice
// mirror; hub call sites keep working unchanged. Fullplant writes under its OWN file key
// (FULLPLANT_SAVE_FILE_KEY) — both ports use slice_id 'slice1', so they must never share
// one localStorage key.

import { QUESTS_SCHEMA_VERSION, type QuestProgressMap } from './quest_tracker.ts';

export const SAVE_FORMAT = 'steelx-save';
export const SAVE_FORMAT_VERSION = 1;
export const SNAPSHOT_SCHEMA_VERSION = 2; // v2: slices map + onboarding block (S0.5)

export interface RngCapture {
  /** xorshift32 word when the slice runs a generator (slice3); null when it doesn't. */
  word: number | null;
}

export interface GameSave {
  schema_version: number; // SNAPSHOT_SCHEMA_VERSION; loader rejects mismatches
  saved_at: string; // ISO timestamp, display only
  slice_id: string; // catalog entry this resume belongs to
  tick: number; // cross-checked against state.tick on load
  rng_state: RngCapture; // explicit RNG capture mirroring the Python dump_prng_state model
  state: unknown; // full sim state, verbatim
  /** Phase 2 persistence coverage (§13 mark): quest progress rides the snapshot so a
   *  loaded campaign continues with completed/active quests intact. Optional — saves
   *  written before Phase 2 simply lack it and load as null (no quest restore). */
  quest_progress?: QuestProgressMap | null;
  /** Content schema the quest_progress was authored against (reject-never-default). */
  quests_schema_version?: number | null;
  /** Phase 2 persistence coverage (§13 mark): construction snapshot — SlotLifecycle[]
   *  from shared/construction.ts — rides the snapshot so ghost-slot build progress
   *  survives a save/load. Optional: pre-Phase-2 saves lack it and load as null. */
  construction?: unknown[] | null;
  /** Phase 2 persistence coverage (§13 mark): route connections — RouteConnection[]
   *  from shared/route_ledger.ts — ride the snapshot so player-built routes survive a
   *  save/load. Optional: pre-Phase-2 saves lack it and load as null. */
  routes?: unknown[] | null;
  /** Phase 2 persistence coverage (Step B): Decide-verb log (DecisionRow[] from
   *  ports/slice1/slice1_decide.ts) rides the snapshot so the player's decision
   *  history survives a save/load round-trip. Absent = null (pre-Step-B saves). */
  decisions?: unknown[] | null;
  /** S0.5 (v2): per-slice snapshots for multi-slice ports (fullplant). Each entry is
   *  that slice's full state plus its own rng capture. Absent on hub saves — the
   *  top-level state/rng_state then stand alone. When present, slices[slice_id] must
   *  mirror the top level. */
  slices?: Record<string, SliceSnapshot>;
  /** S0.5 (v2): fullplant onboarding progress so a resumed campaign does not replay the
   *  guided sequence. Absent = fresh onboarding; present-but-malformed = rejected. */
  onboarding?: OnboardingSnapshot;
  /** S1.2 (PLAN_FORGED): ore-belt chain carried by fullplant saves. Absent = no belt
   *  built yet (pre-S1.2 saves load fresh); present-but-malformed or ledger-open = reject.
   *  Shape-checked in session.ts (validateOreBeltBlock) because the closure gate needs the
   *  registry primitives, which save_load must not import. */
  ore_belt?: { state: Record<string, unknown>; deposits_total: number };
}

/** One slice's snapshot inside a multi-slice save (S0.5). Sim states are immutable per
 *  tick (every tick returns a fresh deepClone), so the snapshot may hold a reference. */
export interface SliceSnapshot {
  state: Record<string, unknown>;
  rng_state: RngCapture; // cross-check of the word inside `state`
}

/** Fullplant onboarding block (S0.5). index === -1 means the guided sequence is done —
 *  a resumed campaign drops straight into free play. `built` records which steps were
 *  completed by building (onboardingComplete's gate reads it). */
export interface OnboardingSnapshot {
  index: number; // current step in the sequence, -1 = done
  built: string[]; // ids of steps completed by building
  clockRunning: boolean;
  questProgressSnapshot: QuestProgressMap | null; // authored against QUESTS_SCHEMA_VERSION
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  format_version: number;
  saves: Record<string, GameSave>;
}

/** Storage behind an interface so tests (and later mobile) swap implementations. */
export interface SaveStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export class MemorySaveStorage implements SaveStorage {
  private data = new Map<string, string>();
  read(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  write(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

export class LocalStorageSaveStorage implements SaveStorage {
  constructor(private readonly ls: Storage) {}
  read(key: string): string | null {
    return this.ls.getItem(key);
  }
  write(key: string, value: string): void {
    this.ls.setItem(key, value);
  }
  remove(key: string): void {
    this.ls.removeItem(key);
  }
}

// The save-file envelope key in localStorage. NOTE: must NOT be written with an
// escaped-quote form like `'steelx-save'` — the bundler's quote optimization turns
// that into a backtick template literal, and a backtick inside single quotes is a
// literal character: `SAVE_FILE_KEY` becomes '***' at runtime (Phase 2 bug hunt,
// 2026-10-20: dist bundle showed `xn=`steelx-save`` for the format constant but a
// literal '***' inlined at the read/write call sites). Plain quotes only here.
export const SAVE_FILE_KEY = 'steelx-save';

// Fullplant autosave file key (S0.5). The hub and the fullplant port BOTH use slice_id
// 'slice1' as their primary — sharing one localStorage key would let a hub save be
// resumed by the fullplant boot (and vice versa) with the wrong engine semantics. Same
// plain-quote rule as SAVE_FILE_KEY above (bundler quote-optimization bug, 2026-10-20).
export const FULLPLANT_SAVE_FILE_KEY = 'steelx-fullplant-save';

function emptyFile(): SaveFile {
  return { format: SAVE_FORMAT, format_version: SAVE_FORMAT_VERSION, saves: {} };
}

/** Pull the generator word out of a hub state. slice3 keeps `prng_state`; slice1's ops
 *  engine keeps the same canonical xorshift32 word as `generator_state` (ops_domain3);
 *  slice4/5 have no generator. First non-null match wins; both names must never coexist. */
export function captureRng(state: any): RngCapture {
  const w = typeof state?.prng_state === 'number' ? state.prng_state
    : typeof state?.generator_state === 'number' ? state.generator_state
    : null;
  return { word: w };
}

/** Read the save-file envelope at `key`; a corrupt/foreign file is rejected, never
 *  defaulted. Defaults to the hub key so existing call sites are unchanged. */
export function readSaveFileAt(storage: SaveStorage, key: string = SAVE_FILE_KEY): SaveFile {
  const raw = storage.read(key);
  if (raw === null) return emptyFile();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('save file is not valid JSON');
  }
  if (parsed?.format !== SAVE_FORMAT) throw new Error(`foreign save file format: ${parsed?.format}`);
  if (parsed.format_version !== SAVE_FORMAT_VERSION) {
    throw new Error(`unsupported save format_version ${parsed.format_version} (this build reads ${SAVE_FORMAT_VERSION})`);
  }
  return parsed as SaveFile;
}

/** Read the save file envelope; a corrupt/foreign file is rejected, never defaulted. */
export function readSaveFile(storage: SaveStorage): SaveFile {
  return readSaveFileAt(storage, SAVE_FILE_KEY);
}

/** Snapshot the current loop state into slot `slot`, preserving other slots.
 *  `questProgress` (Phase 2 coverage) rides the snapshot when supplied. */
export function writeSave(
  storage: SaveStorage,
  slot: string,
  sliceId: string,
  state: any,
  questProgress?: QuestProgressMap | null,
  construction?: unknown[] | null,
  routes?: unknown[] | null,
  decisions?: unknown[] | null,
): GameSave {
  const file = readSaveFile(storage);
  const save: GameSave = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    saved_at: new Date().toISOString(),
    slice_id: sliceId,
    tick: state.tick,
    rng_state: captureRng(state),
    state,
    quest_progress: questProgress ?? null,
    quests_schema_version: questProgress ? QUESTS_SCHEMA_VERSION : null,
    construction: construction ?? null,
    routes: routes ?? null,
    decisions: decisions ?? null,
  };
  file.saves[slot] = save;
  storage.write(SAVE_FILE_KEY, JSON.stringify(file));
  return save;
}

/** Fullplant autosave (S0.5): writes the multi-slice map under FULLPLANT_SAVE_FILE_KEY
 *  so a hub slot and a fullplant slot can never collide (both ports use slice_id
 *  'slice1'). The top-level state/rng_state/tick mirror slices[slice1] for v1-shape
 *  readers; quest progress rides the standard quest_progress field. */
export function writeFullplantSave(
  storage: SaveStorage,
  slot: string,
  slices: Record<string, SliceSnapshot>,
  opts?: {
    questProgress?: QuestProgressMap | null;
    onboarding?: OnboardingSnapshot | null;
    oreBelt?: { state: Record<string, unknown>; deposits_total: number } | null;
  },
): GameSave {
  const primary = slices['slice1'];
  if (!primary) throw new Error('writeFullplantSave needs a slice1 snapshot (the mirror)');
  const save: GameSave = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    saved_at: new Date().toISOString(),
    slice_id: 'slice1',
    tick: (primary.state as any).tick,
    rng_state: primary.rng_state,
    state: primary.state, // mirror of slices.slice1
    quest_progress: opts?.questProgress ?? null,
    quests_schema_version: opts?.questProgress ? QUESTS_SCHEMA_VERSION : null,
    slices,
  };
  if (opts?.onboarding) save.onboarding = opts.onboarding;
  if (opts?.oreBelt) save.ore_belt = opts.oreBelt; // S1.2 belt chain (absent = no belt built)
  const file = readSaveFileAt(storage, FULLPLANT_SAVE_FILE_KEY);
  file.saves[slot] = save;
  storage.write(FULLPLANT_SAVE_FILE_KEY, JSON.stringify(file));
  return save;
}

export function listSaves(storage: SaveStorage): Array<{ slot: string; save: GameSave }> {
  const file = readSaveFile(storage);
  return Object.entries(file.saves)
    .map(([slot, save]) => ({ slot, save }))
    .sort((a, b) => a.save.saved_at.localeCompare(b.save.saved_at));
}

export function deleteSave(storage: SaveStorage, slot: string): void {
  const file = readSaveFile(storage);
  if (!(slot in file.saves)) throw new Error(`no save in slot '${slot}'`);
  delete file.saves[slot];
  storage.write(SAVE_FILE_KEY, JSON.stringify(file));
}

export interface LoadContext {
  /** slice_ids the hub catalog knows about. */
  knownSliceIds: string[];
  /** Optional ledger gate: a save whose state fails the registry check is rejected. */
  validate?: (sliceId: string, state: any) => void;
  /** S0.5: onboarding sequence step ids — required to accept an `onboarding` block
   *  (index bounds are checked against the sequence). Absent + block present = reject. */
  seqSteps?: readonly string[];
}

/** Load slot `slot` and return the state to resume from, after integrity checks. */
export function loadSave(storage: SaveStorage, slot: string, ctx: LoadContext): GameSave {
  return loadSaveFrom(readSaveFile(storage), slot, ctx);
}

/** Fullplant boot restore (S0.5): same checks as loadSave, against the fullplant key. */
export function loadFullplantSave(storage: SaveStorage, slot: string, ctx: LoadContext): GameSave {
  return loadSaveFrom(readSaveFileAt(storage, FULLPLANT_SAVE_FILE_KEY), slot, ctx);
}

function innerRngWord(state: any): number | null {
  return typeof state.prng_state === 'number' ? state.prng_state
    : typeof state.generator_state === 'number' ? state.generator_state
    : null;
}

/** S0.5 v2 slices-map gate: each entry needs a state object with a valid tick and an
 *  rng capture that agrees with the word inside that state (prng_state / generator_state
 *  — slice1 ops vs slice3 xorshift; slice4/5 null). Reject-never-default. */
function validateSlicesMap(slices: unknown, knownSliceIds: readonly string[]): Record<string, SliceSnapshot> {
  if (typeof slices !== 'object' || slices === null || Array.isArray(slices)) {
    throw new Error('save slices must be an object keyed by slice id');
  }
  const out: Record<string, SliceSnapshot> = {};
  for (const [id, snap] of Object.entries(slices as Record<string, unknown>)) {
    if (!knownSliceIds.includes(id)) throw new Error(`save slices map references unknown slice '${id}'`);
    if (!snap || typeof snap !== 'object') throw new Error(`save slices['${id}'] is not an object`);
    const s = snap as Record<string, unknown>;
    const st = s.state as any;
    if (!st || typeof st !== 'object' || typeof st.tick !== 'number') {
      throw new Error(`save slices['${id}'] state is missing its tick — not a valid snapshot`);
    }
    const rng = s.rng_state as RngCapture | undefined;
    if (!rng || typeof rng !== 'object' || !('word' in rng)) {
      throw new Error(`save slices['${id}'] has no rng_state capture`);
    }
    const inner = innerRngWord(st);
    if (rng.word !== inner) {
      throw new Error(`save slices['${id}'] rng capture ${rng.word} disagrees with state generator ${inner}`);
    }
    out[id] = { state: st, rng_state: { word: inner } };
  }
  return out;
}

/** S0.5 onboarding block gate (reject-never-default): absent = fresh onboarding, but a
 *  present-but-malformed block is rejected outright. index -1 = done; otherwise it must
 *  sit inside the sequence. built = unique non-empty step ids. */
function validateOnboardingBlock(ob: unknown, seqSteps: readonly string[]): OnboardingSnapshot {
  if (!ob || typeof ob !== 'object') throw new Error('save onboarding block is not an object');
  const o = ob as Record<string, unknown>;
  if (typeof o.index !== 'number' || !Number.isInteger(o.index)) {
    throw new Error('save onboarding.index must be an integer');
  }
  if (!(o.index === -1 || (o.index >= 0 && o.index < seqSteps.length))) {
    throw new Error(`save onboarding.index ${o.index} outside the sequence (0..${seqSteps.length - 1}, or -1 = done)`);
  }
  if (!Array.isArray(o.built) || !o.built.every((b) => typeof b === 'string' && b.length > 0)) {
    throw new Error('save onboarding.built must be an array of non-empty strings');
  }
  const built = [...new Set(o.built as string[])];
  if (typeof o.clockRunning !== 'boolean') throw new Error('save onboarding.clockRunning must be a boolean');
  let qps: QuestProgressMap | null = null;
  if (o.questProgressSnapshot != null) {
    if (typeof o.questProgressSnapshot !== 'object' || Array.isArray(o.questProgressSnapshot)) {
      throw new Error('save onboarding.questProgressSnapshot must be an object or null');
    }
    qps = o.questProgressSnapshot as QuestProgressMap;
  }
  return { index: o.index, built, clockRunning: o.clockRunning, questProgressSnapshot: qps };
}

function loadSaveFrom(file: SaveFile, slot: string, ctx: LoadContext): GameSave {
  const save = file.saves[slot];
  if (!save) throw new Error(`no save in slot '${slot}'`);
  if (save.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`unsupported snapshot schema_version ${save.schema_version} (this build reads ${SNAPSHOT_SCHEMA_VERSION})`);
  }
  if (!ctx.knownSliceIds.includes(save.slice_id)) {
    throw new Error(`save references unknown slice '${save.slice_id}'`);
  }
  const state: any = save.state;
  if (state === null || typeof state !== 'object' || typeof state.tick !== 'number') {
    throw new Error('save state is missing its tick — not a valid snapshot');
  }
  if (state.tick !== save.tick) {
    throw new Error(`save tick ${save.tick} disagrees with state.tick ${state.tick}`);
  }
  // RNG capture must agree with the generator word inside the state.
  const inner = typeof state.prng_state === 'number' ? state.prng_state
    : typeof state.generator_state === 'number' ? state.generator_state
    : null;
  if (save.rng_state?.word !== inner) {
    throw new Error(`rng capture ${save.rng_state?.word} disagrees with state generator ${inner}`);
  }
  // S0.5 v2: a multi-slice save carries per-slice snapshots; the primary slice's entry
  // must mirror the top level (same tick), and every entry passes its own rng gate.
  if (save.slices !== undefined && save.slices !== null) {
    const slices = validateSlicesMap(save.slices, ctx.knownSliceIds);
    const mirror = slices[save.slice_id];
    if (!mirror) throw new Error(`save slices map is missing its primary slice '${save.slice_id}'`);
    if ((mirror.state as any).tick !== save.tick) {
      throw new Error(`save tick ${save.tick} disagrees with slices['${save.slice_id}'].state.tick ${(mirror.state as any).tick}`);
    }
    save.slices = slices;
  }
  // S0.5 v2: onboarding block — absent = fresh onboarding, present-but-malformed = reject.
  if (save.onboarding !== undefined && save.onboarding !== null) {
    if (!ctx.seqSteps) throw new Error('save carries an onboarding block but the loader supplied no seqSteps');
    save.onboarding = validateOnboardingBlock(save.onboarding, ctx.seqSteps);
  }
  // S1.2 v2: ore-belt block — absent = no belt built; present must at least have the right
  // shape (the full ledger gate re-runs in session.validateOreBeltBlock on restore).
  if (save.ore_belt !== undefined && save.ore_belt !== null) {
    const ob = save.ore_belt as Record<string, unknown>;
    if (typeof ob !== 'object' || Array.isArray(ob)) throw new Error('save ore_belt block is not an object');
    if (!ob.state || typeof ob.state !== 'object') throw new Error('save ore_belt.state must be an object');
    if (typeof ob.deposits_total !== 'number' || !Number.isFinite(ob.deposits_total)) {
      throw new Error('save ore_belt.deposits_total must be a finite number');
    }
  }
  // Quest progress coverage (Phase 2): a carried map must carry its content schema and
  // well-formed rows; a pre-Phase-2 save without the field loads as null (no restore).
  if (save.quest_progress != null) {
    if (save.quests_schema_version !== QUESTS_SCHEMA_VERSION) {
      throw new Error(`quest_progress authored against quests schema ${save.quests_schema_version} (this build reads ${QUESTS_SCHEMA_VERSION})`);
    }
    for (const [id, p] of Object.entries(save.quest_progress)) {
      if (!p || p.id !== id || !['locked', 'available', 'active', 'completed'].includes(p.status)) {
        throw new Error(`save quest_progress row '${id}' is malformed`);
      }
      // S0.5 hardening: window fields must be shape-valid when present, and an
      // open-window row (active/available) MUST carry them — a quest restored without
      // its baseline would evaluate cumulative deltas from tick-0 zeros and silently
      // complete on stale plant tonnage. A completed row may legally lack them.
      const r = p as any;
      if (r.window_baseline !== undefined && r.window_baseline !== null) {
        if (typeof r.window_baseline !== 'object' || Array.isArray(r.window_baseline) ||
            Object.values(r.window_baseline).some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
          throw new Error(`save quest_progress row '${id}' window_baseline is malformed`);
        }
      }
      if (r.window_open_tick !== undefined && r.window_open_tick !== null &&
          (typeof r.window_open_tick !== 'number' || !Number.isInteger(r.window_open_tick) || r.window_open_tick < 0)) {
        throw new Error(`save quest_progress row '${id}' window_open_tick is malformed`);
      }
      if ((r.status === 'active' || r.status === 'available') &&
          (r.window_baseline === undefined || r.window_open_tick === undefined)) {
        throw new Error(`save quest_progress row '${id}' (${r.status}) is missing its window fields — refusing to load`);
      }
    }
  }
  // Construction coverage (Phase 2): carried rows must be well-formed SlotLifecycle
  // entries (slot id + lifecycle status); a pre-Phase-2 save without the field loads
  // as null (fresh placement registration instead of restore).
  if (save.construction != null) {
    if (!Array.isArray(save.construction)) {
      throw new Error('save construction is not an array');
    }
    for (const row of save.construction) {
      const r = row as any;
      if (!r || typeof r.slot_id !== 'string' ||
          !['not_built', 'built_pending', 'operational'].includes(r.state)) {
        throw new Error('save construction row is malformed');
      }
    }
  }
  // Route coverage (Phase 2): carried rows must be well-formed connections (two node
  // ids + the tick the connect landed). Validation of WHAT a legal route is stays in
  // the shared validator (§2.1 — one implementation); this is shape integrity only.
  if (save.routes != null) {
    if (!Array.isArray(save.routes)) {
      throw new Error('save routes is not an array');
    }
    for (const row of save.routes) {
      const r = row as any;
      if (!r || typeof r.from !== 'string' || typeof r.to !== 'string' ||
          typeof r.connected_at_tick !== 'number') {
        throw new Error('save routes row is malformed');
      }
    }
  }
  // Decide-log coverage (Step B): carried rows must be well-formed DecisionRow entries
  // (tick + verb + target + ok + message). Verb semantics stay in the engine's decide_*
  // functions; this is shape integrity only. Absent = null (pre-Step-B saves).
  if (save.decisions != null) {
    if (!Array.isArray(save.decisions)) {
      throw new Error('save decisions is not an array');
    }
    const DECIDE_VERBS = ['stop', 'start', 'schedule_maintenance', 'cancel_maintenance', 'order_spare', 'overtime'];
    for (const row of save.decisions) {
      const r = row as any;
      if (!r || typeof r.tick !== 'number' || !DECIDE_VERBS.includes(r.verb) ||
          typeof r.target !== 'string' || typeof r.ok !== 'boolean' ||
          typeof r.message !== 'string') {
        throw new Error('save decisions row is malformed');
      }
    }
  }
  ctx.validate?.(save.slice_id, state);
  return save;
}
