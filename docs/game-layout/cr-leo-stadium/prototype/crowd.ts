/** Stands move as one smooth cloth: narrow columns of the untouched photo, never torn cells. */
export const CROWD_TOP = 160, CROWD_HEIGHT = 270, PLATE_W = 1536, PLATE_STAND = 446;
export type CrowdFrames = { layer: HTMLCanvasElement };
export async function bakeCrowd(plate: HTMLImageElement, mask: HTMLImageElement, pause: () => Promise<unknown>): Promise<CrowdFrames> {
  const layer = document.createElement('canvas'); layer.width = PLATE_W; layer.height = CROWD_HEIGHT;
  const c = layer.getContext('2d')!; c.drawImage(mask, 0, 0, PLATE_W, CROWD_HEIGHT); c.globalCompositeOperation = 'source-in'; c.drawImage(plate, 0, -CROWD_TOP);
  await pause(); return { layer };
}
export type Plate = { scale: number; x: number; y: number };
export function platePlacement(width: number, standBottom: number): Plate {
  const scale = Math.max(width / PLATE_W, standBottom / PLATE_STAND);
  return { scale, x: (width - PLATE_W * scale) / 2, y: standBottom - PLATE_STAND * scale };
}
export function drawCrowd(c: CanvasRenderingContext2D, f: CrowdFrames, at: Plate, seconds: number, excitement: (u: number) => number, width: number) {
  const top = at.y + CROWD_TOP * at.scale, h = CROWD_HEIGHT * at.scale, step = 8; c.save();
  for (let x = 0; x < PLATE_W; x += step) {
    const sx = at.x + x * at.scale, sw = step * at.scale; if (sx + sw < 0 || sx > width) continue;
    const e = Math.max(0, Math.min(1, excitement((sx + sw / 2) / width)));
    if (e < .01) continue;
    const lift = (1.1 + 1.1 * Math.sin(x * .031 - seconds * 8.5)) * e * 1.5 * at.scale;
    c.globalAlpha = 1; c.drawImage(f.layer, x, 0, step, CROWD_HEIGHT, sx, top - lift, sw + .4, h);
    if (e > .3) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = (e - .3) * .16; c.drawImage(f.layer, x, 0, step, CROWD_HEIGHT, sx, top - lift, sw + .4, h); c.globalCompositeOperation = 'source-over'; }
  }
  c.restore();
}

import SKY from './sky-edge.json';
export function drawClouds(c: CanvasRenderingContext2D, clouds: HTMLImageElement, at: Plate, seconds: number) {
  c.save(); c.beginPath(); c.moveTo(at.x, at.y - 400);
  (SKY as number[]).forEach((y, i) => c.lineTo(at.x + i * 12 * at.scale, at.y + y * at.scale));
  c.lineTo(at.x + PLATE_W * at.scale, at.y - 400); c.closePath(); c.clip();
  const w = PLATE_W * at.scale, h = 200 * at.scale, drift = seconds * 3 * at.scale % w;
  for (const k of [-1, 0]) c.drawImage(clouds, at.x + drift + k * w, at.y, w, h);
  c.restore();
}
