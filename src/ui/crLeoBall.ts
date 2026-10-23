import type { SpriteFrame } from './crLeoSprites';

const buffers = new WeakMap<readonly SpriteFrame[], HTMLCanvasElement>();

/** Registered photographic frames rotate the pattern while daylight stays fixed. */
export function drawFootball(c: CanvasRenderingContext2D, frames: readonly SpriteFrame[], x: number, y: number, radius: number, rotation: number, alpha = 1) {
  if (!frames.length) return;
  const phase = rotation / (Math.PI * 2) * frames.length, whole = Math.floor(phase), blend = phase - whole;
  const index = (whole % frames.length + frames.length) % frames.length;
  let buffer = buffers.get(frames);
  if (!buffer) { buffer = document.createElement('canvas'); buffer.width = buffer.height = 128; buffers.set(frames, buffer); }
  const b = buffer.getContext('2d')!; b.clearRect(0, 0, 128, 128);
  const draw = (frame: SpriteFrame, opacity: number) => {
    // Register every silhouette by its actual bounds, avoiding atlas padding jitter.
    const scale = 128 / Math.max(frame.image.width, frame.image.height);
    const width = frame.image.width * scale, height = frame.image.height * scale;
    b.globalAlpha = opacity; b.drawImage(frame.image, 64 - width / 2, 64 - height / 2, width, height);
  };
  draw(frames[index], 1); if (blend) draw(frames[(index + 1) % frames.length], blend);
  c.save(); c.globalAlpha = alpha; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.clip();
  // Apply any result fade once to the composite, preserving its opacity while blending.
  c.drawImage(buffer, x - radius, y - radius, radius * 2, radius * 2);
  c.restore();
}
