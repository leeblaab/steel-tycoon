// Hub content-JSON loader (extracted from catalog.ts's glob so ports outside
// src/hub — e.g. ports/fullplant/browser — can reuse it; import.meta.glob patterns are
// rooted at the FILE that declares them, so a deep port dir cannot reach ../../content).
// Same keys/semantics as catalog.ts: paths relative to THIS file (3 levels under src).

const REPO = 'C:/AI_LAB/SteelX';

const jsonModules = import.meta.glob('../../../{fixtures,content}/**/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, unknown>;

export function loadContentJson(path: string): any {
  const rel = `../../../${path.slice(REPO.length + 1)}`;
  const raw = jsonModules[rel];
  const text = typeof raw === 'string' ? raw : (raw as any)?.default;
  if (typeof text !== 'string') throw new Error(`loadContentJson: no raw text for ${rel} (got ${typeof raw})`);
  return JSON.parse(text);
}

export function loadHubQuestsDoc(): any {
  return loadContentJson(`${REPO}/content/quests.json`);
}
