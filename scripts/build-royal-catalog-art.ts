import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { ARCADE_GITHUB_GAMES, ROYAL_PLATFORM_GAMES } from '../src/shared/arcadeCatalog';
import { STUDIO_INFO, type StudioGameId } from '../src/shared/studioGames';
import { STUDIO_ART } from '../src/ui/StudioArtwork';
import { clusterSymbol } from '../src/ui/ClusterArtwork';
import { collectSymbol } from '../src/ui/CollectArtwork';
import { elementSymbol } from '../src/ui/ElementArtwork';
import { holdSymbol } from '../src/ui/HoldArtwork';
import { journeySymbol } from '../src/ui/JourneyArtwork';
import { waysSymbol } from '../src/ui/WaysArtwork';
import { cascadeSymbol } from '../src/ui/CascadeArtwork';
import { wheelTrailSymbol } from '../src/ui/WheelTrailArtwork';

// Catalogue-only composites of canonical game art. Run with node --import tsx
// scripts/build-royal-catalog-art.ts [--check]. Requires Chrome and cwebp.
// Never rewrite gameplay sprites or the separate cabinet startup previews.
type Rect = [number, number, number, number];
type Layer = { url: string; source?: Rect; target: Rect; circle?: boolean; feather?: boolean };
type Cover = { background: string; crop?: Rect; layers: Layer[]; emblem?: string; versus?: boolean };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const output = path.join(publicRoot, 'assets/royal-catalog');
const manifestPath = path.join(root, 'src/ui/royalCatalogArtwork.json');
const check = process.argv.includes('--check');
const atlas = (url: string, col: number, row: number, target: Rect, cell = 418): Layer =>
  ({ url, source: [col * cell, row * cell, cell, cell], target });
const covers: Record<string, Cover> = {
  'studio-cosmic-escape': {
    background: '/assets/cosmic-guardians/v1/background.webp',
    layers: [{ url: '/assets/cosmic-guardians/v1/alien.webp', source: [170, 0, 680, 880], target: [205, 0, 400, 518] }],
  },
  'studio-caramel-carnival': {
    background: '/assets/caramel-rebuild/v1/background.webp',
    layers: [atlas('/assets/caramel-rebuild/v1/symbols.webp', 1, 0, [370, 0, 235, 235], 1280 / 3),
      atlas('/assets/caramel-rebuild/v1/symbols.webp', 2, 0, [355, 195, 235, 235], 1280 / 3),
      atlas('/assets/caramel-rebuild/v1/symbols.webp', 0, 0, [35, 45, 370, 370], 1280 / 3)],
  },
  'studio-velvet-reign': {
    background: '/assets/velvet-rebuild/v1/background.webp',
    layers: [{ url: '/assets/velvet-rebuild/v3/celeste-64244495645f.webp', target: [20, 45, 300, 450] },
      { url: '/assets/velvet-rebuild/v3/viola-2e5782904937.webp', target: [250, 0, 370, 555] }],
  },
  'studio-last-convoy': {
    background: '/assets/last-convoy/v1/background.webp',
    layers: [{ url: '/assets/last-convoy/v1/heroine.webp', source: [240, 0, 540, 870], target: [215, 0, 360, 580] }],
  },
  'studio-nitro-run': {
    background: '/assets/nitro-run/v1/background.webp',
    layers: [atlas('/assets/nitro-run/v1/symbols.webp', 1, 1, [315, 70, 340, 340]),
      atlas('/assets/nitro-run/v1/symbols.webp', 2, 1, [-20, 70, 450, 450])],
  },
  'studio-afterglow': {
    background: '/assets/afterglow/v1/background-studio-v3.webp',
    layers: [{ url: '/assets/afterglow/v3/base-1.webp', source: [160, 0, 700, 900], target: [285, 5, 350, 450], feather: true },
      { url: '/assets/afterglow/v3/base-0.webp', source: [160, 0, 700, 900], target: [15, 0, 350, 450], feather: true }],
  },
  'studio-meme-overload': {
    background: '/assets/meme-overload/v1/desktop.svg',
    layers: [{ url: '/assets/meme-overload/v1/pepe.jpg', target: [315, 40, 310, 310], circle: true },
      { url: '/assets/meme-overload/v1/doge.jpg', target: [15, 0, 380, 380], circle: true }],
  },
  'studio-dracona': {
    background: '/assets/dracona/manor.webp',
    layers: [{ url: '/assets/dracona/hero-idle-a.png', source: [95, 100, 310, 365], target: [205, 0, 400, 471] }],
  },
  'royal-plinko': {
    background: '/assets/arcane-plinko/world-ef0d9320252e.webp',
    layers: [{ url: '/assets/arcane-plinko/vespera-poster-46d5ebf7e7cd.webp', source: [30, 0, 730, 900], target: [215, 0, 390, 481], feather: true }],
  },
  'github-crash': {
    background: '/assets/last-exit/v1/highway.webp',
    layers: [{ url: '/assets/last-exit/v2d/helicopter.png', target: [0, -20, 295, 197] },
      { url: '/assets/last-exit/v1/coupe.webp', target: [60, 50, 580, 387] }],
  },
  'original-cr-vs-leo': {
    background: '/assets/cr-vs-leo/v2/stadium.webp', versus: true,
    layers: [{ url: '/assets/cr-vs-leo/v2/cr-white-thumb.webp', target: [-35, 20, 380, 380] },
      { url: '/assets/cr-vs-leo/v2/leo-thumb.webp', target: [295, 20, 380, 380] }],
  },
};

