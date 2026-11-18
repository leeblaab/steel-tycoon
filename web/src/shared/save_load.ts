// Save/load v1 (Roadmap V3 §13 Phase 1 mark: minimal versioned snapshot).
// Schema rationale: docs/save_load_v1_schema.md. Whole-state snapshots — every hub slice
// state is JSON-plain and carries its PRNG word inside (slice3 `prng_state`), so restore
// is verbatim and continuation is deterministic. Reject-never-default on versions, same
// rule as configs.

import { QUESTS_SCHEMA_VERSION, type QuestProgressMap } from './quest_tracker.ts';

export const SAVE_FORMAT = 'steelx-save';
export const SAVE_FORMAT_VERSION = 1;
export const SNAPSHOT_SCHEMA_VERSION = 1;

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

/** Read the save file envelope; a corrupt/foreign file is rejected, never defaulted. */
export function readSaveFile(storage: SaveStorage): SaveFile {
  const raw = storage.read(SAVE_FILE_KEY);
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
}

/** Load slot `slot` and return the state to resume from, after integrity checks. */
export function loadSave(storage: SaveStorage, slot: string, ctx: LoadContext): GameSave {
  const file = readSaveFile(storage);
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
