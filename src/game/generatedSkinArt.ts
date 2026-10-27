import { skinAssetUrl } from '../shared/skinStudio';
import type { Facing } from '../shared/movement';

const sheets = new Map<string, HTMLImageElement>();
const requests = new Map<string, Promise<HTMLImageElement>>();
export function loadSkinSheet(id: string) {
  if (sheets.has(id)) return Promise.resolve(sheets.get(id)!);
  const pending = requests.get(id); if (pending) return pending;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.decoding = 'async';
    img.onload = () => {
      if (img.naturalWidth !== 1024 || img.naturalHeight !== 1536) { reject(new Error('Invalid skin atlas')); return; }
      sheets.set(id, img);
      if (sheets.size > 48) sheets.delete(sheets.keys().next().value!);
      window.dispatchEvent(new CustomEvent('royal-skin-loaded', { detail: id })); resolve(img);
    };
    img.onerror = () => reject(new Error('Skin artwork unavailable'));
    img.src = skinAssetUrl(id);
  }).finally(() => requests.delete(id));
  requests.set(id, promise); return promise;
}
export function hasSkinSheet(id: string) { return sheets.has(id); }

/** Native drawing coordinates match the existing 32 by 48 character atlas. */
export function drawGeneratedSkin(c: CanvasRenderingContext2D, id: string, facing: Facing, frame: number, seated = false, sip = -1) {
  const image = sheets.get(id); if (!image) return false;
  const row = ['down', 'left', 'right', 'up'].indexOf(facing);
  const walking = frame < 6, gaming = frame >= 28, winning = frame >= 34 && frame < 40, losing = frame >= 40;
  // Each prepared pose is a complete figure, including its connected arms and legs.
  const pose = seated || gaming ? 3 : walking ? [0, 1, 1, 0, 2, 2][frame] : 0;
  const phase = frame % 6 / 6 * Math.PI * 2;
  const bounce = winning ? -Math.max(0, Math.sin(phase)) * 1.1 : 0;
  c.save(); c.beginPath(); c.rect(0, -8, 32, 48); c.clip();
  c.translate(16, 39 + bounce); c.rotate((losing ? Math.sin(phase) * .025 : winning ? Math.sin(phase) * .04 : 0));
  c.drawImage(image, pose * 256, row * 384, 256, 384, -16, -47, 32, 48);
  c.restore();
  if (sip >= 0 && facing !== 'up') {
    // A cup follows the existing six-phase drinking cycle; body artwork remains intact.
    const lift = [0, .4, 1, 1, .4, 0][sip % 6];
    c.save(); c.translate(facing === 'left' ? 11 : 22, 24 - lift * 8);
    c.rotate((facing === 'left' ? -1 : 1) * lift * .4);
    c.fillStyle = '#f0d99b'; c.strokeStyle = '#44362c'; c.lineWidth = .5;
    c.beginPath(); c.roundRect(-2, -4, 4, 5, .5); c.fill(); c.stroke(); c.restore();
  }
  return true;
}
