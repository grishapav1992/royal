/** Stands move as one smooth cloth: narrow columns of the untouched photo, never torn cells. */
export const CROWD_TOP = 160, CROWD_HEIGHT = 270, PLATE_W = 1536, PLATE_STAND = 446;
/** The approved plate seen only through the mask of the seats. */
export function crowdLayer(plate: HTMLImageElement, mask: HTMLImageElement): HTMLCanvasElement {
  const layer = document.createElement('canvas'); layer.width = PLATE_W; layer.height = CROWD_HEIGHT;
  const c = layer.getContext('2d')!; c.drawImage(mask, 0, 0, PLATE_W, CROWD_HEIGHT); c.globalCompositeOperation = 'source-in'; c.drawImage(plate, 0, -CROWD_TOP);
  return layer;
}
export type Plate = { scale: number; x: number; y: number };
export function platePlacement(width: number, standBottom: number): Plate {
  const scale = Math.max(width / PLATE_W, standBottom / PLATE_STAND);
  return { scale, x: (width - PLATE_W * scale) / 2, y: standBottom - PLATE_STAND * scale };
}
export function drawCrowd(c: CanvasRenderingContext2D, layer: HTMLCanvasElement, at: Plate, seconds: number, excitement: (u: number) => number, width: number) {
  const top = at.y + CROWD_TOP * at.scale, h = CROWD_HEIGHT * at.scale, step = 8; c.save();
  for (let x = 0; x < PLATE_W; x += step) {
    const sx = at.x + x * at.scale, sw = step * at.scale; if (sx + sw < 0 || sx > width) continue;
    const e = Math.max(0, Math.min(1, excitement((sx + sw / 2) / width)));
    if (e < .01) continue;
    const lift = (1.1 + 1.1 * Math.sin(x * .031 - seconds * 8.5)) * e * 1.5 * at.scale;
    c.globalAlpha = 1; c.drawImage(layer, x, 0, step, CROWD_HEIGHT, sx, top - lift, sw + .4, h);
    if (e > .3) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = (e - .3) * .16; c.drawImage(layer, x, 0, step, CROWD_HEIGHT, sx, top - lift, sw + .4, h); c.globalCompositeOperation = 'source-over'; }
  }
  c.restore();
}

/** Roof line of the plate, one height per twelve source pixels. Clouds are clipped to the sky above it. */
const SKY = [0,0,0,0,0,0,2,9,17,30,32,40,49,53,66,76,78,86,90,92,95,102,103,115,118,118,129,133,138,140,145,148,151,154,157,159,160,163,164,166,167,169,170,171,172,173,174,175,176,176,177,178,178,179,179,180,180,181,181,181,182,182,182,182,182,182,182,182,182,182,182,182,182,181,181,180,179,179,178,178,178,177,176,175,174,174,173,172,171,170,168,167,165,163,161,159,156,154,151,148,145,142,129,127,121,115,110,110,106,98,93,88,82,76,70,65,58,51,44,39,33,27,20,13,5,0,0,0];
export function drawClouds(c: CanvasRenderingContext2D, clouds: HTMLImageElement, at: Plate, seconds: number) {
  c.save(); c.beginPath(); c.moveTo(at.x, at.y - 400);
  SKY.forEach((y, i) => c.lineTo(at.x + i * 12 * at.scale, at.y + y * at.scale));
  c.lineTo(at.x + PLATE_W * at.scale, at.y - 400); c.closePath(); c.clip();
  const w = PLATE_W * at.scale, h = 200 * at.scale, drift = seconds * 3 * at.scale % w;
  for (const k of [-1, 0]) c.drawImage(clouds, at.x + drift + k * w, at.y, w, h);
  c.restore();
}