// These symbols are the same SVGs shown inside each game, not new characters.
const emblems: Record<string, string> = {
  'studio-deep-current': collectSymbol('studio-deep-current', 1),
  'studio-ember-vault': holdSymbol('studio-ember-vault', 5),
  'studio-lumen-grove': clusterSymbol('studio-lumen-grove', 4),
  'studio-stormforge-duel': elementSymbol('studio-stormforge-duel', 3),
  'studio-copperline-express': journeySymbol('studio-copperline-express', 0),
  'studio-saffron-cipher': elementSymbol('studio-saffron-cipher', 3),
  'studio-prism-atelier': clusterSymbol('studio-prism-atelier', 0),
  'studio-midnight-market': holdSymbol('studio-midnight-market', 1),
  'studio-pulse-district': journeySymbol('studio-pulse-district', 4),
  'studio-sky-lanterns': waysSymbol('studio-sky-lanterns', 0),
  'studio-rivet-rally': waysSymbol('studio-rivet-rally', 0),
  'studio-frostline-courier': waysSymbol('studio-frostline-courier', 4),
  'studio-petal-parlor': wheelTrailSymbol('studio-petal-parlor', 0),
  'studio-beacon-bay': elementSymbol('studio-beacon-bay', 3),
  'studio-sunbird-trails': wheelTrailSymbol('studio-sunbird-trails', 0),
  'studio-blazing-orchard': collectSymbol('studio-blazing-orchard', 0),
  'studio-jade-koi': journeySymbol('studio-jade-koi', 3),
  'studio-moonlit-mint': holdSymbol('studio-moonlit-mint', 0),
  'studio-starfall-oracle': cascadeSymbol('studio-starfall-oracle', 4),
};
const github = new Set<string>(ARCADE_GITHUB_GAMES);
const games = ROYAL_PLATFORM_GAMES.filter(id => !github.has(id));
for (const [index, id] of games.entries()) {
  if (covers[id]) continue;
  const theme = STUDIO_INFO[id as StudioGameId].theme;
  const y = theme === 'candy' ? 90 : 25;
  const width = [850, 920, 960][index % 3];
  covers[id] = { background: STUDIO_ART[theme], crop: [0, y, width, width / 1.6], layers: [], emblem: emblems[id] };
  if (!emblems[id]) {
    if (id === 'studio-orbit') covers[id].layers.push({ url: '/assets/royal-orbit-ship.png', target: [365, 105, 270, 270] });
    else {
      const sprites = { space: [4, 3, 9], candy: [0, 1, 2], ocean: [5, 4, 3], forge: [9, 11, 4], garden: [10, 0, 1] };
      const sprite = sprites[theme][index % 3];
      // The game's shared 4 by 3 symbol sheet includes padding between cells.
      covers[id].layers.push({ url: '/assets/studio/symbols.webp', source: [(sprite % 4) * 362 + 13.4, Math.floor(sprite / 4) * 362 + 13.4, 335.2, 335.2], target: [385, 120, 240, 240] });
    }
  }
}
const temporary = await mkdtemp(path.join(tmpdir(), 'royal-catalog-'));
const browser = await chromium.launch({ channel: process.env.PREVIEW_BROWSER_CHANNEL || 'chrome' });
const page = await browser.newPage();
await page.addScriptTag({ content: 'window.__name = value => value;' });
const manifest: Record<string, string> = {};
let totalBytes = 0;
try {
  const images: Record<string, string> = {};
  for (const url of new Set(Object.values(covers).flatMap(art => [art.background, ...art.layers.map(layer => layer.url)]))) {
    const bytes = await readFile(path.join(publicRoot, url));
    const mime = url.endsWith('.svg') ? 'image/svg+xml' : url.endsWith('.jpg') ? 'image/jpeg' : url.endsWith('.webp') ? 'image/webp' : 'image/png';
    images[url] = `data:${mime};base64,${bytes.toString('base64')}`;
  }
  for (const id of games) {
    const art = covers[id];
    const pngUrl = await page.evaluate(async ({ art, images }) => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
      const ctx = canvas.getContext('2d')!; ctx.scale(.8, .8);
      const decode = async (url: string) => { const image = new Image(); image.src = url; await image.decode(); return image; };
      const background = await decode(images[art.background]);
      const ratio = Math.max(640 / background.width, 400 / background.height);
      const source = art.crop ?? [(background.width - 640 / ratio) / 2, (background.height - 400 / ratio) / 2, 640 / ratio, 400 / ratio];
      ctx.drawImage(background, ...source as Rect, 0, 0, 640, 400);
      if (art.emblem || art.crop) {
        const shade = ctx.createLinearGradient(250, 0, 640, 0); shade.addColorStop(0, '#08142600'); shade.addColorStop(1, '#081426aa');
        ctx.fillStyle = shade; ctx.fillRect(0, 0, 640, 400);
      }
      if (art.emblem) {
        const svg = art.emblem.match(/<svg[\s\S]*?<\/svg>/)?.[0]?.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
        if (!svg) throw new Error('Missing canonical emblem');
        const emblem = await decode('data:image/svg+xml,' + encodeURIComponent(svg.replace(/ xmlns="http:\/\/www.w3.org\/2000\/svg"(?=[\s\S]*xmlns=)/, '')));
        ctx.save(); ctx.shadowColor = '#020a19'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
        ctx.drawImage(emblem, 385, 115, 240, 240); ctx.restore();
      }
      for (const layer of art.layers) {
        const image = await decode(images[layer.url]);
        const s = layer.source ?? [0, 0, image.width, image.height];
        const [x, y, w, h] = layer.target;
        ctx.save();
        if (layer.circle) { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2); ctx.clip(); }
        if (layer.feather) {
          const portrait = document.createElement('canvas'); portrait.width = w; portrait.height = h;
          const p = portrait.getContext('2d')!; p.drawImage(image, ...s as Rect, 0, 0, w, h);
          p.globalCompositeOperation = 'destination-in'; const mask = p.createLinearGradient(0, 0, w, 0);
          mask.addColorStop(0, '#0000'); mask.addColorStop(.16, '#000'); mask.addColorStop(.84, '#000'); mask.addColorStop(1, '#0000');
          p.fillStyle = mask; p.fillRect(0, 0, w, h); ctx.drawImage(portrait, x, y);
        } else ctx.drawImage(image, ...s as Rect, x, y, w, h);
        ctx.restore();
      }
      if (art.versus) { ctx.font = 'italic 900 55px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff0c1'; ctx.shadowColor = '#000'; ctx.shadowBlur = 12; ctx.fillText('VS', 320, 230); }
      return canvas.toDataURL('image/png');
    }, { art, images });
    const png = path.join(temporary, id + '.png'), webp = path.join(temporary, id + '.webp');
    await writeFile(png, Buffer.from(pngUrl.split(',')[1], 'base64'));
    execFileSync(process.env.CWEBP || 'cwebp', ['-quiet', '-q', '80', '-m', '6', png, '-o', webp]);
    const bytes = await readFile(webp), hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    if (bytes.length > 75000) throw new Error(id + ': cover exceeds download budget');
    totalBytes += bytes.length;
    const file = `${id}.${hash}.webp`; manifest[id] = '/assets/royal-catalog/' + file;
    if (check) { if (!(await readFile(path.join(output, file))).equals(bytes)) throw new Error('Stale cover: ' + id); }
    else { await mkdir(output, { recursive: true }); await writeFile(path.join(output, file), bytes); }
  }
  if (totalBytes > 1800000) throw new Error('Catalogue exceeds download budget');
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (check) { if (await readFile(manifestPath, 'utf8') !== json) throw new Error('Stale cover manifest'); }
  else await writeFile(manifestPath, json);
  console.log(JSON.stringify({ checked: check, covers: games.length, totalBytes, size: '512x320', canonicalArtOnly: true }));
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
