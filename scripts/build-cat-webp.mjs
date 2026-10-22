import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Commit generated assets so application builds do not require an image encoder.
const sources = {
  body: 'zverochka-atlas.png',
  habits: 'zverochka-habits.png',
  climb: 'zverochka-climb.png',
  scratch: 'zverochka-scratch.png',
  walk: 'zverochka-walk-v4.png',
};
const directory = resolve('public/assets/cat');
mkdirSync(resolve(directory, 'optimized'), { recursive: true });
const images = {};
let before = 0, after = 0;
for (const [name, source] of Object.entries(sources)) {
  const input = resolve(directory, source);
  const output = resolve(directory, 'optimized', `${name}.webp`);
  execFileSync(process.env.CWEBP || 'cwebp', ['-quiet', '-lossless', '-exact', '-m', '6', input, '-o', output]);
  const bytes = readFileSync(output);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const filename = `${name}-${digest}.webp`;
  writeFileSync(resolve(directory, 'optimized', filename), bytes);
  unlinkSync(output);
  images[name] = `/assets/cat/optimized/${filename}`;
  before += readFileSync(input).length;
  after += bytes.length;
}
// This is frame 17 with the same eight-pixel margin used by CatRenderer.
const portrait = resolve(directory, 'optimized', 'portrait.webp');
execFileSync(process.env.CWEBP || 'cwebp', ['-quiet', '-lossless', '-exact', '-crop', '342', '1066', '209', '290',
  resolve(directory, sources.body), '-o', portrait]);
const portraitBytes = readFileSync(portrait);
const portraitName = `portrait-${createHash('sha256').update(portraitBytes).digest('hex').slice(0, 12)}.webp`;
writeFileSync(resolve(directory, 'optimized', portraitName), portraitBytes);
unlinkSync(portrait);
images.portrait = `/assets/cat/optimized/${portraitName}`;
writeFileSync(resolve('src/game/catImages.json'), JSON.stringify(images, null, 2) + '\n');
console.log(JSON.stringify({ before, after, saved: before - after, images }, null, 2));
