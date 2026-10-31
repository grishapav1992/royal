import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Development tool only. Never imported by the host or game package.
const root = resolve(import.meta.dirname, '..');
const folder = resolve(process.env.FOREST_KLING_WORK || resolve(root, '../generation-reference'));
const base = 'https://api.a6api.vip';
const [action, clip = 'idle'] = process.argv.slice(2);
const prompts = {
  idle: 'Animate only the adult elven forest guardian in this reference image. Preserve her exact face, silver hair, pointed ears, emerald and purple costume, gold jewelry and emerald crystal. Locked camera, identical framing and body scale throughout. Gentle natural breathing, a single soft blink, a tiny calm head movement, a few strands of hair and sleeve fabric drifting softly. Her hands and crystal stay in place. Return to the exact starting pose at the end for a seamless five second idle loop. Keep the entire background perfectly flat pure blue RGB 0 0 255 with no gradients, scenery, shadows, light spill or particles on the background. High quality fantasy game character animation. Silent.',
  channel: 'Animate only the adult elven forest guardian in this reference image. Preserve her exact face, silver hair, pointed ears, emerald and purple costume, gold jewelry and emerald crystal. Locked camera, identical framing and body scale throughout. She gives a restrained graceful nod toward the game board on the left of the image and gently lifts the hand holding the emerald crystal, channeling a soft mint glow contained near her hand. No large arm swing. Hair and sleeve follow subtly. She calmly returns to the exact starting pose by the end of five seconds. Keep the entire background perfectly flat pure blue RGB 0 0 255 with no gradients, scenery, shadows, light spill or particles on the background. High quality fantasy game character animation. Silent.',
};
if (!Object.hasOwn(prompts, clip)) throw Error('Choose idle or channel');
await mkdir(folder, { recursive: true });
const receiptPath = resolve(folder, clip + '.json');
let receipt = await readFile(receiptPath, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const keyPath = process.env.A6API_ENV_FILE;
if (!keyPath) throw Error('Set A6API_ENV_FILE to the existing local environment file');
const key = parseEnv(await readFile(keyPath, 'utf8')).A6API_KEY?.trim();
if (!key) throw Error('A6API_KEY is missing');
const safe = value => JSON.parse(JSON.stringify(value).replaceAll(key, '[redacted]').replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[reference image]'));
async function api(path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(90000) });
  const body = await response.json();
  return { httpStatus: response.status, body: safe(body) };
}
if (action === 'submit') {
  if (receipt) throw Error('A submission receipt already exists. Query it instead of submitting twice.');
  const reference = await sharp(resolve(root, 'public/assets/forest-heart/v3/elf-idle.webp')).resize(720, 1280, { fit: 'contain', background: '#0000ff' }).flatten({ background: '#0000ff' }).png().toBuffer();
  await writeFile(resolve(folder, 'reference.png'), reference);
  const body = { model: 'kling-3.0', prompt: prompts[clip], seconds: '5', size: '720x1280', metadata: { duration: 5, resolution: '720p', sound: 'off', mode: 'std', negative_prompt: 'camera movement, zoom, scene change, new characters, changed face, extra fingers, extra limbs, text, watermark, background details, background shadows' } };
  const form = new FormData();
  for (const name of ['model', 'prompt', 'seconds', 'size']) form.set(name, body[name]);
  form.set('metadata', JSON.stringify(body.metadata));
  form.set('input_reference', new Blob([reference], { type: 'image/png' }), 'forest-elf.png');
  // Persist before sending. A network timeout is ambiguous and must never trigger an automatic second charge.
  receipt = { clip, model: body.model, duration: 5, requestFormat: 'multipart/input_reference', size: body.size, submittedAt: new Date().toISOString(), referenceSha256: createHash('sha256').update(reference).digest('hex'), prompt: body.prompt, status: 'submission-in-progress' };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  const result = await api('/v1/videos', { method: 'POST', body: form });
  receipt.result = result;
  receipt.taskId = result.body.id || result.body.task_id || result.body.data?.task_id || result.body.data?.id;
  receipt.status = receipt.taskId ? 'accepted' : 'rejected';
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ clip, ...result, taskId: receipt.taskId }, null, 2));
} else if (action === 'status') {
  if (!receipt?.taskId) throw Error('No accepted task for this clip');
  const result = await api('/v1/videos/' + encodeURIComponent(receipt.taskId));
  receipt.latest = result; await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ clip, ...result }, null, 2));
} else if (action === 'download') {
  if (!receipt?.taskId) throw Error('No accepted task for this clip');
  const response = await fetch(base + '/v1/videos/' + encodeURIComponent(receipt.taskId) + '/content', { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('video/')) throw Error('Content unavailable: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 80 * 1024 * 1024) throw Error('Unexpectedly large clip');
  await writeFile(resolve(folder, clip + '-source.mp4'), bytes);
  receipt.download = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ clip, ...receipt.download }));
} else throw Error('Use submit, status or download');
