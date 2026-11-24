import type { ForestGeometry } from './ForestLayout';

/** The living frame. Sides repeat mirrored, so neighbouring pieces always meet on the same pixels. */
export function paintForestFrame(x: CanvasRenderingContext2D, g: ForestGeometry, art: HTMLImageElement) {
  const { board: b, frame, pad } = g, k = frame / 118, start = pad, end = pad + b, corner = 60;
  const inner = { left: 184, right: 839, top: 171, bottom: 828 }, right = 1024 - inner.right, bottom = 1024 - inner.bottom;
  x.clearRect(0, 0, b + pad * 2 + g.flower + 9, b + pad * 2 + 9);
  if (!art.complete || !art.naturalWidth) return;
  const draw = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => x.drawImage(art, sx, sy, sw, sh, dx, dy, dw, dh);
  x.save(); x.shadowColor = '#000b'; x.shadowBlur = 12; x.shadowOffsetY = 5;
  const side = (horizontal: boolean, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => {
    const count = Math.max(1, Math.round(b / ((horizontal ? sw : sh) * k))), step = b / count;
    for (let i = 0; i < count; i++) {
      x.save(); const flip = i % 2;
      if (horizontal) { x.translate(dx + i * step + (flip ? step : 0), dy); x.scale(flip ? -1 : 1, 1); draw(sx, sy, sw, sh, 0, 0, step + .6, sh * k); }
      else { x.translate(dx, dy + i * step + (flip ? step : 0)); x.scale(1, flip ? -1 : 1); draw(sx, sy, sw, sh, 0, 0, sw * k, step + .6); }
      x.restore();
    }
  };
  const width = inner.right - inner.left - corner * 2, height = inner.bottom - inner.top - corner * 2;
  side(true, inner.left + corner, 0, width, inner.top, start, start - inner.top * k); side(true, inner.left + corner, inner.bottom, width, bottom, start, end);
  side(false, 0, inner.top + corner, inner.left, height, start - inner.left * k, start); side(false, inner.right, inner.top + corner, right, height, end, start);
  draw(0, 0, inner.left + corner, inner.top, start - inner.left * k, start - inner.top * k, (inner.left + corner) * k, inner.top * k);
  draw(0, 0, inner.left, inner.top + corner, start - inner.left * k, start - inner.top * k, inner.left * k, (inner.top + corner) * k);
  draw(inner.right - corner, 0, right + corner, inner.top, end - corner * k, start - inner.top * k, (right + corner) * k, inner.top * k);
  draw(inner.right, 0, right, inner.top + corner, end, start - inner.top * k, right * k, (inner.top + corner) * k);
  draw(0, inner.bottom, inner.left + corner, bottom, start - inner.left * k, end, (inner.left + corner) * k, bottom * k);
  draw(0, inner.bottom - corner, inner.left, bottom + corner, start - inner.left * k, end - corner * k, inner.left * k, (bottom + corner) * k);
  draw(inner.right - corner, inner.bottom, right + corner, bottom, end - corner * k, end, (right + corner) * k, bottom * k);
  draw(inner.right, inner.bottom - corner, right, bottom + corner, end, end - corner * k, right * k, (bottom + corner) * k);
  g.flowers.forEach((flower, i) => { // branches that carry the three flowers
    x.save(); x.translate(end + frame * .55, flower.y - g.y + pad + g.flower * .27); x.rotate(i === 2 ? .1 : -.06);
    draw(300, 70, 330, 101, 0, -g.flower * .13, g.flower * .62, g.flower * .24); x.restore();
  });
  x.restore();
}
