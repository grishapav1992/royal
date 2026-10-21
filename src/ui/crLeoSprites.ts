export type SpritePart = { id: number; area: number; left: number; top: number; right: number; bottom: number };
/** A diving player can cross a nominal atlas cell. Select whole connected silhouettes. */
export function spriteParts(rgba: Uint8ClampedArray, width: number, height: number, cols: number, rows: number, confine = false, members = 1) {
  const labels = new Int32Array(width * height), queue = new Int32Array(width * height);
  const parts: (SpritePart | undefined)[] = Array(cols * rows).fill(undefined);
  const groups: SpritePart[][] = Array.from({ length: cols * rows }, () => []);
  const cw = width / cols, ch = height / rows; let id = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || rgba[start * 4 + 3] < 160) continue;
    id++; let head = 0, tail = 1, area = 0, left = width, top = height, right = 0, bottom = 0;
    queue[0] = start; labels[start] = id;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width); area++;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      const add = (next: number) => { if (confine && (Math.floor(next % width / cw) !== Math.floor(x / cw) || Math.floor(Math.floor(next / width) / ch) !== Math.floor(y / ch))) return; if (!labels[next] && rgba[next * 4 + 3] >= 160) { labels[next] = id; queue[tail++] = next; } };
      if (x) add(index - 1); if (x + 1 < width) add(index + 1); if (y) add(index - width); if (y + 1 < height) add(index + width);
    }
    if (area < cw * ch * .015) continue;
    const col = Math.max(0, Math.min(cols - 1, Math.floor((left + right) / 2 / cw))), row = Math.max(0, Math.min(rows - 1, Math.floor((top + bottom) / 2 / ch))), cell = row * cols + col;
    const part = { id, area, left, right, top, bottom };
    groups[cell].push(part);
    if (!parts[cell] || parts[cell]!.area < area) parts[cell] = part;
  }
  for (const group of groups) { group.sort((a,b) => b.area-a.area); group.splice(members); }
  return { parts, labels, groups };
}
export type SpriteFrame = { image: HTMLCanvasElement; x: number; y: number; width: number; height: number; hand?: {x:number;y:number} };
export function extractSpriteFrames(image: HTMLImageElement, cols: number, rows: number, confine = rows === 4, handHints?: readonly ('left' | 'right' | 'high' | 'center' | undefined)[], members = 1): SpriteFrame[] {
  const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
  const ctx = source.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, source.width, source.height), { parts, labels, groups } = spriteParts(data.data, source.width, source.height, cols, rows, confine, members);
  if (parts.some(p => !p)) throw Error('Missing football sprite pose');
  const cw = source.width / cols, ch = source.height / rows;
  return groups.map((group, cell) => {
    const ids = new Set(group.map(p => p.id));
    const left = Math.max(0, Math.min(...group.map(p => p.left)) - 1), top = Math.max(0, Math.min(...group.map(p => p.top)) - 1), right = Math.min(source.width - 1, Math.max(...group.map(p => p.right)) + 1), bottom = Math.min(source.height - 1, Math.max(...group.map(p => p.bottom)) + 1);
    const frame = document.createElement('canvas'); frame.width = right - left + 1; frame.height = bottom - top + 1;
    const frameCtx = frame.getContext('2d')!, pixels = frameCtx.createImageData(frame.width, frame.height);
    let gloveX = 0, gloveY = 0, gloves = 0;
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const index = y * source.width + x;
      const belongs = ids.has(labels[index]) || data.data[index * 4 + 3] < 160 && [index - 1, index + 1, index - source.width, index + source.width].some(n => n >= 0 && n < labels.length && ids.has(labels[n]));
      if (!belongs) continue;
      const to = ((y - top) * frame.width + x - left) * 4;
      pixels.data.set(data.data.subarray(index * 4, index * 4 + 4), to);
      const u = (x - cell % cols * cw) / cw, v = (y - Math.floor(cell / cols) * ch) / ch, color = data.data.subarray(index * 4, index * 4 + 4);
      const hint = handHints?.[cell], gloveRegion = hint === 'left' ? u < .4 : hint === 'right' ? u > .6 : hint === 'high' ? u > .2 && u < .8 && v < .4 : hint === 'center' ? u > .2 && u < .8 && v > .25 && v < .70 : false;
      if (gloveRegion && color[0] > 175 && color[1] > 175 && color[2] > 155 && Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2]) < 65) { gloveX += x; gloveY += y; gloves++; }
    }
    frameCtx.putImageData(pixels, 0, 0);
    return { image: frame, x: (left - cell % cols * cw) / cw, y: (top - Math.floor(cell / cols) * ch) / ch, width: frame.width / cw, height: frame.height / ch, ...(gloves ? { hand: { x: (gloveX / gloves - cell % cols * cw) / cw, y: (gloveY / gloves - Math.floor(cell / cols) * ch) / ch } } : {}) };
  });
}
