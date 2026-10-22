import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Technical exports of ImageGen masters. Character composition and source pixels
// stay in assets/source; normal module builds use committed WebP files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'games/neopolis/assets/source');
const output = path.join(root, 'public/assets/neopolis');
const names = ['city', 'granite', 'impulse', 'prism', 'null', 'symbols', 'cover'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let sourceBytes = 0, gameBytes = 0;
const exports = [];
try {
  const page = await browser.newPage();
  await mkdir(output, { recursive: true });
  for (const name of names) {
    const input = await readFile(path.join(source, name + '-v2.png'));
    sourceBytes += input.length;
    const versions = await page.evaluate(async ({ data, cover }) => {
      const image = new Image(); image.src = data; await image.decode();
      const encode = (width, height, crop = false) => {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (crop) {
          const scale = Math.max(width / image.width, height / image.height);
          ctx.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
        } else ctx.drawImage(image, 0, 0, width, height);
        return { data: canvas.toDataURL('image/webp', .94), width, height };
      };
      return [
        { suffix: '', ...encode(image.width, image.height) },
        ...(cover ? [
          { suffix: '-catalog', ...encode(480, Math.round(480 * image.height / image.width)) },
          { suffix: '-cabinet', ...encode(184, 168, true) },
        ] : []),
      ];
    }, { data: 'data:image/png;base64,' + input.toString('base64'), cover: name === 'cover' });
    for (const item of versions) {
      const bytes = Buffer.from(item.data.split(',')[1], 'base64');
      const filename = name + item.suffix + '-v2.webp';
      await writeFile(path.join(output, filename), bytes);
      if (!item.suffix) gameBytes += bytes.length;
      exports.push({ file: '/assets/neopolis/' + filename, width: item.width, height: item.height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await writeFile(path.join(root, 'games/neopolis/assets/exports.json'), JSON.stringify({ generator: 'Built-in ImageGen', export: 'Chrome Canvas WebP, quality 0.94; original dimensions except hall thumbnails', sourceBytes, gameBytes, files: exports }, null, 2) + '\n');
  console.log(JSON.stringify({ sourceBytes, gameBytes, files: exports.length, savedPercent: Math.round((1 - gameBytes / sourceBytes) * 100) }));
} finally { await browser.close(); }

