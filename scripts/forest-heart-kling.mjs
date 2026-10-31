import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Development tool only. Never imported by the host or game package.
const root = resolve(import.meta.dirname, '..');
const base = 'https://api.a6api.vip';
const [action, clip = 'idle'] = process.argv.slice(2);
const fresh = ['look', 'focus', 'magic'].includes(clip);
const folder = resolve(process.env.FOREST_KLING_WORK || resolve(root, fresh ? '../generation-v3' : '../generation-reference'));
const faithful = 'Animate only the supplied reference image of the adult elf. It is the exact first frame. Preserve the face, body proportions, hairstyle, clothing, jewelry, crystal and framing exactly. Locked camera. Keep the background unchanged and still. No zoom, scene change, redesign, added objects, text or large gestures. Five seconds total: hold the reference for 0.25 seconds, perform one tiny gesture during seconds 0.25-2.25, return naturally to the exact reference posture by second 2.75, then hold that posture until the end. Silent. ';
const prompts = {
  idle: 'Animate only the adult elven forest guardian in this reference image. Preserve her exact face, silver hair, pointed ears, emerald and purple costume, gold jewelry and emerald crystal. Locked camera, identical framing and body scale throughout. Gentle natural breathing, a single soft blink, a tiny calm head movement, a few strands of hair and sleeve fabric drifting softly. Her hands and crystal stay in place. Return to the exact starting pose at the end for a seamless five second idle loop. Keep the entire background perfectly flat pure blue RGB 0 0 255 with no gradients, scenery, shadows, light spill or particles on the background. High quality fantasy game character animation. Silent.',
  channel: 'Animate only the adult elven forest guardian in this reference image. Preserve her exact face, silver hair, pointed ears, emerald and purple costume, gold jewelry and emerald crystal. Locked camera, identical framing and body scale throughout. She gives a restrained graceful nod toward the game board on the left of the image and gently lifts the hand holding the emerald crystal, channeling a soft mint glow contained near her hand. No large arm swing. Hair and sleeve follow subtly. She calmly returns to the exact starting pose by the end of five seconds. Keep the entire background perfectly flat pure blue RGB 0 0 255 with no gradients, scenery, shadows, light spill or particles on the background. High quality fantasy game character animation. Silent.',
  look: faithful + 'One very small acknowledging nod and one natural blink. The crystal and both hands stay still. Only a few hair strands move softly.',
  focus: faithful + 'She briefly glances slightly toward the game board on the left, with a tiny head turn, then looks back at the viewer. Hands, shoulders and crystal remain still.',
  magic: faithful + 'She gently lifts the crystal hand only a few centimeters, gives the crystal a restrained warm glance, then lowers it back to the original position. A very soft glow stays inside the existing crystal; no flying effects or particles.',
};
if (!Object.hasOwn(prompts, clip)) throw Error('Choose look, focus or magic (idle/channel query historical tasks)');
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
  const source = await readFile(resolve(root, 'public/assets/forest-heart/v3/elf-idle.webp'));
  const opaque = fresh ? await sharp(source).flatten({background:'#000000'}).png().toBuffer() : null;
  const reference = fresh ? await sharp(opaque).extend({top:256,bottom:256,left:40,right:40,background:'#000000'}).png().toBuffer() : await sharp(source).resize(720, 1280, { fit: 'contain', background: '#0000ff' }).flatten({ background: '#0000ff' }).png().toBuffer();
  if (fresh) {
    const originalPixels = await sharp(source).flatten({background:'#000000'}).raw().toBuffer();
    const submittedPixels = await sharp(reference).extract({left:40,top:256,width:640,height:768}).removeAlpha().raw().toBuffer();
    if (!originalPixels.equals(submittedPixels)) throw Error('Reference pixels changed');
  }
  await writeFile(resolve(folder, 'reference.png'), reference);
  const seconds = 5;
  const body = { model: 'kling-3.0', prompt: prompts[clip], seconds: String(seconds), size: '720x1280', metadata: { duration: seconds, resolution: '720p', sound: 'off', mode: 'std', negative_prompt: 'camera movement, zoom, scene change, new characters, changed face, changed clothes, extra fingers, extra limbs, text, watermark, background details, background shadows' } };
  const form = new FormData();
  for (const name of ['model', 'prompt', 'seconds', 'size']) form.set(name, body[name]);
  form.set('metadata', JSON.stringify(body.metadata));
  form.set('input_reference', new Blob([reference], { type: 'image/png' }), 'forest-elf.png');
  // Persist before sending. A network timeout is ambiguous and must never trigger an automatic second charge.
  receipt = { clip, model: body.model, duration: seconds, targetDuration: fresh ? 3 : 5, requestFormat: 'multipart/input_reference', size: body.size, submittedAt: new Date().toISOString(), originalReferenceSha256: createHash('sha256').update(source).digest('hex'), referenceSha256: createHash('sha256').update(reference).digest('hex'), unchangedReferenceColorsOverBlack: fresh, padding: fresh ? {top:256,bottom:256,left:40,right:40,color:'#000000'} : null, prompt: body.prompt, status: 'submission-in-progress' };
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
