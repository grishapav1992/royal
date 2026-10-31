import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const folder = resolve(root, '../seedance');
const receiptPath = resolve(folder, 'trial.json');
const [action] = process.argv.slice(2);
const envFile = process.env.A6API_ENV_FILE;
if (!envFile) throw Error('Set A6API_ENV_FILE to the existing local environment file');
const key = parseEnv(await readFile(envFile, 'utf8')).A6API_KEY?.trim();
if (!key) throw Error('A6API_KEY is missing');
await mkdir(folder, { recursive: true });
let receipt = await readFile(receiptPath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const base = 'https://api.a6api.vip';
const safe = value => JSON.parse(JSON.stringify(value).replaceAll(key, '[redacted]'));
async function api(path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(90000) });
  return { httpStatus: response.status, body: safe(await response.json()) };
}
if (action === 'submit') {
  if (receipt) throw Error('The single trial already has a receipt. Query it instead of submitting again.');
  const referencePath = 'public/assets/forest-heart/v3/elf-idle.webp';
  const reference = await readFile(resolve(root, referencePath));
  const prompt = 'Animate the exact adult elf in the supplied reference image. Keep the same face, body proportions, silver hairstyle, ears, costume, jewelry, crystal and framing. Locked camera. Only a tiny calm head turn, one natural blink, gentle breathing and subtle hair movement. Hands and crystal remain still. Return gently to the starting pose. No scene change, no redesign, no new objects, no text. Silent.';
  const form = new FormData();
  form.set('model', 'doubao-seedance-2.0-fast'); form.set('prompt', prompt); form.set('seconds', '4'); form.set('size', '480x576');
  form.set('metadata', JSON.stringify({ duration: 4, resolution: '480p', ratio: 'adaptive', generate_audio: false, watermark: false }));
  form.set('input_reference', new Blob([reference], { type: 'image/webp' }), 'elf-idle.webp');
  receipt = { model: 'doubao-seedance-2.0-fast', seconds: 4, resolution: '480p', referencePath, referenceBytes: reference.length, referenceSha256: createHash('sha256').update(reference).digest('hex'), referenceUnmodified: true, requestFormat: 'multipart/input_reference', prompt, submittedAt: new Date().toISOString(), status: 'submission-in-progress' };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  const result = await api('/v1/videos', { method: 'POST', body: form });
  receipt.result = result; receipt.taskId = result.body.id || result.body.task_id || result.body.data?.id || result.body.data?.task_id;
  receipt.status = receipt.taskId ? 'accepted' : 'rejected';
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(result, null, 2));
} else if (action === 'status') {
  if (!receipt?.taskId) throw Error('No accepted trial to query');
  const result = await api('/v1/videos/' + encodeURIComponent(receipt.taskId));
  receipt.latest = result; await writeFile(receiptPath, JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(result, null, 2));
} else if (action === 'download') {
  if (!receipt?.taskId) throw Error('No accepted trial to download');
  const response = await fetch(base + '/v1/videos/' + encodeURIComponent(receipt.taskId) + '/content', { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('video/')) throw Error('Content unavailable: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 80 * 1024 * 1024) throw Error('Unexpectedly large trial');
  await writeFile(resolve(folder, 'trial.mp4'), bytes);
  receipt.download = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt.download));
} else throw Error('Use submit, status or download');
