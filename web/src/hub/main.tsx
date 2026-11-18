// SteelX hub — single entry point hosting the authoritative tick loop over the shared
// parity ports (Roadmap V3 Phase 1, backlog item 5). Slice-selectable (slice3/4/5),
// rendered with the extracted shared UI modules, wired to the shared inventory registry.
// No 3D scene here: this is the integration spine; scenes wire in later per slice.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InventoryRegistry } from '../shared/inventory_registry.ts';
import { HubTickLoop } from './tickloop.ts';
import { buildCatalog, type CatalogEntry } from './catalog.ts';
import {
  LocalStorageSaveStorage,
  writeSave,
  loadSave,
  listSaves,
} from '../shared/save_load.ts';
import { useFixedTickLoop, useTransportCleanup } from '../ui/runloop.ts';
import { TransportControls } from '../ui/controls.tsx';
import { StatBar, StatRow, ProgressBar, Badge } from '../ui/hud.tsx';
import { EventLog, InfoCard } from '../ui/cards.tsx';
import { FactoryView } from '../scene/factory_view.tsx';
import { formatTons, formatNum, formatUsd } from '../ui/format.ts';
import { QuestTracker, loadLevelQuests } from '../shared/quest_tracker.ts';
import { QuestPanel } from '../shared/quest_panel.tsx';
import { ConstructionLedger } from '../shared/construction.ts';
import { RouteLedger } from '../shared/route_ledger.ts';
import { routeGraph } from '../shared/route_validity.ts';
import { RoutePanel } from './route_panel.tsx';
import { DecidePanel } from './decide_panel.tsx';
import { applyDecision } from '../ports/slice1/slice1_decide.ts';
import { ASSET_ORDER } from '../ops_domain3.ts';
import { PlacementPanel } from './placement_panel.tsx';

const REPO = 'C:/AI_LAB/SteelX';

