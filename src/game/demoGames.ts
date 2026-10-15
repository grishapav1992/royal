import { CABINETS } from '../shared/cabinets';

const PROVIDER = 'https://luelonplay.com';
export const DEMO_CATALOG_URL = `${PROVIDER}/demo-api/v1/games?lang=en`;
export type DemoGame = { id: string; name: string; embedUrl: string; category: string; artworkUrl?: string };
export const DEMO_CATEGORIES: Record<string, string> = {
  slot: 'Слоты', flight: 'Полёт', crash: 'Crash', keno: 'Keno',
  plinko: 'Plinko', dice: 'Dice', wheel: 'Колёса', mines: 'Mines',
};
let cached: DemoGame[] | undefined;
let expiresAt = 0;
let pending: Promise<DemoGame[]> | undefined;

export function getDemoGames(): Promise<DemoGame[]> {
  if (cached && Date.now() < expiresAt) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch(DEMO_CATALOG_URL, {
      signal: AbortSignal.timeout(15000), credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error('Demo catalogue unavailable');
    const data: unknown = await response.json();
    const entries = data && typeof data === 'object' && 'games' in data ? data.games : null;
    if (!Array.isArray(entries)) throw new Error('Invalid demo catalogue');
    const ids = new Set<string>();
    const games = entries.filter((value): value is DemoGame => {
      if (!value || typeof value.id !== 'string' || !value.id || ids.has(value.id) || typeof value.name !== 'string' || !value.name || !Object.hasOwn(DEMO_CATEGORIES, value.category) || typeof value.embedUrl !== 'string') return false;
      try {
        const url = new URL(value.embedUrl);
        if (url.origin !== PROVIDER || url.username || url.password || !url.pathname.startsWith('/embed/')) return false;
        ids.add(value.id); return true;
      } catch { return false; }
    });
    if (!games.length) throw new Error('No demo games available');
    for (const game of games) {
      try {
        const url = new URL(game.artworkUrl ?? '');
        if (url.origin !== PROVIDER || url.username || url.password || !url.pathname.startsWith('/assets/')) delete game.artworkUrl;
      } catch { delete game.artworkUrl; }
    }
    cached = games; expiresAt = Date.now() + 5 * 60 * 1000;
    return games;
  })().finally(() => { pending = undefined; });
  return pending;
}

export function prefetchDemoGames() {
  if (CABINETS.some(cabinet => cabinet.demo)) void getDemoGames().catch(() => {});
}

let cabinetGame: DemoGame | undefined;
const cabinetListeners = new Set<(game: DemoGame) => void>();

export async function getCabinetDemoGame(): Promise<DemoGame> {
  const games = await getDemoGames();
  // Keep the advertised game selected even if the catalogue order changes.
  const game = cabinetGame ? games.find(item => item.id === cabinetGame!.id) : games.find(item => item.category === 'slot') ?? games[0];
  if (!game) throw new Error('Advertised demo game is unavailable');
  return selectCabinetDemoGame(game);
}

export async function getDemoGame(id: string): Promise<DemoGame> {
  const game = (await getDemoGames()).find(item => item.id === id);
  if (!game) throw new Error('Selected demo game is unavailable');
  return game;
}

export function selectCabinetDemoGame(game: DemoGame) {
  if (cabinetGame !== game) {
    cabinetGame = game;
    cabinetListeners.forEach(listener => listener(game));
  }
  return game;
}

export function watchCabinetDemoGame(listener: (game: DemoGame) => void) {
  cabinetListeners.add(listener);
  if (cabinetGame) listener(cabinetGame);
  void getCabinetDemoGame().catch(() => {});
  return () => { cabinetListeners.delete(listener); };
}
