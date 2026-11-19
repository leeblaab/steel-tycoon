// Phase 2 step-1 test: quest panel renders the Level-1 chain and tracks progress purely
// from a supplied sim state — presentation never mutates the tracker or invents status.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { QuestTracker, loadLevelQuests } from '../src/shared/quest_tracker.ts';
import { QuestPanel } from '../src/shared/quest_panel.tsx';

const doc = JSON.parse(readFileSync('C:/AI_LAB/SteelX/content/quests.json', 'utf8'));
const level = loadLevelQuests(doc, 'level_1');

describe('QuestPanel (§5.4)', () => {
  it('renders all 5 Level-1 quests with lifecycle statuses from the tracker', () => {
    const t = new QuestTracker(level);
    const html = renderToStaticMarkup(createElement(QuestPanel, {
      defs: t.definitions(), progress: t.snapshotProgress(), simState: {}, note: null,
    }));
    expect(html).toContain('Level 1 — The First Flow');
    expect(html).toContain('First Arrival');
    expect(html).toContain('No Idle Furnace');
    expect(html).toContain('ACTIVE'); // first main quest active
    expect((html.match(/data-status="locked"/g) ?? []).length).toBe(4); // F-12 strict chain: optional starts locked too
  });

  it('live condition progress reads the supplied sim state verbatim', () => {
    const t = new QuestTracker(level);
    const html = renderToStaticMarkup(createElement(QuestPanel, {
      defs: t.definitions(), progress: t.snapshotProgress(),
      simState: { ships_arrived: 0, arrived_t: 42.5 }, note: null,
    }));
    expect(html).toContain('ships_arrived &gt;= 1 (now: 0)');
    expect(html).toContain('arrived_t &gt;= 3000 (now: 42.5)');
  });

  it('panel is presentation-only: rendering never changes tracker progress', () => {
    const t = new QuestTracker(level);
    const before = JSON.stringify(t.snapshotProgress());
    renderToStaticMarkup(createElement(QuestPanel, {
      defs: t.definitions(), progress: t.snapshotProgress(), simState: {}, note: null,
    }));
    expect(JSON.stringify(t.snapshotProgress())).toBe(before);
  });

  it('milestone/hint note line renders when present', () => {
    const t = new QuestTracker(level);
    const html = renderToStaticMarkup(createElement(QuestPanel, {
      defs: t.definitions(), progress: t.snapshotProgress(), simState: {},
      note: 'quest complete: First Arrival — Material must enter the plant before production can consume it.',
    }));
    expect(html).toContain('Material must enter the plant');
  });
});
