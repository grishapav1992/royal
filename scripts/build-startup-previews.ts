import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { CABINET_ARTWORK } from '../src/game/cabinetArtworkSources';
import { paintGirlhubLogo } from '../src/game/cabinetArt';
import { ACTIVE_STUDIO_GAMES } from '../src/shared/arcadeCatalog';

// Run with: node --import tsx scripts/build-startup-previews.ts [--check]
// Requires Chrome and the cwebp encoder. Set CWEBP to use a specific encoder path.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const output = path.join(publicRoot, 'assets/startup-previews');
const manifestPath = path.join(root, 'src/game/startupPreviews.json');
const check = process.argv.includes('--check');
const temporary = await mkdtemp(path.join(tmpdir(), 'royal-startup-previews-'));
const browser = await chromium.launch({ channel: process.env.PREVIEW_BROWSER_CHANNEL || 'chrome' });
const page = await browser.newPage();
const mime = (url: string) => url.endsWith('.svg') ? 'image/svg+xml' : url.endsWith('.jpg') ? 'image/jpeg' : url.endsWith('.webp') ? 'image/webp' : 'image/png';
const dataUrl = (bytes: Buffer, type: string) => `data:${type};base64,${bytes.toString('base64')}`;
const manifest: { cabinets: Record<string, string>; catalog: Record<string, string> } = { cabinets: {}, catalog: {} };
let cabinetBytes = 0, catalogBytes = 0, sourceBytes = 0;

try {
  const urls = [...new Set(Object.values(CABINET_ARTWORK).flatMap(art => [art.background, ...art.layers.map(layer => layer.url)]))];
  const images: Record<string, string> = {};
  for (const url of urls) {
    const bytes = await readFile(path.join(publicRoot, url));
    sourceBytes += bytes.length;
    images[url] = dataUrl(bytes, mime(url));
  }
  await page.addScriptTag({ content: `window.__name = value => value; window.paintGirlhubLogo = ${paintGirlhubLogo.toString()};` });

  for (const [id, artwork] of Object.entries(CABINET_ARTWORK)) {
    const renders = await page.evaluate(async ({ id, artwork, images, catalog }) => {
      const decoded: Record<string, HTMLImageElement> = {};
      for (const url of [artwork.background, ...artwork.layers.map(layer => layer.url)]) {
        if (decoded[url]) continue;
        const image = new Image();
        image.src = images[url];
        await image.decode();
        decoded[url] = image;
      }
      const canvas = document.createElement('canvas');
      canvas.width = 184; canvas.height = 168;
      const context = canvas.getContext('2d')!;
      context.scale(4, 4);
      context.beginPath(); context.rect(0, 0, 46, 42); context.clip();
      const background = decoded[artwork.background];
      const scale = Math.max(46 / background.width, 42 / background.height);
      const width = background.width * scale, height = background.height * scale;
      context.drawImage(background, (46 - width) * (artwork.focus ?? .5), (42 - height) / 2, width, height);
      for (const layer of artwork.layers) {
        const image = decoded[layer.url], source = layer.source ?? [0, 0, image.width, image.height];
        context.drawImage(image, ...source, ...layer.target);
      }
      const glass = context.createLinearGradient(0, 0, 46, 42);
      glass.addColorStop(0, '#ffffff24'); glass.addColorStop(.5, '#ffffff00'); glass.addColorStop(1, '#06122133');
      context.fillStyle = glass; context.fillRect(0, 0, 46, 42);
      if (id === 'studio-afterglow') (window as any).paintGirlhubLogo(context, 1, 1, 44, 10);
      const cabinet = canvas.toDataURL('image/png');
      if (!catalog) return { cabinet };
      const thumbnail = document.createElement('canvas');
      thumbnail.width = Math.min(480, background.width);
      thumbnail.height = Math.round(thumbnail.width * background.height / background.width);
      thumbnail.getContext('2d')!.drawImage(background, 0, 0, thumbnail.width, thumbnail.height);
      return { cabinet, catalog: thumbnail.toDataURL('image/png') };
    }, { id, artwork, images, catalog: (ACTIVE_STUDIO_GAMES as readonly string[]).includes(id) });

    for (const kind of ['cabinet', 'catalog'] as const) {
      const pngUrl = renders[kind];
      if (!pngUrl) continue;
      const png = path.join(temporary, `${id}-${kind}.png`), webp = path.join(temporary, `${id}-${kind}.webp`);
      await writeFile(png, Buffer.from(pngUrl.split(',')[1], 'base64'));
      execFileSync(process.env.CWEBP || 'cwebp', ['-quiet', ...(kind === 'cabinet' ? ['-lossless', '-exact', '-z', '6'] : ['-q', '88', '-m', '6']), png, '-o', webp]);
      const bytes = await readFile(webp);
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      const filename = `${id}-${kind}.${hash}.webp`;
      manifest[kind === 'cabinet' ? 'cabinets' : 'catalog'][id] = `/assets/startup-previews/${filename}`;
      if (kind === 'cabinet') {
        cabinetBytes += bytes.length;
        const mismatch = await page.evaluate(async ({ original, preview }) => {
          const decode = async (url: string) => {
            const image = new Image(); image.src = url; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const [before, after] = await Promise.all([decode(original), decode(preview)]);
          return before.length !== after.length || before.some((value, index) => value !== after[index]);
        }, { original: pngUrl, preview: dataUrl(bytes, 'image/webp') });
        if (mismatch) throw new Error(`${id}: lossless preview differs from the original composition`);
      } else catalogBytes += bytes.length;
      if (check) {
        const existing = await readFile(path.join(output, filename));
        if (!existing.equals(bytes)) throw new Error(`Stale preview: ${filename}`);
      } else {
        await mkdir(output, { recursive: true });
        await writeFile(path.join(output, filename), bytes);
      }
    }
  }
  if (cabinetBytes > 750000 || catalogBytes > 400000 || cabinetBytes + catalogBytes > sourceBytes / 10) throw new Error('Startup preview transfer budget exceeded');
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (check) {
    if (await readFile(manifestPath, 'utf8') !== json) throw new Error('Startup preview manifest is stale');
  } else await writeFile(manifestPath, json);
  console.log(JSON.stringify({ checked: check, cabinets: Object.keys(manifest.cabinets).length, catalog: Object.keys(manifest.catalog).length, sourceBytes, cabinetBytes, catalogBytes, savedBytes: sourceBytes - cabinetBytes - catalogBytes, cabinetPixelsMatch: true }));
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
