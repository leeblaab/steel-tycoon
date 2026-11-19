// Fullplant game UI (Roadmap V3 Phase 1, contract clauses 2-5): right-panel accordion HUD
// over the live GameSession — score strip, speed controls (pause/normal/fast = 3x), quest
// accordion (shared QuestPanel), per-slice status accordions (live KPIs + inspection card),
// event log. Presentation only: it drives the session clock via setSpeed/tick; sim rules
// stay in the parity ports.

import * as React from 'react';
import { QuestPanel } from '../../../shared/quest_panel.tsx';
import type { GameSession, Speed } from './session.ts';
import { selectZone, subscribeSelect, SELECTED } from './main.tsx';
import { TICK_MINUTES, NORMAL_TPS, FAST_MULTIPLIER } from './layout.ts';

const { useEffect, useState } = React;

function Accordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="fp-acc">
      <button className={`fp-acc-head ${open ? 'open' : ''}`} onClick={onToggle}>{open ? '▾' : '▸'} {title}</button>
      {open ? <div className="fp-acc-body">{children}</div> : null}
    </section>
  );
}

function fmt(v: number, d = 1): string { return (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(); }

import { beltLedgerView } from '../../../shared/ore_belt.ts';

/** Live KPI lines per slice — read-only projections of verbatim state fields. */
function kpiLines(session: GameSession, id: string): string[] {
  const st = session.stateOf(id) as any;
  if (!st) return [];
  switch (id) {
    case 'slice1': {
      const lines = [`day ${st.day} · tick ${st.tick}`, `yard stock: ${fmt(st.yard_stock_t)} t`, `arrived: ${fmt(st.arrived_t)} t`, `dispatched: ${fmt(st.dispatched_t)} t`, `demurrage: $${fmt(st.demurrage_usd, 0)}`];
      // S1.2 ore belt: live chain view once the player has built conv_ore_drp (step 4).
      if (session.belt) {
        const v = beltLedgerView(session.belt);
        lines.push(`ore belt: buffer ${fmt(v.buffer_t)} t · on belt ${fmt(v.in_transit_t)} t`);
        if (session.belt.drpCommissioned) lines.push(`DRP intake: ${fmt(v.drp_intake_t)} t`);
      }
      return lines;
    }
    case 'slice3': {
      const buf = st.buffer.reduce((a: number, l: any) => a + l.usable_t, 0);
      return [`tick ${st.tick}`, `DRI buffer: ${fmt(buf)} t`, `heats charged: ${st.heats.filter((h: any) => h.status === 'charged').length}`];
    }
    case 'slice4':
      return [`tick ${st.tick}`, `billet yard: ${fmt(st.billet_yard_t)} t`, st.eaf.busy_charge_id ? `EAF melting ${st.eaf.busy_charge_id}` : 'EAF idle'];
    case 'slice5':
      return [`tick ${st.tick}`, `billet intake yard: ${fmt(st.billet_yard_t)} t`, `product yard: ${fmt(st.product_yard_t)} / ${fmt(st.product_yard_capacity_t, 0)} t`, `orders dispatched: ${st.orders.filter((o: any) => o.status === 'dispatched' || o.dispatched_t >= o.required_t).length}/${st.orders.length}`];
    default:
      return ['engine pending'];
  }
}

export function PlantHud({ session }: { session: GameSession }) {
  const [, setRender] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({ quests: true, slice1: true, log: false });
  // Selection mirrors the shared SELECTED ref (3D tap OR accordion header).
  const selected = React.useSyncExternalStore(subscribeSelect, () => SELECTED.current);
  const rerender = () => setRender((r) => r + 1);

  // A zone tap (canvas or header) auto-opens that slice's accordion so the live card is
  // actually visible on tap — the contract says tap→card, not tap→(card only if you had
  // already opened the panel). Header taps still toggle freely via their own onToggle.
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent).detail as string | undefined;
      if (!id) return;
      setOpen((o) => (o[id] ? o : { ...o, [id]: true }));
    };
    window.addEventListener('steelx-select', h);
    return () => window.removeEventListener('steelx-select', h);
  }, []);

  // Drive the clock at NORMAL_TPS ticks/s (fast = FAST_MULTIPLIER x). Sim keeps running
  // while the player drills into a slice — the HUD is always mounted here.
  useEffect(() => {
    if (session.speed === 'pause') return;
    const interval = 1000 / (NORMAL_TPS * (session.speed === 'fast' ? FAST_MULTIPLIER : 1));
    const id = window.setInterval(() => {
      try { session.stepPlant(); } catch (e) { console.error(e); session.speed = 'pause'; }
      // S0.5 autosave: every 32 ticks the pump snapshots the whole plant to storage.
      session.noteTickForAutosave();
      // §1.5 exit check against live sim state: guided flow ends when Slice 1 is built AND
      // the first material actually flows — then Quest 1 ("First Arrival") takes over.
      if (session.onboardingComplete()) window.dispatchEvent(new Event('steelx-onboard'));
      window.dispatchEvent(new Event('steelx-tick')); // 3D side reads live state (veils, rims)
      rerender();
    }, interval);
    return () => clearInterval(id);
  }, [session, session.speed]);

  const setSpeed = (s: Speed) => { session.speed = s; rerender(); };
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const progress = session.questProgress();
  const activeQuest = session.tracker.definitions().find((d) => !d.optional && progress[d.id]?.status === 'active');
  const note = activeQuest ? `Active: ${activeQuest.title} — ${activeQuest.goal}` : null;
  const clockMin = session.tick * TICK_MINUTES;
  const plantDay = Math.floor(clockMin / 1440) + 1;

  return (
    <div id="hud-right">
      <div className="fp-score">
        <b>Plant day {plantDay}</b> · tick {session.tick} ({clockMin.toLocaleString()} plant-min)
        <div className="fp-speed">
          {(['pause', 'normal', 'fast'] as Speed[]).map((s) => (
            <button key={s} className={session.speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
              {s === 'pause' ? '⏸' : s === 'normal' ? '▶ 1x' : `▶▶ ${FAST_MULTIPLIER}x`}
            </button>
          ))}
        </div>
      </div>
      <Accordion title="Quests" open={!!open.quests} onToggle={() => toggle('quests')}>
        <QuestPanel defs={session.tracker.definitions()} progress={progress} simState={session.stateOf(activeQuest?.slice ?? 'slice1') as any} note={note} />
      </Accordion>
      {(['slice1', 'slice2', 'slice3', 'slice4', 'slice5'] as const).map((id) => {
        const rt = session.slices[id];
        if (!rt) return null;
        const state = rt.unlocked ? (rt.loop ? 'live' : 'engine pending') : 'locked';
        // Header taps TOGGLE only. The old handler also called selectZone(id) for slice2,
        // which dispatched steelx-select -> the auto-open effect forced open[slice2]=true on
        // the same click, so an opened slice-2 accordion could never close again (Yasser
        // 04.11). Zone selection from a canvas tap still auto-opens via that event.
        return (
          <Accordion key={id} title={`${session.catalog.find((c) => c.id === id)?.label ?? id} — ${state}`} open={!!open[id]} onToggle={() => toggle(id)}>
            {rt.unlocked ? (
              <>
                {kpiLines(session, id).map((l) => <div className="stat" key={l}><span>{l}</span></div>)}
                {selected === id ? (() => {
                  const card = session.cardFor(id);
                  return card ? (
                    <div className={`fp-card tone-${card.tone}`}>
                      <b>{card.title}</b>
                      {card.lines.map((l) => <div key={l}>{l}</div>)}
                    </div>
                  ) : <div className="learn">Engine pending — this area is under construction; its live card lands with the slice 2 redesign.</div>;
                })() : <div className="learn">Tap the zone in the 3D view for its live info card.</div>}
              </>
            ) : (
              <div className="learn">Locked — complete the active quest to commission this area.</div>
            )}
          </Accordion>
        );
      })}
      <Accordion title={`Event log (${session.events.length})`} open={!!open.log} onToggle={() => toggle('log')}>
        {session.events.slice(-40).reverse().map((e, i) => (
          <div className="stat" key={i}><span>t{e.tick} · {e.slice}: {e.event}</span></div>
        ))}
      </Accordion>
    </div>
  );
}