// Raw content JSON is inlined by catalog.ts's vite glob; re-expose it for the layout manifest.
// NOTE: with this Vite version `import: 'default'` yields the module namespace object, not
// the raw string — unwrap `.default` (the previous hub build predates this behavior).
const jsonModules = import.meta.glob('../../../{fixtures,content}/**/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, unknown>;

function loadJson(path: string): any {
  const rel = `../../../${path.slice(REPO.length + 1)}`;
  const raw = jsonModules[rel];
  const text = typeof raw === 'string' ? raw : (raw as any)?.default;
  if (typeof text !== 'string') throw new Error(`loadJson: no raw text for ${rel} (got ${typeof raw})`);
  return JSON.parse(text);
}

const TICK_MS = 140; // fixed logical tick rate (mid-point of the five slices' 120–160 ms idiom)
const SAVE_SLOT = 'main'; // v1 single-slot hub save (multi-slot is a schema-supported later step)

function HubApp() {
  const catalog = useMemo(() => buildCatalog(), []);
  const registry = useMemo(() => {
    const r = new InventoryRegistry();
    for (const e of catalog) r.register(e.adapter);
    return r;
  }, [catalog]);
  const storage = useMemo(() => new LocalStorageSaveStorage(window.localStorage), []);

  // Continue-on-startup: if a save exists, resume its slice; otherwise new game.
  // The saved state snapshot is validated here (ledger check) so the loop's initial
  // useState can build straight from it — no post-mount resume effect needed.
  const startup = useMemo(() => {
    const fresh = { sliceId: catalog[0].id, resumedAt: null as number | null, savedAt: null as string | null, resumedState: null as any | null, resumeError: null as Error | null, construction: null as any[] | null, routes: null as any[] | null, decisions: null as any[] | null };
    try {
      const saves = listSaves(storage);
      if (saves.length > 0) {
        const save = loadSave(storage, SAVE_SLOT, { knownSliceIds: catalog.map((e) => e.id) });
        const targetEntry = catalog.find((e) => e.id === save.slice_id)!;
        const probe = new HubTickLoop(targetEntry.module, registry);
        const chk = probe.resume(structuredClone(save.state));
        if (!chk.ok) throw new Error(`restored state fails the ledger: ${chk.detail}`);
        return { sliceId: save.slice_id, resumedAt: save.tick, savedAt: save.saved_at, resumedState: save.state, resumeError: null,        construction: save.construction ?? null, routes: save.routes ?? null, decisions: save.decisions ?? null };
      }
    } catch (err) {
      console.warn('save could not be loaded, starting a new game:', err);
      return { ...fresh, resumeError: err as Error };
    }
    return fresh;
  }, [catalog, storage, registry]);
  const startupRef = useRef(startup);

  // Build a loop for a catalog entry; when the entry is the startup-resume target, the
  // loop starts straight from the saved snapshot (validated by its own adapter).
  const makeLoop = (e: CatalogEntry) => {
    const l = new HubTickLoop(e.module, registry);
    if (startupRef.current.resumedState !== null && e.id === startupRef.current.sliceId) {
      const chk = l.resume(structuredClone(startupRef.current.resumedState));
      if (!chk.ok) throw new Error(`restored state fails the ledger: ${chk.detail}`);
    }
    return l;
  };

  const [sliceId, setSliceId] = useState(startup.sliceId);
  const entry = catalog.find((e) => e.id === sliceId)!;
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  // Phase 2 quest tracking: Level 1's chain (content/quests.json) is evaluated against
  // the LIVE slice1 hub state each tick — completion comes only from sim state (§5.2),
  // never UI clicks. The tracker lives outside the loop so switching slices never resets
  // quest progress; save/load carries its progress map (§13 Phase 2 coverage).
  const QUEST_STALL_TICKS = 60; // §6.5 window: ~8.4 s of no measurable progress at 140 ms/tick
  const questsDoc = useMemo(() => loadJson(`${REPO}/content/quests.json`), []);
  const questTracker = useMemo(() => {
    const t = new QuestTracker(loadLevelQuests(questsDoc, 'level_1'));
    if (startup.resumedState !== null) {
      try {
        const save = loadSave(storage, SAVE_SLOT, { knownSliceIds: catalog.map((e) => e.id) });
        if (save.quest_progress) t.restoreProgress(save.quest_progress);
      } catch { /* startup probe already validated the save; re-read failure is non-fatal */ }
    }
    return t;
  }, [questsDoc, startup, storage, catalog]);
  const questNoteRef = useRef<string | null>(null); // last milestone/hint feedback line

  // Phase 2 guided placement (§14.4 lifecycle, gameplay §1.4 Build verb): ghost slots
  // ride the hub's authoritative clock — construction advances one tick per sim step on
  // the active slice's loop. Pre-placed machines are declared pre-built starter state.
  // Construction progress persists via GameSave.construction (§13 coverage). Build
  // durations are sme_pending.
  const layoutDoc = useMemo(() => loadJson(`${REPO}/content/layout/factory_layout_v1.json`), []);

  const [saveNote, setSaveNote] = useState<string | null>(
    startup.resumeError !== null
      ? 'new game (save was rejected)'
      : startup.resumedAt !== null
        ? `continued from tick ${startup.resumedAt} (saved ${startup.savedAt})`
        : 'new game',
  );

  // Per-entry loops: each catalog entry owns its own HubTickLoop, so the state `st`,
  // the projected adapter (`entry.adapter`), and the balance check always come from the
  // SAME entry object in any render pass — even when a slice switch commits `sliceId`
  // while the old loop's tick is still queued (the desync that threw
  // `n.charges is not iterable`, 2026-10-19: a render ran with the new entry but the
  // previous slice's state). No setState-in-render needed.
  const loopsRef = useRef(new Map(catalog.map((e) => [e.id, makeLoop(e)])));
  const transportRef = useRef(null);
  const lastEntryRef = useRef(entry);
  // Construction ledger keyed by slice: only the ACTIVE slice's copy advances (hub
  // design — one loop ticks), so switching slices never resets build progress. Ghosts
  // register in their zone's owning slice; machines enter as pre-built starter state.
  const makeConstruction = (sid: string): ConstructionLedger => {
    const c = new ConstructionLedger();
    for (const s of layoutDoc.slots) {
      if (s.kind === 'ghost') {
        if (layoutDoc.zones.find((z: any) => z.id === s.zone)?.slice !== sid) continue;
        c.register(s.id);
      } else {
        c.register(s.id, { preBuilt: true }); // §14.4: declared pre-built starter state
      }
    }
    return c;
  };
  const constructionRef = useRef(new Map(catalog.map((e) => [e.id, makeConstruction(e.id)])));
  // Route ledgers keyed by slice (§7.2 Connect verb): each entry owns its copy so a
  // slice switch never resets connections; validation lives in the shared validator.
  const routeRef = useRef(new Map(catalog.map((e) => [e.id, new RouteLedger(routeGraph)])));
  // Resume path: construction snapshot replaces the fresh registration (mid-build saves
  // continue where they left off — §13 coverage).
  if (startup.construction !== null) {
    for (const c of constructionRef.current.values()) c.restore(startup.construction);
  }
  if (startup.routes !== null) {
    for (const r of routeRef.current.values()) r.restore(startup.routes);
  }
  if (lastEntryRef.current !== entry) {
    lastEntryRef.current = entry;
    transportRef.current?.pause();
    setSaveNote('new game');
  }

  const transport = useFixedTickLoop(() => {
    const activeEntry = lastEntryRef.current;
    const l = loopsRef.current.get(activeEntry.id)!;
    l.step();
    // Quest evaluation rides the authoritative state right after each step (§5.2/§5.3).
    if (activeEntry.id === 'slice1') {
      constructionRef.current.get('slice1')!.tick(l.tick); // §14.4 on the sim clock
      const snap = { tick: l.tick, state: l.state };
      const completed = questTracker.update(snap);
      for (const id of completed) {
        const q = questTracker.definition(id)!;
        questNoteRef.current = `quest complete: ${q.title} — ${q.learning_takeaway}`;
        // Quest milestones surface in the hub event log as HubEvents ({tick, event}).
        loopsRef.current.get('slice1')!.log.push({ tick: l.tick, event: `quest_complete:${id}` });
      }
      if (completed.length === 0) {
        const stalled = questTracker.stalledQuest(QUEST_STALL_TICKS, snap);
        if (stalled && !questNoteRef.current?.startsWith('stuck')) {
          const c = stalled.unmet[0];
          questNoteRef.current = `stuck on '${stalled.quest.title}': ${c.field} ${c.op} ${c.value} not met after ${stalled.stalled_for} ticks`;
        }
      }
    }
    rerender();
  }, TICK_MS);
  transportRef.current = transport;
  useTransportCleanup(transport);

  const loop = loopsRef.current.get(entry.id)!;
  const st: any = loop.state;
  const check = loop.balanceCheck;
  const balanceTone = check.ok ? 'ok' : 'bad';

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <main style={{ flex: 1, padding: 16 }}>
        <h1>SteelX Hub — authoritative tick loop</h1>
        {/* Phase 1 item (d): common factory scene. The focused slice's loop is the only
            one that ticks (hub design), so neighbor zones render as static dioramas per
            the approved focus rule. Tap machine -> inspection card; tap ghost -> preview. */}
        <FactoryView
          layout={loadJson(`${REPO}/content/layout/factory_layout_v1.json`)}
          focusSlice={sliceId}
          simState={st}
        />
        <div className="steelx-controls">
          {catalog.map((e) => (
            <button key={e.id} onClick={() => transport.pause() || setSliceId(e.id)} data-active={e.id === sliceId}>
              {e.label}
            </button>
          ))}
        </div>
        {/* Phase 2 guided placement (§7.2 phased scope / §14.4 lifecycle): ghost slots in
            the focused slice's zones -> Build verb -> N ticks -> operational. */}
        <PlacementPanel
          layout={layoutDoc}
          construction={constructionRef.current.get(sliceId)!}
          tick={loop.tick}
          onBuild={(slotId) => {
            const r = constructionRef.current.get(sliceId)!.build(slotId, loop.tick);
            questNoteRef.current = r.ok ? r.reason : `cannot build: ${r.reason}`;
            if (r.ok) loopsRef.current.get(sliceId)!.log.push({ tick: loop.tick, event: `construction_started:${slotId}` });
            rerender();
          }}
        />
        {/* Phase 2 route connections (§7.4 Connect verb): node choices + Connect; the
            validator's verdict (reason + explainRouteFailure line) surfaces verbatim. */}
        <RoutePanel
          nodeIds={[...routeGraph.nodeIds]}
          connections={routeRef.current.get(sliceId)!.list()}
          onConnect={(fromId, toId) => {
            const r = routeRef.current.get(sliceId)!.connect(fromId, toId, loop.tick);
            if (r.ok) loopsRef.current.get(sliceId)!.log.push({ tick: loop.tick, event: `route_connected:${fromId}_to_${toId}` });
            rerender();
            return r;
          }}
        />
        {/* Phase 2 Step B Decide verbs: the panel owns no rule — applyDecision calls the
            engine's decide_* functions (the only mutators) and surfaces their message. */}
        {sliceId === 'slice1' && (
          <DecidePanel
            assets={[...ASSET_ORDER]}
            decisions={(loop.state as any).decisions ?? []}
            onDecide={(verb, target, arg) => {
              const r = applyDecision(loop.state as any, verb, target, arg);
              loopsRef.current.get(sliceId)!.log.push({ tick: loop.tick, event: `decide_${verb}:${target}${r.ok ? '' : ':rejected'}` });
              rerender();
              return r;
            }}
          />
        )}
        <TransportControls
          transport={transport}
          onReset={() => {
            loop.reset();
            rerender();
          }}
          tickRateMs={TICK_MS}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
          <button
            onClick={() => {
              transport.pause();
              loop.reset(); // new game = fresh scenario state for the selected slice
              constructionRef.current.get(entry.id)!.restore([]); // fresh ghost slots
              routeRef.current.get(entry.id)!.restore([]); // fresh route connections
              setSaveNote('new game');
              rerender();
            }}
          >
            New game
          </button>
          <button
            onClick={() => {
              try {
                // Phase 2 persistence coverage: quest progress + construction ride the snapshot.
                writeSave(
                  storage, SAVE_SLOT, sliceId, loop.state,
                  questTracker.snapshotProgress(), constructionRef.current.get(sliceId)!.snapshot(),
                  routeRef.current.get(sliceId)!.snapshot(),
                  (loop.state as any).decisions ?? null, // Step B decision log (§13 coverage)
                );
                setSaveNote(`saved at tick ${loop.tick}`);
              } catch (err) {
                setSaveNote(`save failed: ${(err as Error).message}`);
              }
              rerender();
            }}
          >
            Save
          </button>
          <button
            onClick={() => {
              transport.pause();
              try {
                const save = loadSave(storage, SAVE_SLOT, { knownSliceIds: catalog.map((e) => e.id) });
                const targetEntry = catalog.find((e) => e.id === save.slice_id)!;
                const l = loopsRef.current.get(targetEntry.id)!;
                const chk = l.resume(structuredClone(save.state));
                if (!chk.ok) throw new Error(`restored state fails the ledger: ${chk.detail}`);
                if (targetEntry.id !== sliceId) setSliceId(targetEntry.id);
                // Quest progress + construction restore with the snapshot (§13 coverage).
                if (save.quest_progress) questTracker.restoreProgress(save.quest_progress);
                constructionRef.current.get(targetEntry.id)!.restore(save.construction ?? []);
                routeRef.current.get(targetEntry.id)!.restore(save.routes ?? []); // §13 coverage
                // Step B: the decision log lives inside the loop state snapshot itself
                // (loop.state.decisions), so resume carries it verbatim — no separate
                // ledger to restore; save_load only shape-checks the row fields.
                questNoteRef.current = null;
                setSaveNote(`loaded tick ${save.tick} (${save.slice_id}, saved ${save.saved_at})`);
              } catch (err) {
                setSaveNote(`load failed: ${(err as Error).message}`);
              }
              rerender();
            }}
          >
            Load
          </button>
          <span style={{ fontSize: 12, opacity: 0.75 }}>{saveNote}</span>
        </div>
        <StatBar title="ledger">
          <StatRow label="tick" value={loop.tick} />
          <StatRow label="balance identity" value={<Badge tone={balanceTone}>{check.ok ? 'closed' : `OPEN ${formatNum(check.residual, 6)}`}</Badge>} />
          <StatRow label="registry residual" value={formatNum(check.residual, 9)} />
          {sliceId === 'slice3' && (
            <>
              <StatRow label="buffer" value={formatTons(st.buffer_t, 2)} />
              <ProgressBar fraction={st.buffer_t / entry.fixture.scenario.buffer.capacity_t} label="buffer fill" />
              <StatRow label="heats charged" value={st.heats.filter((h: any) => h.status === 'charged').length} />
              <StatRow label="heats skipped" value={st.heats.filter((h: any) => h.status === 'skipped').length} />
            </>
          )}
          {sliceId === 'slice4' && st.eaf !== undefined && (
            <>
              <StatRow label="EAF" value={st.eaf.busy_charge_id ?? 'idle'} />
              <StatRow label="LRF" value={st.lrf.busy_ladle_id ?? 'idle'} />
              <StatRow label="CCM" value={st.ccm.busy_ladle_id ?? 'idle'} />
              <StatRow label="ladles free" value={`${st.ladles.filter((l: any) => l.status === 'free').length} / ${st.ladles.length}`} />
              <StatRow label="billet yard" value={formatTons(st.billet_yard_t, 2)} />
              <StatRow label="heats tapped" value={st.counters.heats_tapped} />
              <StatRow label="energy" value={`${Math.round(st.counters.energy_kwh_total).toLocaleString('en-US')} kWh`} />
            </>
          )}
          {sliceId === 'slice5' && (
            <>
              <StatRow label="billet yard" value={formatTons(st.billet_yard_t, 1)} />
              <StatRow label="product yard" value={formatTons(st.product_yard_t, 2)} />
              <ProgressBar fraction={st.product_yard_t / st.product_yard_capacity_t} label="product yard fill" />
              <StatRow label="dispatched" value={formatTons(st.counters.dispatched_t_total, 2)} />
              <StatRow label="revenue" value={formatUsd(st.counters.revenue_usd)} />
            </>
          )}
        </StatBar>
        <section style={{ marginTop: 12 }}>
          <h2>ledger terms (registry view)</h2>
          {/* Structural invariant: `st` and the adapter both come from `entry`'s own
              per-entry loop (loopsRef keyed by entry.id), so no foreign-shaped state can
              ever reach an adapter regardless of render pass (crash `n.charges is not
              iterable`, 2026-10-19). */}
          {registry.project(entry.id, st).terms.map((t) => (
            <StatRow key={t.id} label={t.label} value={formatTons(t.value, 3)} />
          ))}
        </section>
      </main>
      <aside style={{ width: 360, padding: 14, borderLeft: '1px solid #2a3038', overflowY: 'auto' }}>
        {/* §5.4 quest panel — the campaign spine; progress reads live sim state. */}
        <QuestPanel
          defs={questTracker.definitions()}
          progress={questTracker.snapshotProgress()}
          simState={st}
          note={questNoteRef.current}
        />
        <InfoCard card={{ id: sliceId, title: entry.cardTitle, body: entry.cardBody, source: 'learning layer — placeholder until docs card JSON is wired' }} />
        <EventLog entries={loop.log} />
      </aside>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<HubApp />);
