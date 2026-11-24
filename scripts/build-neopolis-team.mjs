import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Transparent exports of the same ImageGen masters. The silhouettes in
// assets/source/masks come from Apple Vision (scripts/neopolis-subject-mask.swift).
// Light outside a silhouette (armour glow, lightning) was painted over black, so
// it becomes real transparency instead of a dark patch. No pixels are redrawn.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const heroes = ['granite', 'impulse', 'prism'];
const floor = 14, rim = 9, version = 'v5';
const step = (from, to, value) => { const t = Math.max(0, Math.min(1, (value - from) / (to - from))); return t * t * (3 - 2 * t); };

/** Distance to the nearest outside pixel, up to the rim width. */
function depth(mask, width, height) {
  const out = new Uint8Array(width * height).fill(rim); let edge = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] < 128) { out[i] = 0; edge.push(i); }
  for (let d = 1; d < rim; d++) {
    const next = [];
    for (const i of edge) {
      const x = i % width, y = (i / width) | 0;
      for (const j of [x ? i - 1 : i, x < width - 1 ? i + 1 : i, y ? i - width : i, y < height - 1 ? i + width : i]) if (out[j] > d) { out[j] = d; next.push(j); }
    }
    edge = next;
  }
  return out;
}
/** Keep the figure and everything attached to it; drop stray fragments of a neighbour. */
function attached(alpha, width, height) {
  const label = new Int32Array(alpha.length); let best = 0, size = 0, current = 0;
  for (let start = 0; start < alpha.length; start++) {
    if (label[start] || alpha[start] < .03) continue;
    current++; const queue = [start]; label[start] = current; let count = 0;
    while (queue.length) {
      const i = queue.pop(), x = i % width, y = (i / width) | 0; count++;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && !label[j] && alpha[j] >= .03) { label[j] = current; queue.push(j); }
      }
    }
    if (count > size) { size = count; best = current; }
  }
  for (let i = 0; i < alpha.length; i++) if (label[i] !== best) alpha[i] = 0;
}

const exports = [];
for (const team of ['night', 'eclipse', 'chrono']) {
  const source = path.join(root, 'games/neopolis/assets/source');
  const { data, info } = await sharp(path.join(source, 'team-' + team + '-v3.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, out = Buffer.alloc(width * height * 4);
  for (const [index, hero] of heroes.entries()) {
    const left = Math.round(index * width / 3), panel = Math.round((index + 1) * width / 3) - left;
    const mask = await sharp(path.join(source, 'masks', team + '-' + hero + '.png')).resize(panel, height, { fit: 'fill' }).extractChannel(0).raw().toBuffer();
    const inside = depth(mask, panel, height), alpha = new Float32Array(panel * height), gain = new Float32Array(panel * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < panel; x++) {
      const j = y * panel + x, i = (y * width + left + x) * 3, peak = Math.max(data[i], data[i + 1], data[i + 2]);
      // Near the outline near-black pixels are the old backdrop between curls and fingers.
      const near = inside[j] / rim, body = mask[j] / 255 * (near + (1 - near) * step(8, 40, peak));
      const light = Math.max(0, Math.min(1, (peak - floor) / (255 - floor)));
      alpha[j] = body + (1 - body) * light;
      gain[j] = alpha[j] ? (body + (1 - body) * light * Math.min(255 / Math.max(1, peak), 1 / Math.max(light, .02))) / alpha[j] : 1;
    }
    attached(alpha, panel, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < panel; x++) {
      const j = y * panel + x, i = y * width + left + x;
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.min(255, Math.round(data[i * 3 + c] * gain[j]));
      out[i * 4 + 3] = Math.round(alpha[j] * 255);
    }
  }
  const bytes = await sharp(out, { raw: { width, height, channels: 4 } }).webp({ quality: 88, alphaQuality: 90 }).toBuffer();
  const file = '/assets/neopolis/team-' + team + '-' + version + '.webp';
  await writeFile(path.join(root, 'public' + file), bytes);
  exports.push({ file, width, height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const manifest = path.join(root, 'games/neopolis/assets/exports.json'), current = JSON.parse(await readFile(manifest, 'utf8'));
current.files = [...current.files.filter(item => !/team-\w+-v[45]\.webp$/.test(item.file)), ...exports];
current.gameBytes = current.files.filter(item => !/cover-(catalog|cabinet)/.test(item.file)).reduce((sum, item) => sum + item.bytes, 0);
current.teamExport = 'sharp WebP, quality 88 with alpha; Apple Vision silhouettes, light outside them kept as transparency';
await writeFile(manifest, JSON.stringify(current, null, 2) + '\n');
console.log(JSON.stringify(exports.map(item => [item.file, item.bytes])));
