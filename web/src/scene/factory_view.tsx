// SteelX hub factory view — common plant scene embedded in the hub (Phase 1 build item d).
// Focus rule straight from factory_scene_design_v1.md: the hub runs ONE slice loop at a time,
// so the focused slice ticks live and every other zone renders as a static diorama.
// Interaction rule: tap machine/ghost -> card (CardPopup); no hover-dependent UI.

import { useMemo, useState } from 'react';
import type { FactoryLayout, SlotDef } from '../shared/factory_layout.ts';
import { zonesForSlice, parseFactoryLayout } from '../shared/factory_layout.ts';
import { inspectSlice4Slot, inspectSlice5Slot, inspectSlice1Slot, type InspectionCardData } from '../shared/inspection_cards.ts';
import { FactoryScene, type SceneSlotState } from '../scene/factory_scene.tsx';
import { CardPopup } from '../ui/cards.tsx';

// Parsed manifest object is injected by the caller (hub inlines content JSON via vite glob).
export function FactoryView({ layout: parsedLayout, focusSlice, simState }: {
  layout: FactoryLayout;
  focusSlice: string; // catalog entry id: slice1 | slice3 | slice4 | slice5
  simState: unknown; // live state of the focused loop only — neighbors are dioramas by construction
}) {
  const layout: FactoryLayout = useMemo(() => parseFactoryLayout(parsedLayout), [parsedLayout]);
  const [popup, setPopup] = useState<{ title: string; body: string } | null>(null);

  // Live slot states ONLY for the focused slice (diorama rule: neighbors never tick).
  // Only slots owned by the focused slice get projections — an s1 berth slot under a
  // slice4 focus must not be fed the slice4 state view.
  const slotStates: Record<string, SceneSlotState> = {};
  if ((focusSlice === 'slice1' || focusSlice === 'slice4' || focusSlice === 'slice5') && simState !== null) {
    for (const s of layout.slots) {
      if (s.kind !== 'machine') continue;
      const zoneSlice = layout.zones.find((z) => z.id === s.zone)?.slice;
      if (zoneSlice !== focusSlice) continue;
      const card = focusSlice === 'slice4'
        ? inspectSlice4Slot(s, simState as any)
        : focusSlice === 'slice5'
          ? inspectSlice5Slot(s, simState as any)
          : inspectSlice1Slot(s, simState as any);
      slotStates[s.id] = { busy: card.tone === 'busy', waiting: card.tone === 'waiting', detail: card.lines[0] };
      // Berth animation input (slice1 only): presence of a real ship is sim state.
      if (focusSlice === 'slice1') {
        slotStates[s.id].ship_present = ((simState as any).berth_ships?.length ?? 0) > 0;
      }
    }
  }

  const onTapSlot = (slot: SlotDef) => {
    const zoneSlice = layout.zones.find((z) => z.id === slot.zone)!.slice;
    if (slot.kind === 'ghost') {
      // Decision 4: preview card from the manifest — capacity + cost band + learning line.
      const p = slot.preview!;
      setPopup({
        title: `${slot.id} — future ${slot.content_ref?.split('#')[1] ?? 'unit'}`,
        body: `Capacity: ${p.capacity_band}\nCost band: ${p.cost_band_usd}\n\n${p.learning_line}`,
      });
      return;
    }
    // Machine slot: inspection card is a projection of the FOCUSED sim only.
    if (zoneSlice !== focusSlice) {
      setPopup({ title: `${slot.id} — neighbor slice`, body: 'This unit belongs to another slice and stands as a static diorama while you run the focused line. Select its slice to watch it work.' });
      return;
    }
    let card: InspectionCardData | null = null;
    try {
      if (focusSlice === 'slice4') card = inspectSlice4Slot(slot, simState as any);
      else if (focusSlice === 'slice5') card = inspectSlice5Slot(slot, simState as any);
      else if (focusSlice === 'slice1') card = inspectSlice1Slot(slot, simState as any);
    } catch {
      card = null;
    }
    if (card) setPopup({ title: card.title, body: card.lines.join('\n') });
    else setPopup({ title: `${slot.id}`, body: 'No live telemetry for this slice yet (slice1 web parity port is a later item).' });
  };

  const focusZones = zonesForSlice(layout, focusSlice).map((z) => z.label).join(', ');

  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.8, margin: '6px 0' }}>
        Factory view — focused line ticks live ({focusZones || focusSlice}); other zones are static dioramas. Tap a machine or ghost slot.
      </div>
      <div style={{ height: 420, width: 'min(96vw, 1400px)' }}>
        <FactoryScene layout={layout} focusSlice={focusSlice} slotStates={slotStates} onTapSlot={onTapSlot} />
      </div>
      {popup !== null && (
        <CardPopup card={{ id: 'factory-card', title: popup.title, body: <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{popup.body}</pre> }} onClose={() => setPopup(null)} />
      )}
    </div>
  );
}
