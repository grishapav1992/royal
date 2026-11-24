import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Transparent exports of the same ImageGen masters. Only the black connected to
// the outer edge of every hero panel is removed; no character pixels are redrawn.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = 9;
const exports = [];
for (const team of ['night', 'eclipse', 'chrono']) {
  const input = path.join(root, 'games/neopolis/assets/source/team-' + team + '-v3.png');
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, panel = Math.floor(width / 3);
  const background = new Uint8Array(width * height), queue = [];
  for (let hero = 0; hero < 3; hero++) {
    const left = hero * panel, right = hero === 2 ? width - 1 : left + panel - 1;
    const push = (x, y) => {
      const i = y * width + x;
      if (background[i] || Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) > edge) return;
      background[i] = 1; queue.push(i);
    };
    for (let y = 0; y < height; y++) { push(left, y); push(right, y); }
    for (let x = left; x <= right; x++) push(x, 0);
    while (queue.length) {
      const i = queue.pop(), x = i % width, y = (i / width) | 0;
      if (x > left) push(x - 1, y);
      if (x < right) push(x + 1, y);
      if (y) push(x, y - 1);
      if (y < height - 1) push(x, y + 1);
    }
  }
  const mask = Buffer.alloc(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = background[i] ? 0 : 255;
  const soft = await sharp(mask, { raw: { width, height, channels: 1 } }).blur(1.2).extractChannel(0).raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = Math.min(mask[i], Math.max(0, Math.round((soft[i] - 70) * 1.6)));
  }
  const bytes = await sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ quality: 90, alphaQuality: 90 }).toBuffer();
  const file = '/assets/neopolis/team-' + team + '-v4.webp';
  await writeFile(path.join(root, 'public' + file), bytes);
  exports.push({ file, width, height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const manifest = path.join(root, 'games/neopolis/assets/exports.json'), current = JSON.parse(await readFile(manifest, 'utf8'));
current.files = [...current.files.filter(item => !/team-\w+-v4\.webp$/.test(item.file)), ...exports];
current.gameBytes = current.files.filter(item => !/cover-(catalog|cabinet)/.test(item.file)).reduce((sum, item) => sum + item.bytes, 0);
current.teamExport = 'sharp WebP, quality 90 with alpha; edge-connected black removed from each panel';
await writeFile(manifest, JSON.stringify(current, null, 2) + '\n');
console.log(JSON.stringify(exports));
